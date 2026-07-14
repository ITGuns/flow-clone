// Usage metering + reader — CONTRACTS §7 (weekly words) and §8 (`QUOTA_EXCEEDED`).
//
// meterUsage() is called by the Phase 3 gate at `format.done` time. It increments the user's
// weekly word tally (Redis hot counter), write-throughs the new absolute total to Postgres
// (durable record), and reports {wordsThisWeek, limit, exceeded}. It ONLY computes and reports —
// it does NOT emit the `usage.update` frame, the `QUOTA_EXCEEDED` error, or decide injection. Per
// §8 the gate emits the error AND still returns the raw transcript ("never eat the user's words");
// meterUsage stays a pure metering step so that policy lives in one place (the gate).
//
// UsageReader is injected by the gate into task 3a's `GET /v1/me` (`usage: { wordsThisWeek, limit }`).

import { weeklyWordLimit, type MeteredPlan } from './limits';
import type { UsageCounter } from './usage-counter';
import type { UsageRepo } from './usage-repo';
import { weekStartMondayUtc } from './week';

/** Collaborators for {@link meterUsage}. `now` is injectable for deterministic week-boundary tests. */
export interface MeterDeps {
  counter: UsageCounter;
  repo: UsageRepo;
  now?: () => Date;
}

/** What the gate needs at `format.done`: the running total, the plan cap, and whether it was passed. */
export interface MeterResult {
  wordsThisWeek: number;
  limit: number;
  /** True once the weekly total has strictly passed the cap (the word that tips over and beyond). */
  exceeded: boolean;
}

/**
 * Meter `wordCount` words against `userId`'s current-week tally for their effective `plan`.
 *
 * Redis is incremented first (authoritative running total), then that absolute total is mirrored to
 * Postgres. `exceeded` is `wordsThisWeek > limit` — a user gets their full quota; the increment that
 * carries them past it (and every one after) reports exceeded, which the gate maps to §8
 * `QUOTA_EXCEEDED` while still returning the raw transcript.
 */
export async function meterUsage(
  deps: MeterDeps,
  userId: string,
  wordCount: number,
  plan: MeteredPlan,
): Promise<MeterResult> {
  const now = deps.now ?? ((): Date => new Date());
  const weekStart = weekStartMondayUtc(now());

  const wordsThisWeek = await deps.counter.increment(userId, weekStart, wordCount);
  // Write-through: mirror the new authoritative total to the durable §7 record.
  await deps.repo.setWeekTotal(userId, weekStart, wordsThisWeek);

  const limit = weeklyWordLimit(plan);
  return { wordsThisWeek, limit, exceeded: wordsThisWeek > limit };
}

/** Read-side used by `GET /v1/me` — no mutation. */
export interface UsageReader {
  read(userId: string, plan: MeteredPlan): Promise<{ wordsThisWeek: number; limit: number }>;
}

/**
 * Default {@link UsageReader}: reports the current-week total as `max(redis, postgres)`.
 *
 * Redis is normally authoritative and ahead of Postgres, but if the Redis key was evicted or a node
 * restarted with a cold cache mid-week, the durable Postgres total is the floor — taking the max
 * means /v1/me never under-reports a user's usage.
 */
export class DefaultUsageReader implements UsageReader {
  constructor(
    private readonly counter: UsageCounter,
    private readonly repo: UsageRepo,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async read(userId: string, plan: MeteredPlan): Promise<{ wordsThisWeek: number; limit: number }> {
    const weekStart = weekStartMondayUtc(this.now());
    const [redisWords, pgWords] = await Promise.all([
      this.counter.current(userId, weekStart),
      this.repo.getWeekTotal(userId, weekStart),
    ]);
    return { wordsThisWeek: Math.max(redisWords, pgWords), limit: weeklyWordLimit(plan) };
  }
}
