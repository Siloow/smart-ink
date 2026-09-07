/**
 * Browser-local beta gate for development without a Supabase project.
 *
 * Everything lives in this browser's localStorage: the waitlist, invites,
 * the "active" list and the session. An invite minted here cannot be redeemed
 * on another device, and the email code is a constant shown in the UI. That
 * is exactly why it is dev-only; production builds without Supabase refuse to
 * sign anyone in (see authMode()).
 */
import {
  accessMessage,
  isValidEmail,
  normalizeEmail,
  type BetaAuthBackend,
} from './backend';
import type {
  BetaAuthSnapshot,
  BetaSession,
  Invite,
  InvitePreview,
  RequestAccessResult,
  SendInviteResult,
  SessionState,
  WaitlistEntry,
} from './types';

const STORAGE_KEY = 'smartink-beta-auth-v1';
const ADMIN_KEY = 'smartink-beta-admin-unlocked';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Demo one-time code, returned by requestEmailCode and shown in the UI. */
export const DEMO_EMAIL_CODE = '482913';
/** Unlocks the operator console in demo mode. Not shown on screen. */
const DEMO_ADMIN_PASSPHRASE = 'smartink-beta';

/** Typing this in the login email field signs in as super admin (DEV only). */
export const DEV_ADMIN_HANDLE = 'admin';
const DEV_ADMIN_EMAIL = 'admin@smartink.local';

export function isDevAdminHandle(rawEmail: string): boolean {
  return import.meta.env.DEV && rawEmail.trim().toLowerCase() === DEV_ADMIN_HANDLE;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function emptySnapshot(): BetaAuthSnapshot {
  return { waitlist: [], invites: [], session: null, activeEmails: [] };
}

function load(): BetaAuthSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as Partial<BetaAuthSnapshot>;
    return {
      waitlist: parsed.waitlist ?? [],
      invites: parsed.invites ?? [],
      session: parsed.session ?? null,
      activeEmails: parsed.activeEmails ?? [],
    };
  } catch {
    return emptySnapshot();
  }
}

const listeners = new Set<() => void>();

function save(snapshot: BetaAuthSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  listeners.forEach((l) => l());
}

function adminUnlocked(): boolean {
  return sessionStorage.getItem(ADMIN_KEY) === '1';
}

function setAdminUnlocked(unlocked: boolean): void {
  if (unlocked) sessionStorage.setItem(ADMIN_KEY, '1');
  else sessionStorage.removeItem(ADMIN_KEY);
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
  if (!adminUnlocked()) throw new Error('Operator access required.');
}

function assertCanSignIn(snap: BetaAuthSnapshot, email: string): void {
  if (snap.activeEmails.includes(email)) return;
  const entry = snap.waitlist.find((e) => e.email === email);
  if (!entry) throw new Error(accessMessage('none'));
  if (entry.status === 'invited' || entry.status === 'active') return;
  throw new Error(accessMessage(entry.status));
}

function activateSession(email: string, method: BetaSession['method'], displayName?: string): BetaSession {
  const snap = load();
  assertCanSignIn(snap, email);
  if (!snap.activeEmails.includes(email)) snap.activeEmails.push(email);
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
  save(snap);
  return session;
}

function mintInvite(snap: BetaAuthSnapshot, email: string | null, note?: string): Invite {
  const invite: Invite = {
    code: inviteCode(),
    email,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL_MS,
    redeemedAt: null,
    redeemedByEmail: null,
    note,
  };
  snap.invites.unshift(invite);
  return invite;
}

// ---------------------------------------------------------------------------
// Demo-only operator controls
// ---------------------------------------------------------------------------

export function unlockDemoAdmin(passphrase: string): void {
  if (passphrase.trim() !== DEMO_ADMIN_PASSPHRASE) {
    throw new Error('Incorrect operator passphrase.');
  }
  setAdminUnlocked(true);
}

export function lockDemoAdmin(): void {
  setAdminUnlocked(false);
}

