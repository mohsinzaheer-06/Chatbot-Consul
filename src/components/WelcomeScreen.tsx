import { Code2, Compass, Globe2, Lightbulb, PenLine } from 'lucide-react';
import { motion } from 'motion/react';
import { detectTextDirection } from '../lib/language';
import { ConsulLogo } from './ConsulLogo';

interface StarterSuggestion {
  category: string;
  prompt: string;
  icon: typeof Lightbulb;
}

const STARTER_SUGGESTIONS: StarterSuggestion[] = [
  {
    category: 'Learn something new',
    prompt: 'Explain how compound interest and inflation affect everyday savings in simple terms.',
    icon: Lightbulb,
  },
  {
    category: 'Write and create',
    prompt: 'Write a polite, concise email to reschedule a client meeting to next Tuesday.',
    icon: PenLine,
  },
  {
    category: 'Solve a problem',
    prompt: 'Mujhe Next.js aur React ka farq simple Roman Urdu mein samjhao.',
    icon: Compass,
  },
  {
    category: 'Develop something',
    prompt: 'Design a clean folder structure and REST API plan for a small task-tracking web app.',
    icon: Code2,
  },
];

interface WelcomeScreenProps {
  detectedContext: {
    timezone: string;
    locationLabel?: string;
  };
  onSelectPrompt: (prompt: string) => void;
}

export function WelcomeScreen({ detectedContext, onSelectPrompt }: WelcomeScreenProps) {
  const contextLine = detectedContext.locationLabel
    ? `${detectedContext.locationLabel} · ${detectedContext.timezone}`
    : detectedContext.timezone;

  return (
    <div className="mx-auto flex w-full max-w-[740px] flex-1 flex-col justify-center px-5 py-8 sm:px-8 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8 sm:mb-10"
      >
        <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-[#3D6B58] shadow-xs dark:border-white/[0.1] dark:bg-[#1D1F23] dark:text-[#7CC0A3]">
          <ConsulLogo className="h-5 w-5" />
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#18191B] sm:text-3xl dark:text-[#ECECEF] [text-wrap:balance]">
          Good to see you.
        </h1>
        <p className="mt-1.5 text-base font-normal text-[#5C6066] sm:text-lg dark:text-[#9CA1A8] [text-wrap:balance]">
          What would you like to explore today?
        </p>

        <div className="mt-4 flex items-center gap-2 text-xs text-[#6E737B] dark:text-[#8E939C]">
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
          <span className="truncate">Live web grounding active · {contextLine}</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
        {STARTER_SUGGESTIONS.map((item, idx) => {
          const Icon = item.icon;
          const dir = detectTextDirection(item.prompt);
          return (
            <motion.button
              key={item.category}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.035, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => onSelectPrompt(item.prompt)}
              dir={dir}
              className="group flex min-h-[44px] flex-col items-start rounded-2xl border border-black/[0.08] bg-white/75 px-4 py-3.5 text-start transition-colors hover:border-[#3D6B58]/35 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D6B58] dark:border-white/[0.08] dark:bg-[#1B1C1F]/70 dark:hover:border-[#6BA588]/40 dark:hover:bg-[#1D1F23]"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-[#3D6B58] dark:text-[#7CC0A3]">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{item.category}</span>
              </div>
              <span className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-[#3F4349] transition-colors group-hover:text-[#18191B] dark:text-[#B9BEC6] dark:group-hover:text-white">
                {item.prompt}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
