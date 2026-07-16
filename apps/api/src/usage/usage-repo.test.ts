// UsageRepo tests — the in-memory fake's behavior (used everywhere downstream) plus a stubbed-db
// check that DrizzleUsageRepo issues an idempotent upsert + a filtered select. No live Postgres.
import { describe, it, expect, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from '../db';
import { DrizzleUsageRepo, FakeUsageRepo } from './usage-repo';

const USER = 'u1';
const WK = '2026-07-13';

describe('FakeUsageRepo', () => {
  it('returns 0 before any write', async () => {
    expect(await new FakeUsageRepo().getWeekTotal(USER, WK)).toBe(0);
  });

  it('setWeekTotal writes an absolute value that overwrites (idempotent write-through)', async () => {
    const repo = new FakeUsageRepo();
    await repo.setWeekTotal(USER, WK, 100);
    await repo.setWeekTotal(USER, WK, 100); // retry of the same total: still 100, not 200
    expect(await repo.getWeekTotal(USER, WK)).toBe(100);
    await repo.setWeekTotal(USER, WK, 150);
    expect(await repo.getWeekTotal(USER, WK)).toBe(150);
  });

  it('isolates users and weeks', async () => {
    const repo = new FakeUsageRepo();
    await repo.setWeekTotal('a', WK, 5);
    await repo.setWeekTotal('b', WK, 9);
    await repo.setWeekTotal('a', '2026-07-20', 1);
    expect(await repo.getWeekTotal('a', WK)).toBe(5);
    expect(await repo.getWeekTotal('b', WK)).toBe(9);
    expect(await repo.getWeekTotal('a', '2026-07-20')).toBe(1);
  });
});

describe('DrizzleUsageRepo — query shape (stubbed db, no live PG)', () => {
  it('setWeekTotal issues insert→values→onConflictDoUpdate with the absolute total', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as PostgresJsDatabase<typeof schema>;

    await new DrizzleUsageRepo(db).setWeekTotal(USER, WK, 250);

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith({ userId: USER, weekStart: WK, words: 250 });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { words: 250 } }),
    );
  });

  it('getWeekTotal returns the row words, or 0 when the select is empty', async () => {
    const makeDb = (result: Array<{ words: number }>): PostgresJsDatabase<typeof schema> => {
      const where = vi.fn().mockResolvedValue(result);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      return { select } as unknown as PostgresJsDatabase<typeof schema>;
    };

    expect(await new DrizzleUsageRepo(makeDb([{ words: 77 }])).getWeekTotal(USER, WK)).toBe(77);
    expect(await new DrizzleUsageRepo(makeDb([])).getWeekTotal(USER, WK)).toBe(0);
  });
});
