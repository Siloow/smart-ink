import React, { useId, useState, type FormEvent, type ReactNode } from 'react';
import { requestBetaAccess } from './auth/betaAuthService';
import {
  CONTACT_EMAIL,
  isWaitlistEndpointConfigured,
  submitWaitlistRequest,
} from './auth/waitlistSubmit';
import { ArtworkFigure, PlacementFigure, RenderFigure } from './landing/PipelineFigures';
import HeroPreview from './landing/HeroPreview';

interface LandingPageProps {
  onNavigateToLogin: () => void;
}

type StepKey = 'artwork' | 'placement' | 'render';

/**
 * Real captures override the drawn figures. Drop files into public/examples/
 * and point the matching key at them, e.g. '/examples/placement.png'.
 */
const EXAMPLE_IMAGES: Record<StepKey, string | null> = {
  artwork: null,
  placement: null,
  render: null,
};

const STEPS: { key: StepKey; index: string; title: string; body: string; figure: ReactNode }[] = [
  {
    key: 'artwork',
    index: '01',
    title: 'Bring your artwork',
    body: 'Drop in a PNG with a transparent background — line work, colour, whatever you already draw in. Nothing to redraw or trace.',
    figure: <ArtworkFigure />,
  },
  {
    key: 'placement',
    index: '02',
    title: 'Place it on the body',
    body: 'Click the mesh to drop the design, then drag to nudge it. Scale, rotation and opacity update live, a safe zone keeps it clear of seams, and you can orbit to check how it reads from every angle.',
    figure: <PlacementFigure />,
  },
  {
    key: 'render',
    index: '03',
    title: 'Render it properly',
    body: 'Choose a body, pose, skin tone and lighting look, then send the exact same scene to Blender Cycles for a client-ready image — or export an Instagram, portfolio or print crop straight from the browser.',
    figure: <RenderFigure />,
  },
];

const VALUE_PROPS = [
  {
    title: 'Settle placement before the needle',
    body: 'Clients see scale, position and flow on a body instead of a design pasted flat over a photo. Fewer surprises on the day, fewer redraws.',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
      </>
    ),
  },
  {
    title: 'The same light every time',
    body: 'Studio softbox, window daylight or dramatic rim, with four skin tones and two poses. One consistent rig, so a portfolio built from it hangs together.',
    icon: (
      <>
        <path d="M12 3.5a6 6 0 0 1 3.4 10.9V17a1 1 0 0 1-1 1h-4.8a1 1 0 0 1-1-1v-2.6A6 6 0 0 1 12 3.5Z" />
        <path d="M10 20.5h4" />
      </>
    ),
  },
  {
    title: 'Two levels of output',
    body: 'A fast browser preview while you iterate, and a full Cycles render when the image has to carry weight. Both come out of the same scene.',
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

    let recorded: ReturnType<typeof requestBetaAccess>;
    try {
      recorded = requestBetaAccess(email);
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not send your request.');
      return;
    }

    if (recorded.already) {
      const hasAccess = recorded.entry.status === 'active' || recorded.entry.status === 'invited';
      setState('already');
      setMessage(
        hasAccess
          ? 'You already have access — log in with that email.'
          : 'You’re already on the list. We’ll be in touch when a seat opens.'
      );
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

const StepFigure: React.FC<{ stepKey: StepKey; title: string; figure: ReactNode }> = ({
  stepKey,
  title,
  figure,
}) => {
  const override = EXAMPLE_IMAGES[stepKey];
  return (
    <div className="step-stage">
      {override ? <img src={override} alt={title} loading="lazy" /> : figure}
    </div>
  );
};

const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToLogin }) => {
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
            href="#how"
            onClick={(e) => {
              e.preventDefault();
              scrollTo('how');
            }}
          >
            How it works
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
            Log in
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

      <section className="section section--how" id="how">
        <header className="section-head">
          <p className="section-eyebrow">How it works</p>
          <h2>Three steps, one scene</h2>
          <p className="section-lead">
            Your design goes in flat and comes out lit on a body. Nothing in between is guesswork.
          </p>
        </header>
        <ol className="step-grid">
          {STEPS.map((step) => (
            <li key={step.key} className="step-card">
              <StepFigure stepKey={step.key} title={step.title} figure={step.figure} />
              <div className="step-body">
                <p className="step-index">{step.index}</p>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section section--why" id="why">
        <header className="section-head">
          <p className="section-eyebrow">Why artists use it</p>
          <h2>Built for the conversation before the session</h2>
        </header>
        <div className="value-grid">
          {VALUE_PROPS.map((item) => (
            <article key={item.title} className="value-card">
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
              Log in
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
