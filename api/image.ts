import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';

type VercelIncomingMessage = IncomingMessage & { body?: unknown };

const PAID_GEMINI_IMAGE_MODELS = new Set([
  'gemini-3.1-flash-lite-image',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image',
]);

const STYLE_SUFFIXES: Record<string, string> = {
  none: '',
  'product-photography': 'clean commercial product photography, studio lighting, crisp textures, soft shadows',
  'lifestyle-photography': 'authentic lifestyle photography, natural daylight, candid editorial framing, warm tones',
  'commercial-advertising': 'high-impact commercial advertising photography, balanced composition, polished lighting',
  illustration: 'refined editorial vector and hand-inked illustration, cohesive palette',
  anime: 'high-craft anime illustration, expressive lighting, clean cel shading',
  photorealism: 'photorealistic camera capture, natural depth of field, true-to-life lighting',
  'digital-artwork': 'contemporary digital artwork, rich atmospheric lighting, clean brushwork',
  '3d-artwork': 'stylized 3D render, soft global illumination, tactile matte and satin materials',
};

const ASPECT_DIMS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '16:9': { width: 1024, height: 576 },
  '3:4': { width: 768, height: 1024 },
  '9:16': { width: 576, height: 1024 },
};

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJson(req: VercelIncomingMessage): Promise<Record<string, unknown> | null> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > 4_000_000) return null;
    chunks.push(buf);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelIncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/image.' });
    return;
  }

  const hfToken = process.env.HF_API_TOKEN?.trim();
  const hfModel = process.env.HF_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell';
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiImgModel = process.env.GEMINI_IMAGE_MODEL?.trim();

  const useHf = Boolean(hfToken && hfToken !== 'MY_HF_TOKEN');
  const useGemini =
    !useHf &&
    Boolean(
      geminiKey &&
        geminiKey !== 'MY_GEMINI_API_KEY' &&
        geminiImgModel &&
        /^gemini-[a-z0-9.-]+$/i.test(geminiImgModel) &&
        (!PAID_GEMINI_IMAGE_MODELS.has(geminiImgModel.toLowerCase()) ||
          process.env.ALLOW_PAID_IMAGE_MODEL === 'true')
    );

  const body = await readJson(req);
  if (!body) {
    sendJson(res, 400, { code: 'INVALID_JSON', message: 'Valid JSON request body is required.' });
    return;
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 1000) {
    sendJson(res, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Please provide an image prompt between 1 and 1000 characters.',
    });
    return;
  }

  const style = typeof body.style === 'string' && body.style in STYLE_SUFFIXES ? body.style : 'none';
  const aspectRatio =
    typeof body.aspectRatio === 'string' && body.aspectRatio in ASPECT_DIMS
      ? body.aspectRatio
      : '1:1';
  const count: 1 | 2 = body.count === 2 ? 2 : 1;

  try {
    const images: Array<{
      dataUrl: string;
      mimeType: string;
      provider: string;
      model: string;
      variantIndex: number;
    }> = [];

    if (useHf && hfToken) {
      if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(hfModel)) {
        sendJson(res, 500, { code: 'INVALID_CONFIG', message: 'Invalid HF_IMAGE_MODEL identifier.' });
        return;
      }
      const dims = ASPECT_DIMS[aspectRatio];
      const endpoint = `https://router.huggingface.co/hf-inference/models/${hfModel}`;
      for (let i = 0; i < count; i++) {
        const suffix = STYLE_SUFFIXES[style];
        const variation =
          count === 2
            ? i === 0
              ? 'primary balanced framing and natural composition'
              : 'distinct alternative framing, angle, and lighting variation'
            : '';
        const styledPrompt = [prompt, suffix, variation].filter(Boolean).join(', ');
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: styledPrompt,
            parameters: {
              width: dims.width,
              height: dims.height,
              seed: Math.floor(Math.random() * 2_000_000_000) + i * 97,
            },
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`Hugging Face provider returned HTTP ${resp.status}: ${text.slice(0, 120)}`);
        }
        const mime = resp.headers.get('content-type') || 'image/png';
        if (!mime.startsWith('image/')) {
          throw new Error('Hugging Face provider did not return an image payload.');
        }
        const b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
        images.push({
          dataUrl: `data:${mime};base64,${b64}`,
          mimeType: mime,
          provider: 'huggingface',
          model: hfModel,
          variantIndex: i,
        });
      }
      sendJson(res, 200, { ok: true, provider: 'huggingface', model: hfModel, images });
      return;
    }

    if (useGemini && geminiKey && geminiImgModel) {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { timeout: 25_000, headers: { 'User-Agent': 'aistudio-build' } },
      });
      const refB64 =
        typeof body.referenceImageBase64 === 'string'
          ? body.referenceImageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
          : undefined;
      const refMime =
        typeof body.referenceImageMimeType === 'string' &&
        /^image\/(png|jpeg|webp)$/i.test(body.referenceImageMimeType)
          ? body.referenceImageMimeType
          : 'image/jpeg';

      for (let i = 0; i < count; i++) {
        const suffix = STYLE_SUFFIXES[style];
        const variation =
          count === 2
            ? i === 0
              ? 'primary balanced framing'
              : 'distinct alternative framing and angle'
            : '';
        const styledPrompt = [prompt, suffix, variation].filter(Boolean).join(', ');
        const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> =
          [];
        if (refB64 && /^[A-Za-z0-9+/=]+$/.test(refB64)) {
          parts.push({ inlineData: { data: refB64, mimeType: refMime } });
        }
        parts.push({ text: styledPrompt });

        const resp = await ai.models.generateContent({
          model: geminiImgModel,
          contents: { parts },
          config: { imageConfig: { aspectRatio } },
        });
        let found = false;
        for (const part of resp.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            images.push({
              dataUrl: `data:${mime};base64,${part.inlineData.data}`,
              mimeType: mime,
              provider: 'gemini',
              model: geminiImgModel,
              variantIndex: i,
            });
            found = true;
            break;
          }
        }
        if (!found) {
          throw new Error('The configured image model did not return an image.');
        }
      }
      sendJson(res, 200, { ok: true, provider: 'gemini', model: geminiImgModel, images });
      return;
    }

    const cleanPrompt = prompt
      .replace(
        /^(?:please\s+)?(?:can you\s+|could you\s+|help me\s+|i want you to\s+|i need you to\s+)?(?:generat\w*|creat\w*|make|draw|paint|render|illustrat\w*|design)(?:\s+me)?\s+(?:an?\s+)?(?:(?:image|picture|pic|photo|artwork|illustration)\s+of\s+)?/i,
        ''
      )
      .replace(/\b(?:as my|for my|as a|for a)\s+(?:desktop|laptop|phone|mobile)\s*(?:wallpaper|background)?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || prompt;

    const dims = ASPECT_DIMS[aspectRatio];
    const hordeDims: Record<string, { width: number; height: number }> = {
      '1:1': { width: 512, height: 512 },
      '4:3': { width: 576, height: 448 },
      '16:9': { width: 640, height: 384 },
      '3:4': { width: 448, height: 576 },
      '9:16': { width: 384, height: 640 },
    };
    const hDim = hordeDims[aspectRatio] ?? { width: 512, height: 512 };
    const hordeKey = process.env.AI_HORDE_API_KEY?.trim() || '0000000000';
    const hordeModels = [
      'stable_diffusion',
      'DreamShaper',
      'AbsoluteReality',
      'Deliberate',
      'Realistic Vision',
      'Epic Diffusion',
      'Analog Diffusion',
    ];

    for (let i = 0; i < count; i++) {
      const suffix = STYLE_SUFFIXES[style];
      const variation =
        count === 2
          ? i === 0
            ? 'primary balanced framing and natural composition'
            : 'distinct alternative framing, angle, and lighting variation'
          : '';
      const styledPrompt = [cleanPrompt, suffix, variation].filter(Boolean).join(', ');
      let pushed = false;

      try {
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
              models: hordeModels,
              params: {
                width: hDim.width,
                height: hDim.height,
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
          if (submitRes.ok) {
            const submitData = (await submitRes.json()) as { id?: string };
            if (submitData.id) jobId = submitData.id;
          }
        } finally {
          clearTimeout(submitTimer);
        }

        if (jobId) {
          const deadline = Date.now() + 32_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1200));
            const statusController = new AbortController();
            const statusTimer = setTimeout(() => statusController.abort(), 4000);
            try {
              const stRes = await fetch(
                `https://aihorde.net/api/v2/generate/status/${encodeURIComponent(jobId)}`,
                { signal: statusController.signal }
              );
              if (!stRes.ok) continue;
              const stData = (await stRes.json()) as {
                done?: boolean;
                faulted?: boolean;
                generations?: Array<{ img?: string; model?: string }>;
              };
              if (stData.faulted) break;
              if (stData.done && stData.generations?.[0]?.img?.startsWith('https://')) {
                const imgController = new AbortController();
                const imgTimer = setTimeout(() => imgController.abort(), 7000);
                try {
                  const imgRes = await fetch(stData.generations[0].img, {
                    signal: imgController.signal,
                  });
                  if (imgRes.ok) {
                    const mime = imgRes.headers.get('content-type') || 'image/webp';
                    if (mime.startsWith('image/')) {
                      const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
                      images.push({
                        dataUrl: `data:${mime};base64,${b64}`,
                        mimeType: mime,
                        provider: 'aihorde',
                        model: stData.generations[0].model || 'stable_diffusion_free',
                        variantIndex: i,
                      });
                      pushed = true;
                    }
                  }
                } finally {
                  clearTimeout(imgTimer);
                }
                break;
              }
            } finally {
              clearTimeout(statusTimer);
            }
          }
        }
      } catch {
        // Fall through to Gemini SVG artwork
      }

      if (pushed) continue;

      if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
        const svgAi = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: { timeout: 10_000, headers: { 'User-Agent': 'aistudio-build' } },
        });
        for (const svgModel of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash']) {
          try {
            const svgResp = await Promise.race([
              svgAi.models.generateContent({
                model: svgModel,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `Create a rich, detailed, visually stunning standalone SVG illustration (${dims.width}x${dims.height} viewBox="0 0 ${dims.width} ${dims.height}") depicting: "${styledPrompt}". Use layered gradients, atmospheric lighting, clean vector silhouettes and shapes, depth, and vibrant colors. Strictly NO <text> elements, NO words, NO labels, NO titles anywhere inside the SVG. Output ONLY raw <svg ...>...</svg> markup with zero markdown fences.`,
                      },
                    ],
                  },
                ],
                config: { maxOutputTokens: 3072, temperature: 0.7 },
              }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
            ]);
            const raw = (svgResp.text ?? '')
              .trim()
              .replace(/^```(?:svg|xml|html)?\s*/i, '')
              .replace(/\s*```$/i, '')
              .trim();
            const start = raw.indexOf('<svg');
            const end = raw.lastIndexOf('</svg>');
            if (start !== -1 && end > start) {
              const svg = raw.slice(start, end + 6);
              if (!/<text\b|<script|onload=|onerror=|javascript:/i.test(svg)) {
                images.push({
                  dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
                  mimeType: 'image/svg+xml',
                  provider: 'gemini-vector',
                  model: svgModel,
                  variantIndex: i,
                });
                pushed = true;
                break;
              }
            }
          } catch {
            // Try next fast model
          }
        }
        if (pushed) continue;
      }

      sendJson(res, 503, {
        code: 'IMAGE_GENERATION_BUSY',
        message: 'The free image generator is busy right now. Please click Retry to try again.',
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      provider: images[0]?.provider ?? 'aihorde',
      model: images[0]?.model ?? 'stable_diffusion_free',
      images,
    });
  } catch (err) {
    sendJson(res, 502, {
      code: 'IMAGE_GENERATION_FAILED',
      message: err instanceof Error ? err.message : 'Image generation failed.',
    });
  }
}
