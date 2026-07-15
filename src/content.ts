// Single source of truth for the pricing figures published on the site. These strings must
// match BUILD_GUIDE §1 verbatim; the build-output test (src/built-html.test.ts) then asserts
// every one of them survives into the rendered HTML, so copy drift fails CI instead of ship.
//
// Figures are authored directly into the HTML as static copy (no runtime templating needed for
// a static site). This module exists so the guard and any future scripting share one definition.
export const PRICING = {
  /** Free plan weekly allowance of formatted words. */
  freeWeeklyWords: '2,000',
  /** Pro plan monthly price. */
  proMonthly: '$12',
  /** Pro plan yearly price. */
  proYearly: '$96',
  /** Pro plan fair-use ceiling per week. */
  fairUseCap: '50k',
  /** Length of the no-card Pro trial. */
  trialLength: '14-day',
} as const;

// The privacy promises rendered in the landing page's "Privacy is the product" section. Each
// must stay true against ARCHITECTURE §2 (audio discarded) and CONTRACTS §7 (transcripts
// AES-256-GCM at rest) / §9 (timing marks never contain transcript content).
export const PRIVACY_CLAIMS = {
  audio: 'Your audio is transcribed in real time and discarded — it never touches our disks.',
  transcripts: 'History is encrypted at rest with AES-256-GCM; plaintext never hits our storage.',
  telemetry: 'Usage analytics count words and measure latency. They never carry what you said.',
} as const;

export type PricingKey = keyof typeof PRICING;
export type PrivacyClaimKey = keyof typeof PRIVACY_CLAIMS;
