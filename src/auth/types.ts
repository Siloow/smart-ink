export type AccessStatus = 'waitlisted' | 'invited' | 'active' | 'revoked';

export interface WaitlistEntry {
  id: string;
  email: string;
  status: AccessStatus;
  createdAt: number;
  invitedAt?: number;
  activatedAt?: number;
  /** Which surface the request came from (hero form, request section, invite:CODE). */
  source?: string | null;
}

export interface Invite {
  code: string;
  email: string | null;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  redeemedByEmail: string | null;
  note?: string | null;
}

/** What an invite link may reveal before the visitor has signed in. */
export interface InvitePreview {
  code: string;
  email: string | null;
  expiresAt: number;
  redeemed: boolean;
}

export interface BetaSession {
  /** Supabase auth user id; absent in the local demo backend. */
  userId?: string;
  email: string;
  displayName: string;
  method: 'google' | 'email';
  createdAt: number;
}

export interface SessionState {
  session: BetaSession | null;
  /**
   * Set when someone authenticated (e.g. returned from Google) but has no beta
   * access. They have been signed out again; show this on the login page.
   */
  accessError: string | null;
}

export interface RequestAccessResult {
  status: AccessStatus;
  already: boolean;
}

export interface SendInviteResult {
  sent: boolean;
  reason?: string;
}

/** Persisted shape of the local demo backend (dev only). */
export interface BetaAuthSnapshot {
  waitlist: WaitlistEntry[];
  invites: Invite[];
  session: BetaSession | null;
  /** Emails that completed invite + login and may sign in again */
  activeEmails: string[];
}
