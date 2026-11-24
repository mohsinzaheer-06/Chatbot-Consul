import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const ELIGIBLE_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
const PAID_GEMINI_IMAGE_MODELS = new Set([
  'gemini-3.1-flash-lite-image',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image',
]);
const IMAGE_UNAVAILABLE_MESSAGE =
  'Image generation is currently unavailable because no eligible free image-generation provider is configured. No paid API will be used.';

function resolveDefaultModel(envDefault?: string | null): string {
  const trimmed = envDefault?.trim();
  if (trimmed && /^gemini-[a-z0-9.-]+$/i.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_MODEL;
}

function resolveLiveModel(envLive?: string | null): string {
  const trimmed = envLive?.trim();
  if (trimmed && /^gemini-[a-z0-9.-]+$/i.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_LIVE_MODEL;
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const configured = Boolean(key && key !== 'MY_GEMINI_API_KEY');
  const liveModel = resolveLiveModel(process.env.GEMINI_LIVE_MODEL);

  const hfToken = process.env.HF_API_TOKEN?.trim();
  const hfModel = process.env.HF_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell';
  const configuredImg = process.env.GEMINI_IMAGE_MODEL?.trim();

  let imageProvider: 'none' | 'gemini' | 'huggingface' | 'pollinations' = 'pollinations';
  let imageModel: string | undefined = 'flux-free';
  let imageAvailable = true;
  let imageUnavailableReason: string | undefined = undefined;

  if (hfToken && hfToken !== 'MY_HF_TOKEN') {
    imageProvider = 'huggingface';
    imageModel = hfModel;
    imageAvailable = true;
    imageUnavailableReason = undefined;
  } else if (
    configured &&
    configuredImg &&
    /^gemini-[a-z0-9.-]+$/i.test(configuredImg) &&
    (!PAID_GEMINI_IMAGE_MODELS.has(configuredImg.toLowerCase()) ||
      process.env.ALLOW_PAID_IMAGE_MODEL === 'true')
  ) {
    imageProvider = 'gemini';
    imageModel = configuredImg;
    imageAvailable = true;
    imageUnavailableReason = undefined;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      ok: true,
      configured,
      nodeVersion: process.version,
      defaultModel: resolveDefaultModel(process.env.GEMINI_MODEL),
      eligibleModels: ELIGIBLE_MODELS,
      liveModel,
      liveAvailable: configured && Boolean(liveModel),
      liveTransport: configured ? 'ephemeral-only' : 'unavailable',
      liveUnavailableReason: configured
        ? undefined
        : 'GEMINI_API_KEY is not configured on the server.',
      imageModel,
      imageProvider,
      imageAvailable,
      imageUnavailableReason,
      freeOnlyPolicy: true,
      rateLimit: {
        windowSec: 60,
        maxRequests: 25,
      },
    })
  );
}
