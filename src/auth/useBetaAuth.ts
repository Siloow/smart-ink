import { useCallback, useEffect, useState } from 'react';
import * as betaAuth from './betaAuthService';
import type { BetaSession, Invite, WaitlistEntry } from './types';

export function useBetaAuth() {
  /** False until the backend has reported the initial session. */
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<BetaSession | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [activeEmails, setActiveEmails] = useState<string[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    return betaAuth.subscribeSession((state) => {
      setSessionState(state.session);
      setAccessError(state.accessError);
      setReady(true);
    });
  }, []);

  // The operator flag follows the session (profiles.is_admin on Supabase, a
  // sessionStorage flag in the demo backend).
  useEffect(() => {
    let cancelled = false;
    void betaAuth.isAdmin().then((v) => {
      if (!cancelled) setIsAdmin(v);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const refreshAdminData = useCallback(async () => {
    try {
      const [w, i, a] = await Promise.all([
        betaAuth.listWaitlist(),
        betaAuth.listInvites(),
        betaAuth.listActiveEmails(),
      ]);
      setWaitlist(w);
      setInvites(i);
      setActiveEmails(a);
      setAdminError(null);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Could not load operator data.');
    }
  }, []);

  /** Pages call this with the session a sign-in just returned. */
  const setSession = useCallback((next: BetaSession | null) => {
    setSessionState(next);
    setAccessError(null);
  }, []);

  const signOut = useCallback(async (opts?: { everywhere?: boolean }) => {
    try {
      await betaAuth.signOut(opts);
    } finally {
      setSessionState(null);
    }
  }, []);

  const unlockAdmin = useCallback(async (passphrase: string) => {
    await betaAuth.unlockAdmin(passphrase);
    setIsAdmin(true);
  }, []);

  const lockAdmin = useCallback(() => {
    betaAuth.lockAdmin();
    setIsAdmin(false);
  }, []);

  const clearAccessError = useCallback(() => setAccessError(null), []);

  return {
    ready,
    session,
    setSession,
    accessError,
    clearAccessError,
    isAdmin,
    waitlist,
    invites,
    activeEmails,
    adminError,
    refreshAdminData,
    signOut,
    unlockAdmin,
    lockAdmin,
  };
}
