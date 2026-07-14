// Thin Redis port + in-memory fake — ARCHITECTURE §"Redis: rate limits, usage counters".
//
// The rest of this module (usage counter, rate-limiter mirror) depends ONLY on this narrow
// interface, never on a concrete driver. That keeps every unit test keyless: the fake below is
// substituted for a real connection, so no live Redis, no keys, MOCK_MODE-clean. The production
// adapter over `ioredis` lives in ./ioredis-adapter and is only constructed in real mode.

/** The subset of Redis operations the usage/rate-limit code actually uses. */
export interface RedisLike {
  /** String GET; resolves `null` when the key is absent. */
  get(key: string): Promise<string | null>;
  /** Atomic INCRBY; creates the key at 0 first when absent. Resolves the new integer value. */
  incrBy(key: string, amount: number): Promise<number>;
  /** Set a TTL in whole seconds (Redis EXPIRE). No-op resolution when the key is gone. */
  expire(key: string, seconds: number): Promise<void>;
}

/**
 * Deterministic in-memory {@link RedisLike} for tests. Mirrors real integer/string semantics
 * (INCRBY on a missing key starts at 0). TTLs are recorded, not enforced, so tests can assert
 * that expiries were set without depending on wall-clock eviction.
 *
 * Test-only affordances beyond the port: {@link failNext} to simulate a Redis outage on the next
 * call, and {@link ttlOf} / {@link peek} to inspect recorded state.
 */
export class InMemoryRedis implements RedisLike {
  private readonly store = new Map<string, string>();
  private readonly ttls = new Map<string, number>();
  private pendingFailure: Error | undefined;

  /** Arm a one-shot failure: the very next port call rejects with `err`, then normal service resumes. */
  failNext(err: Error = new Error('redis unavailable')): void {
    this.pendingFailure = err;
  }

  private throwIfArmed(): void {
    if (this.pendingFailure) {
      const err = this.pendingFailure;
      this.pendingFailure = undefined;
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    this.throwIfArmed();
    return this.store.get(key) ?? null;
  }

  async incrBy(key: string, amount: number): Promise<number> {
    this.throwIfArmed();
    const current = Number.parseInt(this.store.get(key) ?? '0', 10);
    const next = current + amount;
    this.store.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.throwIfArmed();
    if (this.store.has(key)) this.ttls.set(key, seconds);
  }

  /** Recorded TTL for a key, or `undefined` if none was set (test inspection). */
  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }

  /** Current stored raw value, or `null` (test inspection, bypasses `failNext`). */
  peek(key: string): string | null {
    return this.store.get(key) ?? null;
  }
}
