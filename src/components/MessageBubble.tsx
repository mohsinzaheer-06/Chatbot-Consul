import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckSquare,
  Copy,
  FileSpreadsheet,
  FileText,
  Globe2,
  Pencil,
  Presentation,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type KeyboardEvent } from 'react';
import { detectTextDirection } from '../lib/language';
import type { ChatMessage } from '../types/chat';
import { ConsulLogo } from './ConsulLogo';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingLoader } from './ThinkingLoader';

interface MessageBubbleProps {
  message: ChatMessage;
  isLatestAssistant: boolean;
  isGenerating: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onEnterSelectionMode?: () => void;
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
  onEnterSelectionMode,
  onSelectFollowUp,
  onRegenerate,
  onEditUserMessage,
  onDeleteMessage,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(message.content);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleCopy = async () => {
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
    const attachments = message.attachments ?? [];
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
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
                className="h-4 w-4 rounded border-zinc-400 text-[#3D6B58] focus:ring-[#3D6B58]"
              />
            </label>
          )}

          {isEditing ? (
            <div className="w-full max-w-[90%] rounded-2xl border border-[#3D6B58]/50 bg-white p-3.5 shadow-xs sm:max-w-[78%] dark:border-[#6BA588]/50 dark:bg-[#1D1F23]">
              <textarea
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                onKeyDown={handleEditKeyDown}
                dir={dir}
                rows={3}
                autoFocus
                aria-label="Edit message"
                className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-[#18191B] focus:outline-none dark:text-[#ECECEF]"
              />
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setDraftEdit(message.content);
                  }}
                  className="min-h-[34px] rounded-xl border border-black/[0.1] px-3 text-xs font-medium text-[#464A50] hover:bg-black/[0.04] dark:border-white/[0.1] dark:text-[#C4C8CE] dark:hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commitEdit}
                  disabled={!draftEdit.trim()}
                  className="min-h-[34px] rounded-xl bg-[#3D6B58] px-3.5 text-xs font-medium text-white hover:bg-[#315848] disabled:opacity-50 dark:bg-[#6BA588] dark:text-[#111315] dark:hover:bg-[#7BB59C]"
                >
                  Save &amp; resend
                </button>
              </div>
            </div>
          ) : (
            <div className="flex max-w-[86%] flex-col items-end gap-2 sm:max-w-[75%]">
              {attachments.length > 0 && (
                <div className="flex flex-wrap justify-end gap-2">
                  {attachments.map((att) => {
                    const Icon =
                      att.kind === 'spreadsheet'
                        ? FileSpreadsheet
                        : att.kind === 'presentation'
                          ? Presentation
                          : FileText;
                    if (att.kind === 'image' && att.previewDataUrl) {
                      return (
                        <div
                          key={att.id}
                          className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-xs dark:border-white/[0.09] dark:bg-[#1D1F23]"
                        >
                          <img
                            src={att.previewDataUrl}
                            alt={att.name}
                            className="max-h-44 max-w-[220px] object-cover"
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-3 py-2 text-xs dark:border-white/[0.09] dark:bg-[#1D1F23]"
                      >
                        <Icon
                          className="h-4 w-4 shrink-0 text-[#3D6B58] dark:text-[#7CC0A3]"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="max-w-[180px] truncate font-medium text-[#18191B] dark:text-[#ECECEF]">
                            {att.name}
                          </p>
                          {att.summaryLabel && (
                            <p className="text-[10px] text-[#6E737B] dark:text-[#8E939C]">
                              {att.summaryLabel}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                dir={dir}
                data-testid="user-message"
                className="rounded-3xl bg-[#EFECE5] px-4.5 py-3 text-[15px] leading-[1.62] text-[#18191B] dark:bg-[#25272B] dark:text-[#ECECEF]"
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          )}
        </div>

        {!isEditing && !isGenerating && (
          <div className="flex items-center gap-0.5 opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy prompt"
              title="Copy"
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-[#6B7078] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] dark:text-[#8E939C] dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {onEditUserMessage && (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDraftEdit(message.content);
                  setIsEditing(true);
                }}
                aria-label="Edit message"
                title="Edit"
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-[#6B7078] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] dark:text-[#8E939C] dark:hover:bg-white/[0.07] dark:hover:text-white"
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
                title="Delete"
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-[#6B7078] transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:text-[#8E939C] dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span>Delete</span>
              </button>
            )}

            {onDeleteMessage && confirmDelete && (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/8 px-2 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDeleteMessage();
                  }}
                  className="text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-400"
                >
                  Confirm
                </button>
                <span className="text-[#9CA1A8]">·</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-[11px] text-[#5C6066] hover:underline dark:text-[#9CA1A8]"
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      data-testid="assistant-message"
      className="group"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-4">
        {/* Minimal Avatar Row on mobile, Left Column on tablet/desktop */}
        <div className="flex shrink-0 items-center gap-2 sm:pt-0.5">
          {isSelectionMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              aria-label="Select assistant response"
              className="h-4 w-4 cursor-pointer rounded border-zinc-400 text-[#3D6B58] focus:ring-[#3D6B58]"
            />
          )}
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] bg-white text-[#3D6B58] dark:border-white/[0.1] dark:bg-[#1D1F23] dark:text-[#7CC0A3]">
            <ConsulLogo className="h-4 w-4" />
          </div>
          <span className="font-display text-xs font-semibold tracking-tight text-[#18191B] sm:hidden dark:text-[#ECECEF]">
            Consul AI
          </span>
        </div>

        {/* Prose directly on canvas (no enclosing card) */}
        <div className="min-w-0 flex-1">
          {isWaitingFirstToken ? (
            <ThinkingLoader />
          ) : (
            <MarkdownContent content={message.content} />
          )}

          {message.stopped && (
            <p className="mt-2.5 text-xs text-[#6E737B] dark:text-[#8E939C]">
              Response generation stopped.
            </p>
          )}

          {/* Clean Grounding Sources Strip */}
          {sources.length > 0 && !(isGenerating && isLatestAssistant) && (
            <div data-testid="grounding-sources" className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#5C6066] dark:text-[#9CA1A8]">
                <Globe2 className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
                <span>Sources</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {sources.map((src) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/src inline-flex max-w-full items-center gap-2 rounded-xl border border-black/[0.08] bg-white/75 px-3 py-1.5 text-xs transition-colors hover:border-[#3D6B58]/40 hover:bg-white focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-[#6BA588]/40 dark:hover:bg-white/[0.06]"
                  >
                    <span className="truncate font-medium text-[#18191B] max-w-[190px] sm:max-w-[230px] dark:text-[#ECECEF]">
                      {src.title}
                    </span>
                    <span className="font-mono-code shrink-0 text-[11px] text-[#6E737B] dark:text-[#8E939C]">
                      {getHostname(src.uri)}
                    </span>
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-[#757A82] transition-transform group-hover/src:translate-x-0.5 group-hover/src:-translate-y-0.5 group-hover/src:text-[#3D6B58] dark:group-hover/src:text-[#7CC0A3]"
                      aria-hidden="true"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Unobtrusive Action Toolbar */}
          {message.content && !(isGenerating && isLatestAssistant) && (
            <div
              className={`mt-3 flex flex-wrap items-center gap-1 transition-opacity ${
                isLatestAssistant
                  ? 'opacity-95'
                  : 'opacity-85 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy response"
                title="Copy"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
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
                  aria-label="Regenerate response"
                  title="Regenerate"
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Regenerate</span>
                </button>
              )}

              {onEnterSelectionMode && !isSelectionMode && (
                <button
                  type="button"
                  onClick={onEnterSelectionMode}
                  aria-label="Select messages"
                  title="Select"
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white whitespace-nowrap shrink-0"
                >
                  <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Select</span>
                </button>
              )}

              {onDeleteMessage && !isGenerating && (
                !confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete response"
                    title="Delete"
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#5C6066] transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-rose-500/15 dark:hover:text-rose-400 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/8 px-2.5 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(false);
                        onDeleteMessage();
                      }}
                      className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                    >
                      Confirm delete
                    </button>
                    <span className="text-[#9CA1A8]">·</span>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs text-[#5C6066] hover:underline dark:text-[#9CA1A8]"
                    >
                      Cancel
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* Clean Follow-Up Suggestions */}
          {isLatestAssistant && followUps.length > 0 && !isGenerating && (
            <div dir={followUpDir} data-testid="followup-suggestions" className="mt-5">
              <p className="font-ui mb-2 text-xs font-medium text-[#6E737B] dark:text-[#8E939C]">
                Follow-up questions
              </p>
              <div className="flex flex-col gap-1.5">
                {followUps.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => onSelectFollowUp(question)}
                    dir={detectTextDirection(question)}
                    className="group/fu flex min-h-[42px] w-full items-center justify-between gap-3 rounded-xl border border-black/[0.08] bg-white/65 px-3.5 py-2 text-start text-[13.5px] font-medium text-[#2A2D32] transition-colors hover:border-[#3D6B58]/40 hover:bg-white hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D6B58] dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-[#D5D8DD] dark:hover:border-[#6BA588]/40 dark:hover:bg-white/[0.06] dark:hover:text-white"
                  >
                    <span className="leading-snug">{question}</span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-[#757A82] transition-transform group-hover/fu:translate-x-0.5 group-hover/fu:text-[#3D6B58] rtl:rotate-180 rtl:group-hover/fu:-translate-x-0.5 dark:text-[#8E939C] dark:group-hover/fu:text-[#7CC0A3]"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}
