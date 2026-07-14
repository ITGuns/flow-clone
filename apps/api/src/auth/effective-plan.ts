// Effective-plan derivation (guide §1). Pure functions, no I/O — the single source of truth for
// "what plan is this user ACTUALLY on right now", shared by ClerkAuthenticator (which stamps it
// into the session token) and GET /v1/me (which reports it).
//
// Plan CONSTANTS (weekly word caps + trial length) live in ONE place: `billing/plans.ts`
// (Task 3a reconciliation at the Phase 3 gate). This module re-exports them under their
// established public names (`PLAN_LIMITS`, `planLimit`, `TRIAL_DAYS`) so existing importers and
// tests keep working; the literal values are no longer duplicated here.
import { TRIAL_DAYS, WEEKLY_WORD_LIMITS, weeklyWordLimit } from '../billing/plans';
import type { Plan, SubscriptionRecord, UserRecord } from './ports';

/** Signup grants 14 days of Pro (guide §1, no card). Re-exported from the single source. */
export { TRIAL_DAYS };

/**
 * Weekly word caps (guide §1): Free 2,000 / Pro 50,000 (fair-use). Thin re-export of the single
 * source's `WEEKLY_WORD_LIMITS`, kept under this module's established `PLAN_LIMITS` name.
 */
export const PLAN_LIMITS: Record<Plan, number> = WEEKLY_WORD_LIMITS;

/** The weekly formatted-word limit for a plan (the metering unit, CONTRACTS §7). */
export function planLimit(plan: Plan): number {
  return weeklyWordLimit(plan);
}

/**
 * True iff the user holds a paid subscription that is active AND whose current period has not
 * lapsed. A null `currentPeriodEnd` is treated as open-ended (still active). "No active sub" is
 * the default assumption until Task 3e's `subscriptions` reader is wired.
 */
export function hasActivePaidSubscription(sub: SubscriptionRecord | undefined, now: Date): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  if (sub.currentPeriodEnd !== null && sub.currentPeriodEnd.getTime() < now.getTime()) return false;
  return true;
}

/** True iff the user's Pro trial is still running (trialEndsAt in the future, inclusive of now). */
export function isTrialActive(user: Pick<UserRecord, 'trialEndsAt'>, now: Date): boolean {
  return user.trialEndsAt !== null && user.trialEndsAt.getTime() >= now.getTime();
}

/**
 * Derive the honest, currently-effective plan.
 *
 * A stored `plan='pro'` is only legitimate while EITHER the 14-day trial is still running OR the
 * user holds an active paid subscription. Once the trial has lapsed with no active sub, the
 * effective plan falls back to `free` — CONTRACTS §5 requires /v1/me to report this honestly, and
 * the `users.plan` column default of 'free' (Task 3b) is exactly this post-trial fallback.
 */
export function effectivePlan(
  user: Pick<UserRecord, 'plan' | 'trialEndsAt'>,
  sub: SubscriptionRecord | undefined,
  now: Date,
): Plan {
  if (user.plan !== 'pro') return 'free';
  if (hasActivePaidSubscription(sub, now)) return 'pro';
  if (isTrialActive(user, now)) return 'pro';
  return 'free';
}
