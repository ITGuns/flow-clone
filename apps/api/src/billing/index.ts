// Billing surface (apps/api, Task 3e). Plan definitions + weekly word limits (the single source
// Task 3f / the Phase 3 gate consume for QUOTA_EXCEEDED), the Stripe boundary port + impls, the
// persistence ports, and the StripeService (checkout + signed-webhook subscription sync).
export * from './plans';
export * from './stripe-signature';
export * from './stripe-client';
export * from './repos';
export * from './stripe-service';
