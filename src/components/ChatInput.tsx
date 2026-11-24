import { ArrowUp, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { detectTextDirection } from '../lib/language';

interface ChatInputProps {
  isGenerating: boolean;
  focusSignal?: number;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatInput({ isGenerating, focusSignal = 0, onSend, onStop }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const trimmed = value.trim();
  const dir = detectTextDirection(value);

  const handleSubmit = () => {
    if (!trimmed || isGenerating) return;
    onSend(trimmed);
    setValue('');
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
    <div className="border-t-2 border-blue-600/25 bg-[#EAF0FA]/95 px-3 pt-3.5 pb-3.5 backdrop-blur-xs sm:px-6 sm:pb-4 dark:border-blue-400/25 dark:bg-[#0D1322]/95">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border-2 border-blue-600/45 bg-white p-2.5 shadow-[0_8px_24px_-8px_rgba(37,99,235,0.28)] transition-all focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-600/20 dark:border-blue-400/45 dark:bg-[#141B2D] dark:shadow-[0_8px_24px_-8px_rgba(59,130,246,0.32)] dark:focus-within:border-blue-400 dark:focus-within:ring-blue-400/25">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            dir={dir}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ready to brainstorm your ideas..."
            aria-label="Message input"
            maxLength={8000}
            className="max-h-[180px] min-h-[46px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-snug text-zinc-950 placeholder:font-medium placeholder:text-zinc-500 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-400"
          />

          <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
            {value.length > 0 && !isGenerating && (
              <button
                type="button"
                onClick={() => {
                  setValue('');
                  textareaRef.current?.focus();
                }}
                aria-label="Clear input"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            {isGenerating ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generation"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 whitespace-nowrap shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!trimmed}
                aria-label="Send message"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-100 disabled:text-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-blue-500 dark:hover:bg-blue-400 dark:disabled:bg-blue-500/20 dark:disabled:text-blue-300"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] font-medium text-blue-900/70 dark:text-blue-200/70">
          Enter to send · Shift + Enter for new line · Live web &amp; local context enabled
        </p>
      </div>
    </div>
  );
}
