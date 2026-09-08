import type { ReactNode } from 'react';
import { REGISTRY } from './render/registry';
import {
  BODY_SHAPE_PARAMS,
  BODY_SHAPE_PRESETS,
  DEFAULT_BODY_SHAPE,
  formatShapeValue,
  isDefaultShape,
  isPresetActive,
  shapeFromPreset,
  type BodyShape,
  type BodyShapeKey,
} from './render/bodyShape';
import { BODY_REGIONS, SHAPE_PANEL_GROUPS, type BodyRegionId } from './render/bodyRegions';

export interface CharacterBuilderSectionsProps {
  skinToneId: string;
  lookId: string;
  onSkinChange: (id: string) => void;
  onLookChange: (id: string) => void;
  bodyShape: BodyShape;
  onBodyShapeChange: (shape: BodyShape) => void;
  /** Body part cut out in the viewport, or null for the whole figure. */
  isolateRegion: BodyRegionId | null;
  onIsolateRegionChange: (region: BodyRegionId | null) => void;
  /** Tints matching regions in the viewport while a control is hovered. */
  onHighlightRegions: (regions: BodyRegionId[]) => void;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="ep-section">
      <p className="ep-section-label">{label}</p>
      {children}
    </section>
  );
}

const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none';
};

const PARAM_BY_KEY = new Map(BODY_SHAPE_PARAMS.map((p) => [p.key, p]));

/** Track filled from the centre out, so a bipolar value reads at a glance. */
function trackStyle(value: number): React.CSSProperties {
  const pct = ((value + 1) / 2) * 100;
  const lo = Math.min(50, pct);
  const hi = Math.max(50, pct);
  return {
    background: `linear-gradient(90deg,
      var(--shape-track) 0%, var(--shape-track) ${lo}%,
      var(--shape-fill) ${lo}%, var(--shape-fill) ${hi}%,
      var(--shape-track) ${hi}%, var(--shape-track) 100%)`,
  };
}

export default function CharacterBuilderSections({
  skinToneId,
  lookId,
  onSkinChange,
  onLookChange,
  bodyShape,
  onBodyShapeChange,
  isolateRegion,
  onIsolateRegionChange,
  onHighlightRegions,
}: CharacterBuilderSectionsProps) {
  const setShapeValue = (key: BodyShapeKey, value: number) =>
    onBodyShapeChange({ ...bodyShape, [key]: value });

  return (
    <>
      <Section label="Focus">
        <div className="region-grid">
          <button
            type="button"
            className="region-chip"
            aria-pressed={isolateRegion === null}
            onClick={() => onIsolateRegionChange(null)}
            onMouseEnter={() => onHighlightRegions([])}
            onMouseLeave={() => onHighlightRegions([])}
          >
            Full figure
          </button>
          {BODY_REGIONS.map((region) => (
            <button
              key={region.id}
              type="button"
              className="region-chip"
              aria-pressed={isolateRegion === region.id}
              onClick={() =>
                onIsolateRegionChange(isolateRegion === region.id ? null : region.id)
              }
              onMouseEnter={() => onHighlightRegions([region.id])}
              onMouseLeave={() => onHighlightRegions([])}
            >
              {region.label}
            </button>
          ))}
        </div>
        <p className="ep-hint" style={{ marginTop: 8 }}>
          Cuts the rest of the figure away and frames what is left. Right-click any part in the
          viewport to shape it.
        </p>
      </Section>

      <Section label="Skin tone">
        <div className="cb-swatch-row">
          {REGISTRY.skinTones.map((s) => {
            const selected = s.id === skinToneId;
            return (
              <button
                key={s.id}
                type="button"
                className="cb-swatch-wrap"
                aria-pressed={selected}
                title={s.label}
                onClick={() => onSkinChange(s.id)}
              >
                <span
                  className={`cb-swatch${selected ? ' selected' : ''}`}
                  style={{ background: s.swatch }}
                />
                <span className="cb-swatch-label">{s.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Body shape">
        <div className="ep-pill-row shape-presets">
          {BODY_SHAPE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="ep-pill"
              aria-pressed={isPresetActive(bodyShape, preset)}
              onClick={() => onBodyShapeChange(shapeFromPreset(preset))}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {SHAPE_PANEL_GROUPS.map((group) => (
          <div
            className="shape-group"
            key={group.label}
            onMouseEnter={() => onHighlightRegions(group.regions)}
            onMouseLeave={() => onHighlightRegions([])}
          >
            <p className="shape-group-label">{group.label}</p>
            {group.params.map((key) => {
              const param = PARAM_BY_KEY.get(key);
              if (!param) return null;
              const value = bodyShape[key];
              return (
                <div className="shape-field" key={key}>
                  <div className="shape-field-row">
                    <span className="shape-field-label">{param.label}</span>
                    <button
                      type="button"
                      className="shape-value"
                      title="Reset to 0"
                      onClick={() => setShapeValue(key, 0)}
                    >
                      {formatShapeValue(value)}
                    </button>
                  </div>
                  <input
                    type="range"
                    className="shape-range"
                    style={trackStyle(value)}
                    min={-1}
                    max={1}
                    step={0.02}
                    value={value}
                    onChange={(e) => setShapeValue(key, Number(e.target.value))}
                    onDoubleClick={() => setShapeValue(key, 0)}
                    aria-label={param.label}
                    title={param.hint}
                  />
                </div>
              );
            })}
          </div>
        ))}

        <button
          type="button"
          className="ep-btn ep-btn--block ep-btn--ghost"
          disabled={isDefaultShape(bodyShape)}
          onClick={() => onBodyShapeChange({ ...DEFAULT_BODY_SHAPE })}
        >
          Reset shape
        </button>
      </Section>

      <Section label="Lighting">
        <div className="cb-grid cb-grid-3">
          {REGISTRY.looks.map((l) => {
            const selected = l.id === lookId;
            return (
              <button
                key={l.id}
                type="button"
                className={`cb-card cb-card-sm${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onLookChange(l.id)}
              >
                <span className="cb-thumb">
                  <img src={l.thumbnail} alt="" onError={hideOnError} />
                </span>
                <span className="cb-card-label">{l.label}</span>
                {selected && <span className="cb-check" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
