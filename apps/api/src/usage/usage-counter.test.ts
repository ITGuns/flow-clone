// UsageCounter tests — Redis hot-path counter over the in-memory fake. Keyless, no live Redis.
import { describe, it, expect } from 'vitest';
import { InMemoryRedis } from './redis-like';
import { UsageCounter, usageKey, USAGE_KEY_TTL_SECONDS } from './usage-counter';

const USER = 'user-1';
const WK = '2026-07-13';

describe('UsageCounter', () => {
  it('increments and returns the running weekly total', async () => {
    const redis = new InMemoryRedis();
    const counter = new UsageCounter(redis);
    expect(await counter.increment(USER, WK, 10)).toBe(10);
    expect(await counter.increment(USER, WK, 5)).toBe(15);
  });

  it('reads 0 for a week that has never been touched', async () => {
    const counter = new UsageCounter(new InMemoryRedis());
    expect(await counter.current(USER, WK)).toBe(0);
  });

  it('reflects prior increments in current()', async () => {
    const counter = new UsageCounter(new InMemoryRedis());
    await counter.increment(USER, WK, 42);
    expect(await counter.current(USER, WK)).toBe(42);
  });

  it('sets a >1-week TTL on the counter key so an in-flight week never expires', async () => {
    const redis = new InMemoryRedis();
    await new UsageCounter(redis).increment(USER, WK, 1);
    expect(redis.ttlOf(usageKey(USER, WK))).toBe(USAGE_KEY_TTL_SECONDS);
    expect(USAGE_KEY_TTL_SECONDS).toBeGreaterThan(7 * 24 * 60 * 60);
  });

  it('keeps different weeks in independent keys (Monday-UTC rollover)', async () => {
    const counter = new UsageCounter(new InMemoryRedis());
    await counter.increment(USER, '2026-07-13', 100);
    await counter.increment(USER, '2026-07-20', 7);
    expect(await counter.current(USER, '2026-07-13')).toBe(100);
    expect(await counter.current(USER, '2026-07-20')).toBe(7);
  });

  it('keeps different users in independent keys', async () => {
    const counter = new UsageCounter(new InMemoryRedis());
    await counter.increment('a', WK, 3);
    await counter.increment('b', WK, 9);
    expect(await counter.current('a', WK)).toBe(3);
    expect(await counter.current('b', WK)).toBe(9);
  });

  it('clamps a zero word-count to a no-op that still returns the total', async () => {
    const counter = new UsageCounter(new InMemoryRedis());
    await counter.increment(USER, WK, 12);
    expect(await counter.increment(USER, WK, 0)).toBe(12);
  });
});
