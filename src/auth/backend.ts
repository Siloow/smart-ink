import type {
  BetaSession,
  Invite,
  InvitePreview,
  RequestAccessResult,
  SendInviteResult,
  SessionState,
  WaitlistEntry,
} from './types';
import { isSupabaseConfigured } from './supabaseClient';

/**
 * - `supabase`: the hosted gate. Invites, waitlist and sessions live in the
 *   database; identity is verified by Google or an emailed code.
 * - `demo`: the original browser-local gate, kept for `npm run dev` without a
 *   Supabase project. Everything is stored in this browser only.
 * - `unconfigured`: a production build with no Supabase env. Sign-in is
 *   disabled rather than silently shipping the demo gate.
 */
export type AuthMode = 'supabase' | 'demo' | 'unconfigured';

export function authMode(): AuthMode {
  if (isSupabaseConfigured()) return 'supabase';
  return import.meta.env.DEV ? 'demo' : 'unconfigured';
}

export interface BetaAuthBackend {
  readonly mode: 'supabase' | 'demo';

  /** Emits the current state immediately, then on every change. */
  subscribeSession(cb: (state: SessionState) => void): () => void;
  signOut(opts?: { everywhere?: boolean }): Promise<void>;

  requestBetaAccess(email: string, meta: { source: string; referrer?: string }): Promise<RequestAccessResult>;
  getInvite(code: string): Promise<InvitePreview | null>;
  redeemInvite(code: string, email: string): Promise<void>;

  /** Sends a one-time code. The demo backend returns the code instead. */
  requestEmailCode(email: string): Promise<{ demoCode?: string }>;
  verifyEmailCode(email: string, code: string): Promise<BetaSession>;
  /** Resolves to null when the browser is being redirected to Google. */
  signInWithGoogle(emailHint?: string): Promise<BetaSession | null>;

  isAdmin(): Promise<boolean>;
  listWaitlist(): Promise<WaitlistEntry[]>;
  listInvites(): Promise<Invite[]>;
  listActiveEmails(): Promise<string[]>;
  createInvite(opts?: { email?: string | null; note?: string }): Promise<Invite>;
  approveWaitlistEntry(entryId: string): Promise<Invite>;
  revokeAccess(entryId: string): Promise<void>;
  sendInviteEmail(code: string): Promise<SendInviteResult>;
}

export const ACCESS_MESSAGES = {
  none: 'No beta access for this email. Request an invite first.',
  waitlisted: 'You’re on the waitlist. We’ll email you when a spot opens.',
  revoked: 'This beta access was revoked.',
} as const;

export function accessMessage(status: string): string {
  if (status === 'waitlisted') return ACCESS_MESSAGES.waitlisted;
  if (status === 'revoked') return ACCESS_MESSAGES.revoked;
  return ACCESS_MESSAGES.none;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
