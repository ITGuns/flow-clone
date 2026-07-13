// Per-user rate limiting — CONTRACTS.md §8 (`RATE_LIMITED`). Phase 3f swaps the permissive
// in-memory impl for a Redis token bucket; the interface is the stable seam. Over-limit yields
// `retryAfterMs` (present because RATE_LIMITED is `requiresBackoff` in the taxonomy, v1.1.0).

export interface RateLimitDecision {
  ok: boolean;
  /** Backoff hint when `ok` is false; milliseconds until the caller may retry. */
  retryAfterMs?: number;
}

/**
 * Checked once per inbound control message and once per audio frame, keyed by userId. Redis-backed
 * in Phase 3f; the in-memory impl below is permissive so the mock pipeline never throttles.
 */
export interface RateLimiter {
  checkMessage(userId: string): RateLimitDecision;
  checkFrame(userId: string): RateLimitDecision;
}

const ALLOW: RateLimitDecision = { ok: true };

/** Always-allow limiter for MOCK_MODE / dev. Wired for a Redis swap at the same interface. */
export class PermissiveRateLimiter implements RateLimiter {
  checkMessage(_userId: string): RateLimitDecision {
    return ALLOW;
  }
  checkFrame(_userId: string): RateLimitDecision {
    return ALLOW;
  }
}
