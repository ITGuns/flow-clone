// IoRedisAdapter delegation test — proves the port maps onto the ioredis command surface WITHOUT a
// live Redis (a stub client shaped like the methods we call). The real connection path is exercised
// only in an integration environment, per the keyless unit-test rule.
import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { IoRedisAdapter } from './ioredis-adapter';

describe('IoRedisAdapter', () => {
  it('delegates get/incrBy/expire to the underlying ioredis client', async () => {
    const get = vi.fn().mockResolvedValue('7');
    const incrby = vi.fn().mockResolvedValue(8);
    const expire = vi.fn().mockResolvedValue(1);
    const client = { get, incrby, expire } as unknown as Redis;
    const adapter = new IoRedisAdapter(client);

    expect(await adapter.get('k')).toBe('7');
    expect(get).toHaveBeenCalledWith('k');

    expect(await adapter.incrBy('k', 1)).toBe(8);
    expect(incrby).toHaveBeenCalledWith('k', 1);

    await adapter.expire('k', 60);
    expect(expire).toHaveBeenCalledWith('k', 60);
  });

  it('returns null from get when the key is absent', async () => {
    const client = { get: vi.fn().mockResolvedValue(null) } as unknown as Redis;
    expect(await new IoRedisAdapter(client).get('missing')).toBeNull();
  });
});
