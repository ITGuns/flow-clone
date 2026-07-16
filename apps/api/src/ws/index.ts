// Public surface of the WS gateway module.
export { registerWsGateway, type GatewayDeps } from './gateway';
export { SessionStore, RESUME_TTL_MS } from './session-store';
export { PermissiveRateLimiter, type RateLimiter, type RateLimitDecision } from './rate-limiter';
export { SessionStateMachine, type SessionState, type StateEvent } from './state-machine';
export {
  runUtterancePipeline,
  wireError,
  countWords,
  FORMAT_TTFT_TIMEOUT_MS,
  DEFAULT_BACKOFF_MS,
  type PipelineParams,
  type PersistHook,
  type PersistHookInput,
  type MeterHook,
  type MeterHookResult,
  type LoadDictionaryHook,
} from './pipeline';
export {
  signSessionToken,
  verifySessionToken,
  SESSION_TOKEN_TTL_SEC,
  MOCK_JWT_SECRET,
  TokenExpiredError,
  TokenInvalidError,
  type SessionClaims,
  type SignedToken,
} from './jwt';
