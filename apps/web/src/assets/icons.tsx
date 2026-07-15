// Extra inline icons for the dashboard micro-interactions. `currentColor` throughout so they
// inherit text/accent colours in both themes (kept out of components/icons.tsx, which task 4j
// does not own). 24px stroke style, consistent with the existing icon set.
import type { JSX } from 'react';

/** Success tick used in the Copy button's morph after a successful copy. */
export function CheckIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4 4 10-10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
