
import {
  AlertCircle,
  ArrowUp,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Presentation,
  Square,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ACCEPTED_FILE_EXTENSIONS, processFileLocally } from '../lib/fileProcessor';
import { detectTextDirection } from '../lib/language';
import { DEFAULT_UPLOAD_LIMITS } from '../lib/models';
import type { MessageAttachment } from '../types/chat';

interface ChatInputProps {
  isGenerating: boolean;
  focusSignal?: number;
  maxUploadMb?: number;
  onSend: (text: string, attachments?: MessageAttachment[]) => void;
  onStop: () => void;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getAttachmentIcon(att: MessageAttachment) {
  if (att.kind === 'image') return ImageIcon;
  if (att.kind === 'spreadsheet') return FileSpreadsheet;
  if (att.kind === 'presentation') return Presentation;
  return FileText;
}

export function ChatInput({
  isGenerating,
  focusSignal = 0,
  maxUploadMb = DEFAULT_UPLOAD_LIMITS.defaultMaxFileMb,
  onSend,
  onStop,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if (focusSignal > 0) {
      textareaRef.current?.focus();
    }
  }, [focusSignal]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const trimmed = value.trim();
  const dir = detectTextDirection(value);
  const canSend = (trimmed.length > 0 || attachments.length > 0) && !isProcessingFiles;

  const handleFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setComposerNotice(null);

    const remainingSlots = DEFAULT_UPLOAD_LIMITS.maxFilesPerMessage - attachments.length;
    if (remainingSlots <= 0) {
      setComposerNotice(
        `Maximum ${DEFAULT_UPLOAD_LIMITS.maxFilesPerMessage} files can be attached per message.`
      );
      return;
    }

    const toProcess = incoming.slice(0, remainingSlots);
    setIsProcessingFiles(true);
    const added: MessageAttachment[] = [];
    const errors: string[] = [];

    for (const file of toProcess) {
      try {
        const processed = await processFileLocally(file, { maxFileMb: maxUploadMb });
        added.push(processed);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Could not read "${file.name}".`);
      }
    }

    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added].slice(0, DEFAULT_UPLOAD_LIMITS.maxFilesPerMessage));
    }
    if (errors.length > 0) {
      setComposerNotice(errors[0]);
    } else if (incoming.length > remainingSlots) {
      setComposerNotice(
        `Attached the first ${remainingSlots} file(s). Limit is ${DEFAULT_UPLOAD_LIMITS.maxFilesPerMessage} files per message.`
      );
    }

    setIsProcessingFiles(false);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void handleFiles(files);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const toggleDictation = () => {
    setComposerNotice(null);
    if (isDictating) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsDictating(false);
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) {
      setComposerNotice('Browser speech dictation is unavailable in this browser.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (event) => {
        const lastIdx = event.results.length - 1;
        const transcriptText = event.results[lastIdx]?.[0]?.transcript?.trim();
        if (transcriptText) {
          setValue((prev) => (prev.trim() ? `${prev.trimEnd()} ${transcriptText}` : transcriptText));
        }
      };
      rec.onerror = (ev) => {
        setIsDictating(false);
        if (ev.error === 'not-allowed') {
          setComposerNotice('Microphone access was denied for speech dictation.');
        }
      };
      rec.onend = () => {
        setIsDictating(false);
      };
      recognitionRef.current = rec;
      rec.start();
      setIsDictating(true);
    } catch {
      setIsDictating(false);
      setComposerNotice('Could not start speech dictation in this browser.');
    }
  };

  const handleSubmit = () => {
    if (!canSend || isGenerating) return;
    if (isDictating) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsDictating(false);
    }
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    setComposerNotice(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="shrink-0 bg-linear-to-t from-[#FAF9F6] via-[#FAF9F6]/95 to-transparent px-3.5 pt-2 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5 dark:from-[#131416] dark:via-[#131416]/95">
      <div className="mx-auto max-w-[760px]">
        {composerNotice && (
          <div
            role="status"
            className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{composerNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setComposerNotice(null)}
              aria-label="Dismiss notice"
              className="rounded p-0.5 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-[26px] border bg-white px-3 py-2 shadow-[0_6px_24px_-6px_rgba(24,25,27,0.08)] transition-all dark:bg-[#1D1F23] dark:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.45)] ${
            isDragging
              ? 'border-[#3D6B58] ring-2 ring-[#3D6B58]/25 dark:border-[#6BA588] dark:ring-[#6BA588]/30'
              : 'border-black/[0.11] focus-within:border-[#3D6B58]/60 focus-within:ring-2 focus-within:ring-[#3D6B58]/15 dark:border-white/[0.11] dark:focus-within:border-[#6BA588]/60 dark:focus-within:ring-[#6BA588]/20'
          }`}
        >
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px] bg-[#3D6B58]/10 text-xs font-medium text-[#3D6B58] backdrop-blur-[1px] dark:bg-[#6BA588]/15 dark:text-[#7CC0A3]">
              Drop PDF, Word, Excel, PowerPoint, or images here
            </div>
          )}

