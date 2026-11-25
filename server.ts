import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { ELIGIBLE_MODELS, resolveEligibleModel, validateChatRequest } from './src/lib/chatValidation';
import { createStreamAccumulator } from './src/lib/streamParser';
import {
  extractGroundingSourcesFromChunk,
  generateChatStream,
  generateFollowUpsFallback,
  isApiKeyConfigured,
  mapGeminiError,
} from './server/gemini';
import {
  detectImageIntent,
  generateImagesWithProvider,
  getImageProviderAvailability,
  inferImageAspectRatio,
  validateImageGenerationRequest,
} from './server/imageProvider';
import { resolveUserLocationContext } from './server/location';
import type { ApiStatusSnapshot, GroundingSource } from './src/types/chat';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 25;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(clientIp: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = rateBuckets.get(clientIp) ?? [];
  const recent = existing.filter((ts) => now - ts < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000));
    rateBuckets.set(clientIp, recent);
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  rateBuckets.set(clientIp, recent);
  return { allowed: true, retryAfterSec: 0 };
}

function writeSseEvent(res: Response, payload: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const configured = isApiKeyConfigured();
    const imageStatus = getImageProviderAvailability();

    const snapshot: ApiStatusSnapshot = {
      ok: true,
      configured,
      nodeVersion: process.version,
      defaultModel: resolveEligibleModel(undefined, process.env.GEMINI_MODEL),
      eligibleModels: [...ELIGIBLE_MODELS],
      liveModel: '',
      liveAvailable: false,
      liveTransport: 'unavailable',
      liveUnavailableReason: 'Live voice is disabled.',
      imageModel: imageStatus.model,
      imageProvider: imageStatus.provider,
      imageAvailable: imageStatus.available,
      imageUnavailableReason: imageStatus.unavailableReason,
      freeOnlyPolicy: true,
      rateLimit: {
        windowSec: RATE_WINDOW_MS / 1000,
        maxRequests: RATE_MAX_REQUESTS,
      },
    };

    res.json(snapshot);
  });

  app.post('/api/image', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Please wait ${rate.retryAfterSec} seconds.`,
      });
      return;
    }

    const validation = validateImageGenerationRequest(req.body);
    if (!validation.ok) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: validation.error });
      return;
    }

    const result = await generateImagesWithProvider(validation.data);
    if (!result.ok) {
      res.status(result.status).json({ code: result.code, message: result.message });
      return;
    }

    res.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      images: result.images,
    });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Please wait ${rate.retryAfterSec} seconds before sending another message.`,
        retryable: true,
      });
      return;
    }

    const validation = validateChatRequest(req.body);
    if (!validation.ok) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: validation.error,
        retryable: false,
      });
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const accumulator = createStreamAccumulator();
    const seenUris = new Set<string>();
    const sources: GroundingSource[] = [];

    try {
      const locationContext = await resolveUserLocationContext({
        headers: req.headers,
        remoteAddress: req.socket.remoteAddress,
        clientContext: validation.data.clientContext,
      });

      const locationParts = [locationContext.city, locationContext.country].filter(Boolean);
      writeSseEvent(res, {
        type: 'context',
        timezone: locationContext.timezone,
        locationLabel: locationParts.length > 0 ? locationParts.join(', ') : undefined,
      });

      const hasAttachments = Boolean(
        validation.data.attachments && validation.data.attachments.length > 0
      );
      if (!hasAttachments && detectImageIntent(validation.data.message)) {
        try {
          const aspectRatio = inferImageAspectRatio(validation.data.message);
          const imageRes = await generateImagesWithProvider({
            prompt: validation.data.message,
            style: 'none',
            aspectRatio,
            count: 1,
          });
          if (imageRes.ok && imageRes.images.length > 0) {
            const img = imageRes.images[0];
            const safeAlt = validation.data.message.replace(/[\[\]()\r\n]/g, ' ').trim().slice(0, 80);
            writeSseEvent(res, { type: 'meta', model: imageRes.model || 'flux-free' });
            writeSseEvent(res, {
              type: 'delta',
              text: `Here is your generated image (${aspectRatio}):\n\n![${safeAlt || 'Generated image'}](${img.dataUrl})`,
            });
            writeSseEvent(res, {
              type: 'followups',
              questions: [
                'Create a slightly different variation of this image',
                'Make it in a cinematic or photorealistic style',
                'Adjust the aspect ratio or lighting',
              ],
            });
            writeSseEvent(res, { type: 'done' });
            if (!res.writableEnded) {
              res.end();
            }
            return;
          }
        } catch {
          // Fall back to text chat if image generation fails
        }
      }

      const { stream, model, fallbackSources } = await generateChatStream({
        message: validation.data.message,
        history: validation.data.history,
        attachments: validation.data.attachments,
        responseLength: validation.data.responseLength,
        preferredLanguage: validation.data.preferredLanguage,
        requestedModel: validation.data.model,
        locationContext,
        signal: abortController.signal,
      });

      for (const src of fallbackSources) {
        if (!seenUris.has(src.uri) && sources.length < 6) {
          seenUris.add(src.uri);
          sources.push(src);
        }
      }

      writeSseEvent(res, { type: 'meta', model });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          break;
        }
        extractGroundingSourcesFromChunk(chunk, seenUris, sources);

        const chunkText = chunk.text ?? '';
        if (!chunkText) continue;

        const delta = accumulator.push(chunkText);
        if (delta) {
          writeSseEvent(res, { type: 'delta', text: delta });
        }
      }

      if (!abortController.signal.aborted) {
        const finalized = accumulator.finalize();
        if (finalized.remainingDelta) {
          writeSseEvent(res, { type: 'delta', text: finalized.remainingDelta });
        }
        if (sources.length > 0) {
          writeSseEvent(res, { type: 'sources', sources });
        }

        let followUps = finalized.followUps;
        if (
          followUps.length === 0 &&
          finalized.fullAnswer.length > 0 &&
          validation.data.responseLength !== 'quick' &&
          validation.data.responseLength !== 'concise'
        ) {
          followUps = await generateFollowUpsFallback({
            userMessage: validation.data.message,
            assistantAnswer: finalized.fullAnswer,
            requestedModel: model,
          });
        }
        writeSseEvent(res, {
          type: 'followups',
          questions: followUps,
        });
        writeSseEvent(res, { type: 'done' });
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        const mapped = mapGeminiError(err);
        writeSseEvent(res, {
          type: 'error',
          code: mapped.code,
          message: mapped.message,
          retryable: mapped.retryable,
        });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Consul AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
