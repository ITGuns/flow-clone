// Production RedisLike over `ioredis` — the ONLY place the vendor driver is touched (mirrors the
// ASR/DB adapter discipline). Import-time is side-effect-free and keyless: the type is imported
// type-only and the client is constructed lazily via `await import('ioredis')`, so under MOCK_MODE
// (where nothing calls `createRedis`) ioredis is never even loaded and the API boots without a URL.

import type { Redis } from 'ioredis';
import type { RedisLike } from './redis-like';

/** Adapts an `ioredis` client to the narrow {@link RedisLike} port. */
export class IoRedisAdapter implements RedisLike {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }
}

/**
 * Construct a lazily-connecting ioredis-backed {@link RedisLike} from a `REDIS_URL`. `lazyConnect`
 * defers the socket to the first command (parity with the DB client's laziness contract). Returns
 * both the port and a `close()` for graceful shutdown. Real mode only — never called in MOCK_MODE.
 */
export async function createRedis(
  redisUrl: string,
): Promise<{ redis: RedisLike; close: () => Promise<void> }> {
  const { default: IoRedis } = await import('ioredis');
  const client = new IoRedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  return {
    redis: new IoRedisAdapter(client),
    close: async (): Promise<void> => {
      client.disconnect();
    },
  };
}
