// Shared motion prop presets for the dashboard micro-interactions. Each preset takes the resolved
// `reduced` flag: when reduced, it returns `{ initial: false }` so the element mounts at its final
// state with no enter/exit animation (motion renders it statically). Otherwise it returns a small,
// tasteful rise/fade — 240–320ms, gentle ease, never a bounce (BUILD_GUIDE §7).
import type { MotionProps } from 'motion/react';

// A soft ease-out curve (no overshoot). Reused across presets for a coherent feel.
const EASE_OUT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

/** Card / block entrance: rise + fade in, fall + fade out. */
export function rise(reduced: boolean): MotionProps {
  if (reduced) return { initial: false };
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.3, ease: EASE_OUT },
  };
}

/** List item enter/exit that also participates in layout animation (SessionList, HistoryPanel). */
export function listItem(reduced: boolean): MotionProps {
  if (reduced) return { initial: false };
  return {
    layout: true,
    initial: { opacity: 0, y: 8, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { duration: 0.26, ease: EASE_OUT },
  };
}

/** Word-by-word partial reveal: a quick fade so streaming text settles rather than jumps. */
export function word(reduced: boolean): MotionProps {
  if (reduced) return { initial: false };
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.18, ease: 'easeOut' },
  };
}

/** Copy-button success tick morph (icon swap inside AnimatePresence). */
export function tick(reduced: boolean): MotionProps {
  if (reduced) return { initial: false };
  return {
    initial: { opacity: 0, scale: 0.5 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.5 },
    transition: { duration: 0.16, ease: EASE_OUT },
  };
}
