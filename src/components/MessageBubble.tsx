import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Globe2,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type KeyboardEvent } from 'react';
import { detectTextDirection } from '../lib/language';
import type { ChatMessage } from '../types/chat';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingLoader } from './ThinkingLoader';

interface MessageBubbleProps {
  message: ChatMessage;
  isLatestAssistant: boolean;
  isGenerating: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onSelectFollowUp: (question: string) => void;
  onRegenerate: () => void;
  onEditUserMessage?: (newContent: string) => void;
  onDeleteMessage?: () => void;
}

function getHostname(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

export function MessageBubble({
  message,
  isLatestAssistant,
  isGenerating,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  onSelectFollowUp,
  onRegenerate,
  onEditUserMessage,
  onDeleteMessage,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(message.content);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const commitEdit = () => {
    const trimmed = draftEdit.trim();
    if (!trimmed || !onEditUserMessage) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    if (trimmed !== message.content.trim()) {
      onEditUserMessage(trimmed);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setDraftEdit(message.content);
    }
  };

  if (message.role === 'user') {
    const dir = detectTextDirection(isEditing ? draftEdit : message.content);
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="group flex flex-col items-end gap-1.5"
      >
        <div className="flex w-full items-start justify-end gap-2.5">
          {isSelectionMode && (
            <label className="mt-3 flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                aria-label="Select user message"
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
              />
            </label>
          )}

          {isEditing ? (
            <div className="w-full max-w-[88%] rounded-2xl border border-blue-600 bg-white p-3 shadow-sm sm:max-w-[78%] dark:border-blue-400 dark:bg-[#14141E]">
              <textarea
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                onKeyDown={handleEditKeyDown}
                dir={dir}
                rows={3}
                autoFocus
                aria-label="Edit message"
                className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-zinc-950 focus:outline-none dark:text-zinc-100"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setDraftEdit(message.content);
                  }}
                  className="min-h-[32px] rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commitEdit}
                  disabled={!draftEdit.trim()}
                  className="min-h-[32px] rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Save &amp; resend
                </button>
              </div>
            </div>
          ) : (
            <div
              dir={dir}
              data-testid="user-message"
              className="max-w-[88%] rounded-2xl border border-blue-700/35 bg-blue-600 px-4 py-3 text-[15px] leading-relaxed text-white shadow-[0_3px_0_0_rgba(29,78,216,0.22)] sm:max-w-[78%] dark:border-blue-400/35 dark:bg-blue-600 dark:text-white dark:shadow-none"
            >
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          )}
        </div>

        {!isEditing && !isGenerating && (onEditUserMessage || onDeleteMessage) && (
          <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {onEditUserMessage && (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDraftEdit(message.content);
                  setIsEditing(true);
                }}
                aria-label="Edit message"
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                <span>Edit</span>
              </button>
            )}
            {onDeleteMessage && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete message"
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span>Delete</span>
              </button>
            )}
            {onDeleteMessage && confirmDelete && (
              <div className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-1.5 py-0.5 dark:border-rose-900/60 dark:bg-rose-950/40">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDeleteMessage();
                  }}
                  className="text-[11px] font-semibold text-rose-700 hover:underline dark:text-rose-300"
                >
                  Confirm delete
                </button>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-[11px] text-zinc-600 hover:underline dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  const isWaitingFirstToken = isGenerating && isLatestAssistant && !message.content;
  const followUps = message.followUpQuestions ?? [];
  const sources = (message.sources ?? []).filter(
    (s) => s.uri.startsWith('https://') || s.uri.startsWith('http://')
  );
  const followUpDir =
    followUps.length > 0 ? detectTextDirection(followUps[0]) : detectTextDirection(message.content);

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      data-testid="assistant-message"
      className="rounded-2xl border border-zinc-900/12 bg-white px-4 py-4 shadow-[0_2px_0_0_rgba(24,24,27,0.06)] sm:px-5 sm:py-4.5 dark:border-white/10 dark:bg-[#111118] dark:shadow-none"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isSelectionMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              aria-label="Select assistant response"
              className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
            />
          )}
          <span className="font-display inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-900/15 bg-[#D9F99D] text-xs font-extrabold text-zinc-950 dark:border-emerald-400/30 dark:bg-emerald-400/15 dark:text-emerald-300">
            C
          </span>
          <span className="font-display text-xs font-bold tracking-tight text-zinc-950 dark:text-zinc-100">
            Consul AI
          </span>
        </div>
        <span className="font-mono-code text-[11px] text-zinc-400 tabular-nums dark:text-zinc-500">
          {timeLabel}
        </span>
      </div>

      {isWaitingFirstToken ? <ThinkingLoader /> : <MarkdownContent content={message.content} />}

      {message.stopped && (
        <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-400">
          Response generation stopped.
        </p>
      )}

      {sources.length > 0 && !(isGenerating && isLatestAssistant) && (
        <div
          data-testid="grounding-sources"
          className="mt-4 rounded-xl border border-sky-200/80 bg-sky-50/70 p-3 dark:border-sky-500/20 dark:bg-sky-950/25"
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-900 dark:text-sky-300">
            <Globe2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <span>Web sources</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sources.map((src) => (
              <a
                key={src.uri}
                href={src.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-2 rounded-xl border border-sky-200/90 bg-white px-3 py-2 text-xs transition-colors hover:border-sky-500 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-600 dark:border-sky-500/25 dark:bg-[#0F1726] dark:hover:border-sky-400/60 dark:hover:bg-sky-950/45"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {src.title}
                  </p>
                  <p className="font-mono-code truncate text-[11px] text-sky-700/80 dark:text-sky-300/75">
                    {getHostname(src.uri)}
                  </p>
                </div>
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 text-sky-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-sky-700 dark:group-hover:text-sky-300"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {message.content && !(isGenerating && isLatestAssistant) && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-zinc-200/80 pt-3 dark:border-white/10">
          <button
            type="button"
            onClick={handleCopyResponse}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>

          {isLatestAssistant && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isGenerating}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Regenerate</span>
            </button>
          )}

          {onDeleteMessage && !isGenerating && (
            !confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete response"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Delete</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 dark:border-rose-900/60 dark:bg-rose-950/40">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDeleteMessage();
                  }}
                  className="text-xs font-semibold text-rose-700 hover:underline dark:text-rose-300"
                >
                  Confirm delete
                </button>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-zinc-600 hover:underline dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            )
          )}
        </div>
      )}

      {isLatestAssistant && followUps.length > 0 && !isGenerating && (
        <div
          dir={followUpDir}
          data-testid="followup-suggestions"
          className="mt-3.5 rounded-xl border border-violet-200/80 bg-violet-50/60 p-3 dark:border-violet-500/20 dark:bg-violet-950/25"
        >
          <p className="mb-2 text-xs font-semibold text-violet-900 dark:text-violet-300">
            Keep exploring
          </p>
          <div className="flex flex-col gap-2">
            {followUps.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => onSelectFollowUp(question)}
                dir={detectTextDirection(question)}
                className="group flex min-h-[42px] w-full items-center justify-between gap-3 rounded-xl border border-violet-200/90 bg-white px-3.5 py-2 text-start text-sm font-medium text-zinc-800 transition-all hover:-translate-y-0.5 hover:border-violet-500 hover:bg-violet-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-violet-500/25 dark:bg-[#171527] dark:text-zinc-200 dark:hover:border-violet-400/60 dark:hover:bg-violet-950/45 dark:hover:text-white"
              >
                <span className="leading-snug">{question}</span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-700 rtl:rotate-180 rtl:group-hover:-translate-x-0.5 dark:group-hover:text-violet-300"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.article>
  );
}
