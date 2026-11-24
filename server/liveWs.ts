import type { Server as HttpServer } from 'node:http';
import { Modality, type LiveServerMessage } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildLiveVoiceSystemInstruction, resolveLiveModel } from '../src/lib/models';
import { getGeminiClient, isApiKeyConfigured, mapGeminiError } from './gemini';

export function attachLiveVoiceWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', 'http://localhost');
    if (reqUrl.pathname !== '/api/live-ws') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit('connection', clientWs, request, reqUrl);
    });
  });

  wss.on('connection', async (clientWs: WebSocket, _req: unknown, reqUrl: URL) => {
    if (!isApiKeyConfigured()) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 'MISSING_API_KEY',
          message:
            'Gemini API key is not configured on the server. Add GEMINI_API_KEY to use Live Voice.',
        })
      );
      clientWs.close(1008, 'API key not configured');
      return;
    }

    const requestedVoice = reqUrl.searchParams.get('voice') === 'Kore' ? 'Kore' : 'Zephyr';
    const preferredLanguage = reqUrl.searchParams.get('lang') || 'auto';
    const liveModel = resolveLiveModel(process.env.GEMINI_LIVE_MODEL);
    const systemInstruction = buildLiveVoiceSystemInstruction(preferredLanguage);

    let closed = false;
    let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null =
      null;

    try {
      const ai = getGeminiClient();
      session = await ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: requestedVoice } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            if (!closed && clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ type: 'ready', model: liveModel, voice: requestedVoice }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (closed || clientWs.readyState !== 1) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'inputTranscript',
                  text: content.inputTranscription.text,
                })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'outputTranscript',
                  text: content.outputTranscription.text,
                })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(
                  JSON.stringify({
                    type: 'audio',
                    audio: part.inlineData.data,
                  })
                );
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turnComplete' }));
            }
          },
          onerror: (err: unknown) => {
            if (closed || clientWs.readyState !== 1) return;
            const mapped = mapGeminiError(err);
            clientWs.send(
              JSON.stringify({
                type: 'error',
                code: mapped.code,
                message: mapped.message,
              })
            );
          },
          onclose: () => {
            if (!closed && clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ type: 'closed' }));
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      if (clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            code: mapped.code,
            message: mapped.message,
          })
        );
        clientWs.close(1011, mapped.code);
      }
      return;
    }

    clientWs.on('message', (rawData) => {
      if (closed || !session) return;
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          audio?: string;
          text?: string;
        };
        if (msg.type === 'audio' && typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          session.sendRealtimeInput({ text: msg.text.trim() });
        }
      } catch {
        // Ignore malformed client audio frame
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // ignore close error
      }
    });
  });
}
