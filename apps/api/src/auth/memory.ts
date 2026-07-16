// In-memory port implementations. These are the test doubles for the auth ports AND the keyless
// fallbacks the Phase 3 gate can wire in MOCK_MODE (where no Postgres/Redis exists). No external
// I/O — every method resolves synchronously wrapped in a Promise.
import { randomUUID } from 'node:crypto';
import type {
  NewUser,
  SubscriptionReader,
  SubscriptionRecord,
  UsageReader,
  UsageSnapshot,
  UserRecord,
  UserStore,
} from './ports';

/** In-memory {@link UserStore}. Race-safe `insert` by clerk_id; `seed`/`count` are test helpers. */
export class InMemoryUserStore implements UserStore {
  private readonly byId = new Map<string, UserRecord>();
  private readonly idByClerk = new Map<string, string>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  getById(id: string): Promise<UserRecord | undefined> {
    return Promise.resolve(this.byId.get(id));
  }

  getByClerkId(clerkId: string): Promise<UserRecord | undefined> {
    const id = this.idByClerk.get(clerkId);
    return Promise.resolve(id !== undefined ? this.byId.get(id) : undefined);
  }

  insert(user: NewUser): Promise<UserRecord> {
    const existingId = this.idByClerk.get(user.clerkId);
    if (existingId !== undefined) {
      // Concurrent first-auth already created this clerk_id — return the winner, never duplicate.
      return Promise.resolve(this.byId.get(existingId) as UserRecord);
    }
    const record: UserRecord = {
      id: randomUUID(),
      clerkId: user.clerkId,
      email: user.email,
      plan: user.plan,
      trialEndsAt: user.trialEndsAt,
      stripeCustomerId: null,
      createdAt: this.clock(),
    };
    this.byId.set(record.id, record);
    this.idByClerk.set(record.clerkId, record.id);
    return Promise.resolve(record);
  }

  /** Test/seed helper: insert a fully-formed row (bypasses trial provisioning). */
  seed(record: UserRecord): UserRecord {
    this.byId.set(record.id, record);
    this.idByClerk.set(record.clerkId, record.id);
    return record;
  }

  /** Test helper: number of stored users. */
  count(): Promise<number> {
    return Promise.resolve(this.byId.size);
  }
}

/** In-memory {@link SubscriptionReader}. Defaults to "no active sub" for any unknown user. */
export class InMemorySubscriptionReader implements SubscriptionReader {
  private readonly byUser = new Map<string, SubscriptionRecord>();

  set(userId: string, sub: SubscriptionRecord): void {
    this.byUser.set(userId, sub);
  }

  getByUserId(userId: string): Promise<SubscriptionRecord | undefined> {
    return Promise.resolve(this.byUser.get(userId));
  }
}

/** In-memory {@link UsageReader}. Unknown users read as `fallback` (default 0) words this week. */
export class InMemoryUsageReader implements UsageReader {
  private readonly byUser = new Map<string, number>();

  constructor(private readonly fallback = 0) {}

  set(userId: string, wordsThisWeek: number): void {
    this.byUser.set(userId, wordsThisWeek);
  }

  read(userId: string): Promise<UsageSnapshot> {
    return Promise.resolve({ wordsThisWeek: this.byUser.get(userId) ?? this.fallback });
  }
}
