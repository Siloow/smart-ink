import { useCallback, useEffect, useState } from 'react';
import * as betaAuth from './betaAuthService';
import type { BetaSession, Invite, WaitlistEntry } from './types';

export function useBetaAuth() {
  const [session, setSession] = useState<BetaSession | null>(() => betaAuth.getSession());
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [activeEmails, setActiveEmails] = useState<string[]>([]);
  const [adminUnlocked, setAdminUnlocked] = useState(() => betaAuth.adminIsUnlocked());

  const refreshAdminData = useCallback(() => {
    if (!betaAuth.adminIsUnlocked()) return;
    setWaitlist(betaAuth.listWaitlist());
    setInvites(betaAuth.listInvites());
    setActiveEmails(betaAuth.listActiveEmails());
  }, []);

  useEffect(() => {
    setSession(betaAuth.getSession());
  }, []);

  const logout = useCallback(() => {
    betaAuth.logout();
    setSession(null);
  }, []);

  const refreshSession = useCallback(() => {
    setSession(betaAuth.getSession());
  }, []);

  const unlockAdmin = useCallback(
    (passphrase: string) => {
      betaAuth.unlockAdmin(passphrase);
      setAdminUnlocked(true);
      refreshAdminData();
    },
    [refreshAdminData]
  );

  const lockAdmin = useCallback(() => {
    betaAuth.lockAdmin();
    setAdminUnlocked(false);
  }, []);

  return {
    session,
    setSession,
    waitlist,
    invites,
    activeEmails,
    adminUnlocked,
    logout,
    refreshSession,
    refreshAdminData,
    unlockAdmin,
    lockAdmin,
  };
}
