// Persistence ports for billing — CONTRACTS §7 (`users`, `subscriptions`). The webhook handler and
// checkout creator depend on these interfaces, never on Drizzle directly, so they run against
// in-memory fakes (keyless, no live DB) in tests and MOCK_MODE, and against Postgres in prod.
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Plan, schema, subscriptions, users } from '../db';
import type { PlanInterval } from './plans';

type Db = PostgresJsDatabase<typeof schema>;

/** The subset of a `users` row billing reads/writes. */
export interface UserRecord {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  plan: Plan;
}

/** Port over the `users` table (billing-relevant columns only). */
export interface UserRepo {
  getById(userId: string): Promise<UserRecord | undefined>;
  findByStripeCustomerId(customerId: string): Promise<UserRecord | undefined>;
  setStripeCustomerId(userId: string, customerId: string): Promise<void>;
  setPlan(userId: string, plan: Plan): Promise<void>;
}

/** An upsert into `subscriptions` (§7: user_id pk · stripe_sub_id · status · plan_interval · …). */
export interface SubscriptionUpsert {
  userId: string;
  stripeSubId: string | null;
  status: string | null;
  planInterval: PlanInterval | null;
  currentPeriodEnd: Date | null;
}

/** Port over the `subscriptions` table. */
export interface SubscriptionRepo {
  upsert(row: SubscriptionUpsert): Promise<void>;
  getByUserId(userId: string): Promise<SubscriptionUpsert | undefined>;
}

// ── Drizzle implementations (prod) ──────────────────────────────────────────────────────────────

export class DrizzleUserRepo implements UserRepo {
  constructor(private readonly db: Db) {}

  async getById(userId: string): Promise<UserRecord | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const row = rows[0];
    return row
      ? { id: row.id, email: row.email, stripeCustomerId: row.stripeCustomerId, plan: row.plan }
      : undefined;
  }

  async findByStripeCustomerId(customerId: string): Promise<UserRecord | undefined> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1);
    const row = rows[0];
    return row
      ? { id: row.id, email: row.email, stripeCustomerId: row.stripeCustomerId, plan: row.plan }
      : undefined;
  }

  async setStripeCustomerId(userId: string, customerId: string): Promise<void> {
    await this.db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  }

  async setPlan(userId: string, plan: Plan): Promise<void> {
    await this.db.update(users).set({ plan }).where(eq(users.id, userId));
  }
}

export class DrizzleSubscriptionRepo implements SubscriptionRepo {
  constructor(private readonly db: Db) {}

  async upsert(row: SubscriptionUpsert): Promise<void> {
    await this.db
      .insert(subscriptions)
      .values({
        userId: row.userId,
        stripeSubId: row.stripeSubId,
        status: row.status,
        planInterval: row.planInterval,
        currentPeriodEnd: row.currentPeriodEnd,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          stripeSubId: row.stripeSubId,
          status: row.status,
          planInterval: row.planInterval,
          currentPeriodEnd: row.currentPeriodEnd,
          updatedAt: new Date(),
        },
      });
  }

  async getByUserId(userId: string): Promise<SubscriptionUpsert | undefined> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: row.userId,
      stripeSubId: row.stripeSubId,
      status: row.status,
      planInterval: (row.planInterval as PlanInterval | null) ?? null,
      currentPeriodEnd: row.currentPeriodEnd,
    };
  }
}

// ── In-memory fakes (tests / MOCK_MODE) ──────────────────────────────────────────────────────────

export class InMemoryUserRepo implements UserRepo {
  private readonly byId = new Map<string, UserRecord>();

  constructor(seed: UserRecord[] = []) {
    for (const user of seed) this.byId.set(user.id, { ...user });
  }

  getById(userId: string): Promise<UserRecord | undefined> {
    const user = this.byId.get(userId);
    return Promise.resolve(user ? { ...user } : undefined);
  }

  findByStripeCustomerId(customerId: string): Promise<UserRecord | undefined> {
    for (const user of this.byId.values()) {
      if (user.stripeCustomerId === customerId) return Promise.resolve({ ...user });
    }
    return Promise.resolve(undefined);
  }

  setStripeCustomerId(userId: string, customerId: string): Promise<void> {
    const user = this.byId.get(userId);
    if (user) user.stripeCustomerId = customerId;
    return Promise.resolve();
  }

  setPlan(userId: string, plan: Plan): Promise<void> {
    const user = this.byId.get(userId);
    if (user) user.plan = plan;
    return Promise.resolve();
  }
}

export class InMemorySubscriptionRepo implements SubscriptionRepo {
  readonly rows = new Map<string, SubscriptionUpsert>();

  upsert(row: SubscriptionUpsert): Promise<void> {
    this.rows.set(row.userId, { ...row });
    return Promise.resolve();
  }

  getByUserId(userId: string): Promise<SubscriptionUpsert | undefined> {
    const row = this.rows.get(userId);
    return Promise.resolve(row ? { ...row } : undefined);
  }
}
