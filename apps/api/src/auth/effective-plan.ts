// Effective-plan derivation + plan limits (guide §1). Pure functions, no I/O — the single source
// of truth for "what plan is this user ACTUALLY on right now", shared by ClerkAuthenticator (which
// stamps it into the session token) and GET /v1/me (which reports it).
import type { Plan, SubscriptionRecord, UserRecord } from './ports';

/** Signup grants 14 days of Pro (guide §1, no card). */
export const TRIAL_DAYS = 14;

/** Weekly word caps (guide §1): Free 2,000 / Pro 50,000 (fair-use). */
export const PLAN_LIMITS: Record<Plan, number> = {
  free: 2000,
  pro: 50000,
};

/** The weekly formatted-word limit for a plan (the metering unit, CONTRACTS §7). */
export function planLimit(plan: Plan): number {
  return PLAN_LIMITS[plan];
}

/**
 * True iff the user holds a paid subscription that is active AND whose current period has not
 * lapsed. A null `currentPeriodEnd` is treated as open-ended (still active). "No active sub" is
 * the default assumption until Task 3e's `subscriptions` reader is wired.
 */
export function hasActivePaidSubscription(
  sub: SubscriptionRecord | undefined,
  now: Date,
): boolean {
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
