/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Explicit local demo gate; ignored in production builds. */
  readonly VITE_AUTH_MODE?: string;
  /** Render server. Empty in dev means same-origin (Vite proxies to :8000). */
  readonly VITE_RENDER_URL?: string;
  /** Hosted beta gate. Both set → Supabase backend; neither → demo (dev only). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Optional hosted-form endpoint for landing-page requests (used without Supabase). */
  readonly VITE_WAITLIST_ENDPOINT?: string;
  /** Optional fallback address shown when a request cannot be delivered. */
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  readonly VITE_RENDER_BACKEND?: "runpod" | "http";
}
