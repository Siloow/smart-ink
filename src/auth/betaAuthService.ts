import {
  DEMO_ADMIN_PASSPHRASE,
  isAdminUnlocked,
  loadAuthSnapshot,
  saveAuthSnapshot,
  setAdminUnlocked,
} from './betaAuthStore';
import type { BetaSession, Invite, WaitlistEntry } from './types';

export { DEMO_ADMIN_PASSPHRASE };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Demo OTP shown in UI — swap for emailed codes via Supabase later. */
export const DEMO_EMAIL_CODE = '482913';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function requireAdmin(): void {
  if (!isAdminUnlocked()) {
    throw new Error('Operator access required.');
  }
}

export function getSession(): BetaSession | null {
  return loadAuthSnapshot().session;
}

export function logout(): void {
  const snap = loadAuthSnapshot();
  snap.session = null;
  saveAuthSnapshot(snap);
}

export function requestBetaAccess(rawEmail: string): { entry: WaitlistEntry; already: boolean } {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    throw new Error('Enter a valid email address.');
  }

  const snap = loadAuthSnapshot();
  const existing = snap.waitlist.find((e) => e.email === email);
  if (existing) {
    return { entry: existing, already: true };
  }

  if (snap.activeEmails.includes(email)) {
    throw new Error('This email already has beta access. Log in instead.');
  }

  const entry: WaitlistEntry = {
    id: newId(),
    email,
    status: 'waitlisted',
    createdAt: Date.now(),
  };
  snap.waitlist.unshift(entry);
  saveAuthSnapshot(snap);
  return { entry, already: false };
}

export function listWaitlist(): WaitlistEntry[] {
  return loadAuthSnapshot().waitlist;
}

export function listInvites(): Invite[] {
  return loadAuthSnapshot().invites;
}

export function listActiveEmails(): string[] {
  return loadAuthSnapshot().activeEmails;
}

export function unlockAdmin(passphrase: string): void {
  if (passphrase.trim() !== DEMO_ADMIN_PASSPHRASE) {
    throw new Error('Incorrect operator passphrase.');
  }
  setAdminUnlocked(true);
}

export function lockAdmin(): void {
  setAdminUnlocked(false);
}

export function adminIsUnlocked(): boolean {
  return isAdminUnlocked();
}

export function createInvite(opts?: {
  email?: string | null;
  note?: string;
}): Invite {
  requireAdmin();
  const snap = loadAuthSnapshot();
  const email = opts?.email ? normalizeEmail(opts.email) : null;
  if (email && !isValidEmail(email)) {
    throw new Error('Enter a valid email address.');
  }

  const invite: Invite = {
    code: inviteCode(),
    email,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL_MS,
    redeemedAt: null,
    redeemedByEmail: null,
    note: opts?.note,
  };
  snap.invites.unshift(invite);
  saveAuthSnapshot(snap);
  return invite;
}

/** Approve a waitlisted email and mint an invite bound to that address. */
export function approveWaitlistEntry(entryId: string): Invite {
  requireAdmin();
  const snap = loadAuthSnapshot();
  const entry = snap.waitlist.find((e) => e.id === entryId);
  if (!entry) throw new Error('Waitlist entry not found.');
  if (entry.status === 'revoked') throw new Error('This entry was revoked.');
  if (entry.status === 'active') throw new Error('Already active — they can log in.');

  entry.status = 'invited';
  entry.invitedAt = Date.now();
  saveAuthSnapshot(snap);

  return createInvite({ email: entry.email, note: 'Approved from waitlist' });
}

export function getInvite(code: string): Invite | undefined {
  const normalized = code.trim().toUpperCase();
  return loadAuthSnapshot().invites.find((i) => i.code === normalized);
}

export function redeemInvite(code: string, rawEmail: string): WaitlistEntry {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    throw new Error('Enter a valid email address.');
  }

  const snap = loadAuthSnapshot();
  const invite = snap.invites.find((i) => i.code === code.trim().toUpperCase());
  if (!invite) throw new Error('That invite code is not valid.');
  if (invite.redeemedAt) throw new Error('This invite was already used.');
  if (Date.now() > invite.expiresAt) throw new Error('This invite has expired.');
  if (invite.email && invite.email !== email) {
    throw new Error('This invite is reserved for a different email.');
  }

  invite.redeemedAt = Date.now();
  invite.redeemedByEmail = email;

  let entry = snap.waitlist.find((e) => e.email === email);
  if (!entry) {
    entry = {
      id: newId(),
      email,
      status: 'invited',
      createdAt: Date.now(),
      invitedAt: Date.now(),
    };
    snap.waitlist.unshift(entry);
  } else {
    entry.status = 'invited';
    entry.invitedAt = Date.now();
  }

  saveAuthSnapshot(snap);
  return entry;
}

function assertCanSignIn(email: string): void {
  const snap = loadAuthSnapshot();
  if (snap.activeEmails.includes(email)) return;

  const entry = snap.waitlist.find((e) => e.email === email);
  if (!entry) {
    throw new Error('No beta access for this email. Request an invite first.');
  }
  if (entry.status === 'waitlisted') {
    throw new Error('You’re on the waitlist. We’ll email you when a spot opens.');
  }
  if (entry.status === 'revoked') {
    throw new Error('This beta access was revoked.');
  }
  if (entry.status !== 'invited' && entry.status !== 'active') {
    throw new Error('No beta access for this email.');
  }
}

function activateSession(email: string, method: BetaSession['method'], displayName?: string): BetaSession {
  const snap = loadAuthSnapshot();
  assertCanSignIn(email);

  if (!snap.activeEmails.includes(email)) {
    snap.activeEmails.push(email);
  }

  const entry = snap.waitlist.find((e) => e.email === email);
  if (entry) {
    entry.status = 'active';
    entry.activatedAt = Date.now();
  }

  const session: BetaSession = {
    email,
    displayName: displayName ?? email.split('@')[0],
    method,
    createdAt: Date.now(),
  };
  snap.session = session;
  saveAuthSnapshot(snap);
  return session;
}

/** Demo Google sign-in: still requires prior invite/active status for that email. */
export function signInWithGoogle(rawEmail: string): BetaSession {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    throw new Error('Enter the Google account email to continue (demo).');
  }
  return activateSession(email, 'google');
}

export function requestEmailCode(rawEmail: string): { email: string; demoCode: string } {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    throw new Error('Enter a valid email address.');
  }
  assertCanSignIn(email);
  return { email, demoCode: DEMO_EMAIL_CODE };
}

export function verifyEmailCode(rawEmail: string, code: string): BetaSession {
  const email = normalizeEmail(rawEmail);
  if (code.trim() !== DEMO_EMAIL_CODE) {
    throw new Error('Incorrect code. Use the demo code shown below the form.');
  }
  return activateSession(email, 'email');
}

export function inviteUrl(code: string, origin = window.location.origin): string {
  const url = new URL(origin);
  url.searchParams.set('invite', code);
  return url.toString();
}
