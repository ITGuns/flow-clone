// Web-side pricing figures — the SINGLE constant the dashboard's billing section reads so the
// numbers rendered to users can't drift apart across the UI. Mirrors BUILD_GUIDE §1: Free = 2,000
// formatted words/week at $0; Pro = 50,000 words/week fair-use at $12/mo or $96/yr (two months
// free on the yearly plan).
//
// CANONICAL SOURCE: apps/api/src/billing/plans.ts owns the authoritative plan definitions and the
// Stripe price IDs the server bills against. This module only mirrors the display figures for the
// web surface; if §1 changes, update the api module first, then this mirror.

/** Pro plan advertised prices, in whole USD (guide §1). */
export const PRO_MONTHLY_USD = 12;
export const PRO_YEARLY_USD = 96;

/** Weekly formatted-word caps (guide §1) — reused for the honest usage line. */
export const FREE_WEEKLY_WORDS = 2000;
export const PRO_WEEKLY_WORDS = 50000;

/** Months of Pro effectively free on the yearly plan (12 × $12 = $144 vs $96). */
export const YEARLY_FREE_MONTHS = 2;
