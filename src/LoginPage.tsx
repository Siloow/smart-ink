import { useState, type FormEvent } from 'react';
import {
  authMode,
  DEV_ADMIN_HANDLE,
  isDevAdminHandle,
  requestEmailCode,
  signInAsDevAdmin,
  signInWithGoogle,
  signInWithPassword,
  verifyEmailCode,
} from './auth/betaAuthService';
import type { BetaSession } from './auth/types';

export interface LoginPageProps {
  onAuthenticated: (session: BetaSession) => void;
  onBackToLanding?: () => void;
  onOpenInvite?: () => void;
  /** Shown above the form, e.g. after a Google sign-in for an email without access. */
  notice?: string | null;
}

type Busy = 'google' | 'code' | 'verify' | 'password' | null;

export default function LoginPage({ onAuthenticated, onBackToLanding, onOpenInvite, notice }: LoginPageProps) {
  const mode = authMode();
  const unconfigured = mode === 'unconfigured';
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

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

  /** Dev shortcut (demo backend only): `admin` in the email field signs straight in. */
  const tryDevAdmin = async (): Promise<boolean> => {
    if (mode !== 'demo' || !isDevAdminHandle(email)) return false;
    onAuthenticated(await signInAsDevAdmin());
    return true;
  };

  const handleGoogle = () =>
    run(
      'google',
      async () => {
        if (await tryDevAdmin()) return;
        const session = await signInWithGoogle(email);
        // null means the browser is on its way to Google.
        if (session) onAuthenticated(session);
      },
      'Could not sign in with Google.'
    );

  const handleSendCode = () =>
    run(
      'code',
      async () => {
        if (await tryDevAdmin()) return;
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
        if (await tryDevAdmin()) return;
        onAuthenticated(await verifyEmailCode(email, otp));
      },
      'Could not verify code.'
    );
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-card">
          {onBackToLanding && (
            <button
              type="button"
              className="btn-login"
              style={{ marginBottom: 20, width: '100%' }}
              onClick={onBackToLanding}
            >
              ← Back
            </button>
          )}
          <img className="login-logo" src="/brand-droplet.svg" alt="Smart Ink" width={100} height={120} />
          <p className="beta-eyebrow">Members</p>
          <h2>Welcome back</h2>
          <p className="login-subtitle">
            Sign in only if you’ve been invited. New here? Request access from the landing page.
          </p>

          {notice && (
            <div className="beta-banner beta-banner--error" role="alert" style={{ marginBottom: 12 }}>
              {notice}
            </div>
          )}
          {unconfigured && (
            <div className="beta-banner" style={{ marginBottom: 12 }}>
              Sign-in isn’t set up on this deployment yet. Request access from the landing page and
              we’ll email you when it opens.
            </div>
          )}

          <label className="beta-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="login-input"
            placeholder="you@studio.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={unconfigured}
            aria-label="Email"
          />
          <button
            type="button"
            className="btn-google"
            onClick={handleGoogle}
            disabled={busy !== null || unconfigured}
          >
            <span className="g-icon">G</span>{' '}
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="login-divider" />
          <button
            type="button"
            className="btn-continue"
            onClick={handleSendCode}
            disabled={busy !== null || unconfigured}
          >
            {busy === 'code' ? 'Sending…' : codeSent ? 'Send a new code' : 'Email me a code'}
          </button>

          {mode === 'demo' && (
            <div className="beta-banner" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-continue"
                disabled={busy !== null}
                onClick={() => void run('verify', async () => {
                  onAuthenticated(await signInAsDevAdmin());
                }, 'Could not sign in as local admin.')}
              >
                Sign in as local admin
              </button>
              Or type <strong>{DEV_ADMIN_HANDLE}</strong> in the email field. Local data stays in this browser.
            </div>
          )}
          {codeSent &&
            (demoCode ? (
              <div className="beta-banner" style={{ marginTop: 12 }}>
                Demo only — the code is <strong>{demoCode}</strong>. Nothing is emailed by the
                local backend.
              </div>
            ) : (
              <p className="beta-muted" style={{ marginTop: 12 }} role="status">
                We emailed a 6-digit code to <strong>{email.trim()}</strong>. Enter it below.
              </p>
            ))}

          <form onSubmit={handleVerify} className="beta-otp-row" style={{ marginTop: 12 }}>
            <input
              className="login-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={unconfigured}
              aria-label="Sign-in code"
            />
            <button type="submit" className="btn-continue" disabled={busy !== null || unconfigured}>
              {busy === 'verify' ? 'Checking…' : 'Verify'}
            </button>
          </form>
          {mode === 'supabase' && (
            <details style={{ marginTop: 20 }}>
              <summary className="beta-inline-link" style={{ cursor: 'pointer' }}>Sign in with a password</summary>
              <form style={{ marginTop: 12 }} onSubmit={(event) => {
                event.preventDefault();
                void run('password', async () => {
                  try { onAuthenticated(await signInWithPassword(email, password)); }
                  finally { setPassword(''); }
                }, 'Could not sign in.');
              }}>
                <label className="beta-label" htmlFor="login-password">Password</label>
                <input id="login-password" className="login-input" type="password"
                  autoComplete="current-password" value={password} required
                  onChange={(event) => setPassword(event.target.value)} disabled={busy !== null} />
                <button type="submit" className="btn-continue" disabled={busy !== null || !email.trim() || !password}>
                  {busy === 'password' ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </details>
          )}
          {error && <p className="beta-error" role="alert">{error}</p>}

          <div className="login-footer">
            Have an invite code?{' '}
            {onOpenInvite ? (
              <button type="button" className="beta-inline-link" onClick={onOpenInvite}>
                Enter it here
              </button>
            ) : (
              <span>Open your invite link.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
