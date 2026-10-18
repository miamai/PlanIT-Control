/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Precognition core API, e.g. http://localhost:8000 */
  readonly VITE_API_BASE_URL?: string
  /** Enabled by the Vercel build command; /api is proxied to Core. */
  readonly VITE_API_SAME_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
