import { useMemo, useState, type FormEvent } from 'react';
import {
  DEMO_EMAIL_CODE,
  getInvite,
  redeemInvite,
  requestEmailCode,
  signInWithGoogle,
  verifyEmailCode,
} from './auth/betaAuthService';
import type { BetaSession } from './auth/types';

export interface InvitePageProps {
  code: string;
  onBack: () => void;
  onAuthenticated: (session: BetaSession) => void;
}

type Step = 'redeem' | 'signin';

export default function InvitePage({ code, onBack, onAuthenticated }: InvitePageProps) {
  const invite = useMemo(() => getInvite(code), [code]);
  const [email, setEmail] = useState(invite?.email ?? '');
  const [step, setStep] = useState<Step>('redeem');
  const [otp, setOtp] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expired = invite ? Date.now() > invite.expiresAt : false;
  const used = Boolean(invite?.redeemedAt);

  const handleRedeem = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      redeemInvite(code, email);
      setStep('signin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not redeem invite.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = () => {
    setError(null);
    try {
      const session = signInWithGoogle(email);
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleSendCode = () => {
    setError(null);
    try {
      const result = requestEmailCode(email);
      setDemoCode(result.demoCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code.');
    }
  };

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const session = verifyEmailCode(email, otp);
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code.');
    }
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
          ) : (
            <> — enter the email you’ll use to sign in.</>
          )}
        </p>

        {!invite && (
          <div className="beta-banner beta-banner--error">This invite code was not found.</div>
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
            <button type="submit" className="btn-cta" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Checking…' : 'Accept invite'}
            </button>
          </form>
        )}

        {step === 'signin' && (
          <div className="beta-form">
            <p className="beta-muted">Invite accepted for {email}. Finish signing in.</p>
            <button type="button" className="btn-google" onClick={handleGoogle}>
              <span className="g-icon">G</span> Continue with Google
            </button>
            <div className="login-divider" />
            <button type="button" className="btn-continue" onClick={handleSendCode}>
              Email me a code
            </button>
            {demoCode && (
              <div className="beta-banner">
                Demo only — your code is <strong>{DEMO_EMAIL_CODE}</strong> (no email sent yet).
              </div>
            )}
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
              <button type="submit" className="btn-continue">
                Verify
              </button>
            </form>
            {error && <p className="beta-error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
