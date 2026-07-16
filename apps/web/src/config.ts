// Runtime configuration. The API origin comes from the Vite env `VITE_API_URL`; the default is the
// port the api's `start()` actually binds (apps/api/src/index.ts → `process.env.PORT ?? 8080`), NOT
// 3000. The WS URL is derived from the same origin (http→ws, https→wss).

const DEFAULT_API_URL = 'http://localhost:8080';

/** Normalize an API origin: fall back to the default, trim, and drop any trailing slash. */
export function resolveApiBaseUrl(raw?: string): string {
  const value = raw && raw.trim() !== '' ? raw.trim() : DEFAULT_API_URL;
  return value.replace(/\/+$/, '');
}

/** Derive the `/v1/stream` WebSocket URL from an http(s) API origin. */
export function toWsUrl(apiBaseUrl: string): string {
  const ws = apiBaseUrl.replace(/^http(s)?:\/\//i, (_m, secure) => (secure ? 'wss://' : 'ws://'));
  return `${ws.replace(/\/+$/, '')}/v1/stream`;
}

/** The configured API origin for this build (reads the Vite env at call time). */
export function apiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL);
}
