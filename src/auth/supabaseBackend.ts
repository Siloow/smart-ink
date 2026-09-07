/**
 * Hosted beta gate on Supabase. See supabase/migrations/*_beta_gate.sql for
 * the tables and RPCs this talks to, and docs/supabase-setup.md for wiring.
 *
 * Identity comes from Supabase Auth (Google OAuth or an emailed one-time
 * code). Authorization is separate: after every sign-in, my_access() checks
 * the waitlist row for that email and the app only proceeds on 'active'.
 */
import type { Session, User } from '@supabase/supabase-js';
import {
  accessMessage,
  isValidEmail,
  normalizeEmail,
  type BetaAuthBackend,
} from './backend';
import { getSupabase } from './supabaseClient';
import type {
  AccessStatus,
  BetaSession,
  Invite,
  InvitePreview,
  RequestAccessResult,
  SendInviteResult,
  SessionState,
  WaitlistEntry,
} from './types';

function toMs(ts: string | null | undefined): number | undefined {
  if (!ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

function fail(message: string | undefined, fallback: string): never {
  throw new Error(message || fallback);
}

interface WaitlistRow {
  id: string;
  email: string;
  status: AccessStatus;
  source: string | null;
  created_at: string;
  invited_at: string | null;
  activated_at: string | null;
}

interface InviteRow {
  code: string;
  email: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_email: string | null;
}

function mapWaitlist(r: WaitlistRow): WaitlistEntry {
  return {
    id: r.id,
    email: r.email,
    status: r.status,
    createdAt: toMs(r.created_at) ?? 0,
    invitedAt: toMs(r.invited_at),
    activatedAt: toMs(r.activated_at),
    source: r.source,
  };
}

function mapInvite(r: InviteRow): Invite {
  return {
    code: r.code,
    email: r.email,
    createdAt: toMs(r.created_at) ?? 0,
    expiresAt: toMs(r.expires_at) ?? 0,
    redeemedAt: toMs(r.redeemed_at) ?? null,
    redeemedByEmail: r.redeemed_by_email,
    note: r.note,
  };
}

function sessionFromUser(user: User): BetaSession {
  const email = normalizeEmail(user.email ?? '');
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    email.split('@')[0];
  const provider = (user.app_metadata as { provider?: string } | undefined)?.provider;
  return {
    userId: user.id,
    email,
    displayName: name,
    method: provider === 'google' ? 'google' : 'email',
    createdAt: toMs(user.created_at) ?? Date.now(),
  };
}

/**
 * Turns an auth session into app state. Anyone can obtain a Supabase session
 * (Google will happily sign in any account); only invited emails get past
 * here. Everyone else is signed out again with a reason.
 */
async function resolveAccess(session: Session | null): Promise<SessionState> {
  if (!session?.user) return { session: null, accessError: null };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('my_access');
  if (error) {
    await supabase.auth.signOut();
    return { session: null, accessError: `Could not check beta access: ${error.message}` };
  }
  const status = typeof data === 'string' ? data : 'none';
  if (status === 'active') {
    return { session: sessionFromUser(session.user), accessError: null };
  }
  await supabase.auth.signOut();
  return { session: null, accessError: accessMessage(status) };
}

async function assertInvited(email: string): Promise<void> {
  const { data, error } = await getSupabase().rpc('access_status_for_email', { p_email: email });
  if (error) fail(error.message, 'Could not check beta access.');
  const status = typeof data === 'string' ? data : 'none';
  if (status !== 'invited' && status !== 'active') throw new Error(accessMessage(status));
}

export const supabaseBackend: BetaAuthBackend = {
  mode: 'supabase',

  subscribeSession(cb) {
    const supabase = getSupabase();
    let lastResolvedUser: string | null = null;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase asks that no other client calls run inside this callback, so
      // the access check is deferred to the next tick.
      if (event === 'SIGNED_OUT' || !session) {
        lastResolvedUser = null;
        cb({ session: null, accessError: null });
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (event !== 'USER_UPDATED' && lastResolvedUser === session.user.id) return;
        lastResolvedUser = session.user.id;
        window.setTimeout(() => {
          void resolveAccess(session).then(cb);
        }, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  },

  async signOut(opts) {
    const { error } = await getSupabase().auth.signOut({ scope: opts?.everywhere ? 'global' : 'local' });
    if (error) fail(error.message, 'Could not sign out.');
  },

  async requestBetaAccess(rawEmail, meta): Promise<RequestAccessResult> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const { data, error } = await getSupabase().rpc('request_beta_access', {
      p_email: email,
      p_source: meta.source,
      p_referrer: meta.referrer ?? '',
    });
    if (error) fail(error.message, 'Could not send your request.');
    const row = (Array.isArray(data) ? data[0] : data) as { status: AccessStatus; already: boolean } | undefined;
    if (!row) throw new Error('Could not send your request.');
    return { status: row.status, already: row.already };
  },

  async getInvite(code): Promise<InvitePreview | null> {
    const { data, error } = await getSupabase().rpc('get_invite_public', { p_code: code.trim().toUpperCase() });
    if (error) fail(error.message, 'Could not look up that invite.');
    const row = (Array.isArray(data) ? data[0] : data) as
      | { code: string; email: string | null; expires_at: string; redeemed: boolean }
      | undefined;
    if (!row) return null;
    return { code: row.code, email: row.email, expiresAt: toMs(row.expires_at) ?? 0, redeemed: row.redeemed };
  },

  async redeemInvite(code, rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const { error } = await getSupabase().rpc('redeem_invite', { p_code: code, p_email: email });
    if (error) fail(error.message, 'Could not redeem invite.');
  },

  async requestEmailCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    await assertInvited(email);
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) fail(error.message, 'Could not send the code.');
    return {};
  },

  async verifyEmailCode(rawEmail, code) {
    const email = normalizeEmail(rawEmail);
    const token = code.trim();
    if (!token) throw new Error('Enter the code from your email.');
    const { data, error } = await getSupabase().auth.verifyOtp({ email, token, type: 'email' });
    if (error) fail(error.message, 'Incorrect or expired code.');
    const state = await resolveAccess(data.session);
    if (!state.session) throw new Error(state.accessError ?? accessMessage('none'));
    return state.session;
  },

  async signInWithGoogle() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) fail(error.message, 'Could not start Google sign-in.');
    // The browser is now navigating to Google; the session arrives through
    // subscribeSession when it comes back.
    return null;
  },

  async isAdmin() {
    const supabase = getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return false;
    const { data, error } = await supabase.rpc('is_admin');
    if (error) return false;
    return data === true;
  },

  async listWaitlist() {
    const { data, error } = await getSupabase()
      .from('waitlist')
      .select('id, email, status, source, created_at, invited_at, activated_at')
      .order('created_at', { ascending: false });
    if (error) fail(error.message, 'Could not load the waitlist.');
    return ((data ?? []) as WaitlistRow[]).map(mapWaitlist);
  },

  async listInvites() {
    const { data, error } = await getSupabase()
      .from('invites')
      .select('code, email, note, created_at, expires_at, redeemed_at, redeemed_by_email')
      .order('created_at', { ascending: false });
    if (error) fail(error.message, 'Could not load invites.');
    return ((data ?? []) as InviteRow[]).map(mapInvite);
  },

  async listActiveEmails() {
    const { data, error } = await getSupabase()
      .from('waitlist')
      .select('email')
      .eq('status', 'active')
      .order('activated_at', { ascending: false });
    if (error) fail(error.message, 'Could not load active accounts.');
    return ((data ?? []) as { email: string }[]).map((r) => r.email);
  },

  async createInvite(opts) {
    const { data, error } = await getSupabase().rpc('admin_create_invite', {
      p_email: opts?.email ? normalizeEmail(opts.email) : null,
      p_note: opts?.note ?? null,
    });
    if (error) fail(error.message, 'Could not create invite.');
    return mapInvite(data as InviteRow);
  },

  async approveWaitlistEntry(entryId) {
    const { data, error } = await getSupabase().rpc('admin_approve_waitlist', { p_entry_id: entryId });
    if (error) fail(error.message, 'Approve failed.');
    return mapInvite(data as InviteRow);
  },

  async revokeAccess(entryId) {
    const { error } = await getSupabase().rpc('admin_revoke_access', { p_entry_id: entryId });
    if (error) fail(error.message, 'Could not revoke access.');
  },

  async sendInviteEmail(code): Promise<SendInviteResult> {
    const { data, error } = await getSupabase().functions.invoke('send-invite', { body: { code } });
    if (error) {
      return { sent: false, reason: error.message || 'The send-invite function is not deployed.' };
    }
    const body = data as { sent?: boolean; error?: string } | null;
    if (!body?.sent) return { sent: false, reason: body?.error ?? 'Email was not sent.' };
    return { sent: true };
  },
};
