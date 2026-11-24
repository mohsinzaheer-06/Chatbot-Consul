import {
  IMAGE_STYLE_PRESETS,
  IMAGE_UNAVAILABLE_MESSAGE,
  resolveConfiguredImageModel,
} from '../src/lib/models';
import type { ImageAspectRatio, ImageStylePreset } from '../src/types/chat';
import { getGeminiClient, isApiKeyConfigured, mapGeminiError } from './gemini';

export interface ImageProviderAvailability {
  available: boolean;
  provider: 'none' | 'gemini' | 'huggingface' | 'pollinations';
  model?: string;
  unavailableReason?: string;
}

export interface GenerateImagesRequest {
  prompt: string;
  style: ImageStylePreset;
  aspectRatio: ImageAspectRatio;
  count: 1 | 2;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

export interface GeneratedImageOutput {
  dataUrl: string;
  mimeType: string;
  provider: string;
  model: string;
  variantIndex: number;
}

const VALID_ASPECT_RATIOS = new Set<ImageAspectRatio>(['1:1', '4:3', '16:9', '3:4', '9:16']);

const ASPECT_RATIO_DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '16:9': { width: 1024, height: 576 },
  '3:4': { width: 768, height: 1024 },
  '9:16': { width: 576, height: 1024 },
};

export function getImageProviderAvailability(): ImageProviderAvailability {
  const hfToken = process.env.HF_API_TOKEN?.trim();
  const hfModel = process.env.HF_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell';

  if (hfToken && hfToken !== 'MY_HF_TOKEN') {
    return {
      available: true,
      provider: 'huggingface',
      model: hfModel,
    };
  }

  const configuredGemini = resolveConfiguredImageModel(process.env.GEMINI_IMAGE_MODEL);
  if (configuredGemini.model && isApiKeyConfigured()) {
    if (!configuredGemini.isPaidModel || process.env.ALLOW_PAID_IMAGE_MODEL === 'true') {
      return {
        available: true,
        provider: 'gemini',
        model: configuredGemini.model,
      };
    }
  }

  return {
    available: true,
    provider: 'pollinations',
    model: 'flux-free',
  };
}

export function validateImageGenerationRequest(
  body: unknown
): { ok: true; data: GenerateImagesRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) {
    return { ok: false, error: 'Please enter a prompt describing the image you want to generate.' };
  }
  if (prompt.length > 1000) {
    return { ok: false, error: 'Prompt must be 1000 characters or fewer.' };
  }

  const stylePreset = IMAGE_STYLE_PRESETS.some((s) => s.id === raw.style)
    ? (raw.style as ImageStylePreset)
    : 'none';
  const aspectRatio = VALID_ASPECT_RATIOS.has(raw.aspectRatio as ImageAspectRatio)
    ? (raw.aspectRatio as ImageAspectRatio)
    : '1:1';
  const count: 1 | 2 = raw.count === 2 ? 2 : 1;

  let referenceImageBase64: string | undefined;
  let referenceImageMimeType: string | undefined;
  if (typeof raw.referenceImageBase64 === 'string' && raw.referenceImageBase64.trim()) {
    const cleaned = raw.referenceImageBase64
      .trim()
      .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    if (cleaned.length > 3_200_000 || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      return { ok: false, error: 'Reference image is invalid or exceeds size limit.' };
    }
    const mime =
      typeof raw.referenceImageMimeType === 'string' &&
      /^image\/(png|jpeg|jpg|webp)$/i.test(raw.referenceImageMimeType.trim())
        ? raw.referenceImageMimeType.trim().toLowerCase()
        : 'image/jpeg';
    referenceImageBase64 = cleaned;
    referenceImageMimeType = mime === 'image/jpg' ? 'image/jpeg' : mime;
  }

  return {
    ok: true,
    data: {
      prompt,
      style: stylePreset,
      aspectRatio,
      count,
      referenceImageBase64,
      referenceImageMimeType,
    },
  };
}

function composeStyledPrompt(
  prompt: string,
  style: ImageStylePreset,
  variantIndex: number,
  totalCount: number
): string {
  const preset = IMAGE_STYLE_PRESETS.find((s) => s.id === style);
  const parts = [prompt];
  if (preset?.promptSuffix) {
    parts.push(preset.promptSuffix);
  }
  if (totalCount === 2) {
    parts.push(
      variantIndex === 0
        ? 'primary balanced framing and natural composition'
        : 'distinct alternative framing, angle, and lighting variation'
    );
  }
  return parts.join(', ');
}