          {/* Attachment Preview Strip */}
          {(attachments.length > 0 || isProcessingFiles) && (
            <div className="mb-2 flex flex-wrap gap-2 px-1.5 pt-1">
              {attachments.map((att) => {
                const Icon = getAttachmentIcon(att);
                return (
                  <div
                    key={att.id}
                    data-testid="composer-attachment"
                    className="flex max-w-[230px] items-center gap-2 rounded-xl border border-black/[0.08] bg-[#FAF9F6] py-1.5 pr-1.5 pl-2 text-xs dark:border-white/[0.09] dark:bg-[#131416]"
                  >
                    {att.previewDataUrl ? (
                      <img
                        src={att.previewDataUrl}
                        alt={att.name}
                        className="h-7 w-7 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#3D6B58]/10 text-[#3D6B58] dark:bg-[#6BA588]/15 dark:text-[#7CC0A3]">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[#18191B] dark:text-[#ECECEF]">
                        {att.name}
                      </p>
                      {att.summaryLabel && (
                        <p className="truncate text-[10px] text-[#6E737B] dark:text-[#8E939C]">
                          {att.summaryLabel}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                      }
                      aria-label={`Remove ${att.name}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#6E737B] hover:bg-black/[0.06] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {isProcessingFiles && (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-[#FAF9F6] px-3 py-1.5 text-xs text-[#5C6066] dark:border-white/[0.08] dark:bg-[#131416] dark:text-[#9CA1A8]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Reading file locally…</span>
                </div>
              )}
            </div>
          )}

          {/* Textarea Row */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            dir={dir}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ready to brainstorm ideas, analyze documents, or ask anything..."
            aria-label="Message input"
            maxLength={8000}
            className="max-h-[180px] min-h-[40px] w-full resize-none bg-transparent px-2.5 py-1.5 text-[14.5px] leading-snug text-[#18191B] placeholder:text-[13.5px] placeholder:text-[#757A82] focus:outline-none sm:text-[15px] sm:placeholder:text-[15px] dark:text-[#ECECEF] dark:placeholder:text-[#868B93]"
          />

          {/* Compact Bottom Action Toolbar */}
          <div className="mt-1 flex items-center justify-between gap-2 px-0.5 pb-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={isGenerating || isProcessingFiles}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach documents or images"
                title="Attach PDF, Word, Excel, PowerPoint, CSV, or images"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] disabled:opacity-45 dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_EXTENSIONS}
                onChange={handleFileInputChange}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />



              <button
                type="button"
                disabled={isGenerating}
                onClick={toggleDictation}
                aria-label={isDictating ? 'Stop voice dictation' : 'Voice dictation'}
                title={isDictating ? 'Stop dictation' : 'Dictate text'}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                  isDictating
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    : 'text-[#5C6066] hover:bg-black/[0.05] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white'
                }`}
              >
                {isDictating ? (
                  <MicOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {value.length > 0 && !isGenerating && (
                <button
                  type="button"
                  onClick={() => {
                    setValue('');
                    textareaRef.current?.focus();
                  }}
                  aria-label="Clear input"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#6E737B] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}



              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop generation"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#18191B] px-3.5 text-xs font-medium text-white transition-colors hover:bg-[#2B2D31] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D6B58] dark:bg-[#ECECEF] dark:text-[#131416] dark:hover:bg-white whitespace-nowrap shrink-0"
                >
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSend}
                  aria-label="Send message"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#3D6B58] text-white transition-colors hover:bg-[#315848] disabled:cursor-not-allowed disabled:bg-black/[0.07] disabled:text-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D6B58] dark:bg-[#6BA588] dark:text-[#111315] dark:hover:bg-[#7CC0A3] dark:disabled:bg-white/[0.08] dark:disabled:text-white/25"
                >
                  <ArrowUp className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-2 hidden text-center text-[11px] text-[#787C82] sm:block dark:text-[#7D828A]">
          Enter to send · Drag &amp; drop PDF, Word, Excel, PowerPoint, or images · Local-first &amp; free-tier
        </p>
      </div>
    </div>
  );
}
