import {
  AlertCircle,
  MessageSquareText,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Volume2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_VOICE_PERSONAS } from '../lib/models';
import type { ApiStatusSnapshot, LiveVoiceName, PreferredLanguage } from '../types/chat';

type VoiceConnectionState =
  | 'idle'
  | 'requesting-mic'
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'reconnecting'
  | 'error';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface LiveVoiceModalProps {
  isOpen: boolean;
  voiceName: LiveVoiceName;
  preferredLanguage: PreferredLanguage;
  apiStatus: ApiStatusSnapshot | null;
  onChangeVoiceName: (voice: LiveVoiceName) => void;
  onSaveTranscript: (entries: Array<{ role: 'user' | 'assistant'; text: string }>, model?: string) => void;
  onClose: () => void;
}

function encodePcm16ToBase64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64Pcm24k(base64: string, ctx: AudioContext): AudioBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  const buffer = ctx.createBuffer(1, sampleCount, 24000);
  buffer.getChannelData(0).set(float32);
  return buffer;
}

export function LiveVoiceModal({
  isOpen,
  voiceName,
  preferredLanguage,
  apiStatus,
  onChangeVoiceName,
  onSaveTranscript,
  onClose,
}: LiveVoiceModalProps) {
  const [connState, setConnState] = useState<VoiceConnectionState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeModelLabel, setActiveModelLabel] = useState<string>(
    apiStatus?.liveModel || 'gemini-3.8-live'
  );
  const [micLevel, setMicLevel] = useState(0);

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const closedByUserRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const clearScheduledPlayback = useCallback(() => {
    for (const src of scheduledSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore already-stopped nodes
      }
    }
    scheduledSourcesRef.current.clear();
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    clearScheduledPlayback();
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setMicLevel(0);
  }, [clearScheduledPlayback]);

  useEffect(() => {
    if (!isOpen) {
      closedByUserRef.current = true;
      cleanupSession();
      setConnState('idle');
      setErrorMsg(null);
      setIsMuted(false);
      return;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cleanupSession, isOpen, onClose]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript]);

  const appendTranscriptChunk = useCallback((role: 'user' | 'assistant', chunk: string) => {
    const clean = chunk;
    if (!clean) return;
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, text: `${last.text}${clean}` };
        return updated;
      }
      return [
        ...prev,
        { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, text: clean },
      ];
    });
  }, []);

  const playPcmChunk = useCallback((base64Audio: string) => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const buffer = decodeBase64Pcm24k(base64Audio, ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + buffer.duration;

    scheduledSourcesRef.current.add(source);
    setConnState('speaking');

    source.onended = () => {
      scheduledSourcesRef.current.delete(source);
      if (scheduledSourcesRef.current.size === 0 && !closedByUserRef.current) {
        setConnState((prev) => (prev === 'speaking' ? 'connected' : prev));
      }
    };
    source.start(startAt);
  }, []);

  const startVoiceSession = useCallback(async () => {
    cleanupSession();
    closedByUserRef.current = false;
    setErrorMsg(null);

    if (apiStatus && !apiStatus.configured) {
      setConnState('error');
      setErrorMsg(
        'Gemini API key is not configured on the server. Add GEMINI_API_KEY in server environment settings to enable Live Voice.'
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setConnState('error');
      setErrorMsg('Microphone capture is not supported in this browser or context.');
      return;
    }

    setConnState('requesting-mic');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
    } catch {
      setConnState('error');
      setErrorMsg(
        'Microphone permission was denied or no microphone was found. Please allow microphone access and try again.'
      );
      return;
    }

    setConnState('connecting');

    try {
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const sourceNode = inputCtx.createMediaStreamSource(stream);

      const handlePcmFrame = (samples: Float32Array) => {
        if (closedByUserRef.current || isMutedRef.current) {
          setMicLevel(0);
          return;
        }
        let sumSq = 0;
        for (let i = 0; i < samples.length; i++) {
          sumSq += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sumSq / samples.length);
        setMicLevel(Math.min(1, rms * 5.5));

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Client-side barge-in: if user speaks clearly while AI audio is playing, stop playback immediately
        if (rms > 0.045 && scheduledSourcesRef.current.size > 0) {
          clearScheduledPlayback();
        }

        const base64Pcm = encodePcm16ToBase64(samples);
        if (modeRef.current === 'bridge') {
          ws.send(JSON.stringify({ type: 'audio', audio: base64Pcm }));
        } else {
          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' },
              },
            })
          );
        }
      };

      const setupAudioCapture = () => {
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (ev) => {
          handlePcmFrame(ev.inputBuffer.getChannelData(0));
        };
        sourceNode.connect(processor);
        processor.connect(inputCtx.destination);
        processorRef.current = processor;
      };

      const modeRef = { current: 'ephemeral' as 'bridge' | 'ephemeral' };

      // Prefer local Express WebSocket bridge when available; otherwise use Vercel ephemeral token
      let connectedViaBridge = false;
      if (apiStatus?.liveTransport === 'ws-bridge+ephemeral') {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const bridgeUrl = `${wsProto}//${window.location.host}/api/live-ws?voice=${encodeURIComponent(
          voiceName
        )}&lang=${encodeURIComponent(preferredLanguage)}`;
        try {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(bridgeUrl);
            let settled = false;
            const timeout = window.setTimeout(() => {
              if (!settled) {
                settled = true;
                ws.close();
                reject(new Error('WS_BRIDGE_TIMEOUT'));
              }
            }, 5000);

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(String(event.data)) as {
                  type: string;
                  audio?: string;
                  text?: string;
                  model?: string;
                  message?: string;
                };
                if (msg.type === 'ready') {
                  if (!settled) {
                    settled = true;
                    window.clearTimeout(timeout);
                    modeRef.current = 'bridge';
                    wsRef.current = ws;
                    if (msg.model) setActiveModelLabel(msg.model);
                    setConnState('connected');
                    setupAudioCapture();
                    resolve();
                  }
                } else if (msg.type === 'audio' && msg.audio) {
                  playPcmChunk(msg.audio);
                } else if (msg.type === 'inputTranscript' && msg.text) {
                  appendTranscriptChunk('user', msg.text);
                } else if (msg.type === 'outputTranscript' && msg.text) {
                  appendTranscriptChunk('assistant', msg.text);
                } else if (msg.type === 'interrupted') {
                  clearScheduledPlayback();
                  setConnState('connected');
                } else if (msg.type === 'error') {
                  const errText = msg.message || 'Live Voice session error.';
                  if (!settled) {
                    settled = true;
                    window.clearTimeout(timeout);
                    reject(new Error(errText));
                  } else {
                    setErrorMsg(errText);
                    setConnState('error');
                  }
                }
              } catch {
                // ignore non-json message
              }
            };

            ws.onerror = () => {
              if (!settled) {
                settled = true;
                window.clearTimeout(timeout);
                reject(new Error('WS_BRIDGE_FAILED'));
              }
            };

            ws.onclose = () => {
              if (!settled) {
                settled = true;
                window.clearTimeout(timeout);
                reject(new Error('WS_BRIDGE_CLOSED'));
              } else if (!closedByUserRef.current) {
                setConnState('error');
                setErrorMsg((prev) => prev ?? 'Live Voice connection ended. Press Reconnect to resume.');
              }
            };
          });
          connectedViaBridge = true;
        } catch (bridgeErr) {
          // If the bridge returned a real Gemini API / key / quota error, surface it instead of masking it
          const msg = bridgeErr instanceof Error ? bridgeErr.message : '';
          if (msg && !msg.startsWith('WS_BRIDGE_')) {
            throw bridgeErr;
          }
        }
      }

      if (!connectedViaBridge) {
        const tokenRes = await fetch('/api/live-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voiceName, preferredLanguage }),
        });
        const tokenData = (await tokenRes.json()) as {
          available?: boolean;
          wsUrl?: string;
          model?: string;
          voiceName?: string;
          systemInstruction?: string;
          message?: string;
        };

        if (!tokenRes.ok || !tokenData.available || !tokenData.wsUrl) {
          throw new Error(
            tokenData.message ||
              'Live Voice is unavailable on this deployment or API key tier.'
          );
        }

        const resolvedModel = tokenData.model || 'gemini-3.8-live';
        setActiveModelLabel(resolvedModel);

        const ws = new WebSocket(tokenData.wsUrl);
        modeRef.current = 'ephemeral';
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              setup: {
                model: `models/${resolvedModel}`,
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: tokenData.voiceName || voiceName },
                    },
                  },
                },
                systemInstruction: tokenData.systemInstruction
                  ? { parts: [{ text: tokenData.systemInstruction }] }
                  : undefined,
                inputAudioTranscription: {},
                outputAudioTranscription: {},
              },
            })
          );
        };

        ws.onmessage = async (event) => {
          try {
            const rawText =
              event.data instanceof Blob ? await event.data.text() : String(event.data);
            const payload = JSON.parse(rawText) as {
              setupComplete?: unknown;
              serverContent?: {
                interrupted?: boolean;
                inputTranscription?: { text?: string };
                outputTranscription?: { text?: string };
                modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
              };
            };

            if (payload.setupComplete) {
              setConnState('connected');
              setupAudioCapture();
              return;
            }

            const sc = payload.serverContent;
            if (!sc) return;

            if (sc.inputTranscription?.text) {
              appendTranscriptChunk('user', sc.inputTranscription.text);
            }
            if (sc.outputTranscription?.text) {
              appendTranscriptChunk('assistant', sc.outputTranscription.text);
            }
            for (const part of sc.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                playPcmChunk(part.inlineData.data);
              }
            }
            if (sc.interrupted) {
              clearScheduledPlayback();
              setConnState('connected');
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onerror = () => {
          if (!closedByUserRef.current) {
            setConnState('error');
            setErrorMsg(
              'Unable to establish a live audio WebSocket with Gemini Live. Check your API key permissions and free-tier Live API availability.'
            );
          }
        };

        ws.onclose = (ev) => {
          if (!closedByUserRef.current) {
            setConnState('error');
            setErrorMsg(
              (prev) =>
                prev ??
                (ev.reason
                  ? `Live session closed: ${ev.reason}`
                  : 'Live Voice session disconnected. Press Reconnect to try again.')
            );
          }
        };
      }
    } catch (err) {
      cleanupSession();
      setConnState('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to initialize Live Voice session.'
      );
    }
  }, [
    apiStatus,
    appendTranscriptChunk,
    cleanupSession,
    clearScheduledPlayback,
    playPcmChunk,
    preferredLanguage,
    voiceName,
  ]);

  if (!isOpen) return null;

  const isSessionActive =
    connState === 'connected' || connState === 'speaking' || connState === 'connecting' || connState === 'requesting-mic';

  const statusText =
    connState === 'idle'
      ? 'Ready to start live voice'
      : connState === 'requesting-mic'
        ? 'Requesting microphone access…'
        : connState === 'connecting'
          ? 'Connecting to Consul Live Voice…'
          : connState === 'speaking'
            ? 'Speaking · Speak anytime to interrupt'
            : connState === 'connected'
              ? isMuted
                ? 'Microphone muted'
                : 'Listening…'
              : connState === 'reconnecting'
                ? 'Reconnecting…'
                : 'Connection unavailable';

  const handleEndAndClose = () => {
    closedByUserRef.current = true;
    cleanupSession();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-voice-title"
    >
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-xs"
        onClick={handleEndAndClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-[#FAF9F6] sm:h-auto sm:max-h-[90dvh] sm:max-w-xl sm:rounded-3xl sm:border sm:border-black/[0.1] sm:shadow-2xl dark:bg-[#131416] dark:sm:border-white/[0.1]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[0.07] px-5 py-4 dark:border-white/[0.08]">
          <div>
            <h2
              id="live-voice-title"
              className="font-display text-base font-semibold tracking-tight text-[#18191B] dark:text-[#ECECEF]"
            >
              Live Voice Conversation
            </h2>
            <p className="font-mono-code text-[11px] text-[#6E737B] dark:text-[#8E939C]">
              {activeModelLabel} · Free-tier Live Audio
            </p>
          </div>
          <button
            type="button"
            onClick={handleEndAndClose}
            aria-label="Close live voice"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#5C6066] hover:bg-black/[0.05] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </div>

        {/* Center Orb + Voice Persona */}
        <div className="flex flex-1 flex-col items-center justify-between overflow-y-auto px-5 py-6">
          <div className="w-full max-w-sm">
            <label
              htmlFor="live-voice-persona"
              className="block text-xs font-medium text-[#5C6066] dark:text-[#9CA1A8]"
            >
              Assistant voice personality
            </label>
            <select
              id="live-voice-persona"
              disabled={isSessionActive}
              value={voiceName}
              onChange={(e) => onChangeVoiceName(e.target.value as LiveVoiceName)}
              className="mt-1.5 h-10 w-full rounded-xl border border-black/[0.12] bg-white px-3 text-xs font-medium text-[#18191B] disabled:opacity-60 dark:border-white/[0.12] dark:bg-[#1D1F23] dark:text-[#ECECEF]"
            >
              {LIVE_VOICE_PERSONAS.map((p) => (
                <option key={p.voiceName} value={p.voiceName}>
                  {p.label} — {p.subtitle}
                </option>
              ))}
            </select>
          </div>

          {/* Organic Breathing Voice Presence Indicator */}
          <div className="my-7 flex flex-col items-center">
            <div className="relative flex h-36 w-36 items-center justify-center">
              <motion.div
                animate={{
                  scale:
                    connState === 'speaking'
                      ? [1, 1.18, 1.04]
                      : connState === 'connected'
                        ? 1 + micLevel * 0.28
                        : 1,
                  opacity: isSessionActive ? 0.28 : 0.1,
                }}
                transition={
                  connState === 'speaking'
                    ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.12 }
                }
                className="absolute inset-0 rounded-full bg-[#3D6B58] dark:bg-[#6BA588]"
              />
              <motion.div
                animate={{
                  scale: connState === 'speaking' ? [1, 1.08, 1] : 1 + micLevel * 0.12,
                }}
                transition={
                  connState === 'speaking'
                    ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.1 }
                }
                className={`relative flex h-24 w-24 items-center justify-center rounded-full border shadow-md transition-colors ${
                  connState === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : isSessionActive
                      ? 'border-[#3D6B58]/40 bg-[#3D6B58] text-white dark:border-[#6BA588]/40 dark:bg-[#6BA588] dark:text-[#111315]'
                      : 'border-black/[0.1] bg-white text-[#3D6B58] dark:border-white/[0.1] dark:bg-[#1D1F23] dark:text-[#7CC0A3]'
                }`}
              >
                {connState === 'speaking' ? (
                  <Volume2 className="h-8 w-8" aria-hidden="true" />
                ) : isMuted ? (
                  <MicOff className="h-8 w-8" aria-hidden="true" />
                ) : (
                  <Mic className="h-8 w-8" aria-hidden="true" />
                )}
              </motion.div>
            </div>

            <p className="mt-3 text-sm font-medium text-[#18191B] dark:text-[#ECECEF]">
              {statusText}
            </p>
            <p className="mt-1 text-center text-xs text-[#6E737B] dark:text-[#8E939C]">
              Supports natural turn-taking and voice interruption (barge-in).
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="mb-4 flex w-full items-start gap-2.5 rounded-2xl border border-rose-500/25 bg-rose-500/8 px-3.5 py-3 text-xs leading-relaxed text-rose-800 dark:text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Optional Live Transcript Drawer */}
          {showTranscript && (
            <div className="w-full rounded-2xl border border-black/[0.08] bg-white/80 p-3 dark:border-white/[0.08] dark:bg-[#1B1C1F]/80">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-[#6E737B] dark:text-[#8E939C]">
                <span>Live transcript</span>
                {transcript.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onSaveTranscript(transcript, activeModelLabel);
                      handleEndAndClose();
                    }}
                    className="font-medium text-[#3D6B58] hover:underline dark:text-[#7CC0A3]"
                  >
                    Save to chat
                  </button>
                )}
              </div>
              <div className="max-h-36 space-y-2 overflow-y-auto text-xs">
                {transcript.length === 0 ? (
                  <p className="py-3 text-center text-[#7A7E86] dark:text-[#7D828A]">
                    Transcript appears here as you and Consul AI speak.
                  </p>
                ) : (
                  transcript.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-xl px-2.5 py-1.5 ${
                        item.role === 'user'
                          ? 'bg-[#EFECE5] text-[#18191B] dark:bg-[#25272B] dark:text-[#ECECEF]'
                          : 'bg-[#3D6B58]/8 text-[#18191B] dark:bg-[#6BA588]/12 dark:text-[#ECECEF]'
                      }`}
                    >
                      <span className="font-semibold">
                        {item.role === 'user' ? 'You: ' : 'Consul AI: '}
                      </span>
                      <span>{item.text}</span>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 border-t border-black/[0.07] bg-white/75 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/[0.08] dark:bg-[#1B1C1F]/90">
          {!isSessionActive ? (
            <button
              type="button"
              onClick={() => void startVoiceSession()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#3D6B58] px-6 text-sm font-medium text-white shadow-xs transition-colors hover:bg-[#315848] dark:bg-[#6BA588] dark:text-[#111315] dark:hover:bg-[#7CC0A3]"
            >
              {connState === 'error' ? (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <span>Reconnect voice</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  <span>Start live conversation</span>
                </>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                className={`inline-flex min-h-[42px] items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors ${
                  isMuted
                    ? 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-200'
                    : 'border-black/[0.12] bg-white text-[#18191B] hover:bg-black/[0.04] dark:border-white/[0.12] dark:bg-[#24262B] dark:text-[#ECECEF]'
                }`}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span>{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closedByUserRef.current = true;
                  cleanupSession();
                  setConnState('idle');
                }}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-rose-600 px-5 text-xs font-medium text-white hover:bg-rose-700"
              >
                <PhoneOff className="h-4 w-4" aria-hidden="true" />
                <span>End call</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowTranscript((prev) => !prev)}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 text-xs font-medium text-[#5C6066] hover:text-[#18191B] dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#9CA1A8] dark:hover:text-white"
          >
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            <span>{showTranscript ? 'Hide transcript' : 'Transcript'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
