import { useId } from 'react';
import {
  BOTTOM_OPTIONS, CLOTHING_COLORS, HAIR_OPTIONS, HAIR_TONES, TOP_OPTIONS,
  DEFAULT_BODY_APPEARANCE, normalizeAppearance, type BodyAppearance,
} from './render/bodyAppearance';
import type { BodyRegionId } from './render/bodyRegions';

export interface AppearanceControlsProps {
  bodyAppearance: BodyAppearance;
  onAppearanceChange: (appearance: BodyAppearance) => void;
  isolateRegion: BodyRegionId | null;
}

export default function AppearanceControls({ bodyAppearance, onAppearanceChange, isolateRegion }: AppearanceControlsProps) {
  const id = useId();
  const update = (next: Partial<BodyAppearance>) => onAppearanceChange(normalizeAppearance({ ...bodyAppearance, ...next }));
  const clothingColors = (key: 'topColor' | 'bottomColor', label: string) => (
    <div className="appearance-swatches" role="group" aria-label={`${label} color`}>
      {CLOTHING_COLORS.map((color) => <button key={color.value} type="button" className="appearance-swatch"
        style={{ backgroundColor: color.value }} aria-label={`${label}: ${color.label}`} title={color.label}
        aria-pressed={bodyAppearance[key] === color.value} onClick={() => update({ [key]: color.value })} />)}
    </div>
  );
  const outfit = bodyAppearance.top === 'tshirt' && bodyAppearance.bottom === 'trousers' ? 'Casual'
    : bodyAppearance.top === 'none' && bodyAppearance.bottom === 'none' ? 'No clothes'
    : [TOP_OPTIONS.find(option => option.id === bodyAppearance.top)?.label, BOTTOM_OPTIONS.find(option => option.id === bodyAppearance.bottom)?.label].filter(label => label && label !== 'None').join(' + ');
  const hair = HAIR_OPTIONS.find(option => option.id === bodyAppearance.hairStyle)?.label ?? 'No hair';
  return <details className="ep-section ep-details appearance-section">
    <summary><span className="ep-section-label">Clothes &amp; hair</span><span className="ep-details-summary">{outfit} · {hair}</span></summary>
    <div className="appearance-presets ep-pill-row">
      <button type="button" className="ep-pill" aria-pressed={bodyAppearance.top === 'tshirt' && bodyAppearance.bottom === 'trousers'}
        onClick={() => update({ top: 'tshirt', bottom: 'trousers' })}>Casual</button>
      <button type="button" className="ep-pill" aria-pressed={bodyAppearance.top === 'tshirt' && bodyAppearance.bottom === 'shorts'}
        onClick={() => update({ top: 'tshirt', bottom: 'shorts' })}>T-shirt &amp; shorts</button>
      <button type="button" className="ep-pill" aria-pressed={bodyAppearance.top === 'none' && bodyAppearance.bottom === 'none'}
        onClick={() => update({ top: 'none', bottom: 'none' })}>No clothes</button>
    </div>
    <div className="appearance-field">
      <label className="ep-field-label" htmlFor={`${id}-top`}>Top</label>
      <select id={`${id}-top`} className="ep-select" value={bodyAppearance.top}
        onChange={(event) => update({ top: event.target.value as BodyAppearance['top'] })}>
        {TOP_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {bodyAppearance.top !== 'none' && clothingColors('topColor', 'Top')}
    </div>
    <div className="appearance-field">
      <label className="ep-field-label" htmlFor={`${id}-bottom`}>Bottoms</label>
      <select id={`${id}-bottom`} className="ep-select" value={bodyAppearance.bottom}
        onChange={(event) => update({ bottom: event.target.value as BodyAppearance['bottom'] })}>
        {BOTTOM_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {bodyAppearance.bottom !== 'none' && clothingColors('bottomColor', 'Bottoms')}
    </div>
    <div className="appearance-field">
      <label className="ep-field-label" htmlFor={`${id}-hair`}>Hair</label>
      <select id={`${id}-hair`} className="ep-select" value={bodyAppearance.hairStyle}
        onChange={(event) => update({ hairStyle: event.target.value as BodyAppearance['hairStyle'] })}>
        {HAIR_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {bodyAppearance.hairStyle !== 'none' && <div className="appearance-swatches" role="group" aria-label="Hair color">
        {HAIR_TONES.map((tone) => <button key={tone.id} type="button" className="appearance-swatch"
          style={{ backgroundColor: tone.color }} aria-label={`Hair: ${tone.label}`} title={tone.label}
          aria-pressed={bodyAppearance.hairTone === tone.id} onClick={() => update({ hairTone: tone.id })} />)}
      </div>}
    </div>
    <p className="ep-hint appearance-hint">{isolateRegion
      ? 'Clothes are hidden in Focus so you can reach the skin. Return to Full figure to see your outfit.'
      : 'Place tattoos on exposed skin. Use Focus or remove a garment to reach a covered area.'}</p>
    <button type="button" className="ep-btn ep-btn--block ep-btn--ghost"
      onClick={() => onAppearanceChange({ ...DEFAULT_BODY_APPEARANCE })}>Reset appearance</button>
  </details>;
}
