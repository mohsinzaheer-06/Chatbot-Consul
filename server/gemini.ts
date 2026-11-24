import { GoogleGenAI, ThinkingLevel, type Content, type Part } from '@google/genai';
import {
  buildSystemInstruction,
  formatAttachmentsForPrompt,
  resolveEligibleModel,
} from '../src/lib/chatValidation';
import { fetchLiveWebFallback, needsLiveWebSearch } from './webFallback';
import type {
  ChatHistoryTurn,
  EligibleModel,
  GroundingSource,
  MessageAttachment,
  PreferredLanguage,
  ResponseLength,
  UserLocationContext,
} from '../src/types/chat';

export interface MappedApiError {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export function isApiKeyConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

export function getGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      timeout: 25_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function buildUserMessageParts(
  latestMessage: string,
  attachments?: MessageAttachment[]
): Part[] {
  const parts: Part[] = [];
  const docContext = formatAttachmentsForPrompt(attachments);
  const fullText = docContext
    ? `${latestMessage}\n\n--- ATTACHED FILES DATA ---\n${docContext}`
    : latestMessage;

  parts.push({ text: fullText });

  if (attachments) {
    for (const att of attachments) {
      if (att.inlineImageBase64) {
        parts.push({
          inlineData: {
            data: att.inlineImageBase64,
            mimeType: att.mimeType === 'image/jpg' ? 'image/jpeg' : att.mimeType || 'image/jpeg',
          },
        });
      }
    }
  }

  return parts;
}

export function normalizeGeminiContents(
  history: ChatHistoryTurn[],
  latestMessage: string,
  attachments?: MessageAttachment[]
): Content[] {
  const normalized: Content[] = [];

  for (const turn of history) {
    if (!turn.content.trim()) continue;
    const prev = normalized[normalized.length - 1];
    if (!prev) {
      if (turn.role === 'user') {
        normalized.push({ role: 'user', parts: [{ text: turn.content }] });
      }
      continue;
    }

    if (prev.role === turn.role && prev.parts?.[0]?.text) {
      prev.parts[0].text = `${prev.parts[0].text}\n\n${turn.content}`;
    } else {
      normalized.push({ role: turn.role, parts: [{ text: turn.content }] });
    }
  }

  const latestParts = buildUserMessageParts(latestMessage, attachments);
  const last = normalized[normalized.length - 1];
  if (last && last.role === 'user' && last.parts?.[0]?.text) {
    const firstLatestText = latestParts[0]?.text ?? latestMessage;
    last.parts[0].text = `${last.parts[0].text}\n\n${firstLatestText}`;
    for (const extraPart of latestParts.slice(1)) {
      last.parts.push(extraPart);
    }
  } else {
    normalized.push({ role: 'user', parts: latestParts });
  }

  return normalized;
}

export function extractGroundingSourcesFromChunk(
  chunk: unknown,
  seenUris: Set<string>,
  collected: GroundingSource[]
): void {
  if (!chunk || typeof chunk !== 'object' || collected.length >= 6) return;
  const candidate = (
    chunk as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: unknown[] } }> }
  ).candidates?.[0];
  const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(groundingChunks)) return;

  for (const item of groundingChunks) {
    if (collected.length >= 6) break;
    if (!item || typeof item !== 'object') continue;
    const web = (item as { web?: { uri?: unknown; title?: unknown } }).web;
    if (!web || typeof web.uri !== 'string') continue;

    let safeUri = '';
    try {
      const parsed = new URL(web.uri.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      safeUri = parsed.toString();
    } catch {
      continue;
    }

    if (seenUris.has(safeUri)) continue;
    seenUris.add(safeUri);

    const rawTitle = typeof web.title === 'string' ? web.title.trim() : '';
    let fallbackHost = safeUri;
    try {
      fallbackHost = new URL(safeUri).hostname.replace(/^www\./, '');
    } catch {
      // keep uri
    }

    collected.push({
      title: rawTitle || fallbackHost,
      uri: safeUri,
    });
  }
}

function parseRetryAfterMs(err: unknown, rawMessage: string): number | undefined {
  const errObj = err as {
    headers?: { get?: (name: string) => string | null; ['retry-after']?: string };
    response?: { headers?: { get?: (name: string) => string | null; ['retry-after']?: string } };
  };
  const headerVal =
    errObj?.headers?.get?.('retry-after') ??
    errObj?.headers?.['retry-after'] ??
    errObj?.response?.headers?.get?.('retry-after') ??
    errObj?.response?.headers?.['retry-after'];

  if (headerVal) {
    const seconds = Number(headerVal);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 3500);
    }
  }

  const retryMatch = rawMessage.match(/retry(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*s/i);
  if (retryMatch) {
    const seconds = Number(retryMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 3500);
    }
  }

  return undefined;
}

