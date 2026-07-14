// Redis-backed per-user rate limiter — CONTRACTS §4.1 (per-user limits from Redis) and §8
// (`RATE_LIMITED`, `requiresBackoff` → over-limit carries `retryAfterMs`). Implements the EXISTING
// `RateLimiter` interface (apps/api/src/ws/rate-limiter.ts) unchanged; the gateway swaps
// `PermissiveRateLimiter` for this in real mode.
//
// ── Why local token buckets, not a Redis round-trip per check ─────────────────────────────────
// The `RateLimiter` interface is SYNCHRONOUS (`checkMessage(userId): RateLimitDecision`) and is
// consulted once per inbound control message AND once per audio frame — 50 frames/second per live
// connection. A network round-trip on that hot path is impossible behind a sync signature and
// would blow the §"latency budget" regardless. So the authoritative decision is an in-process
// token bucket (per user, per kind), which is exact and allocation-cheap. Redis is used as an
// async, best-effort WRITE-THROUGH mirror of accepted load (fixed-window counters) for durability
// and future cross-node aggregation/observability — it never gates the synchronous decision.
// (This sync-interface constraint is reported as contract friction; a truly cross-node atomic
// limiter would require an async interface, which is a contract change this task may not make.)

import type { RedisLike } from '../usage/redis-like';
import type { RateLimitDecision, RateLimiter } from './rate-limiter';

/** A single token-bucket rule: sustained `ratePerSec` with a `burst` capacity. */
export interface RateLimitRule {
  /** Tokens refilled per second (sustained ceiling). */
  ratePerSec: number;
  /** Bucket capacity — the largest instantaneous burst allowed. */
  burst: number;
}

/** Per-user caps for the two checked streams. */
export interface RateLimitConfig {
  /** JSON control messages (session.start / utterance.start / audio.end / ping / resume). */
  messages: RateLimitRule;
  /** Binary audio frames (20ms PCM16 ⇒ 50 fps steady per §4.2). */
  frames: RateLimitRule;
}

/**
 * Default v1 caps (documented, tunable):
 * - messages: 20/s sustained, burst 40. Control traffic is inherently sparse; this is generous
 *   headroom over the handful of frames per utterance while still capping a flood.
 * - frames: 100/s sustained (2× the 50 fps real-time rate — a live mic cannot exceed real-time),
 *   burst 1600. The burst intentionally exceeds the §4.4 replay ring buffer (1500 frames / 30s of
 *   audio) so a full post-reconnect replay is absorbed in one gulp without a spurious RATE_LIMITED.
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  messages: { ratePerSec: 20, burst: 40 },
  frames: { ratePerSec: 100, burst: 1600 },
};

/** Fixed-window size (seconds) for the async Redis mirror counters. */
const DEFAULT_MIRROR_WINDOW_SECONDS = 60;

export interface RedisRateLimiterOptions {
  redis: RedisLike;
  /** Per-user caps. Defaults to {@link DEFAULT_RATE_LIMITS}. */
  config?: RateLimitConfig;
  /** Monotonic-ish clock in ms. Injected for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
  /** Fixed-window size for mirror counters. Defaults to 60s. */
  mirrorWindowSeconds?: number;
  /** Observe (best-effort) mirror failures — telemetry hook; never surfaced to the caller. */
  onMirrorError?: (err: unknown) => void;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

/**
 * Redis-backed {@link RateLimiter}. Synchronous decision from in-process token buckets; asynchronous
 * best-effort write-through to Redis. Over-limit returns `{ ok: false, retryAfterMs }` with a
 * positive integer backoff (ms until one token is available), satisfying the §8 `requiresBackoff`
 * contract for `RATE_LIMITED`.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly redis: RedisLike;
  private readonly config: RateLimitConfig;
  private readonly now: () => number;
  private readonly mirrorWindowSeconds: number;
  private readonly onMirrorError: ((err: unknown) => void) | undefined;
  private readonly buckets = new Map<string, Bucket>();
  /** In-flight mirror promises; awaited by {@link whenSettled} in tests. Each never rejects. */
  private readonly pending = new Set<Promise<void>>();

  constructor(options: RedisRateLimiterOptions) {
    this.redis = options.redis;
    this.config = options.config ?? DEFAULT_RATE_LIMITS;
    this.now = options.now ?? Date.now;
    this.mirrorWindowSeconds = options.mirrorWindowSeconds ?? DEFAULT_MIRROR_WINDOW_SECONDS;
    this.onMirrorError = options.onMirrorError;
  }

  checkMessage(userId: string): RateLimitDecision {
    return this.take('msg', userId, this.config.messages);
  }

  checkFrame(userId: string): RateLimitDecision {
    return this.take('frame', userId, this.config.frames);
  }

  /** Refill (by elapsed time) then attempt to consume one token from the (kind,user) bucket. */
  private take(kind: 'msg' | 'frame', userId: string, rule: RateLimitRule): RateLimitDecision {
    const key = `${kind}:${userId}`;
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: rule.burst, lastMs: nowMs };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
    bucket.tokens = Math.min(rule.burst, bucket.tokens + elapsedSec * rule.ratePerSec);
    bucket.lastMs = nowMs;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.mirror(kind, userId, nowMs);
      return { ok: true };
    }

    // How long until the bucket accrues the one missing token.
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.max(1, Math.ceil((deficit / rule.ratePerSec) * 1000));
    return { ok: false, retryAfterMs };
  }

  /** Async, best-effort mirror of one accepted unit to a per-user fixed-window Redis counter. */
  private mirror(kind: 'msg' | 'frame', userId: string, nowMs: number): void {
    const windowId = Math.floor(nowMs / 1000 / this.mirrorWindowSeconds);
    const key = `ratelimit:${kind}:${userId}:${windowId}`;
    const p = (async (): Promise<void> => {
      await this.redis.incrBy(key, 1);
      await this.redis.expire(key, this.mirrorWindowSeconds * 2);
    })()
      .catch((err: unknown) => {
        this.onMirrorError?.(err);
      })
      .finally(() => {
        this.pending.delete(p);
      });
    this.pending.add(p);
  }

  /** Resolve once all in-flight mirror writes have settled. Test aid; also usable on shutdown. */
  async whenSettled(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
