import { useState } from 'react';

/** Final transparent Blender render with refined skin detail. */
const FEATURED_RENDER = {
  src: '/renders/hero-arm-cinematic-detail.webp',
  alt: 'An ornamental eye tattoo on the inner forearm, with an open palm, detailed skin and cinematic studio lighting.',
  caption: 'Rendered in Blender Cycles',
};

export default function RenderShowcase() {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const ready = state === 'ready';

  return (
    <section className="section render-showcase" id="render" aria-labelledby="render-title" data-orientation={orientation}>
      <header className="render-showcase-intro">
        <p className="section-eyebrow">The finished image</p>
        <h2 id="render-title">Your artwork.<br /><span>In its best light.</span></h2>
        <p className="render-showcase-description">
          Every line follows the body. Light brings out the form.
          Give your client a picture of the idea you see.
        </p>
        <a className="render-story-link" href="#why">Made for the way you work <span aria-hidden="true">↓</span></a>
      </header>

      <figure className="render-showcase-figure">
        <div className={`render-showcase-stage${ready ? ' render-showcase-stage--ready' : ''}`}>
          {state !== 'unavailable' && (
            <img
              src={FEATURED_RENDER.src}
              alt={FEATURED_RENDER.alt}
              className="render-showcase-image"
              width={2400}
              height={2040}
              loading="lazy"
              decoding="async"
              onLoad={(event) => {
                const image = event.currentTarget;
                setOrientation(image.naturalWidth / image.naturalHeight >= 1.25 ? 'landscape' : 'portrait');
                setState('ready');
              }}
              onError={() => setState('unavailable')}
            />
          )}
          {!ready && (
            <div className="render-showcase-pending">
              <span className="render-study-label">Smart Ink / Studio study</span>
              <p>A closer look.</p>
              <span>The finished image is coming soon.</span>
            </div>
          )}
        </div>
        <figcaption className="render-showcase-caption">
          <span>{ready ? FEATURED_RENDER.caption : 'The studio collection'}</span>
          {ready && <a href={FEATURED_RENDER.src} target="_blank" rel="noreferrer">View full render <span aria-hidden="true">↗</span></a>}
        </figcaption>
      </figure>
      <p className="render-showcase-bridge"><span aria-hidden="true" />From the first conversation to the final presentation.</p>
    </section>
  );
}
