import type { ReactNode } from 'react';
import { REGISTRY } from './render/registry';
import {
  BODY_SHAPE_PRESETS,
  DEFAULT_BODY_SHAPE,
  bodyShapeParamsFor,
  formatShapeValue,
  isDefaultShape,
  isPresetActive,
  shapeFromPreset,
  type BodyShape,
  type BodyShapeGroup,
} from './render/bodyShape';

export interface CharacterBuilderSectionsProps {
  bodyMeshId: string;
  skinToneId: string;
  /** Kept in the scene and render contract; the selector is hidden until poses work end to end. */
  poseId: string;
  lookId: string;
  onBodyChange: (id: string) => void;
  onSkinChange: (id: string) => void;
  onPoseChange: (id: string) => void;
  onLookChange: (id: string) => void;
  armBendDeg?: number;
  onArmBendChange?: (deg: number) => void;
  bodyShape: BodyShape;
  onBodyShapeChange: (shape: BodyShape) => void;
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

export default function CharacterBuilderSections({
  bodyMeshId,
  skinToneId,
  lookId,
  onBodyChange,
  onSkinChange,
  onLookChange,
  armBendDeg = 0,
  onArmBendChange,
  bodyShape,
  onBodyShapeChange,
}: CharacterBuilderSectionsProps) {
  const showArmRig = bodyMeshId === 'human';
  const shapeParams = bodyShapeParamsFor(bodyMeshId);
  const shapeGroups = shapeParams.reduce<Array<{ group: BodyShapeGroup; params: typeof shapeParams }>>(
    (acc, param) => {
      const existing = acc.find((g) => g.group === param.group);
      if (existing) existing.params.push(param);
      else acc.push({ group: param.group, params: [param] });
      return acc;
    },
    []
  );
  const setShapeValue = (key: keyof BodyShape, value: number) =>
    onBodyShapeChange({ ...bodyShape, [key]: value });

  return (
    <>
      <Section label="Body">
        <div className="cb-grid cb-grid-2">
          {REGISTRY.bodyMeshes.map((b) => {
            const selected = b.id === bodyMeshId;
            return (
              <button
                key={b.id}
                type="button"
                className={`cb-card${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onBodyChange(b.id)}
              >
                <span className="cb-thumb">
                  <img src={b.thumbnail} alt="" onError={hideOnError} />
                </span>
                <span className="cb-card-label">{b.label}</span>
                {selected && <span className="cb-check" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
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
        {shapeGroups.map(({ group, params }) => (
          <div className="shape-group" key={group}>
            <p className="shape-group-label">{group}</p>
            {params.map((param) => (
              <div className="ep-field shape-field" key={param.key}>
                <div className="ep-field-row">
                  <span className="ep-field-label">{param.label}</span>
                  <span className="shape-value">{formatShapeValue(bodyShape[param.key])}</span>
                </div>
                <input
                  type="range"
                  className="ep-range"
                  min={-1}
                  max={1}
                  step={0.02}
                  value={bodyShape[param.key]}
                  onChange={(e) => setShapeValue(param.key, Number(e.target.value))}
                  onDoubleClick={() => setShapeValue(param.key, 0)}
                  aria-label={param.label}
                  title="Double-click to reset"
                />
              </div>
            ))}
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
        {!showArmRig && bodyMeshId === 'forearm' && (
          <p className="ep-hint" style={{ marginTop: 6 }}>
            Proportion controls apply to full figures; this body only takes Height and Build.
          </p>
        )}
      </Section>

      {/*
        Pose presets (REGISTRY.poses) are hidden until they drive both the
        preview and the Blender render — see docs/beta-improvement-plan.md,
        Phase 3. The elbow rig on the Human body works today, so it stays.
      */}
      {showArmRig && onArmBendChange && (
        <Section label="Pose">
          <div className="ep-field">
            <div className="ep-field-row">
              <span className="ep-field-label">Right elbow</span>
              <span className="ep-field-label">{Math.round(armBendDeg)}°</span>
            </div>
            <input
              className="ep-range"
              type="range"
              min={0}
              max={120}
              step={1}
              value={armBendDeg}
              onChange={(e) => onArmBendChange(Number(e.target.value))}
              aria-label="Right elbow bend"
            />
            <p className="ep-hint" style={{ marginTop: 6 }}>
              Place a tattoo on the arm, then bend to preview UV deformation.
            </p>
          </div>
        </Section>
      )}

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