/** Grant the dev admin beta access, unlock the console, and sign in. */
export function signInAsDevAdmin(): BetaSession {
  if (!import.meta.env.DEV) throw new Error(accessMessage('none'));
  const snap = load();
  const entry = snap.waitlist.find((e) => e.email === DEV_ADMIN_EMAIL);
  if (entry) {
    entry.status = 'active';
  } else {
    snap.waitlist.unshift({
      id: newId(),
      email: DEV_ADMIN_EMAIL,
      status: 'active',
      createdAt: Date.now(),
      invitedAt: Date.now(),
      source: 'dev-admin',
    });
  }
  if (!snap.activeEmails.includes(DEV_ADMIN_EMAIL)) snap.activeEmails.push(DEV_ADMIN_EMAIL);
  save(snap);
  setAdminUnlocked(true);
  return activateSession(DEV_ADMIN_EMAIL, 'email', 'Admin');
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export const localDemoBackend: BetaAuthBackend = {
  mode: 'demo',

  subscribeSession(cb) {
    const emit = () => cb({ session: load().session, accessError: null });
    emit();
    listeners.add(emit);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) emit();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(emit);
      window.removeEventListener('storage', onStorage);
    };
  },

  async signOut() {
    const snap = load();
    snap.session = null;
    save(snap);
  },

  async requestBetaAccess(rawEmail, meta): Promise<RequestAccessResult> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const snap = load();
    const existing = snap.waitlist.find((e) => e.email === email);
    if (existing) return { status: existing.status, already: true };
    if (snap.activeEmails.includes(email)) return { status: 'active', already: true };
    const entry: WaitlistEntry = {
      id: newId(),
      email,
      status: 'waitlisted',
      createdAt: Date.now(),
      source: meta.source,
    };
    snap.waitlist.unshift(entry);
    save(snap);
    return { status: 'waitlisted', already: false };
  },

  async getInvite(code): Promise<InvitePreview | null> {
    const normalized = code.trim().toUpperCase();
    const invite = load().invites.find((i) => i.code === normalized);
    if (!invite) return null;
    return {
      code: invite.code,
      email: invite.email,
      expiresAt: invite.expiresAt,
      redeemed: invite.redeemedAt !== null,
    };
  },

  async redeemInvite(code, rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const snap = load();
    const invite = snap.invites.find((i) => i.code === code.trim().toUpperCase());
    if (!invite) throw new Error('That invite code is not valid.');
    if (invite.redeemedAt) throw new Error('This invite was already used.');
    if (Date.now() > invite.expiresAt) throw new Error('This invite has expired.');
    if (invite.email && invite.email !== email) {
      throw new Error('This invite is reserved for a different email.');
    }
    invite.redeemedAt = Date.now();
    invite.redeemedByEmail = email;
    const entry = snap.waitlist.find((e) => e.email === email);
    if (!entry) {
      snap.waitlist.unshift({
        id: newId(),
        email,
        status: 'invited',
        createdAt: Date.now(),
        invitedAt: Date.now(),
        source: `invite:${invite.code}`,
      });
    } else if (entry.status !== 'revoked') {
      entry.status = 'invited';
      entry.invitedAt = Date.now();
    }
    save(snap);
    if (entry?.status === 'revoked') throw new Error(accessMessage('revoked'));
  },

  async requestEmailCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    assertCanSignIn(load(), email);
    return { demoCode: DEMO_EMAIL_CODE };
  },

  async verifyEmailCode(rawEmail, code) {
    const email = normalizeEmail(rawEmail);
    if (code.trim() !== DEMO_EMAIL_CODE) {
      throw new Error('Incorrect code. Use the demo code shown below the form.');
    }
    return activateSession(email, 'email');
  },

  async signInWithGoogle(emailHint) {
    const email = normalizeEmail(emailHint ?? '');
    if (!isValidEmail(email)) {
      throw new Error('Enter the Google account email to continue (demo).');
    }
    return activateSession(email, 'google');
  },

  async isAdmin() {
    return adminUnlocked();
  },

  async listWaitlist() {
    requireAdmin();
    return load().waitlist;
  },

  async listInvites() {
    requireAdmin();
    return load().invites;
  },

  async listActiveEmails() {
    requireAdmin();
    return load().activeEmails;
  },

  async createInvite(opts) {
    requireAdmin();
    const snap = load();
    const email = opts?.email ? normalizeEmail(opts.email) : null;
    if (email && !isValidEmail(email)) throw new Error('Enter a valid email address.');
    const invite = mintInvite(snap, email, opts?.note);
    save(snap);
    return invite;
  },

  async approveWaitlistEntry(entryId) {
    requireAdmin();
    const snap = load();
    const entry = snap.waitlist.find((e) => e.id === entryId);
    if (!entry) throw new Error('Waitlist entry not found.');
    if (entry.status === 'revoked') throw new Error('This entry was revoked.');
    if (entry.status === 'active') throw new Error('Already active — they can log in.');
    entry.status = 'invited';
    entry.invitedAt = Date.now();
    const invite = mintInvite(snap, entry.email, 'Approved from waitlist');
    save(snap);
    return invite;
  },

  async revokeAccess(entryId) {
    requireAdmin();
    const snap = load();
    const entry = snap.waitlist.find((e) => e.id === entryId);
    if (!entry) throw new Error('Waitlist entry not found.');
    entry.status = 'revoked';
    snap.activeEmails = snap.activeEmails.filter((e) => e !== entry.email);
    if (snap.session?.email === entry.email) snap.session = null;
    save(snap);
  },

  async sendInviteEmail(): Promise<SendInviteResult> {
    return { sent: false, reason: 'Email delivery needs the Supabase backend. Copy the link instead.' };
  },
};

export type { SessionState };