export function mapGeminiError(err: unknown): MappedApiError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const statusMatch = rawMessage.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  const numericStatus =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : statusMatch
        ? Number(statusMatch[1])
        : 500;

  if (rawMessage === 'MISSING_API_KEY') {
    return {
      status: 503,
      code: 'MISSING_API_KEY',
      message:
        'Gemini API key is not configured on the server. Please add GEMINI_API_KEY in Vercel Environment Variables (or .env.local when running locally).',
      retryable: false,
    };
  }

  if (rawMessage === 'UPSTREAM_TIMEOUT') {
    return {
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      message: 'The AI service took too long to respond. Please try again.',
      retryable: true,
    };
  }

  const isHardQuotaExhausted =
    /limit:\s*0|billing|exceeded your current quota|daily quota|free_tier_requests.*limit:\s*0/i.test(
      rawMessage
    );

  if (
    numericStatus === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(rawMessage)
  ) {
    if (isHardQuotaExhausted) {
      return {
        status: 429,
        code: 'QUOTA_EXHAUSTED',
        message:
          'API quota for the selected model is exhausted. Please check your Gemini API quota or switch to another free-tier model in Settings.',
        retryable: false,
      };
    }

    return {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message:
        'Temporary API rate limit reached. Please wait a few seconds and try again, or switch models in Settings.',
      retryable: true,
      retryAfterMs: parseRetryAfterMs(err, rawMessage),
    };
  }

  if (
    numericStatus === 401 ||
    numericStatus === 403 ||
    /PERMISSION_DENIED|API_KEY_INVALID|invalid api key/i.test(rawMessage)
  ) {
    return {
      status: 403,
      code: 'API_KEY_INVALID',
      message:
        'The configured Gemini API key was rejected. Please verify GEMINI_API_KEY in your server environment settings.',
      retryable: false,
    };
  }

  if (numericStatus === 404 || /NOT_FOUND/i.test(rawMessage)) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message:
        'The selected Gemini model is currently unavailable. Please try switching models in Settings.',
      retryable: false,
    };
  }

  if (numericStatus === 400) {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      message:
        'The request could not be processed. Please shorten your message or reduce attachment size.',
      retryable: false,
    };
  }

  console.error('[gemini-api-error]', numericStatus, rawMessage.slice(0, 200));

  return {
    status: 502,
    code: 'UPSTREAM_ERROR',
    message:
      'Unable to reach the AI service right now. Please check your connection and try again.',
    retryable: true,
  };
}

const SEARCH_COOLDOWN_MS = 60_000;
const MODEL_NOT_FOUND_COOLDOWN_MS = 5 * 60_000;
const searchCooldownUntil = new Map<string, number>();
const modelNotFoundCooldownUntil = new Map<string, number>();