async function generateWithHuggingFace(
  req: GenerateImagesRequest,
  model: string
): Promise<GeneratedImageOutput[]> {
  const token = process.env.HF_API_TOKEN?.trim();
  if (!token) {
    throw new Error('NO_FREE_PROVIDER');
  }
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(model)) {
    throw new Error('Invalid Hugging Face image model identifier.');
  }

  const dims = ASPECT_RATIO_DIMENSIONS[req.aspectRatio];
  const endpoint = `https://router.huggingface.co/hf-inference/models/${model}`;
  const results: GeneratedImageOutput[] = [];

  for (let i = 0; i < req.count; i++) {
    const styledPrompt = composeStyledPrompt(req.prompt, req.style, i, req.count);
    const seed = Math.floor(Math.random() * 2_000_000_000) + i * 97;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: styledPrompt,
          parameters: {
            width: dims.width,
            height: dims.height,
            seed,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Hugging Face provider returned HTTP ${response.status}: ${text.slice(0, 140)}`);
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/')) {
        throw new Error('Image provider did not return an image payload.');
      }
      const arrayBuf = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      results.push({
        dataUrl: `data:${contentType};base64,${base64}`,
        mimeType: contentType,
        provider: 'huggingface',
        model,
        variantIndex: i,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return results;
}

async function generateWithConfiguredGeminiModel(
  req: GenerateImagesRequest,
  model: string
): Promise<GeneratedImageOutput[]> {
  const ai = getGeminiClient();
  const results: GeneratedImageOutput[] = [];

  for (let i = 0; i < req.count; i++) {
    const styledPrompt = composeStyledPrompt(req.prompt, req.style, i, req.count);
    const parts: Array<
      | { text: string }
      | { inlineData: { data: string; mimeType: string } }
    > = [];
    if (req.referenceImageBase64 && req.referenceImageMimeType) {
      parts.push({
        inlineData: {
          data: req.referenceImageBase64,
          mimeType: req.referenceImageMimeType,
        },
      });
    }
    parts.push({ text: styledPrompt });

    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: req.aspectRatio,
        },
      },
    });

    let found = false;
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || 'image/png';
        results.push({
          dataUrl: `data:${mime};base64,${part.inlineData.data}`,
          mimeType: mime,
          provider: 'gemini',
          model,
          variantIndex: i,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error('The configured image model did not return an image output.');
    }
  }

  return results;
}

async function generateWithPollinations(
  req: GenerateImagesRequest,
  model: string
): Promise<GeneratedImageOutput[]> {
  const dims = ASPECT_RATIO_DIMENSIONS[req.aspectRatio];
  const results: GeneratedImageOutput[] = [];

  for (let i = 0; i < req.count; i++) {
    const styledPrompt = composeStyledPrompt(req.prompt, req.style, i, req.count);
    const seed = Math.floor(Math.random() * 2_000_000_000) + i * 97;
    const endpoint = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      styledPrompt
    )}?width=${dims.width}&height=${dims.height}&seed=${seed}&nologo=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'image/*',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Free image provider returned HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuf = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      results.push({
        dataUrl: `data:${contentType};base64,${base64}`,
        mimeType: contentType,
        provider: 'pollinations',
        model,
        variantIndex: i,
      });
    } catch {
      const escapeXml = (str: string) =>
        str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}" viewBox="0 0 ${dims.width} ${dims.height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#3b0764"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${dims.width * 0.5}" cy="${dims.height * 0.5}" r="${Math.min(dims.width, dims.height) * 0.35}" fill="url(#glow)"/>
  <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="28" font-weight="700">${escapeXml(req.prompt.slice(0, 48))}</text>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="15">Style: ${req.style} · Free Generative Art</text>
</svg>`;
      const base64Svg = Buffer.from(svgFallback).toString('base64');
      results.push({
        dataUrl: `data:image/svg+xml;base64,${base64Svg}`,
        mimeType: 'image/svg+xml',
        provider: 'pollinations-fallback',
        model,
        variantIndex: i,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return results;
}

export async function generateImagesWithProvider(
  req: GenerateImagesRequest
): Promise<
  | { ok: true; images: GeneratedImageOutput[]; provider: string; model: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const availability = getImageProviderAvailability();
  if (!availability.available || !availability.model) {
    return {
      ok: false,
      status: 503,
      code: 'IMAGE_PROVIDER_UNAVAILABLE',
      message: availability.unavailableReason ?? IMAGE_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const images =
      availability.provider === 'huggingface'
        ? await generateWithHuggingFace(req, availability.model)
        : availability.provider === 'gemini'
          ? await generateWithConfiguredGeminiModel(req, availability.model)
          : await generateWithPollinations(req, availability.model);

    return {
      ok: true,
      images,
      provider: availability.provider,
      model: availability.model,
    };
  } catch (err) {
    if (availability.provider === 'gemini') {
      const mapped = mapGeminiError(err);
      return {
        ok: false,
        status: mapped.status,
        code: mapped.code,
        message: mapped.message,
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'IMAGE_GENERATION_FAILED',
      message:
        err instanceof Error
          ? err.message
          : 'Image generation failed on the configured free provider.',
    };
  }
}
