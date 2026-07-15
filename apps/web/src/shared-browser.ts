// Browser-safe subset of @undertone/shared for the Vite production bundle. The shared barrel
// (packages/shared/src/index.ts) re-exports a node-only golden-fixture loader (node:fs / node:url)
// that a browser build cannot resolve and never needs. vite.config.ts aliases '@undertone/shared'
// to this file so the bundle pulls only the protocol types + frame codec — nothing node-only.
//
// Types stay sourced from the real package for typecheck (the alias is Vite-only); this file merely
// narrows what the RUNTIME bundle includes. Keep it aligned with the barrel's browser-safe surface.
export * from '../../../packages/shared/src/types';
export * from '../../../packages/shared/src/errors';
export * from '../../../packages/shared/src/protocol';
export * from '../../../packages/shared/src/frame-codec';
