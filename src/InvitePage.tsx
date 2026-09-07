import { useEffect, useState, type FormEvent } from 'react';
import {
  getInvite,
  redeemInvite,
  requestEmailCode,
  signInWithGoogle,
  verifyEmailCode,
} from './auth/betaAuthService';
import type { BetaSession, InvitePreview } from './auth/types';

export interface InvitePageProps {
  code: string;
  onBack: () => void;
  onAuthenticated: (session: BetaSession) => void;
}

type Step = 'redeem' | 'signin';
type Busy = 'redeem' | 'google' | 'code' | 'verify' | null;

export default function InvitePage({ code, onBack, onAuthenticated }: InvitePageProps) {
  /** undefined while the lookup is in flight, null when the code is unknown. */
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('redeem');
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvite(undefined);
    setError(null);
    getInvite(code)
      .then((found) => {
        if (cancelled) return;
        setInvite(found);
        if (found?.email) setEmail(found.email);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInvite(null);
        setError(err instanceof Error ? err.message : 'Could not look up that invite.');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const expired = invite ? Date.now() > invite.expiresAt : false;
  const used = Boolean(invite?.redeemed);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>, fallback: string) => {
    setError(null);
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  };

  const handleRedeem = (e: FormEvent) => {
    e.preventDefault();
    void run(
      'redeem',
      async () => {
        await redeemInvite(code, email);
        setStep('signin');
      },
      'Could not redeem invite.'
    );
  };

  const handleGoogle = () =>
    run(
      'google',
      async () => {
        const session = await signInWithGoogle(email);
        if (session) onAuthenticated(session);
      },
      'Google sign-in failed.'
    );

  const handleSendCode = () =>
    run(
      'code',
      async () => {
        const result = await requestEmailCode(email);
        setDemoCode(result.demoCode ?? null);
        setCodeSent(true);
      },
      'Could not send code.'
    );

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    void run(
      'verify',
      async () => {
        onAuthenticated(await verifyEmailCode(email, otp));
      },
      'Could not verify code.'
    );
  };

  return (
    <div className="beta-gate-page">
      <div className="beta-gate-card">
        <button type="button" className="beta-link-btn" onClick={onBack}>
          ← Back
        </button>
        <p className="beta-eyebrow">Private beta</p>
        <h1>You’re invited</h1>
        <p className="beta-lead">
          Invite <code className="beta-code">{code}</code>
          {invite?.email ? (
            <>
              {' '}
              reserved for <strong>{invite.email}</strong>
            </>
          ) : invite === undefined ? null : (
            <> — enter the email you’ll use to sign in.</>
          )}
        </p>

        {invite === undefined && <p className="beta-muted">Checking your invite…</p>}
        {invite === null && (
          <div className="beta-banner beta-banner--error">
            {error ?? 'This invite code was not found.'}
          </div>
        )}
        {invite && expired && (
          <div className="beta-banner beta-banner--error">This invite has expired.</div>
        )}
        {invite && used && step === 'redeem' && (
          <div className="beta-banner">This invite was already redeemed. Try logging in.</div>
        )}

        {invite && !expired && step === 'redeem' && !used && (
          <form className="beta-form" onSubmit={handleRedeem}>
            <label className="beta-label" htmlFor="invite-email">
              Email
            </label>
            <input
              id="invite-email"
              className="login-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              required
              readOnly={Boolean(invite.email)}
            />
            {error && <p className="beta-error">{error}</p>}
            <button
              type="submit"
              className="btn-cta"
              disabled={busy !== null}
              style={{ width: '100%' }}
            >
              {busy === 'redeem' ? 'Checking…' : 'Accept invite'}
            </button>
          </form>
        )}

        {step === 'signin' && (
          <div className="beta-form">
            <p className="beta-muted">Invite accepted for {email}. Finish signing in.</p>
            <button
              type="button"
              className="btn-google"
              onClick={handleGoogle}
              disabled={busy !== null}
            >
              <span className="g-icon">G</span>{' '}
              {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <div className="login-divider" />
            <button
              type="button"
              className="btn-continue"
              onClick={handleSendCode}
              disabled={busy !== null}
            >
              {busy === 'code' ? 'Sending…' : codeSent ? 'Send a new code' : 'Email me a code'}
            </button>
            {codeSent &&
              (demoCode ? (
                <div className="beta-banner">
                  Demo only — the code is <strong>{demoCode}</strong>. Nothing is emailed by the
                  local backend.
                </div>
              ) : (
                <p className="beta-muted" role="status">
                  We emailed a 6-digit code to <strong>{email.trim()}</strong>. Enter it below.
                </p>
              ))}
            <form onSubmit={handleVerify} className="beta-otp-row">
              <input
                className="login-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                aria-label="Sign-in code"
              />
              <button type="submit" className="btn-continue" disabled={busy !== null}>
                {busy === 'verify' ? 'Checking…' : 'Verify'}
              </button>
            </form>
            {error && <p className="beta-error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
