import {
  IMAGE_STYLE_PRESETS,
  IMAGE_UNAVAILABLE_MESSAGE,
  resolveConfiguredImageModel,
} from '../src/lib/models';
import type { ImageAspectRatio, ImageStylePreset } from '../src/types/chat';
import { getGeminiClient, isApiKeyConfigured, mapGeminiError } from './gemini';

export interface ImageProviderAvailability {
  available: boolean;
  provider: 'none' | 'gemini' | 'huggingface' | 'aihorde';
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

export function detectImageIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) return false;
  return (
    /\b(generat\w*|creat\w*|make|draw|paint|render|illustrat\w*|design)\b.{0,50}\b(image|images|picture|pictures|pic|pics|photo|photos|illustration|art|artwork|wallpaper|wallpapers|portrait|icon|logo|banner|sketch|poster|drawing)\b/i.test(
      trimmed
    ) ||
    /^(?:image of|picture of|photo of|wallpaper of|draw me|draw a|draw an|paint a|paint an|sketch a|sketch an|create an? image|generat\w* an? image|make an? image|make me an? image)\b/i.test(
      trimmed
    )
  );
}

export function cleanImagePrompt(rawPrompt: string): string {
  const cleaned = rawPrompt
    .trim()
    .replace(
      /^(?:please\s+)?(?:can you\s+|could you\s+|help me\s+|i want you to\s+|i need you to\s+)?(?:generat\w*|creat\w*|make|draw|paint|render|illustrat\w*|design)(?:\s+me)?\s+(?:an?\s+)?(?:(?:image|picture|pic|photo|artwork|illustration)\s+of\s+)?/i,
      ''
    )
    .replace(/\b(?:as my|for my|as a|for a)\s+(?:desktop|laptop|phone|mobile)\s*(?:wallpaper|background)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 3 ? cleaned : rawPrompt.trim();
}

export function inferImageAspectRatio(message: string): ImageAspectRatio {
  const lower = message.toLowerCase();
  if (
    /\b(desktop|laptop|widescreen|landscape|banner|wallpaper|16:9|panoramic|ultrawide|cover)\b/.test(
      lower
    )
  ) {
    return '16:9';
  }
  if (/\b(phone|mobile|story|stories|reel|vertical|portrait|9:16|lockscreen)\b/.test(lower)) {
    return '9:16';
  }
  if (/\b(4:3)\b/.test(lower)) return '4:3';
  if (/\b(3:4)\b/.test(lower)) return '3:4';
  return '1:1';
}

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
    provider: 'aihorde',
    model: 'stable_diffusion_free',
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
  const parts = [cleanImagePrompt(prompt)];
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

const AI_HORDE_DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 512, height: 512 },
  '4:3': { width: 576, height: 448 },
  '16:9': { width: 640, height: 384 },
  '3:4': { width: 448, height: 576 },
  '9:16': { width: 384, height: 640 },
};

const AI_HORDE_FAST_MODELS = [
  'stable_diffusion',
  'DreamShaper',
  'AbsoluteReality',
  'Deliberate',
  'Realistic Vision',
  'Epic Diffusion',
  'Analog Diffusion',
];

async function generateGeminiSvgArt(
  prompt: string,
  aspectRatio: ImageAspectRatio
): Promise<{ svg: string; model: string } | null> {
  if (!isApiKeyConfigured()) return null;
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];
  const ai = getGeminiClient();
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash']) {
    try {
      const resp = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Create a rich, detailed, visually stunning standalone SVG illustration (${dims.width}x${dims.height} viewBox="0 0 ${dims.width} ${dims.height}") depicting: "${prompt}". Use layered gradients, atmospheric lighting, clean vector silhouettes and shapes, depth, and vibrant colors. Strictly NO <text> elements, NO words, NO labels, NO titles anywhere inside the SVG. Output ONLY raw <svg ...>...</svg> markup with zero markdown fences.`,
                },
              ],
            },
          ],
          config: { maxOutputTokens: 3072, temperature: 0.7 },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
      ]);
      const raw = (resp.text ?? '')
        .trim()
        .replace(/^```(?:svg|xml|html)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const start = raw.indexOf('<svg');
      const end = raw.lastIndexOf('</svg>');
      if (start !== -1 && end > start) {
        const svg = raw.slice(start, end + 6);
        if (!/<text\b|<script|onload=|onerror=|javascript:/i.test(svg)) {
          return { svg, model };
        }
      }
    } catch {
      // Try next fast model
    }
  }
  return null;
}

