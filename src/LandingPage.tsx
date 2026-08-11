import React, { useState, type FormEvent } from 'react';
import { requestBetaAccess } from './auth/betaAuthService';

interface LandingPageProps {
  onNavigateToLogin: () => void;
  onOpenAdmin: () => void;
}

const features = [
  {
    icon: '🎨',
    title: 'UV tattoo placement',
    description: 'Upload PNG artwork and project it onto a realistic 3D body mesh with precise control.',
  },
  {
    icon: '⚡',
    title: 'Real-time preview',
    description: 'Three.js mood board for fast iteration — orbit, tune lighting, and frame the shot.',
  },
  {
    icon: '📤',
    title: 'Blender Cycles render',
    description: 'Export scene intent and upgrade fidelity with the same contract the production server uses.',
  },
  {
    icon: '✦',
    title: 'Invite-only beta',
    description: 'Limited seats while we harden the studio pipeline. Request access — we’ll send an invite.',
  },
];

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToLogin, onOpenAdmin }) => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'ok' | 'already' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handleRequest = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus('idle');
    setMessage('');
    try {
      const result = requestBetaAccess(email);
      if (result.already) {
        if (result.entry.status === 'active' || result.entry.status === 'invited') {
          setStatus('already');
          setMessage('You already have access — log in with that email.');
        } else {
          setStatus('already');
          setMessage('You’re already on the list. We’ll reach out when a seat opens.');
        }
      } else {
        setStatus('ok');
        setMessage('You’re on the private list. We’ll send an invite when a spot opens.');
        setEmail('');
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Could not join the waitlist.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="floating-shapes-spline" aria-hidden>
        <div className="shape-spline shape-spline-1" />
        <div className="shape-spline shape-spline-2" />
        <div className="shape-spline shape-spline-3" />
        <div className="shape-spline shape-spline-4" />
        <div className="shape-spline shape-spline-5" />
      </div>

      <nav className="landing-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div className="nav-logo" aria-hidden />
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#request">Request access</a>
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" className="btn-login" onClick={onNavigateToLogin}>
            Log in
          </button>
          <button
            type="button"
            className="btn-getstarted"
            onClick={() => document.getElementById('request')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Request access
          </button>
        </div>
      </nav>

      <div className="hero-spline">
        <p className="beta-hero-badge">Private beta · Invite only</p>
        <h1>
          <span>Preview &amp; render</span>
          <span>tattoos in 3D</span>
        </h1>
        <p>
          Smart Ink is opening a limited studio beta: place designs on a body mesh in the browser, then
          send the same export to Blender Cycles.
        </p>
        <button
          type="button"
          className="btn-cta"
          onClick={() => document.getElementById('request')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Request beta access <span className="arrow">→</span>
        </button>
      </div>

      <div className="grid-floor" aria-hidden />

      <div className="landing-content" id="features">
        <div className="landing-content-inner">
          <h2 className="landing-section-title">A quieter way in</h2>
          <p className="landing-section-sub">
            See the craft first. If it fits your workflow, ask for a seat — we approve invites by hand.
          </p>
          <div className="feature-grid-landing">
            {features.map((f, i) => (
              <div key={i} className="feature-card-landing">
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
              </div>
            ))}
          </div>

          <div className="beta-request-block" id="request">
            <h2 className="landing-section-title">Request beta access</h2>
            <p className="landing-section-sub">
              Leave your email. If we have a seat, you’ll get a personal invite link — no open signup.
            </p>
            <form className="beta-request-form" onSubmit={handleRequest}>
              <input
                className="login-input"
                type="email"
                required
                autoComplete="email"
                placeholder="you@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email for beta access"
              />
              <button type="submit" className="btn-cta" disabled={busy}>
                {busy ? 'Sending…' : 'Join the list'}
              </button>
            </form>
            {message && (
              <p
                className={
                  status === 'error' ? 'beta-error' : status === 'ok' ? 'beta-success' : 'beta-muted'
                }
                style={{ marginTop: 16 }}
              >
                {message}
              </p>
            )}
            <p className="beta-muted" style={{ marginTop: 20 }}>
              Already invited?{' '}
              <button type="button" className="beta-inline-link" onClick={onNavigateToLogin}>
                Log in
              </button>
            </p>
          </div>
        </div>
      </div>

      <footer className="landing-footer">
        <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          © {new Date().getFullYear()} Smart Ink · Private beta
          {' · '}
          <button type="button" className="beta-inline-link" onClick={onOpenAdmin}>
            Operator
          </button>
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
