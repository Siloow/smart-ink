import type { BetaAuthSnapshot } from './types';

const STORAGE_KEY = 'smartink-beta-auth-v1';
const ADMIN_KEY = 'smartink-beta-admin-unlocked';

/** Local demo operator passphrase — replace with real admin auth later. */
export const DEMO_ADMIN_PASSPHRASE = 'smartink-beta';

const EMPTY: BetaAuthSnapshot = {
  waitlist: [],
  invites: [],
  session: null,
  activeEmails: [],
};

export function loadAuthSnapshot(): BetaAuthSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, waitlist: [], invites: [], activeEmails: [] };
    const parsed = JSON.parse(raw) as BetaAuthSnapshot;
    return {
      waitlist: parsed.waitlist ?? [],
      invites: parsed.invites ?? [],
      session: parsed.session ?? null,
      activeEmails: parsed.activeEmails ?? [],
    };
  } catch {
    return { ...EMPTY, waitlist: [], invites: [], activeEmails: [] };
  }
}

export function saveAuthSnapshot(snapshot: BetaAuthSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function isAdminUnlocked(): boolean {
  return sessionStorage.getItem(ADMIN_KEY) === '1';
}

export function setAdminUnlocked(unlocked: boolean): void {
  if (unlocked) sessionStorage.setItem(ADMIN_KEY, '1');
  else sessionStorage.removeItem(ADMIN_KEY);
}
