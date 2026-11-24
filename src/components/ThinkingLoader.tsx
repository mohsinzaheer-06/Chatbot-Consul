import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

const LOADING_PHASES = [
  'Reading local context…',
  'Checking live web facts…',
  'Drafting a clear response…',
];

export function ThinkingLoader() {
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhaseIdx((prev) => (prev + 1) % LOADING_PHASES.length);
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="py-1"
      role="status"
      aria-live="polite"
      aria-label="Generating response"
      data-testid="thinking-loader"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((idx) => (
            <motion.span
              key={idx}
              className="h-1.5 w-1.5 rounded-full bg-[#3D6B58] dark:bg-[#7CC0A3]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
              transition={{
                duration: 1.05,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: idx * 0.16,
              }}
            />
          ))}
        </div>

        <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p
              key={phaseIdx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="truncate text-[13px] text-[#5C6066] dark:text-[#9CA1A8]"
            >
              {LOADING_PHASES[phaseIdx]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="relative h-2 w-[78%] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <motion.div
            className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/75 to-transparent dark:via-white/15"
            animate={{ x: ['-100%', '220%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
        <div className="relative h-2 w-[56%] overflow-hidden rounded-full bg-black/[0.045] dark:bg-white/[0.06]">
          <motion.div
            className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/75 to-transparent dark:via-white/15"
            animate={{ x: ['-100%', '220%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.18 }}
          />
        </div>
      </div>
    </div>
  );
}
