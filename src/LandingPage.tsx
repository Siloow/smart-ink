import React, { useId, useState, type FormEvent } from 'react';
import { authMode, requestBetaAccess } from './auth/betaAuthService';
import type { RequestAccessResult } from './auth/types';
import {
  CONTACT_EMAIL,
  isWaitlistEndpointConfigured,
  submitWaitlistRequest,
} from './auth/waitlistSubmit';
import HeroPreview from './landing/HeroPreview';
import RenderShowcase from './landing/RenderShowcase';
import './landing/render-story.css';

interface LandingPageProps {
  onNavigateToLogin: () => void;
  signedIn?: boolean;
}

const ARTIST_BENEFITS = [
  {
    category: 'Placement',
    title: 'Get on the same page.',
    body: 'Show your client the scale and position on a body. Explore the options together, with a clear picture of what each change means.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
      </>
    ),
  },
  {
    category: 'Flow',
    title: 'See how the design belongs.',
    body: 'Follow the curve of an arm, check the silhouette, and turn the body to see another angle. Refine the placement while the idea is still taking shape.',
    icon: (
      <>
        <path d="M12 3.5a6 6 0 0 1 3.4 10.9V17a1 1 0 0 1-1 1h-4.8a1 1 0 0 1-1-1v-2.6A6 6 0 0 1 12 3.5Z" />
        <path d="M10 20.5h4" />
      </>
    ),
  },
  {
    category: 'Presentation',
    title: 'Give your work the right light.',
    body: 'Choose the lighting, frame the details, and render an image to share. Bring the same considered look to client proposals and portfolio concepts.',
    icon: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="M3.5 15l4.2-3.6 3.4 2.9 3.2-4.1 6.2 6" />
      </>
    ),
  },
];

const FACTS = ['Runs in the browser', 'Blender Cycles output', 'Invites approved by hand'];

type SubmitState = 'idle' | 'sending' | 'joined' | 'already' | 'undelivered' | 'error';

const RequestAccessForm: React.FC<{ source: string; buttonLabel: string }> = ({
  source,
  buttonLabel,
}) => {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');
  const inputId = useId();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'sending') return;

    setState('sending');
    setMessage('');

    let recorded: RequestAccessResult;
    try {
      recorded = await requestBetaAccess(email, { source, referrer: document.referrer });
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not send your request.');
      return;
    }

    if (recorded.already) {
      const hasAccess = recorded.status === 'active' || recorded.status === 'invited';
      setState('already');
      setMessage(
        hasAccess
          ? 'You already have access — log in with that email.'
          : 'You’re already on the list. We’ll be in touch when a seat opens.'
      );
      return;
    }

    // With the hosted backend the request is already in the database.
    if (authMode() === 'supabase') {
      setState('joined');
      setMessage('You’re on the list. We’ll email an invite when a seat opens.');
      setEmail('');
      return;
    }

    if (!isWaitlistEndpointConfigured()) {
      console.warn(
        '[Smart Ink] VITE_WAITLIST_ENDPOINT is not set — this beta request was only stored in this browser and will not reach you. See .env.example.'
      );
      setState('joined');
      setMessage('You’re on the list. We’ll email an invite when a seat opens.');
      setEmail('');
      return;
    }

    try {
      await submitWaitlistRequest({ email, source, referrer: document.referrer });
      setState('joined');
      setMessage('You’re on the list. We’ll email an invite when a seat opens.');
      setEmail('');
    } catch (err) {
      console.error('[Smart Ink] Waitlist delivery failed:', err);
      setState('undelivered');
      setMessage(
        CONTACT_EMAIL
          ? `We couldn’t reach our server just now. Email ${CONTACT_EMAIL} and we’ll add you by hand.`
          : 'We couldn’t reach our server just now. Please try again in a moment.'
      );
    }
  };

  const tone =
    state === 'error' || state === 'undelivered'
      ? 'request-note request-note--warn'
      : state === 'joined'
        ? 'request-note request-note--ok'
        : 'request-note';

  return (
    <div className="request-block">
      <form className="request-form" onSubmit={handleSubmit} noValidate>
        <label className="request-form-label" htmlFor={inputId}>
          Email address
        </label>
        <input
          id={inputId}
          className="request-input"
          type="email"
          required
          autoComplete="email"
          placeholder="you@studio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : buttonLabel}
        </button>
      </form>
      <p className={message ? tone : 'request-note'} role={message ? 'status' : undefined}>
        {message || 'One email when a seat opens. No newsletter, no sharing your address.'}
      </p>
    </div>
  );
};

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToLogin, signedIn = false }) => {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />

      <header className="landing-nav">
        <a
          className="landing-brand"
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="landing-mark" aria-hidden />
          Smart Ink
        </a>
        <nav className="landing-nav-links">
          <a
            href="#render"
            onClick={(e) => {
              e.preventDefault();
              scrollTo('render');
            }}
          >
            The finished image
          </a>
          <a
            href="#why"
            onClick={(e) => {
              e.preventDefault();
              scrollTo('why');
            }}
          >
            Why artists use it
          </a>
        </nav>
        <div className="landing-nav-actions">
          <button type="button" className="btn-quiet" onClick={onNavigateToLogin}>
            {signedIn ? 'My Projects' : 'Log in'}
          </button>
          <button type="button" className="btn-primary btn-primary--sm" onClick={() => scrollTo('request')}>
            Request access
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-badge">Private beta · invite only</p>
          <h1>
            Show the tattoo
            <br />
            before you ink it.
          </h1>
          <p className="hero-lead">
            Smart Ink wraps your artwork onto a 3D body, so you and your client agree on placement,
            scale and flow before the first line goes in — then renders the result properly in
            Blender Cycles.
          </p>
          <RequestAccessForm source="hero" buttonLabel="Request an invite" />
          <ul className="hero-facts">
            {FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
        <div className="hero-figure">
          <HeroPreview />
        </div>
      </section>

      <RenderShowcase />

      <section className="section section--why" id="why" aria-labelledby="artists-title">
        <header className="section-head">
          <p className="section-eyebrow">Why artists use it</p>
          <h2 id="artists-title">Make the next decision a visual one.</h2>
          <p className="section-lead">
            More room to explore your ideas. A clearer way to share them.
          </p>
        </header>
        <div className="value-grid">
          {ARTIST_BENEFITS.map((item) => (
            <article key={item.category} className="value-card">
              <svg
                className="value-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {item.icon}
              </svg>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--request" id="request">
        <div className="request-panel">
          <p className="section-eyebrow">Request access</p>
          <h2>We’re letting studios in a few at a time</h2>
          <p className="section-lead">
            Leave your email and we’ll send a personal invite link when a seat opens. There’s no open
            signup — we read every request, and we’d rather have a handful of artists telling us what
            breaks than a queue we can’t support.
          </p>
          <RequestAccessForm source="request-section" buttonLabel="Request an invite" />
          <p className="request-login">
            Already invited?{' '}
            <button type="button" className="link-button" onClick={onNavigateToLogin}>
              {signedIn ? 'My Projects' : 'Log in'}
            </button>
          </p>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="landing-mark landing-mark--sm" aria-hidden />
        <p>© {new Date().getFullYear()} Smart Ink · Private beta</p>
      </footer>
    </div>
  );
};

export default LandingPage;
