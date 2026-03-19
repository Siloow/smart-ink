import React, { useState } from 'react';
import { FaCheck, FaStar, FaArrowRight } from 'react-icons/fa';

interface PricingTier {
  name: string;
  price: number;
  period: string;
  features: string[];
  popular?: boolean;
  buttonText: string;
}

interface LandingPageProps {
  onNavigateToApp?: () => void;
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Starter',
    price: 9,
    period: 'month',
    features: [
      '5 projects per month',
      'Basic 3D models',
      'Standard export formats',
      'Community support',
      '720p export quality',
    ],
    buttonText: 'Start Free Trial',
  },
  {
    name: 'Professional',
    price: 29,
    period: 'month',
    features: [
      'Unlimited projects',
      'Premium 3D models',
      'All export formats',
      'Priority support',
      '4K export quality',
      'Custom watermarks',
      'Advanced lighting presets',
    ],
    popular: true,
    buttonText: 'Start Free Trial',
  },
  {
    name: 'Enterprise',
    price: 99,
    period: 'month',
    features: [
      'Everything in Professional',
      'Team collaboration',
      'API access',
      'Custom integrations',
      'Dedicated support',
      'White-label options',
      'Advanced analytics',
    ],
    buttonText: 'Contact Sales',
  },
];

const features = [
  {
    icon: '🎨',
    title: 'Advanced decal system',
    description:
      'Apply custom designs and logos to 3D models with precision control over placement, rotation, and scaling.',
  },
  {
    icon: '⚡',
    title: 'Real-time rendering',
    description:
      'Smooth 3D visualization optimized for editing and preview.',
  },
  {
    icon: '📤',
    title: 'Export-ready output',
    description: 'Social, print, and web formats tuned for your workflow.',
  },
  {
    icon: '👥',
    title: 'Professional workflow',
    description: 'Built for designers, marketers, and studios.',
  },
];

const testimonials = [
  {
    name: 'Sarah Chen',
    role: 'Product Designer',
    company: 'TechCorp',
    content:
      'Smart Ink has changed how we present designs. The decal workflow feels instant.',
    rating: 5,
  },
  {
    name: 'Marcus Rodriguez',
    role: 'Marketing Director',
    company: 'BrandFlow',
    content: 'We ship campaign visuals in minutes instead of days.',
    rating: 5,
  },
  {
    name: 'Emily Watson',
    role: 'Content Creator',
    company: 'Creative Studio',
    content: 'Export presets are perfect for every channel.',
    rating: 5,
  },
];

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToApp }) => {
  const [email, setEmail] = useState('');

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Email signup:', email);
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
            <a href="#pricing">Pricing</a>
            <a href="#testimonials">Reviews</a>
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" className="btn-login" onClick={onNavigateToApp}>
            Log in
          </button>
          <button type="button" className="btn-getstarted" onClick={onNavigateToApp}>
            Get started
          </button>
        </div>
      </nav>

      <div className="hero-spline">
        <h1>
          <span>The platform for</span>
          <span>3D tattoo visualization</span>
        </h1>
        <p>
          Smart Ink lets you place designs on realistic models, tune lighting and camera, and export
          production-ready images — in real time.
        </p>
        <button type="button" className="btn-cta" onClick={onNavigateToApp}>
          Open studio — it&apos;s free <span className="arrow">→</span>
        </button>
        <div style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <input
            type="email"
            className="email-input-landing"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email for updates"
          />
          <button type="button" className="btn-create" onClick={handleEmailSubmit}>
            Subscribe
          </button>
        </div>
      </div>

      <div className="viewport-hint">
        <div className="hint-label">
          <span>↻</span> Orbit with drag in the editor
        </div>
      </div>

      <div className="grid-floor" aria-hidden />

      <div className="landing-content" id="features">
        <div className="landing-content-inner">
          <h2 className="landing-section-title">Built for serious workflows</h2>
          <p className="landing-section-sub">
            Decals, lighting presets, camera angles, and exports — in one dark, focused UI.
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

          <h2 className="landing-section-title" id="pricing" style={{ marginTop: 24 }}>
            Simple pricing
          </h2>
          <p className="landing-section-sub">14-day trial on paid plans. Cancel anytime.</p>
          <div className="pricing-grid-landing">
            {pricingTiers.map((tier, index) => (
              <div
                key={index}
                className={`pricing-card-landing${tier.popular ? ' popular' : ''}`}
              >
                {tier.popular && <span className="pricing-badge">Popular</span>}
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 8 }}>{tier.name}</h3>
                  <div>
                    <span style={{ fontSize: '2rem', fontWeight: 700 }}>${tier.price}</span>
                    <span style={{ color: 'var(--text-muted)' }}>/{tier.period}</span>
                  </div>
                </div>
                <ul style={{ listStyle: 'none', marginBottom: 24 }}>
                  {tier.features.map((feature, fi) => (
                    <li
                      key={fi}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 10,
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <FaCheck style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={tier.popular ? 'btn-cta' : 'btn-login'}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() =>
                    tier.name === 'Enterprise' ? undefined : onNavigateToApp?.()
                  }
                >
                  {tier.name === 'Enterprise' ? tier.buttonText : 'Try now'}{' '}
                  {tier.name !== 'Enterprise' && <FaArrowRight style={{ marginLeft: 6 }} />}
                </button>
              </div>
            ))}
          </div>

          <h2 className="landing-section-title" id="testimonials">
            Trusted by creatives
          </h2>
          <p className="landing-section-sub">Real feedback from teams using Smart Ink.</p>
          <div className="feature-grid-landing">
            {testimonials.map((t, i) => (
              <div key={i} className="testimonial-card">
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {[...Array(t.rating)].map((_, j) => (
                    <FaStar key={j} style={{ color: 'var(--accent-orange)' }} />
                  ))}
                </div>
                <p>&ldquo;{t.content}&rdquo;</p>
                <div>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {t.role} · {t.company}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <h2 className="landing-section-title">Ready to try?</h2>
            <p className="landing-section-sub">Jump into the editor or explore scenes.</p>
            <button type="button" className="btn-cta" onClick={onNavigateToApp}>
              Open Smart Ink <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </div>

      <footer className="landing-footer">
        <div
          style={{
            maxWidth: 80 * 16,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 32,
          }}
        >
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>Smart Ink</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              3D visualization for tattoo and body art pros.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>
              Product
            </h4>
            <ul style={{ listStyle: 'none', fontSize: '0.88rem' }}>
              <li style={{ marginBottom: 8 }}>
                <a href="#features">Features</a>
              </li>
              <li style={{ marginBottom: 8 }}>
                <a href="#pricing">Pricing</a>
              </li>
            </ul>
          </div>
          <div>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>
              Legal
            </h4>
            <ul style={{ listStyle: 'none', fontSize: '0.88rem' }}>
              <li style={{ marginBottom: 8 }}>
                <a href="#">Privacy</a>
              </li>
              <li style={{ marginBottom: 8 }}>
                <a href="#">Terms</a>
              </li>
            </ul>
          </div>
        </div>
        <p style={{ textAlign: 'center', marginTop: 40, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          © {new Date().getFullYear()} Smart Ink. All rights reserved.
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
