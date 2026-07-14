// Weekly word limits — CONTRACTS §7 ("Free limit 2000/wk; Pro fair-use 50000/wk") and
// BUILD_GUIDE §1 ("Free — 2,000 formatted words/week … Pro … fair-use cap of 50k words/week").
//
// ⚠️ DUPLICATION FLAG (reported as friction): these two numbers also belong to the billing
// surface built in parallel by task 3e (`apps/api/src/billing`, not in this task's allowlist and
// possibly not present yet). They are defined here locally so metering does not take a hard
// dependency on 3e. The gate / a follow-up must reconcile these to ONE source of truth (either
// billing re-exports these, or both import a shared constant). Until then, changing a limit means
// changing it in BOTH places.

import type { Plan } from '../db';

/** Plans that carry a metered weekly word cap. Kept aligned with the §7 `users.plan` union. */
export type MeteredPlan = Plan;

/** Weekly formatted-word cap per plan (the metering unit is `FormatResult.wordCount`, §1). */
export const WEEKLY_WORD_LIMITS: Readonly<Record<MeteredPlan, number>> = {
  free: 2000,
  pro: 50000,
};

/** The weekly word cap for a user's effective plan. */
export function weeklyWordLimit(plan: MeteredPlan): number {
  return WEEKLY_WORD_LIMITS[plan];
}
