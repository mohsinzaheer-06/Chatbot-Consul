import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MODEL = 'gemini-3.8-flash';

function resolveDefaultModel(envDefault?: string | null): string {
  const trimmed = envDefault?.trim();
  if (trimmed && /^gemini-[a-z0-9.-]+$/i.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_MODEL;
}

export default async function handler(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const configured = Boolean(key && key !== 'MY_GEMINI_API_KEY');

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      ok: true,
      configured,
      nodeVersion: process.version,
      defaultModel: resolveDefaultModel(process.env.GEMINI_MODEL),
    })
  );
}
