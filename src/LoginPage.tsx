export interface LoginPageProps {
  onNavigateToApp: () => void;
  onBackToLanding?: () => void;
}

const showcase = [
  { emoji: '🎮', gradient: 'linear-gradient(135deg,#2a1535,#1a2540)', name: 'Interactive previews', author: '@DesignGabor' },
  { emoji: '🤖', gradient: 'linear-gradient(135deg,#201530,#352040)', name: 'Character meshes', author: '@heyvlad' },
  { emoji: '⚙️', gradient: 'linear-gradient(135deg,#1a2030,#252535)', name: 'Studio workflow', author: '@heyvlad' },
  { emoji: '🏭', gradient: 'linear-gradient(135deg,#1a1a2e,#2a2040)', name: 'Export & share', author: '@elcord' },
];

export default function LoginPage({ onNavigateToApp, onBackToLanding }: LoginPageProps) {
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
          <h2>Welcome to Smart Ink</h2>
          <p className="login-subtitle">Log in or register with your email.</p>
          <button type="button" className="btn-google" onClick={onNavigateToApp}>
            <span className="g-icon">G</span> Continue with Google
          </button>
          <div className="login-divider" />
          <input type="email" className="login-input" placeholder="Email" readOnly aria-label="Email" />
          <button type="button" className="btn-continue" onClick={onNavigateToApp}>
            Continue
          </button>
          <div className="login-footer">
            Demo only — no account required.
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
