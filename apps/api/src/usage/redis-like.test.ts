// Fake-port tests — the in-memory RedisLike must mirror real semantics so every downstream test
// that runs against it is trustworthy.
import { describe, it, expect } from 'vitest';
import { InMemoryRedis } from './redis-like';

describe('InMemoryRedis fake', () => {
  it('GET returns null for an absent key', async () => {
    const r = new InMemoryRedis();
    expect(await r.get('nope')).toBeNull();
  });

  it('INCRBY starts a missing key at 0 and returns the new total', async () => {
    const r = new InMemoryRedis();
    expect(await r.incrBy('k', 5)).toBe(5);
    expect(await r.incrBy('k', 3)).toBe(8);
    expect(await r.get('k')).toBe('8');
  });

  it('INCRBY by 0 is a readable no-op that still materializes the key', async () => {
    const r = new InMemoryRedis();
    expect(await r.incrBy('k', 0)).toBe(0);
    expect(await r.get('k')).toBe('0');
  });

  it('records TTLs only for existing keys', async () => {
    const r = new InMemoryRedis();
    await r.expire('ghost', 60);
    expect(r.ttlOf('ghost')).toBeUndefined();
    await r.incrBy('real', 1);
    await r.expire('real', 60);
    expect(r.ttlOf('real')).toBe(60);
  });

  it('failNext arms exactly one rejection, then resumes normal service', async () => {
    const r = new InMemoryRedis();
    r.failNext(new Error('boom'));
    await expect(r.incrBy('k', 1)).rejects.toThrow('boom');
    // Next call succeeds; the failed INCRBY did not mutate state.
    expect(await r.incrBy('k', 1)).toBe(1);
  });
});
