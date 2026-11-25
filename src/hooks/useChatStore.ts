import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAttachmentsForPrompt } from '../lib/chatValidation';
import {
  clearAllDbTx,
  deleteConversationTx,
  initAndLoadConversations,
  syncConversationTx,
  upsertManyConversationsTx,
} from '../lib/indexedDb';
import { generateConversationTitle } from '../lib/language';
import {
  clearAllStoredConversations,
  computeLastMessagePreview,
  exportConversationsAsJson,
  exportConversationsAsTxt,
  loadActiveConversationId,
  loadConversations,
  loadSettings,
  mergeImportedConversations,
  parseImportedConversations,
  saveActiveConversationId,
  saveConversations,
  saveSettings,
} from '../lib/storage';
import type {
  ApiStatusSnapshot,
  ChatHistoryTurn,
  ChatMessage,
  Conversation,
  EligibleModel,
  GroundingSource,
  LiveVoiceName,
  MessageAttachment,
  PreferredLanguage,
  ResponseLength,
  ThemeMode,
  UserSettings,
} from '../types/chat';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface ChatErrorState {
  message: string;
  retryable: boolean;
  lastPrompt?: string;
}

export function useChatStore() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const savedId = loadActiveConversationId();
    const list = loadConversations();
    if (savedId && list.some((c) => c.id === savedId)) {
      return savedId;
    }
    return list[0]?.id ?? null;
  });
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorState, setErrorState] = useState<ChatErrorState | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [focusInputSignal, setFocusInputSignal] = useState(0);
  const [isDbReady, setIsDbReady] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatusSnapshot | null>(null);
  const [detectedContext, setDetectedContext] = useState<{
    timezone: string;
    locationLabel?: string;
  }>(() => {
    let tz = 'UTC';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      tz = 'UTC';
    }
    return { timezone: tz };
  });

  const usingIndexedDbRef = useRef(true);
  const dirtyConversationIdsRef = useRef<Set<string>>(new Set());
  const hasMutatedBeforeLoadRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const generationTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSendTimestampRef = useRef(0);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshApiStatus = useCallback(async (): Promise<ApiStatusSnapshot | null> => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as ApiStatusSnapshot;
      setApiStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshApiStatus();
  }, [refreshApiStatus]);

  // Initialize IndexedDB (with automatic one-time migration from localStorage)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await initAndLoadConversations();
      if (cancelled) return;
      usingIndexedDbRef.current = result.usingIndexedDb;
      setIsDbReady(true);

      if (hasMutatedBeforeLoadRef.current) {
        if (result.usingIndexedDb && conversationsRef.current.length > 0) {
          await upsertManyConversationsTx(conversationsRef.current);
        }
        return;
      }

      setConversations(result.conversations);
      setActiveConversationId((prevId) => {
        const savedId = loadActiveConversationId();
        if (prevId && result.conversations.some((c) => c.id === prevId)) return prevId;
        if (savedId && result.conversations.some((c) => c.id === savedId)) return savedId;
        return result.conversations[0]?.id ?? null;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply dark mode class to <html> and persist settings
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveSettings(settings);
  }, [settings]);

  // Persist dirty conversations to IndexedDB (or localStorage fallback)
  useEffect(() => {
    if (!isDbReady) return;

    if (!usingIndexedDbRef.current) {
      const ok = saveConversations(conversations);
      setStorageWarning(
        ok
          ? null
          : 'Browser storage is nearly full. Export and clear older conversations to avoid losing new messages.'
      );
      return;
    }

    const dirtyIds = Array.from(dirtyConversationIdsRef.current);
    if (dirtyIds.length === 0) return;

    const flush = async () => {
      const idsToFlush = Array.from(dirtyConversationIdsRef.current);
      dirtyConversationIdsRef.current.clear();
      const byId = new Map(conversationsRef.current.map((c) => [c.id, c]));

      for (const id of idsToFlush) {
        const conv = byId.get(id);
        if (conv) {
          const ok = await syncConversationTx(conv);
          if (!ok) {
            setStorageWarning(
              'Unable to save conversation changes to IndexedDB. Please export your history as backup.'
            );
          } else {
            setStorageWarning(null);
          }
        }
      }
    };

    if (isGenerating) {
      const timer = window.setTimeout(() => {
        void flush();
      }, 300);
      return () => window.clearTimeout(timer);
    }

    void flush();
  }, [conversations, isDbReady, isGenerating]);

  // Persist active conversation id
  useEffect(() => {
    saveActiveConversationId(activeConversationId);
  }, [activeConversationId]);

  const markDirty = useCallback((conversationId: string) => {
    hasMutatedBeforeLoadRef.current = true;
    dirtyConversationIdsRef.current.add(conversationId);
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conv) => {
      if (conv.title.toLowerCase().includes(q)) return true;
      return conv.messages.some(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.attachments?.some((a) => a.name.toLowerCase().includes(q))
      );
    });
  }, [conversations, searchQuery]);

  const updateTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => ({ ...prev, theme }));
  }, []);

  const updateResponseLength = useCallback((responseLength: ResponseLength) => {
    setSettings((prev) => ({ ...prev, responseLength }));
  }, []);

  const updateModel = useCallback((model: EligibleModel) => {
    setSettings((prev) => ({ ...prev, model }));
  }, []);

  const updatePreferredLanguage = useCallback((preferredLanguage: PreferredLanguage) => {
    setSettings((prev) => ({ ...prev, preferredLanguage }));
  }, []);

  const updateLiveVoiceName = useCallback((liveVoiceName: LiveVoiceName) => {
    setSettings((prev) => ({ ...prev, liveVoiceName }));
  }, []);

  const updateMaxUploadMb = useCallback((maxUploadMb: number) => {
    setSettings((prev) => ({ ...prev, maxUploadMb }));
  }, []);

  const stopGeneration = useCallback(() => {
    generationTokenRef.current += 1;
    isGeneratingRef.current = false;
    setIsGenerating(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const createNewChat = useCallback(() => {
    if (isGeneratingRef.current) {
      stopGeneration();
    }
    setErrorState(null);
    setActiveConversationId(null);
    setFocusInputSignal((prev) => prev + 1);
  }, [stopGeneration]);

  const selectConversation = useCallback(
    (id: string) => {
      if (isGeneratingRef.current) {
        stopGeneration();
      }
      setErrorState(null);
      setActiveConversationId(id);
    },
    [stopGeneration]
  );

  const renameConversation = useCallback(
    (id: string, nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed) return;
      markDirty(id);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title: trimmed.slice(0, 120), updatedAt: Date.now() } : c
        )
      );
    },
    [markDirty]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId && isGeneratingRef.current) {
        stopGeneration();
      }
      hasMutatedBeforeLoadRef.current = true;
      dirtyConversationIdsRef.current.delete(id);
      void deleteConversationTx(id);

      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeConversationId === id) {
          setActiveConversationId(next[0]?.id ?? null);
        }
        return next;
      });
    },
    [activeConversationId, stopGeneration]
  );

  const clearAllHistory = useCallback(() => {
    if (isGeneratingRef.current) {
      stopGeneration();
    }
    hasMutatedBeforeLoadRef.current = true;
    dirtyConversationIdsRef.current.clear();
    clearAllStoredConversations();
    void clearAllDbTx();
    setConversations([]);
    setActiveConversationId(null);
    setErrorState(null);
  }, [stopGeneration]);

  const deleteMessage = useCallback(
    (conversationId: string, messageId: string) => {
      if (conversationId === activeConversationId && isGeneratingRef.current) {
        stopGeneration();
      }
      markDirty(conversationId);
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const nextMessages = conv.messages.filter((m) => m.id !== messageId);
          return {
            ...conv,
            updatedAt: Date.now(),
            lastMessagePreview: computeLastMessagePreview(nextMessages),
            messages: nextMessages,
          };
        })
      );
    },
    [activeConversationId, markDirty, stopGeneration]
  );

  const deleteSelectedMessages = useCallback(
    (conversationId: string, messageIds: string[]) => {
      if (messageIds.length === 0) return;
      if (conversationId === activeConversationId && isGeneratingRef.current) {
        stopGeneration();
      }
      const idSet = new Set(messageIds);
      markDirty(conversationId);
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const nextMessages = conv.messages.filter((m) => !idSet.has(m.id));
          return {
            ...conv,
            updatedAt: Date.now(),
            lastMessagePreview: computeLastMessagePreview(nextMessages),
            messages: nextMessages,
          };
        })
      );
    },
    [activeConversationId, markDirty, stopGeneration]
  );

  const clearConversationMessages = useCallback(
    (conversationId: string) => {
      if (conversationId === activeConversationId && isGeneratingRef.current) {
        stopGeneration();
      }
      markDirty(conversationId);
      setErrorState(null);
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          return {
            ...conv,
            updatedAt: Date.now(),
            lastMessagePreview: undefined,
            messages: [],
          };
        })
      );
    },
    [activeConversationId, markDirty, stopGeneration]
  );

  const buildHistoryPayload = (messages: ChatMessage[]): ChatHistoryTurn[] =>
    messages
      .filter((m) => !m.isError && (m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0))
      .map((m) => {
        const attText = m.attachments?.length
          ? formatAttachmentsForPrompt(m.attachments).slice(0, 2500)
          : '';
        const combined = attText ? `${m.content}\n\n${attText}` : m.content;
        return {
          role: m.role === 'user' ? 'user' : 'model',
          content: combined,
        };
      });

  const streamAssistantTurn = useCallback(
    async (params: {
      conversationId: string;
      userMessageText: string;
      attachments?: MessageAttachment[];
      history: ChatHistoryTurn[];
      assistantMsgId: string;
    }) => {
      const { conversationId, userMessageText, attachments, history, assistantMsgId } = params;
      const myToken = ++generationTokenRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setErrorState(null);

      let accumulatedText = '';
      let activeModel = settingsRef.current.model;

      try {
        let clientTimezone: string | undefined;
        let clientLocale: string | undefined;
        try {
          clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          clientLocale = navigator.language;
        } catch {
          // Ignore environments without Intl/navigator
        }

        const wireAttachments = attachments?.map((att) => ({
          id: att.id,
          name: att.name,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          kind: att.kind,
          summaryLabel: att.summaryLabel,
          extractedText: att.extractedText,
          inlineImageBase64: att.inlineImageBase64,
          pageCount: att.pageCount,
          sheetNames: att.sheetNames,
          slideCount: att.slideCount,
          truncated: att.truncated,
        }));

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessageText,
            history,
            attachments: wireAttachments && wireAttachments.length > 0 ? wireAttachments : undefined,
            responseLength: settingsRef.current.responseLength,
            preferredLanguage: settingsRef.current.preferredLanguage,
            model: settingsRef.current.model,
            clientContext: {
              timezone: clientTimezone,
              localTimeIso: new Date().toISOString(),
              locale: clientLocale,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMessage =
            response.status === 404 || response.status === 405
              ? 'Chat API endpoint (/api/chat) is unavailable on this deployment. Verify that serverless API routes are deployed and GEMINI_API_KEY is set.'
              : `Request failed (HTTP ${response.status}). Please try again.`;
          let retryable = response.status >= 500 || response.status === 429;
          try {
            const errJson = (await response.json()) as {
              message?: string;
              retryable?: boolean;
            };
            if (errJson.message) errMessage = errJson.message;
            if (typeof errJson.retryable === 'boolean') retryable = errJson.retryable;
          } catch {
            // Keep HTTP status error message when body is non-JSON
          }
          throw Object.assign(new Error(errMessage), { retryable });
        }

        if (!response.body) {
          throw Object.assign(new Error('Streaming response is unavailable.'), {
            retryable: true,
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() ?? '';

          for (const rawEvent of events) {
            const lines = rawEvent.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonPart = line.slice(6).trim();
              if (!jsonPart) continue;

              let evt: {
                type: string;
                text?: string;
                questions?: string[];
                sources?: GroundingSource[];
                timezone?: string;
                locationLabel?: string;
                message?: string;
                retryable?: boolean;
                model?: string;
              };
              try {
                evt = JSON.parse(jsonPart);
              } catch {
                continue;
              }

              if (evt.type === 'context' && evt.timezone) {
                setDetectedContext({
                  timezone: evt.timezone,
                  locationLabel: evt.locationLabel,
                });
              } else if (evt.type === 'meta' && evt.model) {
                activeModel = evt.model as EligibleModel;
              } else if (evt.type === 'delta' && typeof evt.text === 'string') {
                accumulatedText += evt.text;
                markDirty(conversationId);
                setConversations((prev) =>
                  prev.map((conv) => {
                    if (conv.id !== conversationId) return conv;
                    const nextMessages = conv.messages.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: accumulatedText, model: activeModel }
                        : m
                    );
                    return {
                      ...conv,
                      updatedAt: Date.now(),
                      lastMessagePreview: computeLastMessagePreview(nextMessages),
                      messages: nextMessages,
                    };
                  })
                );
              } else if (evt.type === 'sources' && Array.isArray(evt.sources)) {
                const validSources = evt.sources
                  .filter(
                    (s): s is GroundingSource =>
                      Boolean(s) &&
                      typeof s.uri === 'string' &&
                      typeof s.title === 'string' &&
                      (s.uri.startsWith('https://') || s.uri.startsWith('http://'))
                  )
                  .slice(0, 6);
                if (validSources.length > 0) {
                  markDirty(conversationId);
                  setConversations((prev) =>
                    prev.map((conv) => {
                      if (conv.id !== conversationId) return conv;
                      return {
                        ...conv,
                        messages: conv.messages.map((m) =>
                          m.id === assistantMsgId ? { ...m, sources: validSources } : m
                        ),
                      };
                    })
                  );
                }
              } else if (evt.type === 'followups' && Array.isArray(evt.questions)) {
                const followUps = evt.questions.slice(0, 3);
                markDirty(conversationId);
                setConversations((prev) =>
                  prev.map((conv) => {
                    if (conv.id !== conversationId) return conv;
                    return {
                      ...conv,
                      messages: conv.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, followUpQuestions: followUps } : m
                      ),
                    };
                  })
                );
              } else if (evt.type === 'error') {
                throw Object.assign(
                  new Error(evt.message || 'An error occurred while generating a response.'),
                  { retryable: Boolean(evt.retryable) }
                );
              }
            }
          }
        }

        if (!accumulatedText.trim() && !controller.signal.aborted) {
          throw Object.assign(
            new Error('No response was received from the AI service. Please try again.'),
            { retryable: true }
          );
        }
      } catch (err) {
        const isAborted =
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError');

        markDirty(conversationId);
        if (isAborted) {
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== conversationId) return conv;
              const nextMessages = !accumulatedText.trim()
                ? conv.messages.filter((m) => m.id !== assistantMsgId)
                : conv.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, stopped: true } : m
                  );
              return {
                ...conv,
                lastMessagePreview: computeLastMessagePreview(nextMessages),
                messages: nextMessages,
              };
            })
          );
        } else {
          const message =
            err instanceof Error
              ? err.message
              : 'Network error. Please check your connection and try again.';
          const retryable =
            typeof (err as { retryable?: unknown })?.retryable === 'boolean'
              ? Boolean((err as { retryable: boolean }).retryable)
              : true;

          setErrorState({
            message,
            retryable,
            lastPrompt: userMessageText,
          });

          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== conversationId) return conv;
              const nextMessages = !accumulatedText.trim()
                ? conv.messages.filter((m) => m.id !== assistantMsgId)
                : conv.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, isError: true } : m
                  );
              return {
                ...conv,
                lastMessagePreview: computeLastMessagePreview(nextMessages),
                messages: nextMessages,
              };
            })
          );
        }
      } finally {
        if (generationTokenRef.current === myToken) {
          isGeneratingRef.current = false;
          abortControllerRef.current = null;
          setIsGenerating(false);
        }
      }
    },
    [markDirty]
  );

  const sendMessage = useCallback(
    async (rawText: string, attachments?: MessageAttachment[]) => {
      const trimmed = rawText.trim();
      const hasAtt = Boolean(attachments && attachments.length > 0);
      if ((!trimmed && !hasAtt) || isGeneratingRef.current) return;

      // Gentle free-tier throttle guard (350ms cooldown)
      const nowMs = Date.now();
      if (nowMs - lastSendTimestampRef.current < 350) {
        setErrorState({
          message: 'Please pause a moment before sending another message.',
          retryable: false,
        });
        return;
      }
      lastSendTimestampRef.current = nowMs;

      const effectivePrompt =
        trimmed ||
        `Please analyze the attached file${(attachments?.length ?? 0) > 1 ? 's' : ''}.`;

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: effectivePrompt,
        attachments: hasAtt ? attachments : undefined,
        createdAt: now,
      };
      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: '',
        createdAt: now + 1,
      };

      const titleSeed = trimmed || attachments?.[0]?.name || 'File analysis';

      let targetConversationId = activeConversationId;
      let priorHistory: ChatHistoryTurn[] = [];

      if (!targetConversationId) {
        const newConv: Conversation = {
          id: createId('conv'),
          title: generateConversationTitle(titleSeed),
          createdAt: now,
          updatedAt: now,
          lastMessagePreview: computeLastMessagePreview([userMsg]),
          messages: [userMsg, assistantMsg],
        };
        targetConversationId = newConv.id;
        markDirty(targetConversationId);
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
      } else {
        const existing = conversationsRef.current.find((c) => c.id === targetConversationId);
        if (existing) {
          priorHistory = buildHistoryPayload(existing.messages);
        }

        markDirty(targetConversationId);
        setConversations((prev) => {
          const updated = prev.map((c) => {
            if (c.id !== targetConversationId) return c;
            const shouldRetitle = c.messages.length === 0;
            const nextMessages = [...c.messages, userMsg, assistantMsg];
            return {
              ...c,
              title: shouldRetitle ? generateConversationTitle(titleSeed) : c.title,
              updatedAt: now,
              lastMessagePreview: computeLastMessagePreview(nextMessages),
              messages: nextMessages,
            };
          });
          return [...updated].sort((a, b) => b.updatedAt - a.updatedAt);
        });
      }

      await streamAssistantTurn({
        conversationId: targetConversationId,
        userMessageText: effectivePrompt,
        attachments,
        history: priorHistory,
        assistantMsgId: assistantMsg.id,
      });
    },
    [activeConversationId, markDirty, streamAssistantTurn]
  );

  const editUserMessage = useCallback(
    async (conversationId: string, messageId: string, newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed || isGeneratingRef.current) return;

      const conv = conversationsRef.current.find((c) => c.id === conversationId);
      if (!conv) return;

      const idx = conv.messages.findIndex((m) => m.id === messageId && m.role === 'user');
      if (idx === -1) return;

      const priorMessages = conv.messages.slice(0, idx);
      const priorHistory = buildHistoryPayload(priorMessages);
      const existingAttachments = conv.messages[idx].attachments;

      const updatedUserMsg: ChatMessage = {
        ...conv.messages[idx],
        content: trimmed,
      };
      const newAssistantMsg: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: '',
        createdAt: Math.max(Date.now(), updatedUserMsg.createdAt + 1),
      };

      const nextMessages = [...priorMessages, updatedUserMsg, newAssistantMsg];
      markDirty(conversationId);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                title: idx === 0 ? generateConversationTitle(trimmed) : c.title,
                updatedAt: Date.now(),
                lastMessagePreview: computeLastMessagePreview(nextMessages),
                messages: nextMessages,
              }
            : c
        )
      );

      await streamAssistantTurn({
        conversationId,
        userMessageText: trimmed,
        attachments: existingAttachments,
        history: priorHistory,
        assistantMsgId: newAssistantMsg.id,
      });
    },
    [markDirty, streamAssistantTurn]
  );

  const regenerateLastResponse = useCallback(async () => {
    if (isGeneratingRef.current || !activeConversation) return;

    const messages = activeConversation.messages;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    const lastUserMessage = messages[lastUserIdx];
    const priorHistory = buildHistoryPayload(messages.slice(0, lastUserIdx));

    const newAssistantMsg: ChatMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };

    const nextMessages = [...messages.slice(0, lastUserIdx + 1), newAssistantMsg];
    markDirty(activeConversation.id);

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConversation.id) return c;
        return {
          ...c,
          updatedAt: Date.now(),
          lastMessagePreview: computeLastMessagePreview(nextMessages),
          messages: nextMessages,
        };
      })
    );

    await streamAssistantTurn({
      conversationId: activeConversation.id,
      userMessageText: lastUserMessage.content,
      attachments: lastUserMessage.attachments,
      history: priorHistory,
      assistantMsgId: newAssistantMsg.id,
    });
  }, [activeConversation, markDirty, streamAssistantTurn]);

  const retryLastError = useCallback(async () => {
    if (isGeneratingRef.current || !activeConversation) return;
    const messages = activeConversation.messages;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'user') {
      const priorHistory = buildHistoryPayload(messages.slice(0, -1));

      const newAssistantMsg: ChatMessage = {
        id: createId('msg'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      const nextMessages = [...messages, newAssistantMsg];
      markDirty(activeConversation.id);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessagePreview: computeLastMessagePreview(nextMessages),
                messages: nextMessages,
              }
            : c
        )
      );

      await streamAssistantTurn({
        conversationId: activeConversation.id,
        userMessageText: lastMsg.content,
        attachments: lastMsg.attachments,
        history: priorHistory,
        assistantMsgId: newAssistantMsg.id,
      });
      return;
    }

    await regenerateLastResponse();
  }, [activeConversation, markDirty, regenerateLastResponse, streamAssistantTurn]);

  const saveVoiceTranscriptToChat = useCallback(
    (entries: Array<{ role: 'user' | 'assistant'; text: string }>, model?: string) => {
      const valid = entries.filter((e) => e.text.trim().length > 0);
      if (valid.length === 0) return;

      const now = Date.now();
      const chatMessages: ChatMessage[] = valid.map((e, idx) => ({
        id: createId('msg'),
        role: e.role,
        content: e.text.trim(),
        createdAt: now + idx,
        model: e.role === 'assistant' ? model : undefined,
      }));

      const titleSeed =
        valid.find((e) => e.role === 'user')?.text ?? 'Voice conversation';
      const newConv: Conversation = {
        id: createId('conv'),
        title: `Voice: ${generateConversationTitle(titleSeed)}`.slice(0, 80),
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: computeLastMessagePreview(chatMessages),
        messages: chatMessages,
      };
      markDirty(newConv.id);
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
    },
    [markDirty]
  );

  const exportJson = useCallback(() => {
    const content = exportConversationsAsJson(conversations);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consul-ai-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [conversations]);

  const exportTxt = useCallback(() => {
    const content = exportConversationsAsTxt(conversations);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consul-ai-history-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [conversations]);

  const importJson = useCallback(
    (rawJson: string): { ok: true; count: number } | { ok: false; error: string } => {
      const parsed = parseImportedConversations(rawJson);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      for (const conv of parsed.conversations) {
        markDirty(conv.id);
      }
      setConversations((prev) => {
        const merged = mergeImportedConversations(prev, parsed.conversations);
        if (!activeConversationId && merged[0]) {
          setActiveConversationId(merged[0].id);
        }
        return merged;
      });
      return { ok: true, count: parsed.conversations.length };
    },
    [activeConversationId, markDirty]
  );

  return {
    conversations,
    filteredConversations,
    activeConversation,
    activeConversationId,
    settings,
    searchQuery,
    setSearchQuery,
    isGenerating,
    errorState,
    clearError: () => setErrorState(null),
    storageWarning,
    apiStatus,
    refreshApiStatus,
    updateTheme,
    updateResponseLength,
    updateModel,
    updatePreferredLanguage,
    updateLiveVoiceName,
    updateMaxUploadMb,
    createNewChat,
    selectConversation,
    renameConversation,
    deleteConversation,
    clearAllHistory,
    deleteMessage,
    deleteSelectedMessages,
    clearConversationMessages,
    editUserMessage,
    sendMessage,
    stopGeneration,
    regenerateLastResponse,
    retryLastError,
    saveVoiceTranscriptToChat,
    exportJson,
    exportTxt,
    importJson,
    focusInputSignal,
    detectedContext,
  };
}
