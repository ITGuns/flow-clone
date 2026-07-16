// Original warm empty-state illustrations for the dashboard. Consistent language: a light "paper"
// panel (currentColor at low opacity), terracotta accent (var(--accent)), and the product's
// "spoken underline" breath motif — a baseline that swells like a spoken sentence. All strokes use
// currentColor / CSS variables so light and dark themes both read correctly; no embedded raster.
import type { JSX } from 'react';

const VIEWBOX = '0 0 160 120';

/** Shared framing: a faint rounded panel the motif sits on. */
function Panel(): JSX.Element {
  return (
    <rect
      x="18"
      y="20"
      width="124"
      height="80"
      rx="12"
      fill="none"
      stroke="currentColor"
      strokeOpacity="0.16"
      strokeWidth="2"
    />
  );
}

/** History empty: stacked transcript lines resolving into the spoken-underline baseline. */
export function HistoryEmptyArt(): JSX.Element {
  return (
    <svg className="art" viewBox={VIEWBOX} fill="none" role="img" aria-label="No history yet">
      <Panel />
      <path
        d="M34 44h64"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M34 56h84"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M34 68h48"
        stroke="currentColor"
        strokeOpacity="0.16"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Spoken underline — a baseline that swells like a breath. */}
      <path
        d="M34 84c10 0 8-9 16-9s6 12 16 12 8-14 18-14 8 11 16 11"
        stroke="var(--accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Mic permission: a microphone breathing outward — the pre-prompt reassurance. */
export function MicPermissionArt(): JSX.Element {
  return (
    <svg className="art" viewBox={VIEWBOX} fill="none" role="img" aria-label="Microphone">
      <Panel />
      <path
        d="M80 46a7 7 0 0 1 7 7v9a7 7 0 0 1-14 0v-9a7 7 0 0 1 7-7Z"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M68 60a12 12 0 0 0 24 0M80 74v8"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Breath arcs in the accent. */}
      <path
        d="M100 48a18 18 0 0 1 0 24"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M108 42a28 28 0 0 1 0 36"
        stroke="var(--accent)"
        strokeOpacity="0.45"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Error state: an interrupted waveform with a warm alert dot — honest, not alarming. */
export function ErrorStateArt(): JSX.Element {
  return (
    <svg className="art" viewBox={VIEWBOX} fill="none" role="img" aria-label="Something went wrong">
      <Panel />
      <path
        d="M34 60h10l6-16 8 32 6-24 5 12h4"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The line breaks — a gap — then a warm alert. */}
      <path
        d="M92 60h6"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      <circle cx="116" cy="60" r="12" stroke="var(--accent)" strokeWidth="2.6" fill="none" />
      <path d="M116 54v7" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="116" cy="66" r="1.4" fill="var(--accent)" />
    </svg>
  );
}
