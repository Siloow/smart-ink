import { useId } from 'react';
import AdjustmentControl from './AdjustmentControl';
import { DEFAULT_STUDIO, STUDIO_PAPERS, normalizeStudio, type StudioSettings } from './render/studioSettings';
import { BACKGROUNDS, type BackgroundId } from './render/exportPresentation';
import type { BodyRegionId } from './render/bodyRegions';
import './studio-controls.css';

export interface StudioControlsProps {
  studio: StudioSettings;
  onStudioChange: (studio: StudioSettings) => void;
  isolateRegion: BodyRegionId | null;
  background?: BackgroundId;
  onBackgroundChange?: (background: BackgroundId) => void;
}

const BACKGROUND_LABELS: Record<BackgroundId, string> = { white: 'White', dark: 'Charcoal', gray: 'Gray', bluepurple: 'Sunset', peach: 'Peach' };

export default function StudioControls({ studio, onStudioChange, isolateRegion, background = 'white', onBackgroundChange }: StudioControlsProps) {
  const id = useId();
  const update = (change: Partial<StudioSettings>) => onStudioChange(normalizeStudio({ ...studio, ...change }));
  return <details className="ep-section ep-details studio-controls" open>
    <summary><span className="ep-section-label">Backdrop</span><span className="ep-details-summary">{studio.mode === 'sweep' ? STUDIO_PAPERS.find(paper => paper.color === studio.color)?.name ?? 'Custom paper' : BACKGROUND_LABELS[background]}</span></summary>
    <p className="ep-hint">Set the scene around your figure.</p>
    <div className="ep-pill-row studio-mode">
      <button type="button" className="ep-pill" aria-pressed={studio.mode === 'sweep'} onClick={() => update({ mode: 'sweep' })}>Studio sweep</button>
      <button type="button" className="ep-pill" aria-pressed={studio.mode === 'plain'} onClick={() => update({ mode: 'plain' })}>Simple background</button>
    </div>
    {studio.mode === 'sweep' ? <>
      <div className="studio-papers" role="group" aria-label="Backdrop paper">
        {STUDIO_PAPERS.map(paper => <button type="button" className="studio-paper" key={paper.color}
          aria-pressed={studio.color === paper.color} aria-label={`${paper.name} backdrop`} onClick={() => update({ color: paper.color })}>
          <span className="studio-paper-preview" style={{ backgroundColor: paper.color }}><span /></span>
          <span>{paper.name}</span>
        </button>)}
      </div>
      <label className="studio-setting" htmlFor={`${id}-color`}><span>Custom paper</span><input id={`${id}-color`} type="color" value={studio.color} onChange={e => update({ color: e.target.value })} /></label>
      <AdjustmentControl label="Ground shadow" value={studio.shadow * 100} min={0} max={100} step={5} unit="%" resetValue={DEFAULT_STUDIO.shadow * 100} onChange={value => update({ shadow: value / 100 })} />
      <p className="ep-hint studio-note">{isolateRegion ? 'Focus keeps your backdrop color and hides the floor.' : 'The paper curves into the floor and follows your viewing angle. Ground shadows are hidden in fast mode.'}</p>
    </> : onBackgroundChange ? <>
      <div className="studio-papers studio-backgrounds" role="group" aria-label="Simple background">
        {(Object.keys(BACKGROUNDS) as BackgroundId[]).map(key => <button type="button" className="studio-paper" key={key}
          aria-pressed={background === key} aria-label={`${BACKGROUND_LABELS[key]} background`} onClick={() => onBackgroundChange(key)}>
          <span className="studio-paper-preview studio-background-preview" style={{ background: BACKGROUNDS[key].css }} />
          <span>{BACKGROUND_LABELS[key]}</span>
        </button>)}
      </div>
      {BACKGROUNDS[background].stops.length > 1 && <p className="ep-hint studio-note">This gradient is included in canvas images and Blender renders.</p>}
    </> : <p className="ep-hint studio-note">{BACKGROUND_LABELS[background]} background.</p>}
    <button type="button" className="ep-btn ep-btn--ghost ep-btn--block" onClick={() => onStudioChange({ ...DEFAULT_STUDIO, showGuides: studio.showGuides })}>Reset backdrop</button>
  </details>;
}
