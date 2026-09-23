import { lazy, Suspense, useState } from 'react';
import './hero-showcase.css';

const HeroPreview = lazy(() => import('./HeroPreview'));

/** The homepage opens on a real Cycles render; the live placement demo stays available. */
export default function HeroShowcase() {
  const [interactive, setInteractive] = useState(false);
  const photograph = (
    <img className="hero-render-image" src="/renders/hero-arm-cinematic-detail.webp"
      alt="Cinematic Blender render of an ornamental eye tattoo on the inner forearm, with the full open palm facing outward."
      width={2400} height={2040} fetchPriority="high" decoding="async" />
  );
  return (
    <div className="hero-showcase">
      {interactive ? <Suspense fallback={photograph}><HeroPreview /></Suspense> : photograph}
      {!interactive && <p className="hero-render-caption">Actual Blender Cycles render</p>}
      <div className="hero-showcase-switch" role="group" aria-label="Hero view">
        <button type="button" aria-pressed={!interactive} onClick={() => setInteractive(false)}>Studio render</button>
        <button type="button" aria-pressed={interactive} onClick={() => setInteractive(true)}>Try it live <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  );
}