async function generateSingleWithAiHorde(
  styledPrompt: string,
  aspectRatio: ImageAspectRatio,
  variantIndex: number
): Promise<GeneratedImageOutput | null> {
  const dims = AI_HORDE_DIMENSIONS[aspectRatio];
  const hordeKey = process.env.AI_HORDE_API_KEY?.trim() || '0000000000';

  const submitController = new AbortController();
  const submitTimer = setTimeout(() => submitController.abort(), 5000);
  let jobId = '';
  try {
    const submitRes = await fetch('https://aihorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: hordeKey,
        'Client-Agent': 'ConsulAI:1.0:https://consul-ai.vercel.app',
      },
      body: JSON.stringify({
        prompt: `${styledPrompt}, high quality, detailed`,
        models: AI_HORDE_FAST_MODELS,
        params: {
          width: dims.width,
          height: dims.height,
          steps: 14,
          n: 1,
          sampler_name: 'k_euler_a',
        },
        nsfw: false,
        censor_nsfw: true,
        r2: true,
      }),
      signal: submitController.signal,
    });
    if (!submitRes.ok) return null;
    const submitData = (await submitRes.json()) as { id?: string };
    if (!submitData.id) return null;
    jobId = submitData.id;
  } catch {
    return null;
  } finally {
    clearTimeout(submitTimer);
  }

  const deadline = Date.now() + 32_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const statusController = new AbortController();
    const statusTimer = setTimeout(() => statusController.abort(), 4000);
    try {
      const statusRes = await fetch(
        `https://aihorde.net/api/v2/generate/status/${encodeURIComponent(jobId)}`,
        { signal: statusController.signal }
      );
      if (!statusRes.ok) continue;
      const statusData = (await statusRes.json()) as {
        done?: boolean;
        faulted?: boolean;
        generations?: Array<{ img?: string; model?: string }>;
      };
      if (statusData.faulted) return null;
      if (statusData.done && statusData.generations?.[0]?.img) {
        const imgUrl = statusData.generations[0].img;
        if (imgUrl.startsWith('https://')) {
          const imgController = new AbortController();
          const imgTimer = setTimeout(() => imgController.abort(), 7000);
          try {
            const imgRes = await fetch(imgUrl, { signal: imgController.signal });
            if (imgRes.ok) {
              const mime = imgRes.headers.get('content-type') || 'image/webp';
              if (mime.startsWith('image/')) {
                const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
                return {
                  dataUrl: `data:${mime};base64,${b64}`,
                  mimeType: mime,
                  provider: 'aihorde',
                  model: statusData.generations[0].model || 'stable_diffusion_free',
                  variantIndex,
                };
              }
            }
          } finally {
            clearTimeout(imgTimer);
          }
        }
        return null;
      }
    } catch {
      // Keep polling until deadline
    } finally {
      clearTimeout(statusTimer);
    }
  }
  return null;
}

async function generateWithFreeAiHorde(
  req: GenerateImagesRequest,
  _model: string
): Promise<GeneratedImageOutput[]> {
  const results: GeneratedImageOutput[] = [];

  for (let i = 0; i < req.count; i++) {
    const styledPrompt = composeStyledPrompt(req.prompt, req.style, i, req.count);
    const hordeOut = await generateSingleWithAiHorde(styledPrompt, req.aspectRatio, i);
    if (hordeOut) {
      results.push(hordeOut);
      continue;
    }

    const geminiSvg = await generateGeminiSvgArt(styledPrompt, req.aspectRatio);
    if (geminiSvg) {
      results.push({
        dataUrl: `data:image/svg+xml;base64,${Buffer.from(geminiSvg.svg).toString('base64')}`,
        mimeType: 'image/svg+xml',
        provider: 'gemini-vector',
        model: geminiSvg.model,
        variantIndex: i,
      });
      continue;
    }

    throw new Error('IMAGE_GENERATION_BUSY');
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
          : await generateWithFreeAiHorde(req, availability.model);

    return {
      ok: true,
      images,
      provider: images[0]?.provider ?? availability.provider,
      model: images[0]?.model ?? availability.model,
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
    const rawMsg = err instanceof Error ? err.message : '';
    return {
      ok: false,
      status: 503,
      code: 'IMAGE_GENERATION_BUSY',
      message:
        rawMsg === 'IMAGE_GENERATION_BUSY'
          ? 'The free image generator is busy right now. Please click Retry to try again.'
          : rawMsg || 'Image generation failed on the configured free provider.',
    };
  }
}
