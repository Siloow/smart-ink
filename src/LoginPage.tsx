import { useState, type FormEvent } from 'react';
import {
  DEMO_EMAIL_CODE,
  requestEmailCode,
  signInWithGoogle,
  verifyEmailCode,
} from './auth/betaAuthService';
import type { BetaSession } from './auth/types';

export interface LoginPageProps {
  onAuthenticated: (session: BetaSession) => void;
  onBackToLanding?: () => void;
  onOpenInvite?: () => void;
}

const showcase = [
  { emoji: '🎮', gradient: 'linear-gradient(135deg,#2a1535,#1a2540)', name: 'Interactive previews', author: '@DesignGabor' },
  { emoji: '🤖', gradient: 'linear-gradient(135deg,#201530,#352040)', name: 'Character meshes', author: '@heyvlad' },
  { emoji: '⚙️', gradient: 'linear-gradient(135deg,#1a2030,#252535)', name: 'Studio workflow', author: '@heyvlad' },
  { emoji: '🏭', gradient: 'linear-gradient(135deg,#1a1a2e,#2a2040)', name: 'Export & share', author: '@elcord' },
];

export default function LoginPage({ onAuthenticated, onBackToLanding, onOpenInvite }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [demoCodeVisible, setDemoCodeVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = () => {
    setError(null);
    try {
      onAuthenticated(signInWithGoogle(email));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in with Google.');
    }
  };

  const handleSendCode = () => {
    setError(null);
    try {
      requestEmailCode(email);
      setDemoCodeVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code.');
    }
  };

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onAuthenticated(verifyEmailCode(email, otp));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code.');
    }
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
          <div className="login-logo" aria-hidden />
          <p className="beta-eyebrow">Members</p>
          <h2>Welcome back</h2>
          <p className="login-subtitle">
            Sign in only if you’ve been invited. New here? Request access from the landing page.
          </p>
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
            aria-label="Email"
          />
          <button type="button" className="btn-google" onClick={handleGoogle}>
            <span className="g-icon">G</span> Continue with Google
          </button>
          <div className="login-divider" />
          <button type="button" className="btn-continue" onClick={handleSendCode}>
            Email me a code
          </button>
          {demoCodeVisible && (
            <div className="beta-banner" style={{ marginTop: 12 }}>
              Demo only — code is <strong>{DEMO_EMAIL_CODE}</strong> (email delivery comes later).
            </div>
          )}
          <form onSubmit={handleVerify} className="beta-otp-row" style={{ marginTop: 12 }}>
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
          <div className="login-footer">
            Have an invite code?{' '}
            {onOpenInvite ? (
              <button type="button" className="beta-inline-link" onClick={onOpenInvite}>
                Enter it here
              </button>
            ) : (
              <span>Open your invite link.</span>
            )}
            <br />
            <a href="#">Privacy</a> · <a href="#">Terms</a>
          </div>
        </div>
      </div>
      <div className="login-right">
        {showcase.map((item, i) => (
          <div key={i} className="showcase-card">
            <div className="showcase-img" style={{ background: item.gradient }}>
              {item.emoji}
            </div>
            <div className="showcase-meta">
              <div className="showcase-icon">✦</div>
              <div className="showcase-info">
                <div className="showcase-name">{item.name}</div>
                <div className="showcase-author">{item.author}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
