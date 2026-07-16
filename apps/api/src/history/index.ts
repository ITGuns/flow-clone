// Public surface of the encrypted-history module (Task 3c). The Phase 3 gate wires these into the
// pipeline (persistTranscript) and the Fastify app (registerHistoryRoutes via routes/history).
export * from './crypto';
export * from './token-index';
export * from './repo';
export * from './store';
export * from './service';
