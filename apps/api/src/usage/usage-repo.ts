// Durable weekly-usage record — CONTRACTS §7 `usage_weeks` (Postgres is the source of truth for
// reporting; Redis is the hot counter). meterUsage write-through: after Redis returns the new
// authoritative weekly total, that ABSOLUTE total is upserted here. Writing the absolute value
// (not an increment) makes the write-through idempotent — a retried format never double-counts in
// Postgres, and PG can only lag Redis, never exceed it.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, usageWeeks } from '../db';

/** Port for the durable weekly-usage store. A Drizzle impl and an in-memory fake both satisfy it. */
export interface UsageRepo {
  /** Upsert the absolute weekly total for (user, weekStart). Idempotent. */
  setWeekTotal(userId: string, weekStart: string, words: number): Promise<void>;
  /** Durable weekly total, or 0 when no row exists yet. */
  getWeekTotal(userId: string, weekStart: string): Promise<number>;
}

/** Drizzle/Postgres implementation over the §7 `usage_weeks` table. */
export class DrizzleUsageRepo implements UsageRepo {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async setWeekTotal(userId: string, weekStart: string, words: number): Promise<void> {
    await this.db
      .insert(usageWeeks)
      .values({ userId, weekStart, words })
      .onConflictDoUpdate({
        target: [usageWeeks.userId, usageWeeks.weekStart],
        set: { words },
      });
  }

  async getWeekTotal(userId: string, weekStart: string): Promise<number> {
    const rows = await this.db
      .select({ words: usageWeeks.words })
      .from(usageWeeks)
      .where(and(eq(usageWeeks.userId, userId), eq(usageWeeks.weekStart, weekStart)));
    return rows[0]?.words ?? 0;
  }
}

/** In-memory {@link UsageRepo} for tests — no live Postgres. */
export class FakeUsageRepo implements UsageRepo {
  private readonly rows = new Map<string, number>();

  private key(userId: string, weekStart: string): string {
    return `${userId}::${weekStart}`;
  }

  async setWeekTotal(userId: string, weekStart: string, words: number): Promise<void> {
    this.rows.set(this.key(userId, weekStart), words);
  }

  async getWeekTotal(userId: string, weekStart: string): Promise<number> {
    return this.rows.get(this.key(userId, weekStart)) ?? 0;
  }
}
