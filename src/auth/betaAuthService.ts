/**
 * The one module pages import for beta auth. It picks a backend from the
 * environment (see authMode) and keeps the function names the pages already
 * use; everything is async because the hosted backend is.
 */
import { authMode, type BetaAuthBackend } from './backend';
import {
  localDemoBackend,
  lockDemoAdmin,
  signInAsDevAdmin as demoSignInAsDevAdmin,
  unlockDemoAdmin,
} from './localDemoBackend';
import { supabaseBackend } from './supabaseBackend';
import type {
  BetaSession,
  Invite,
  InvitePreview,
  RequestAccessResult,
  SendInviteResult,
  SessionState,
  WaitlistEntry,
} from './types';

export { authMode } from './backend';
export type { AuthMode } from './backend';
export { DEV_ADMIN_HANDLE, isDevAdminHandle } from './localDemoBackend';

const UNCONFIGURED = 'Sign-in is not set up on this deployment yet. Request access and we will email you.';

function backend(): BetaAuthBackend {
  return authMode() === 'supabase' ? supabaseBackend : localDemoBackend;
}

/** Throws in production builds that have no Supabase project configured. */
function requireSignInBackend(): BetaAuthBackend {
  if (authMode() === 'unconfigured') throw new Error(UNCONFIGURED);
  return backend();
}

export function subscribeSession(cb: (state: SessionState) => void): () => void {
  if (authMode() === 'unconfigured') {
    cb({ session: null, accessError: null });
    return () => {};
  }
  return backend().subscribeSession(cb);
}

export function signOut(opts?: { everywhere?: boolean }): Promise<void> {
  if (authMode() === 'unconfigured') return Promise.resolve();
  return backend().signOut(opts);
}

/**
 * Landing-page request. With Supabase this is the delivery; the demo backend
 * only records it in this browser (LandingPage warns and can also post to
 * VITE_WAITLIST_ENDPOINT).
 */
export function requestBetaAccess(
  email: string,
  meta: { source: string; referrer?: string }
): Promise<RequestAccessResult> {
  return backend().requestBetaAccess(email, meta);
}

export function getInvite(code: string): Promise<InvitePreview | null> {
  return requireSignInBackend().getInvite(code);
}

export function redeemInvite(code: string, email: string): Promise<void> {
  return requireSignInBackend().redeemInvite(code, email);
}

export function requestEmailCode(email: string): Promise<{ demoCode?: string }> {
  return requireSignInBackend().requestEmailCode(email);
}

export function verifyEmailCode(email: string, code: string): Promise<BetaSession> {
  return requireSignInBackend().verifyEmailCode(email, code);
}

/** Resolves to null while the browser is being redirected to Google. */
export function signInWithGoogle(emailHint?: string): Promise<BetaSession | null> {
  return requireSignInBackend().signInWithGoogle(emailHint);
}

/** Demo backend only (DEV builds). */
export async function signInAsDevAdmin(): Promise<BetaSession> {
  if (authMode() !== 'demo') throw new Error('The dev admin shortcut only exists in the local demo backend.');
  return demoSignInAsDevAdmin();
}

// --- Operator console ------------------------------------------------------

export function isAdmin(): Promise<boolean> {
  if (authMode() === 'unconfigured') return Promise.resolve(false);
  return backend().isAdmin();
}

/** Demo backend only; the hosted gate reads profiles.is_admin instead. */
export async function unlockAdmin(passphrase: string): Promise<void> {
  if (authMode() !== 'demo') throw new Error('Operator access comes from your account on this deployment.');
  unlockDemoAdmin(passphrase);
}

export function lockAdmin(): void {
  if (authMode() === 'demo') lockDemoAdmin();
}

export function listWaitlist(): Promise<WaitlistEntry[]> {
  return backend().listWaitlist();
}

export function listInvites(): Promise<Invite[]> {
  return backend().listInvites();
}

export function listActiveEmails(): Promise<string[]> {
  return backend().listActiveEmails();
}

export function createInvite(opts?: { email?: string | null; note?: string }): Promise<Invite> {
  return backend().createInvite(opts);
}

export function approveWaitlistEntry(entryId: string): Promise<Invite> {
  return backend().approveWaitlistEntry(entryId);
}

export function revokeAccess(entryId: string): Promise<void> {
  return backend().revokeAccess(entryId);
}

export function sendInviteEmail(code: string): Promise<SendInviteResult> {
  return backend().sendInviteEmail(code);
}

export function inviteUrl(code: string, origin = window.location.origin): string {
  const url = new URL(origin);
  url.searchParams.set('invite', code);
  return url.toString();
}
