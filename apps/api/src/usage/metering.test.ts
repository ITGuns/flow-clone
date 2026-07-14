// meterUsage + UsageReader tests — the surface the Phase 3 gate calls. Keyless: in-memory Redis
// fake + FakeUsageRepo, injected clocks. Covers increment, plan-limit selection, the exceeded
// boundary, week rollover, write-through, and the reader's Redis/PG max fallback.
import { describe, it, expect } from 'vitest';
import { InMemoryRedis } from './redis-like';
import { UsageCounter } from './usage-counter';
import { FakeUsageRepo } from './usage-repo';
import { DefaultUsageReader, meterUsage, type MeterDeps } from './metering';

const USER = 'user-1';
const TUE = new Date('2026-07-14T12:00:00.000Z'); // week of Mon 2026-07-13
const NEXT_MON = new Date('2026-07-20T00:00:00.000Z'); // next week

function deps(now: () => Date): MeterDeps & { redis: InMemoryRedis; repo: FakeUsageRepo } {
  const redis = new InMemoryRedis();
  const repo = new FakeUsageRepo();
  return { counter: new UsageCounter(redis), repo, now, redis };
}

describe('meterUsage', () => {
  it('accumulates the weekly total across calls', async () => {
    const d = deps(() => TUE);
    expect((await meterUsage(d, USER, 100, 'free')).wordsThisWeek).toBe(100);
    expect((await meterUsage(d, USER, 50, 'free')).wordsThisWeek).toBe(150);
  });

  it('selects the limit from the effective plan', async () => {
    const d = deps(() => TUE);
    expect((await meterUsage(d, USER, 1, 'free')).limit).toBe(2000);
    expect((await meterUsage(d, 'user-2', 1, 'pro')).limit).toBe(50000);
  });

  it('does not flag exceeded up to and including the cap, then flags past it (§8 boundary)', async () => {
    const d = deps(() => TUE);
    // Reach exactly 2000 (free cap): not exceeded.
    const atCap = await meterUsage(d, USER, 2000, 'free');
    expect(atCap.wordsThisWeek).toBe(2000);
    expect(atCap.exceeded).toBe(false);
    // One more word tips it over.
    const over = await meterUsage(d, USER, 1, 'free');
    expect(over.wordsThisWeek).toBe(2001);
    expect(over.exceeded).toBe(true);
  });

  it('keeps reporting exceeded for every call after the cap is passed', async () => {
    const d = deps(() => TUE);
    await meterUsage(d, USER, 2001, 'free');
    const next = await meterUsage(d, USER, 10, 'free');
    expect(next.exceeded).toBe(true);
    expect(next.wordsThisWeek).toBe(2011);
  });

  it('rolls over at the Monday-UTC week boundary — a new week starts fresh', async () => {
    let clock = TUE;
    const d = deps(() => clock);
    await meterUsage(d, USER, 1500, 'free');
    expect((await meterUsage(d, USER, 0, 'free')).wordsThisWeek).toBe(1500);
    // Advance into the next week: the tally resets.
    clock = NEXT_MON;
    const fresh = await meterUsage(d, USER, 20, 'free');
    expect(fresh.wordsThisWeek).toBe(20);
    expect(fresh.exceeded).toBe(false);
  });

  it('write-throughs the new absolute total to the durable repo', async () => {
    const d = deps(() => TUE);
    await meterUsage(d, USER, 300, 'pro');
    await meterUsage(d, USER, 200, 'pro');
    expect(await d.repo.getWeekTotal(USER, '2026-07-13')).toBe(500);
  });

  it('a zero word-count meters nothing but still reports the current total', async () => {
    const d = deps(() => TUE);
    await meterUsage(d, USER, 40, 'free');
    const res = await meterUsage(d, USER, 0, 'free');
    expect(res.wordsThisWeek).toBe(40);
    expect(res.exceeded).toBe(false);
  });
});

describe('DefaultUsageReader', () => {
  it('reports the Redis total plus the plan limit', async () => {
    const d = deps(() => TUE);
    await meterUsage(d, USER, 123, 'free');
    const reader = new DefaultUsageReader(d.counter, d.repo, () => TUE);
    expect(await reader.read(USER, 'free')).toEqual({ wordsThisWeek: 123, limit: 2000 });
  });

  it('falls back to the durable Postgres total when Redis is cold (eviction/restart)', async () => {
    const redis = new InMemoryRedis();
    const repo = new FakeUsageRepo();
    // Postgres has a record, Redis has nothing (simulated eviction).
    await repo.setWeekTotal(USER, '2026-07-13', 900);
    const reader = new DefaultUsageReader(new UsageCounter(redis), repo, () => TUE);
    expect(await reader.read(USER, 'pro')).toEqual({ wordsThisWeek: 900, limit: 50000 });
  });

  it('takes the max so it never under-reports when Redis leads Postgres', async () => {
    const redis = new InMemoryRedis();
    const repo = new FakeUsageRepo();
    const counter = new UsageCounter(redis);
    await counter.increment(USER, '2026-07-13', 50); // redis ahead
    await repo.setWeekTotal(USER, '2026-07-13', 30); // pg lagging
    const reader = new DefaultUsageReader(counter, repo, () => TUE);
    expect((await reader.read(USER, 'free')).wordsThisWeek).toBe(50);
  });

  it('reads 0 for a user with no usage this week', async () => {
    const d = deps(() => TUE);
    const reader = new DefaultUsageReader(d.counter, d.repo, () => TUE);
    expect(await reader.read(USER, 'free')).toEqual({ wordsThisWeek: 0, limit: 2000 });
  });
});
