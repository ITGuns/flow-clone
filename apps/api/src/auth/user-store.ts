// DrizzleUserStore — the production {@link UserStore}, backed by the Task 3b `users` table over the
// Drizzle client (apps/api/src/db). The Phase 3 gate constructs it as
// `new DrizzleUserStore(getDb(env).db)` in real mode. Not unit-tested (requires live Postgres);
// it is a thin adapter and the trial/plan policy it serves is tested via InMemoryUserStore.
import { eq } from 'drizzle-orm';
import { type DbClient, users } from '../db';
import type { NewUser, UserRecord, UserStore } from './ports';

type Db = DbClient['db'];
type UserRow = typeof users.$inferSelect;

export class DrizzleUserStore implements UserStore {
  constructor(private readonly db: Db) {}

  async getById(id: string): Promise<UserRecord | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async getByClerkId(clerkId: string): Promise<UserRecord | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async insert(user: NewUser): Promise<UserRecord> {
    // Race-safe: on a concurrent clerk_id conflict, DO NOTHING and re-select the winning row.
    const inserted = await this.db
      .insert(users)
      .values({
        clerkId: user.clerkId,
        email: user.email,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
      })
      .onConflictDoNothing({ target: users.clerkId })
      .returning();

    const row = inserted[0];
    if (row) return toRecord(row);

    const existing = await this.getByClerkId(user.clerkId);
    if (!existing) {
      throw new Error(`user insert for clerk_id ${user.clerkId} conflicted but no row was found`);
    }
    return existing;
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    clerkId: row.clerkId,
    email: row.email,
    plan: row.plan,
    trialEndsAt: row.trialEndsAt,
    stripeCustomerId: row.stripeCustomerId,
    createdAt: row.createdAt,
  };
}
