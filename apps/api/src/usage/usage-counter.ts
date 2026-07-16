// Redis weekly word counter — the HOT metering path (ARCHITECTURE §"Redis: usage counters").
//
// One integer per (user, ISO-week) keyed `usage:{userId}:{weekStart}`. INCRBY is atomic, so this
// is safe across concurrent utterances and (eventually) across gateway nodes. Postgres is the
// durable mirror (see UsageRepo); Redis is the fast counter read on the format hot path and by
// /v1/me. Keys carry a TTL a little over a week so stale weeks self-evict — the durable record
// lives in `usage_weeks`, so losing a Redis key only costs a cheap Postgres re-read.

import type { RedisLike } from './redis-like';

/** TTL for a weekly counter key: 14 days. Longer than a week so an in-flight week never expires. */
export const USAGE_KEY_TTL_SECONDS = 14 * 24 * 60 * 60;

/** Redis key for a user's word tally in a given Monday-UTC week. */
export function usageKey(userId: string, weekStart: string): string {
  return `usage:${userId}:${weekStart}`;
}

/** Redis-backed weekly word counter. Pure over the {@link RedisLike} port; week math is the caller's. */
export class UsageCounter {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds: number = USAGE_KEY_TTL_SECONDS,
  ) {}

  /**
   * Add `words` to the user's tally for `weekStart` and return the new weekly total. Refreshes the
   * key TTL on every write. A zero/negative `words` is clamped to 0 (metering never decrements).
   */
  async increment(userId: string, weekStart: string, words: number): Promise<number> {
    const delta = words > 0 ? words : 0;
    const total = await this.redis.incrBy(usageKey(userId, weekStart), delta);
    await this.redis.expire(usageKey(userId, weekStart), this.ttlSeconds);
    return total;
  }

  /** Current weekly tally from Redis, or 0 when the key is absent (cold / evicted). */
  async current(userId: string, weekStart: string): Promise<number> {
    const raw = await this.redis.get(usageKey(userId, weekStart));
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}
