import React from 'react';
import { FaArrowRight } from 'react-icons/fa';

interface LandingPageProps {
  onNavigateToApp?: () => void;
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
    icon: '🔷',
    title: 'Render pipeline demo',
    description: 'Landing → login → editor → cloud or local Blender render. No business tooling, just the core path.',
  },
];

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToApp }) => {
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
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" className="btn-login" onClick={onNavigateToApp}>
            Log in
          </button>
          <button type="button" className="btn-getstarted" onClick={onNavigateToApp}>
            Open demo
          </button>
        </div>
      </nav>

      <div className="hero-spline">
        <h1>
          <span>Preview &amp; render</span>
          <span>tattoos in 3D</span>
        </h1>
        <p>
          Smart Ink Render is a slim demo of the production pipeline: place designs on a body mesh in the
          browser, then send the same export to Blender Cycles — locally or in the cloud.
        </p>
        <button type="button" className="btn-cta" onClick={onNavigateToApp}>
          Try the editor <span className="arrow">→</span>
        </button>
      </div>

      <div className="viewport-hint">
        <div className="hint-label">
          <span>↻</span> Orbit with drag in the editor
        </div>
      </div>

      <div className="grid-floor" aria-hidden />

      <div className="landing-content" id="features">
        <div className="landing-content-inner">
          <h2 className="landing-section-title">Render pipeline, distilled</h2>
          <p className="landing-section-sub">
            UV placement, lighting presets, camera angles, JSON export, and Cycles rendering — nothing else.
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

          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <h2 className="landing-section-title">Ready to render?</h2>
            <p className="landing-section-sub">No account required — jump straight into the editor.</p>
            <button type="button" className="btn-cta" onClick={onNavigateToApp}>
              Open Smart Ink Render <FaArrowRight style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      </div>

      <footer className="landing-footer">
        <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          © {new Date().getFullYear()} Smart Ink Render. Demo build — render pipeline only.
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
