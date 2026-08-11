export type AccessStatus = 'waitlisted' | 'invited' | 'active' | 'revoked';

export interface WaitlistEntry {
  id: string;
  email: string;
  status: AccessStatus;
  createdAt: number;
  invitedAt?: number;
  activatedAt?: number;
}

export interface Invite {
  code: string;
  email: string | null;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  redeemedByEmail: string | null;
  note?: string;
}

export interface BetaSession {
  email: string;
  displayName: string;
  method: 'google' | 'email';
  createdAt: number;
}

export interface BetaAuthSnapshot {
  waitlist: WaitlistEntry[];
  invites: Invite[];
  session: BetaSession | null;
  /** Emails that completed invite + login and may sign in again */
  activeEmails: string[];
}
