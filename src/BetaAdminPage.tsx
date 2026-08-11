import { useEffect, useState, type FormEvent } from 'react';
import {
  DEMO_ADMIN_PASSPHRASE,
  approveWaitlistEntry,
  createInvite,
  inviteUrl,
} from './auth/betaAuthService';
import type { Invite, WaitlistEntry } from './auth/types';

export interface BetaAdminPageProps {
  unlocked: boolean;
  waitlist: WaitlistEntry[];
  invites: Invite[];
  activeEmails: string[];
  onUnlock: (passphrase: string) => void;
  onLock: () => void;
  onRefresh: () => void;
  onBack: () => void;
}

export default function BetaAdminPage({
  unlocked,
  waitlist,
  invites,
  activeEmails,
  onUnlock,
  onLock,
  onRefresh,
  onBack,
}: BetaAdminPageProps) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState('');
  const [lastLink, setLastLink] = useState<string | null>(null);

  useEffect(() => {
    if (unlocked) onRefresh();
  }, [unlocked, onRefresh]);

  const handleUnlock = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onUnlock(passphrase);
      setPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Copied to clipboard.');
    } catch {
      setMessage(text);
    }
  };

  const handleApprove = (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const invite = approveWaitlistEntry(id);
      const link = inviteUrl(invite.code);
      setLastLink(link);
      onRefresh();
      void copy(link);
      setMessage(`Invite created for ${invite.email ?? 'open seat'}. Link copied.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed.');
    }
  };

  const handleCreateInvite = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const invite = createInvite({
        email: manualEmail.trim() ? manualEmail : null,
        note: 'Manual invite',
      });
      const link = inviteUrl(invite.code);
      setLastLink(link);
      setManualEmail('');
      onRefresh();
      void copy(link);
      setMessage('Invite link created and copied.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite.');
    }
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
          <p className="beta-lead">
            Local demo gate. Passphrase is <code className="beta-code">{DEMO_ADMIN_PASSPHRASE}</code> —
            replace with real admin auth before production.
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
        </div>
      </div>
    );
  }

  const pending = waitlist.filter((w) => w.status === 'waitlisted');

  return (
    <div className="beta-admin-page">
      <header className="beta-admin-header">
        <div>
          <p className="beta-eyebrow">Operator</p>
          <h1>Beta console</h1>
        </div>
        <div className="beta-admin-actions">
          <button type="button" className="btn-login" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn-login" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>

      <p className="beta-admin-note">
        Everything here is stored in this browser only (localStorage). Wire to Supabase / your API when
        you host the beta.
      </p>

      {message && <div className="beta-banner">{message}</div>}
      {error && <div className="beta-banner beta-banner--error">{error}</div>}
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
          <button type="submit" className="btn-getstarted">
            Mint invite link
          </button>
        </form>
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
                  </span>
                </div>
                <button type="button" className="btn-getstarted" onClick={() => handleApprove(entry.id)}>
                  Approve + copy invite
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="beta-admin-section">
        <h2>Invites</h2>
        {invites.length === 0 ? (
          <p className="beta-muted">No invites yet.</p>
        ) : (
          <ul className="beta-admin-list">
            {invites.map((invite) => (
              <li key={invite.code}>
                <div>
                  <code className="beta-code">{invite.code}</code>
                  <span className="beta-muted">
                    {' '}
                    · {invite.email ?? 'open'} ·{' '}
                    {invite.redeemedAt
                      ? `used by ${invite.redeemedByEmail}`
                      : Date.now() > invite.expiresAt
                        ? 'expired'
                        : 'open'}
                  </span>
                </div>
                {!invite.redeemedAt && Date.now() <= invite.expiresAt && (
                  <button
                    type="button"
                    className="btn-login"
                    onClick={() => void copy(inviteUrl(invite.code))}
                  >
                    Copy link
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="beta-admin-section">
        <h2>Active ({activeEmails.length})</h2>
        {activeEmails.length === 0 ? (
          <p className="beta-muted">No activated accounts yet.</p>
        ) : (
          <ul className="beta-admin-list">
            {activeEmails.map((email) => (
              <li key={email}>
                <strong>{email}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
