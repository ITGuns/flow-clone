// Public surface of the auth module (Task 3a). The Phase 3 gate wires these into the composition
// root; other tasks import the ports/fakes from here.
export type {
  ClerkPrincipal,
  ClerkVerifier,
  NewUser,
  Plan,
  SubscriptionReader,
  SubscriptionRecord,
  UsageReader,
  UsageSnapshot,
  UserRecord,
  UserStore,
} from './ports';
export {
  PLAN_LIMITS,
  TRIAL_DAYS,
  effectivePlan,
  hasActivePaidSubscription,
  isTrialActive,
  planLimit,
} from './effective-plan';
export { syncUser } from './sync-user';
export {
  ClerkAuthenticator,
  extractBearerToken,
  type ClerkAuthenticatorDeps,
} from './clerk-authenticator';
export { ClerkBackendVerifier, type ClerkBackendVerifierOptions } from './clerk-verifier';
export { DrizzleUserStore } from './user-store';
export { InMemorySubscriptionReader, InMemoryUsageReader, InMemoryUserStore } from './memory';
