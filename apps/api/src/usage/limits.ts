// Weekly word limits — CONTRACTS §7 ("Free limit 2000/wk; Pro fair-use 50000/wk") and
// BUILD_GUIDE §1 ("Free — 2,000 formatted words/week … Pro … fair-use cap of 50k words/week").
//
// SINGLE SOURCE OF TRUTH (reconciled at the Phase 3 gate): the limit table + accessor now live in
// `billing/plans.ts`. This module is a thin re-export shim so metering keeps importing
// `WEEKLY_WORD_LIMITS` / `weeklyWordLimit` from here without carrying its own copy of the numbers.
// (Historically these literals were duplicated here to avoid a hard dependency on the billing
// surface; that duplication is now removed.)

import type { Plan } from '../db';

/** Re-export the single-source limit table + accessor (billing/plans.ts). */
export { WEEKLY_WORD_LIMITS, weeklyWordLimit } from '../billing/plans';

/** Plans that carry a metered weekly word cap. Kept aligned with the §7 `users.plan` union. */
export type MeteredPlan = Plan;
