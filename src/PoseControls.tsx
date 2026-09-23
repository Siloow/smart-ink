import { useId, useState } from 'react';
import {
  BODY_POSE_BOUNDS, BODY_POSE_PARAMS, BODY_POSE_PRESETS, normalizePose, poseBoundsForKey,
  type BodyPose, type BodyPoseKey,
} from './render/bodyPose';
import AdjustmentControl from './AdjustmentControl';
import type { BodyRegionId } from './render/bodyRegions';

export interface PoseControlsProps {
  poseId: string;
  bodyPose: BodyPose;
  onPosePresetChange: (id: string) => void;
  onBodyPoseChange: (pose: BodyPose) => void;
  onHighlightRegions: (regions: BodyRegionId[]) => void;
  onFramePose: () => void;
}

const GROUPS: { id: string; label: string; keys: BodyPoseKey[]; regions: BodyRegionId[] }[] = [
  { id: 'leftArm', label: 'Left arm', keys: ['leftArmLift', 'leftArmForward', 'leftElbow'], regions: ['armLeft'] },
  { id: 'rightArm', label: 'Right arm', keys: ['rightArmLift', 'rightArmForward', 'rightElbow'], regions: ['armRight'] },
  { id: 'leftLeg', label: 'Left leg', keys: ['leftLegSpread', 'leftLegForward', 'leftKnee'], regions: ['legLeft'] },
  { id: 'rightLeg', label: 'Right leg', keys: ['rightLegSpread', 'rightLegForward', 'rightKnee'], regions: ['legRight'] },
  { id: 'head', label: 'Head', keys: ['headTurn', 'headTilt'], regions: ['head'] },
];
const labelFor = (key: BodyPoseKey) => BODY_POSE_PARAMS.find((param) => param.key === key);

export default function PoseControls({ poseId, bodyPose, onPosePresetChange, onBodyPoseChange, onHighlightRegions, onFramePose }: PoseControlsProps) {
  const [selected, setSelected] = useState('leftArm');
  const [linked, setLinked] = useState(false);
  const helpId = useId();
  const group = GROUPS.find((item) => item.id === selected) ?? GROUPS[0];
  const bilateral = selected !== 'head';
  const highlight = () => onHighlightRegions(linked && bilateral
    ? selected.endsWith('Arm') ? ['armLeft', 'armRight'] : ['legLeft', 'legRight']
    : group.regions);
  const oppositeKey = (key: BodyPoseKey) =>
    (key.startsWith('left') ? key.replace('left', 'right') : key.replace('right', 'left')) as BodyPoseKey;
  const boundsFor = (key: BodyPoseKey) => {
    const bounds = poseBoundsForKey(key, bodyPose);
    if (linked && bilateral) {
      const other = poseBoundsForKey(oppositeKey(key), bodyPose);
      return { min: Math.max(bounds.min, other.min), max: Math.min(bounds.max, other.max) };
    }
    return bounds;
  };
  const choosePreset = (id: string) => { setLinked(false); onPosePresetChange(id); };
  const toggleLinked = (checked: boolean) => {
    setLinked(checked);
    if (checked && bilateral) {
      const next = { ...bodyPose };
      for (const key of group.keys) next[oppositeKey(key)] = next[key];
      onBodyPoseChange(normalizePose(next));
    }
  };
  const setValue = (key: BodyPoseKey, value: number) => {
    const { min, max } = boundsFor(key);
    value = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
    const next = { ...bodyPose, [key]: value };
    if (linked && bilateral) {
      const opposite = oppositeKey(key);
      if (Object.hasOwn(BODY_POSE_BOUNDS, opposite)) next[opposite as BodyPoseKey] = value;
    }
    onBodyPoseChange(normalizePose(next));
  };

  return (
    <section className="ep-section pose-section">
      <div className="pose-heading">
        <p className="ep-section-label">Pose</p>
        <span className="ep-hint">{poseId === 'custom' ? 'Custom' : BODY_POSE_PRESETS.find((p) => p.id === poseId)?.label ?? 'Neutral'}</span>
      </div>
      <div className="ep-pill-row shape-presets pose-presets">
        {BODY_POSE_PRESETS.map((preset) => (
          <button type="button" key={preset.id} className="ep-pill" aria-pressed={poseId === preset.id}
            onClick={() => choosePreset(preset.id)}>{preset.label}</button>
        ))}
      </div>
      <details className="ep-details pose-adjustments">
        <summary><span>Adjust limbs</span><span className="ep-details-summary">{poseId === 'custom' ? 'Custom pose' : BODY_POSE_PRESETS.find(preset => preset.id === poseId)?.label ?? 'Neutral'}</span></summary>
        <p className="ep-hint" id={helpId}>Left and right refer to the figure. Angles are relative to the neutral pose. Arm limits adapt as you move the shoulder and elbow.</p>
        <div className="pose-parts" role="group" aria-label="Body part to pose">
          {GROUPS.map((part) => (
            <button type="button" key={part.id} className="region-chip" aria-pressed={selected === part.id}
              onClick={() => {
                if (part.id.endsWith('Arm') !== selected.endsWith('Arm') || part.id === 'head') setLinked(false);
                setSelected(part.id); onHighlightRegions([]);
              }}
              onMouseEnter={() => onHighlightRegions(part.regions)} onMouseLeave={() => onHighlightRegions([])}>{part.label}</button>
          ))}
        </div>
        {bilateral && <label className="pose-link">
          <input type="checkbox" checked={linked} onChange={(e) => toggleLinked(e.target.checked)} />
          Move both {selected.endsWith('Arm') ? 'arms' : 'legs'} together
        </label>}
        {group.keys.map((key) => {
          const { min, max } = boundsFor(key);
          const param = labelFor(key);
          const label = (param?.label ?? key).replace(/^(Left|Right|Head) /, '');
          const value = bodyPose[key];
          return <div className="shape-field" key={key} onMouseEnter={highlight} onMouseLeave={() => onHighlightRegions([])}>
            <AdjustmentControl id={`${helpId}-${key}-input`} label={label.charAt(0).toUpperCase() + label.slice(1)}
              ariaLabel={`${group.label}: ${label}`} value={value} min={min} max={max} step={1} unit="°"
              onChange={next => setValue(key, next)} hint={param?.hint} />
          </div>;
        })}
      </details>
      <div className="pose-actions">
        <button type="button" className="ep-btn ep-btn--ghost" onClick={onFramePose}>Frame pose</button>
        <button type="button" className="ep-btn ep-btn--ghost" disabled={Object.values(bodyPose).every((value) => value === 0)}
          onClick={() => choosePreset('neutral')}>Reset pose</button>
      </div>
    </section>
  );
}
