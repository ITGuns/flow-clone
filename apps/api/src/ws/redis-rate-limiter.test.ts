// RedisRateLimiter tests — CONTRACTS §4.1 / §8. Keyless: in-memory Redis fake + injected clock.
// Covers: allow under cap, block over cap with a positive retryAfterMs, refill over time, per-kind
// and per-user isolation, the async Redis mirror, and mirror-failure resilience.
import { describe, it, expect } from 'vitest';
import { InMemoryRedis } from '../usage/redis-like';
import {
  DEFAULT_RATE_LIMITS,
  RedisRateLimiter,
  type RateLimitConfig,
} from './redis-rate-limiter';

/** A tight config so drain/refill is testable in a few calls. */
const TIGHT: RateLimitConfig = {
  messages: { ratePerSec: 10, burst: 3 },
  frames: { ratePerSec: 100, burst: 5 },
};

function fixedClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RedisRateLimiter — decisions', () => {
  it('allows messages up to the burst capacity', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) {
      expect(rl.checkMessage('u').ok).toBe(true);
    }
  });

  it('blocks the message past the burst with a positive integer retryAfterMs', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    const decision = rl.checkMessage('u');
    expect(decision.ok).toBe(false);
    expect(decision.retryAfterMs).toBeGreaterThan(0);
    expect(Number.isInteger(decision.retryAfterMs)).toBe(true);
  });

  it('retryAfterMs matches the refill rate (10/s ⇒ ~100ms for one token)', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    // Bucket now at 0 tokens; one token at 10/s = 100ms.
    expect(rl.checkMessage('u').retryAfterMs).toBe(100);
  });

  it('refills over time — a drained bucket allows again after enough elapsed time', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    expect(rl.checkMessage('u').ok).toBe(false); // drained
    clock.advance(100); // 10/s × 0.1s = 1 token
    expect(rl.checkMessage('u').ok).toBe(true);
    expect(rl.checkMessage('u').ok).toBe(false); // and drained again
  });

  it('never over-refills beyond burst capacity', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    clock.advance(10_000); // idle 10s — would be 100 tokens uncapped
    let allowed = 0;
    for (let i = 0; i < 50; i++) if (rl.checkMessage('u').ok) allowed++;
    expect(allowed).toBe(TIGHT.messages.burst); // capped back at burst
  });

  it('keeps message and frame buckets independent', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    expect(rl.checkMessage('u').ok).toBe(false); // messages drained
    expect(rl.checkFrame('u').ok).toBe(true); // frames untouched
  });

  it('keeps per-user buckets independent', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('a');
    expect(rl.checkMessage('a').ok).toBe(false);
    expect(rl.checkMessage('b').ok).toBe(true);
  });
});

describe('RedisRateLimiter — Redis mirror', () => {
  it('write-throughs accepted units to a per-user fixed-window counter with a TTL', async () => {
    const redis = new InMemoryRedis();
    const clock = fixedClock(60_000_000); // aligns to a clean window boundary
    const rl = new RedisRateLimiter({ redis, config: TIGHT, now: clock.now });
    rl.checkMessage('u');
    rl.checkMessage('u');
    rl.checkFrame('u');
    await rl.whenSettled();

    const windowId = Math.floor(60_000_000 / 1000 / 60);
    const msgKey = `ratelimit:msg:u:${windowId}`;
    const frameKey = `ratelimit:frame:u:${windowId}`;
    expect(redis.peek(msgKey)).toBe('2');
    expect(redis.peek(frameKey)).toBe('1');
    expect(redis.ttlOf(msgKey)).toBe(120); // window × 2
  });

  it('does NOT mirror a rejected (over-limit) unit', async () => {
    const redis = new InMemoryRedis();
    const clock = fixedClock(60_000_000);
    const rl = new RedisRateLimiter({ redis, config: TIGHT, now: clock.now });
    for (let i = 0; i < TIGHT.messages.burst; i++) rl.checkMessage('u');
    rl.checkMessage('u'); // rejected — must not increment the mirror
    await rl.whenSettled();
    const windowId = Math.floor(60_000_000 / 1000 / 60);
    expect(redis.peek(`ratelimit:msg:u:${windowId}`)).toBe(String(TIGHT.messages.burst));
  });

  it('survives a Redis outage — the sync decision is unaffected and errors are swallowed', async () => {
    const redis = new InMemoryRedis();
    const errors: unknown[] = [];
    const clock = fixedClock();
    const rl = new RedisRateLimiter({
      redis,
      config: TIGHT,
      now: clock.now,
      onMirrorError: (e) => errors.push(e),
    });
    redis.failNext(new Error('redis down'));
    expect(rl.checkMessage('u').ok).toBe(true); // decision still made locally
    await expect(rl.whenSettled()).resolves.toBeUndefined(); // no unhandled rejection
    expect(errors).toHaveLength(1);
  });
});

describe('DEFAULT_RATE_LIMITS', () => {
  it('is generous enough for a real 50 fps audio stream and absorbs a full replay burst', () => {
    // frames burst must clear the §4.4 replay ring buffer (1500 frames) in one gulp.
    expect(DEFAULT_RATE_LIMITS.frames.burst).toBeGreaterThan(1500);
    // sustained frame rate exceeds the 50 fps real-time rate.
    expect(DEFAULT_RATE_LIMITS.frames.ratePerSec).toBeGreaterThan(50);
    // message cap is a sane positive burst.
    expect(DEFAULT_RATE_LIMITS.messages.burst).toBeGreaterThan(0);
  });

  it('allows a sustained 50 fps stream indefinitely under the default frame cap', () => {
    const clock = fixedClock();
    const rl = new RedisRateLimiter({ redis: new InMemoryRedis(), now: clock.now });
    // 5 seconds of real-time 20ms frames = 250 frames, one every 20ms.
    let allowed = 0;
    for (let i = 0; i < 250; i++) {
      if (rl.checkFrame('u').ok) allowed++;
      clock.advance(20);
    }
    expect(allowed).toBe(250);
  });
});
