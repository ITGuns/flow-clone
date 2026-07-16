/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for REST + WS (see src/config.ts). Defaults to http://localhost:8080. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
