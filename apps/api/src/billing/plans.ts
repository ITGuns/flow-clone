// Plan definitions & pricing — BUILD_GUIDE §1, CONTRACTS §1/§7. The SINGLE source of truth for
// the weekly word limits that Task 3f (metering) and the Phase 3 gate consume for QUOTA_EXCEEDED
// enforcement (§8). This module is pure constants + helpers — it touches no DB and no Stripe SDK.
//
// Pricing (guide §1): Free = 2,000 formatted words/week, $0. Pro = 50,000 words/week fair-use,
// $12/mo or $96/yr. Trial = 14 days of Pro on signup, no card.
//
// Stripe price IDs are read from env (STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_YEARLY) with
// mock-mode placeholder defaults. NOTE: those two env vars are NOT in CONTRACTS §10 — flagged to
// the orchestrator as contract friction to add to the §10 env contract + .env.example.

/** Plan tiers — mirrors `users.plan` (§7 `text ('free'|'pro')`). */
export type PlanId = 'free' | 'pro';

/** Billing cadence for the Pro plan. Stored in `subscriptions.plan_interval` (§7). */
export type PlanInterval = 'monthly' | 'yearly';

/** Weekly formatted-word cap per tier (§1, §7). THE metering unit is words injected at format time. */
export const WEEKLY_WORD_LIMITS: Record<PlanId, number> = {
  free: 2000,
  pro: 50000,
};

/** Free trial length in days — 14 days of Pro on signup, no card (§1). */
export const TRIAL_DAYS = 14;

/** A plan's product-facing definition. Prices are in whole USD as advertised in §1. */
export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Weekly formatted-word cap (fair-use for Pro). */
  weeklyWordLimit: number;
  /** Monthly price in USD (0 for Free). */
  monthlyPriceUsd: number;
  /** Yearly price in USD (0 for Free). */
  yearlyPriceUsd: number;
}

/** The two v1 plans (§1). */
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: { id: 'free', name: 'Free', weeklyWordLimit: WEEKLY_WORD_LIMITS.free, monthlyPriceUsd: 0, yearlyPriceUsd: 0 },
  pro: { id: 'pro', name: 'Pro', weeklyWordLimit: WEEKLY_WORD_LIMITS.pro, monthlyPriceUsd: 12, yearlyPriceUsd: 96 },
};

/** The weekly word cap for a plan — the single accessor 3f/gate should call. */
export function weeklyWordLimit(plan: PlanId): number {
  return WEEKLY_WORD_LIMITS[plan];
}

// ── Stripe price configuration (env-driven; NOT in CONTRACTS §10 — see friction note above) ─────

/** Placeholder test-mode price IDs used when the env vars are absent (mock mode / CI). */
export const MOCK_PRICE_IDS = {
  monthly: 'price_mock_pro_monthly',
  yearly: 'price_mock_pro_yearly',
} as const;

/** Resolved Stripe price IDs for the Pro plan's two intervals. */
export interface StripePriceConfig {
  monthly: string;
  yearly: string;
}

/**
 * Resolve the Pro price IDs from env, falling back to the mock placeholders so the build stays
 * keyless. Real price IDs are created in the Stripe dashboard and injected via these env vars.
 */
export function resolvePriceConfig(source: NodeJS.ProcessEnv = process.env): StripePriceConfig {
  return {
    monthly: source.STRIPE_PRICE_PRO_MONTHLY || MOCK_PRICE_IDS.monthly,
    yearly: source.STRIPE_PRICE_PRO_YEARLY || MOCK_PRICE_IDS.yearly,
  };
}

/** The Stripe price ID for a chosen interval. */
export function priceIdForInterval(config: StripePriceConfig, interval: PlanInterval): string {
  return interval === 'monthly' ? config.monthly : config.yearly;
}

// ── Stripe subscription-status → plan mapping (webhook sync) ─────────────────────────────────────

/** Stripe subscription statuses that grant Pro access (active sub → 'pro'). */
export const PRO_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

/**
 * Map a Stripe subscription `status` onto the user's plan tier: an active/trialing subscription
 * grants 'pro'; anything else (canceled, unpaid, incomplete_expired, past_due, …) drops to 'free'.
 */
export function planForStatus(status: string): PlanId {
  return (PRO_SUBSCRIPTION_STATUSES as readonly string[]).includes(status) ? 'pro' : 'free';
}

/** Map a Stripe recurring `interval` ('month'|'year') onto our `PlanInterval`; unknown → undefined. */
export function planIntervalFromStripe(stripeInterval: string): PlanInterval | undefined {
  if (stripeInterval === 'month') return 'monthly';
  if (stripeInterval === 'year') return 'yearly';
  return undefined;
}
