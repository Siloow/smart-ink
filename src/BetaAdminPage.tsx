import { useEffect, useState, type FormEvent } from 'react';
import {
  approveWaitlistEntry,
  createInvite,
  inviteUrl,
  revokeAccess,
  sendInviteEmail,
  type AuthMode,
} from './auth/betaAuthService';
import type { BetaSession, Invite, WaitlistEntry } from './auth/types';

export interface BetaAdminPageProps {
  mode: AuthMode;
  session: BetaSession | null;
  /** Operator access granted: profiles.is_admin on Supabase, passphrase in the demo. */
  unlocked: boolean;
  waitlist: WaitlistEntry[];
  invites: Invite[];
  activeEmails: string[];
  loadError: string | null;
  onUnlock: (passphrase: string) => Promise<void>;
  onLock: () => void;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onGoLogin: () => void;
  onSignOut: () => void;
}

export default function BetaAdminPage({
  mode,
  session,
  unlocked,
  waitlist,
  invites,
  activeEmails,
  loadError,
  onUnlock,
  onLock,
  onRefresh,
  onBack,
  onGoLogin,
  onSignOut,
}: BetaAdminPageProps) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState('');
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (unlocked) void onRefresh();
  }, [unlocked, onRefresh]);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onUnlock(passphrase);
      setPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.');
    }
  };

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  /** Shared tail of approve and mint: copy the link, try to email it, report. */
  const deliver = async (invite: Invite, created: string) => {
    const link = inviteUrl(invite.code);
    setLastLink(link);
    const copied = await copy(link);
    let text = `${created}${copied ? ' Link copied.' : ''}`;
    if (invite.email) {
      const result = await sendInviteEmail(invite.code);
      text += result.sent
        ? ` Emailed to ${invite.email}.`
        : ` Not emailed: ${result.reason ?? 'unknown reason'}`;
    }
    setMessage(text);
    await onRefresh();
  };

  const handleApprove = async (entry: WaitlistEntry) => {
    setError(null);
    setMessage(null);
    setBusy(entry.id);
    try {
      const invite = await approveWaitlistEntry(entry.id);
      await deliver(invite, `Invite created for ${entry.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy('mint');
    try {
      const invite = await createInvite({
        email: manualEmail.trim() ? manualEmail : null,
        note: 'Manual invite',
      });
      setManualEmail('');
      await deliver(invite, invite.email ? `Invite created for ${invite.email}.` : 'Open invite created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite.');
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (entry: WaitlistEntry) => {
    if (!window.confirm(`Revoke beta access for ${entry.email}? They will be signed out and cannot sign in again.`)) {
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(entry.id);
    try {
      await revokeAccess(entry.id);
      setMessage(`Access revoked for ${entry.email}.`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke access.');
    } finally {
      setBusy(null);
    }
  };

  const handleCopyLink = async (code: string) => {
    const link = inviteUrl(code);
    setMessage((await copy(link)) ? 'Link copied.' : link);
  };

  if (!unlocked) {
    return (
      <div className="beta-gate-page">
        <div className="beta-gate-card">
          <button type="button" className="beta-link-btn" onClick={onBack}>
            ← Back
          </button>
          <p className="beta-eyebrow">Operator</p>
          <h1>Beta console</h1>

          {mode === 'demo' && (
            <>
              <p className="beta-lead">
                Local demo backend. Everything here lives in this browser only. Enter the operator
                passphrase, or sign in as <code className="beta-code">admin</code> on the login page.
              </p>
              <form className="beta-form" onSubmit={handleUnlock}>
                <input
                  className="login-input"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Operator passphrase"
                  autoComplete="current-password"
                />
                {error && <p className="beta-error">{error}</p>}
                <button type="submit" className="btn-cta" style={{ width: '100%' }}>
                  Unlock
                </button>
              </form>
            </>
          )}

          {mode === 'supabase' && !session && (
            <>
              <p className="beta-lead">Sign in with your operator account to continue.</p>
              <button type="button" className="btn-cta" style={{ width: '100%' }} onClick={onGoLogin}>
                Log in
              </button>
            </>
          )}

          {mode === 'supabase' && session && (
            <>
              <p className="beta-lead">
                <strong>{session.email}</strong> is signed in but is not an operator. Promote it
                once in the Supabase SQL editor:
              </p>
              <pre className="beta-code-block">
                {`update public.profiles set is_admin = true where email = '${session.email}';`}
              </pre>
              <p className="beta-muted">Then reload this page.</p>
              <button type="button" className="btn-login" onClick={onSignOut}>
                Sign out
              </button>
            </>
          )}

          {mode === 'unconfigured' && (
            <p className="beta-lead">
              The hosted backend isn’t configured on this deployment. See docs/supabase-setup.md.
            </p>
          )}
        </div>
      </div>
    );
  }

  const pending = waitlist.filter((w) => w.status === 'waitlisted');
  const active = waitlist.filter((w) => w.status === 'active');
  const activeOnlyEmails = activeEmails.filter((e) => !active.some((w) => w.email === e));
  const revoked = waitlist.filter((w) => w.status === 'revoked');

  return (
    <div className="beta-admin-page">
      <header className="beta-admin-header">
        <div>
          <p className="beta-eyebrow">Operator · {mode === 'supabase' ? 'Supabase' : 'Local demo'}</p>
          <h1>Beta console</h1>
        </div>
        <div className="beta-admin-actions">
          <button type="button" className="btn-login" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn-login" onClick={() => void onRefresh()}>
            Refresh
          </button>
          {mode === 'demo' ? (
            <button type="button" className="btn-login" onClick={onLock}>
              Lock
            </button>
          ) : (
            <button type="button" className="btn-login" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {mode === 'demo' && (
        <p className="beta-admin-note">
          Local demo backend: everything here is stored in this browser only. Invites minted here
          cannot be redeemed on another device. Configure Supabase for the real thing.
        </p>
      )}
      {session && mode === 'supabase' && (
        <p className="beta-admin-note">Signed in as {session.email}.</p>
      )}

      {message && <div className="beta-banner">{message}</div>}
      {error && <div className="beta-banner beta-banner--error">{error}</div>}
      {loadError && <div className="beta-banner beta-banner--error">{loadError}</div>}
      {lastLink && (
        <div className="beta-banner">
          Invite link:{' '}
          <button type="button" className="beta-inline-link" onClick={() => void copy(lastLink)}>
            {lastLink}
          </button>
        </div>
      )}

      <section className="beta-admin-section">
        <h2>Create invite</h2>
        <form className="beta-admin-inline-form" onSubmit={handleCreateInvite}>
          <input
            className="login-input"
            type="email"
            placeholder="Optional email lock"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
          />
          <button type="submit" className="btn-getstarted" disabled={busy !== null}>
            {busy === 'mint' ? 'Creating…' : 'Mint invite link'}
          </button>
        </form>
        <p className="beta-muted">
          With an email, the invite is locked to that address and emailed if the send-invite
          function is deployed. The link is copied either way.
        </p>
      </section>

      <section className="beta-admin-section">
        <h2>Waitlist ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="beta-muted">No pending requests.</p>
        ) : (
          <ul className="beta-admin-list">
            {pending.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.email}</strong>
                  <span className="beta-muted">
                    {' '}
                    · {new Date(entry.createdAt).toLocaleString()}
                    {entry.source ? ` · ${entry.source}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-getstarted"
                  disabled={busy !== null}
                  onClick={() => void handleApprove(entry)}
                >
                  {busy === entry.id ? 'Approving…' : 'Approve + send invite'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="beta-admin-section">
        <h2>Invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="beta-muted">No invites yet.</p>
        ) : (
          <ul className="beta-admin-list">
            {invites.map((invite) => {
              const open = !invite.redeemedAt && Date.now() <= invite.expiresAt;
              return (
                <li key={invite.code}>
                  <div>
                    <code className="beta-code">{invite.code}</code>
                    <span className="beta-muted">
                      {' '}
                      · {invite.email ?? 'open seat'} ·{' '}
                      {invite.redeemedAt
                        ? `used by ${invite.redeemedByEmail}`
                        : Date.now() > invite.expiresAt
                          ? 'expired'
                          : `open until ${new Date(invite.expiresAt).toLocaleDateString()}`}
                    </span>
                  </div>
                  {open && (
                    <button
                      type="button"
                      className="btn-login"
                      onClick={() => void handleCopyLink(invite.code)}
                    >
                      Copy link
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="beta-admin-section">
        <h2>Active ({active.length + activeOnlyEmails.length})</h2>
        {active.length === 0 && activeOnlyEmails.length === 0 ? (
          <p className="beta-muted">No activated accounts yet.</p>
        ) : (
          <ul className="beta-admin-list">
            {active.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.email}</strong>
                  {entry.activatedAt && (
                    <span className="beta-muted">
                      {' '}
                      · since {new Date(entry.activatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-login"
                  disabled={busy !== null}
                  onClick={() => void handleRevoke(entry)}
                >
                  {busy === entry.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
            {activeOnlyEmails.map((email) => (
              <li key={email}>
                <strong>{email}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revoked.length > 0 && (
        <section className="beta-admin-section">
          <h2>Revoked ({revoked.length})</h2>
          <ul className="beta-admin-list">
            {revoked.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.email}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
