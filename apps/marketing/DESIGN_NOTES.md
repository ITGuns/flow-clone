# Design notes — task 4j (original artwork + motion)

For the orchestrator's in-browser review. Identity kept (terracotta accent, editorial serif,
warm paper); craft raised to match the reference. No Wispr Flow assets/copy; no fabricated
social proof. Everything below is disabled cleanly under `prefers-reduced-motion` and readable
with JS off.

**Assets** (`apps/marketing/assets/*.svg`, all currentColor / `--accent`, inlined for theming):

- `logo.svg` — "spoken underline" mark: a baseline swelling like a breath; legible at 16px.
- `hero.svg` — layered illustration: breathing speech wave resolving into typeset lines.
- `glyph-{hotkey,streaming,privacy,dictionary,history,register}.svg` — 24px feature glyphs.
- Dashboard empty states (`apps/web/src/assets/illustrations.tsx`): history-empty, mic-permission, error.

**Landing motion** (`src/anim.ts`, GSAP + ScrollTrigger):

- Sticky-nav shadow on scroll; hero demo types the raw utterance then resolves to formatted text
  (reuses the on-page example); hero illustration breath loop; once-only 400ms card reveals;
  before/after "what Undertone types" panel wipe.

**Dashboard micro-interactions** (`apps/web/src/motion/`, motion/react):

- Push-to-talk press glow + level-driven ring; result card rise, copy→tick morph, word-by-word
  partial fade; SessionList/HistoryPanel layout animations; UsageMeter animated fill.
