// Deterministic relative-time formatting for history rows. Pure and `now`-injectable so it is
// trivially unit-testable and never depends on the wall clock inside a component render.
// Returns short, glanceable copy ("just now", "3 min ago", "yesterday", "Mar 4"); the row also
// exposes the absolute timestamp as a `title` for hover/AT.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short relative label for `iso` as of `now` (both ms-comparable). Future times clamp to "just now". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const delta = now.getTime() - then;

  if (delta < 45 * 1000) return 'just now';
  if (delta < HOUR) {
    const m = Math.max(1, Math.round(delta / MINUTE));
    return `${m} min ago`;
  }
  if (delta < DAY) {
    const h = Math.round(delta / HOUR);
    return `${h} hr ago`;
  }
  if (delta < 2 * DAY) return 'yesterday';
  if (delta < 7 * DAY) {
    const d = Math.round(delta / DAY);
    return `${d} days ago`;
  }
  // Older than a week → an absolute short date, localized.
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Full absolute timestamp for the row's `title`/tooltip. */
export function absoluteTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  return then.toLocaleString();
}
