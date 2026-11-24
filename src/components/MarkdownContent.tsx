import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { detectTextDirection } from '../lib/language';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
}

function isSafeHref(href?: string): boolean {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:')
  );
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const dir = detectTextDirection(content);

  return (
    <div
      dir={dir}
      className="prose-chat max-w-none text-[15.5px] leading-[1.72] text-[#222428] dark:text-[#E6E7EA]"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-display mt-6 mb-3 text-xl font-semibold tracking-tight text-[#18191B] dark:text-white first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-display mt-5 mb-2.5 text-lg font-semibold tracking-tight text-[#18191B] dark:text-white first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-display mt-4 mb-2 text-base font-semibold text-[#18191B] dark:text-white first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-3.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3.5 list-disc space-y-2 ps-5.5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3.5 list-decimal space-y-2 ps-5.5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-[1.68]">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#111214] dark:text-white">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-xl border border-black/[0.08] bg-black/[0.025] px-4 py-3 text-[#464A50] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-[#C4C8CE]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-black/[0.08] dark:border-white/[0.08]" />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-black/[0.09] dark:border-white/[0.09]">
              <table className="w-full border-collapse text-start text-sm tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-black/[0.03] text-[#18191B] dark:bg-white/[0.05] dark:text-white">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-black/[0.08] px-3.5 py-2.5 text-start font-semibold dark:border-white/[0.08]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-black/[0.06] px-3.5 py-2.5 dark:border-white/[0.06]">
              {children}
            </td>
          ),
          a: ({ href, children }) =>
            isSafeHref(href) ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#3D6B58] underline decoration-[#3D6B58]/40 underline-offset-2 transition-colors hover:text-[#2B4E3F] hover:decoration-[#2B4E3F] dark:text-[#7CC0A3] dark:decoration-[#7CC0A3]/40 dark:hover:text-[#98D1B8]"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            isSafeHref(src) ? (
              <span className="my-4 block overflow-hidden rounded-2xl border border-black/[0.08] bg-black/[0.03] shadow-md dark:border-white/[0.09] dark:bg-white/[0.03]">
                <img
                  src={src}
                  alt={alt || 'Generated Image'}
                  loading="lazy"
                  className="max-h-[500px] w-full object-cover transition-transform hover:scale-[1.01]"
                />
                {alt && (
                  <span className="block px-3.5 py-2 text-xs font-medium text-[#5C6066] dark:text-[#9CA1A8]">
                    {alt}
                  </span>
                )}
              </span>
            ) : null,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const text = String(children ?? '').replace(/\n$/, '');
            const isBlock = Boolean(match) || text.includes('\n');

            if (isBlock) {
              return <CodeBlock code={text} language={match?.[1]} />;
            }

            return (
              <code
                dir="ltr"
                className="font-mono-code rounded-md bg-black/[0.055] px-1.5 py-0.5 text-[13.5px] text-[#18191B] dark:bg-white/[0.09] dark:text-[#ECECEF]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
