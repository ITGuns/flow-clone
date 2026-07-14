// Data-layer surface (apps/api). The §7 Drizzle schema, the lazy postgres.js client factory, and
// the migrator. Downstream tasks (3a/3c/3d/3e/3f) import tables + `getDb` from here.
export * from './schema';
export * from './client';
export * from './migrate';
