import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { tokenizeCodeLine, type TokenType } from '../lib/syntaxHighlight';

interface CodeBlockProps {
  code: string;
  language?: string;
}

const TOKEN_CLASSES: Record<TokenType, string> = {
  keyword: 'text-sky-300 font-medium',
  string: 'text-emerald-300',
  comment: 'text-zinc-400 italic',
  number: 'text-amber-300',
  type: 'text-cyan-200',
  function: 'text-indigo-200',
  plain: 'text-zinc-100',
};

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted contexts
    }
  };

  const lines = code.replace(/\n$/, '').split('\n');
  const displayLang = language || 'text';

  return (
    <div
      dir="ltr"
      className="my-4 overflow-hidden rounded-xl border border-black/10 bg-[#1B1D21] text-zinc-100 dark:border-white/[0.09] dark:bg-[#0E1013]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-zinc-300">
        <span className="font-mono-code text-[11px] font-medium lowercase tracking-wide text-zinc-400">
          {displayLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${displayLang} code`}
          className="inline-flex min-h-[28px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6BA588] whitespace-nowrap shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono-code">
        <code>
          {lines.map((line, lineIdx) => {
            const tokens = tokenizeCodeLine(line, language);
            return (
              <div key={lineIdx} className="min-h-[1.4em]">
                {tokens.length === 0
                  ? ' '
                  : tokens.map((token, tokIdx) => (
                      <span key={tokIdx} className={TOKEN_CLASSES[token.type]}>
                        {token.value}
                      </span>
                    ))}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
