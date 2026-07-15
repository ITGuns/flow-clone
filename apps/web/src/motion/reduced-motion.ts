// Single source of truth for the "should we animate?" decision that gates every dashboard
// micro-interaction (BUILD_GUIDE §7 quality floor: prefers-reduced-motion is honoured, and the
// UI is fully usable statically). Animation is presentation only — behaviour never depends on it.
//
// `resolveReducedMotion` is pure so it is unit-testable, and it deliberately defaults to REDUCED
// (true) whenever `matchMedia` is unavailable — e.g. the jsdom test environment — so component
// suites render statically without any rAF/spring churn and assert behaviour, not motion.
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Pure resolver: true = reduce motion (also the safe default when the platform can't tell us). */
export function resolveReducedMotion(win: Window | undefined): boolean {
  if (!win || typeof win.matchMedia !== 'function') return true;
  try {
    return win.matchMedia(QUERY).matches;
  } catch {
    return true;
  }
}

/** React hook mirroring `resolveReducedMotion`, kept live via a `change` listener. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    resolveReducedMotion(typeof window === 'undefined' ? undefined : window),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}
