/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versao do monorepo, embutida em build por vite.config.ts. */
declare const __CONCORD_VERSION__: string;
