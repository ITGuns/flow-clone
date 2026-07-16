// Usage/metering surface (apps/api). The Phase 3 gate wires these into the pipeline (meterUsage at
// format.done) and into 3a's GET /v1/me (UsageReader). Importing this barrel is keyless and
// side-effect-free — the ioredis driver is only pulled in when `createRedis` is actually called
// (real mode), never under MOCK_MODE.
export { WEEKLY_WORD_LIMITS, weeklyWordLimit, type MeteredPlan } from './limits';
export { weekStartMondayUtc } from './week';
export { type RedisLike, InMemoryRedis } from './redis-like';
export { IoRedisAdapter, createRedis } from './ioredis-adapter';
export { UsageCounter, usageKey, USAGE_KEY_TTL_SECONDS } from './usage-counter';
export { type UsageRepo, DrizzleUsageRepo, FakeUsageRepo } from './usage-repo';
export {
  type MeterDeps,
  type MeterResult,
  type UsageReader,
  DefaultUsageReader,
  meterUsage,
} from './metering';