async function withAttemptTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw new Error('Aborted');
  }
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('UPSTREAM_TIMEOUT'));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function generateChatStream(params: {
  message: string;
  history: ChatHistoryTurn[];
  attachments?: MessageAttachment[];
  responseLength: ResponseLength;
  preferredLanguage?: PreferredLanguage;
  requestedModel?: EligibleModel;
  locationContext?: UserLocationContext;
  signal: AbortSignal;
}) {
  const ai = getGeminiClient();
  const primaryModel = resolveEligibleModel(params.requestedModel, process.env.GEMINI_MODEL);
  const candidateModels = Array.from(
    new Set<string>([
      primaryModel,
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
    ])
  );
  const allContents = normalizeGeminiContents(
    params.history,
    params.message,
    params.attachments
  );
  const priorHistory = allContents.slice(0, -1);
  const latestParts = buildUserMessageParts(params.message, params.attachments);

  let cachedFallbackWeb: { webSnippet?: string; sources: GroundingSource[] } | null = null;
  const getFallbackWeb = async () => {
    if (!cachedFallbackWeb) {
      cachedFallbackWeb = await fetchLiveWebFallback(params.message, params.locationContext);
    }
    return cachedFallbackWeb;
  };

  const openStreamForModel = async (targetModel: string, enableSearch: boolean) => {
    const fallbackWeb = enableSearch
      ? { webSnippet: undefined, sources: [] }
      : await getFallbackWeb();
    const systemInstruction = buildSystemInstruction(
      params.responseLength,
      params.locationContext,
      fallbackWeb.webSnippet,
      params.preferredLanguage ?? 'auto'
    );

    const toolsConfig = enableSearch ? { tools: [{ googleSearch: {} }] } : {};
    const config = targetModel.startsWith('gemini-4-')
      ? {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          ...toolsConfig,
        }
      : {
          systemInstruction,
          ...toolsConfig,
        };

    if (priorHistory.length > 0 && !params.attachments?.some((a) => Boolean(a.inlineImageBase64))) {
      const chat = ai.chats.create({
        model: targetModel,
        history: priorHistory,
        config,
      });
      const stream = await chat.sendMessageStream({
        message: latestParts[0]?.text ?? params.message,
      });
      return { stream, model: targetModel, fallbackSources: fallbackWeb.sources };
    }

    const stream = await ai.models.generateContentStream({
      model: targetModel,
      contents: allContents,
      config,
    });
    return { stream, model: targetModel, fallbackSources: fallbackWeb.sources };
  };

  const now = Date.now();
  const hasAttachments = Boolean(params.attachments && params.attachments.length > 0);
  const useSearch = !hasAttachments && needsLiveWebSearch(params.message);
  const rawAttempts: Array<{ model: string; search: boolean }> = [];
  if (useSearch) {
    for (const m of candidateModels) {
      if ((modelNotFoundCooldownUntil.get(m) ?? 0) > now) continue;
      if ((searchCooldownUntil.get(m) ?? 0) <= now) {
        rawAttempts.push({ model: m, search: true });
      }
    }
  }
  for (const m of candidateModels) {
    if ((modelNotFoundCooldownUntil.get(m) ?? 0) > now) continue;
    rawAttempts.push({ model: m, search: false });
  }
  if (rawAttempts.length === 0) {
    rawAttempts.push({ model: 'gemini-3.1-flash-lite', search: false });
  }

  let lastErr: unknown;
  const skippedThisRequest = new Set<string>();

  for (const attempt of rawAttempts) {
    if (params.signal.aborted) {
      throw lastErr ?? new Error('Aborted');
    }
    if (
      skippedThisRequest.has(attempt.model) ||
      (modelNotFoundCooldownUntil.get(attempt.model) ?? 0) > Date.now()
    ) {
      continue;
    }

    const timeoutMs = attempt.model === 'gemini-3.8-flash' ? 8500 : attempt.search ? 12_000 : 20_000;
    try {
      return await withAttemptTimeout(
        openStreamForModel(attempt.model, attempt.search),
        timeoutMs,
        params.signal
      );
    } catch (err) {
      lastErr = err;
      if (params.signal.aborted) {
        throw err;
      }

      const mapped = mapGeminiError(err);

      if (mapped.code === 'API_KEY_INVALID' || mapped.code === 'MISSING_API_KEY') {
        throw err;
      }

      if (mapped.code === 'MODEL_NOT_FOUND') {
        modelNotFoundCooldownUntil.set(attempt.model, Date.now() + MODEL_NOT_FOUND_COOLDOWN_MS);
        continue;
      }

      if (mapped.code === 'UPSTREAM_TIMEOUT') {
        if (attempt.model === 'gemini-3.8-flash') {
          modelNotFoundCooldownUntil.set(attempt.model, Date.now() + 60_000);
          skippedThisRequest.add(attempt.model);
        } else if (attempt.search) {
          searchCooldownUntil.set(attempt.model, Date.now() + SEARCH_COOLDOWN_MS);
        }
        continue;
      }

      if (
        attempt.search &&
        (mapped.code === 'RATE_LIMIT_EXCEEDED' ||
          mapped.code === 'QUOTA_EXHAUSTED' ||
          mapped.code === 'BAD_REQUEST')
      ) {
        searchCooldownUntil.set(attempt.model, Date.now() + SEARCH_COOLDOWN_MS);
        continue;
      }

      if (mapped.code === 'QUOTA_EXHAUSTED') {
        continue;
      }

      if (mapped.code === 'RATE_LIMIT_EXCEEDED' || mapped.retryable) {
        const delayMs = mapped.retryAfterMs ?? 500;
        await sleepWithSignal(delayMs, params.signal);
        try {
          return await withAttemptTimeout(
            openStreamForModel(attempt.model, attempt.search),
            timeoutMs,
            params.signal
          );
        } catch (retryErr) {
          lastErr = retryErr;
          const retryMapped = mapGeminiError(retryErr);
          if (retryMapped.code === 'API_KEY_INVALID' || retryMapped.code === 'MISSING_API_KEY') {
            throw retryErr;
          }
          continue;
        }
      }

      throw err;
    }
  }

  throw lastErr ?? new Error('UPSTREAM_ERROR');
}

export async function generateFollowUpsFallback(params: {
  userMessage: string;
  assistantAnswer: string;
  requestedModel?: EligibleModel;
}): Promise<string[]> {
  try {
    const ai = getGeminiClient();
    const model = resolveEligibleModel(params.requestedModel, process.env.GEMINI_MODEL);
    const { Type } = await import('@google/genai');

    const response = await ai.models.generateContent({
      model,
      contents: `User message: ${params.userMessage}\n\nAssistant answer: ${params.assistantAnswer}\n\nGenerate exactly 3 short, practical, non-generic follow-up questions directly related to this conversation, in the exact same language and script (English, Urdu script, or Roman Urdu) as the assistant answer. Avoid questions already answered.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            followUps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['followUps'],
        },
        ...(model.startsWith('gemini-4-')
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as { followUps?: unknown };
    if (Array.isArray(parsed.followUps)) {
      return parsed.followUps
        .filter((q): q is string => typeof q === 'string' && q.trim().length >= 2)
        .map((q) => q.trim())
        .slice(0, 3);
    }
  } catch {
    // Do not fail the main response if fallback follow-up call hits transient error
  }
  return [];
}
