// Debounce a rapidly-changing value (the search box text) so we hit the history API at most once per
// quiet period. 250ms per the task spec. Isolated as a hook so it can be tested with fake timers and
// reused by settings/dictionary search later.
import { useEffect, useState } from 'react';

/** Returns `value` delayed by `delayMs` of quiet; resets the timer on every change. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
