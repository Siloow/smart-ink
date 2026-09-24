import { useId, type ReactNode } from 'react';
import { REGISTRY } from './render/registry';
import {
  BODY_SHAPE_PARAMS,
  BODY_SHAPE_LIMITS,
  BODY_SHAPE_PRESETS,
  DEFAULT_BODY_SHAPE,
  clampShapeValue,
  isDefaultShape,
  isPresetActive,
  shapeFromPreset,
  type BodyShape,
  type BodyShapeKey,
} from './render/bodyShape';
import AdjustmentControl from './AdjustmentControl';
import { SHAPE_PANEL_GROUPS, type BodyRegionId } from './render/bodyRegions';

export interface CharacterBuilderSectionsProps {
  shapeDisabled?: boolean;
  skinToneId: string;
  lookId: string;
  onSkinChange: (id: string) => void;
  onLookChange: (id: string) => void;
  bodyShape: BodyShape;
  onBodyShapeChange: (shape: BodyShape) => void;
  /** Body part cut out in the viewport, or null for the whole figure. */
  isolateRegion: BodyRegionId | null;
  onIsolateRegionChange: (region: BodyRegionId | null) => void;
  onFrameFocus?: () => void;
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

const PARAM_BY_KEY = new Map(BODY_SHAPE_PARAMS.map((p) => [p.key, p]));

/** Fill from the original shape, even when a control has unequal limits. */
function trackStyle(key: BodyShapeKey, value: number): React.CSSProperties {
  const { min, max } = BODY_SHAPE_LIMITS[key];
  const span = max - min;
  const pct = ((clampShapeValue(key, value) - min) / span) * 100;
  const zero = ((clampShapeValue(key, 0) - min) / span) * 100;
  const lo = Math.min(zero, pct);
  const hi = Math.max(zero, pct);
  return {
    background: `linear-gradient(90deg,
      var(--shape-track) 0%, var(--shape-track) ${lo}%,
      var(--shape-fill) ${lo}%, var(--shape-fill) ${hi}%,
      var(--shape-track) ${hi}%, var(--shape-track) 100%)`,
  };
}

export default function CharacterBuilderSections({
  skinToneId,
  shapeDisabled = false,
  onSkinChange,
  bodyShape,
  onBodyShapeChange,
  onHighlightRegions,
}: CharacterBuilderSectionsProps) {
  const shapeHelpId = useId();
  const setShapeValue = (key: BodyShapeKey, value: number) =>
    onBodyShapeChange({ ...bodyShape, [key]: clampShapeValue(key, value) });

  return (
    <>
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

      <div inert={shapeDisabled} style={shapeDisabled ? { opacity: .45 } : undefined}><Section label="Body shape">
        <p className="ep-hint shape-help" id={shapeHelpId}>
          Choose a starting shape, then fine-tune it. Zero is the original shape.
        </p>
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

        <details className="ep-details shape-adjustments">
          <summary><span>Fine-tune shape</span><span className="ep-details-summary">{BODY_SHAPE_PRESETS.find(preset => isPresetActive(bodyShape, preset))?.label ?? 'Custom shape'}</span></summary>
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
              const value = clampShapeValue(key, bodyShape[key]);
              const { min, max } = BODY_SHAPE_LIMITS[key];
              return <AdjustmentControl key={key} label={param.label} value={value} min={min} max={max}
                step={0.02} resetValue={0} onChange={next => setShapeValue(key, next)}
                rangeStyle={trackStyle(key, value)} hint={param.hint} />;
            })}
          </div>
        ))}

        </details>

        <button
          type="button"
          className="ep-btn ep-btn--block ep-btn--ghost"
          disabled={isDefaultShape(bodyShape)}
          onClick={() => onBodyShapeChange({ ...DEFAULT_BODY_SHAPE })}
        >
          Reset shape
        </button>
      </Section></div>

    </>
  );
}
