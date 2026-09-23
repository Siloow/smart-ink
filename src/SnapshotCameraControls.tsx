import { useId } from 'react';
import AdjustmentControl from './AdjustmentControl';
import { normalizeTattooCamera, TATTOO_CAMERA_LIMITS, type TattooCameraAdjustment } from './render/tattooCamera';

export interface SnapshotCameraControlsProps {
  adjustment: TattooCameraAdjustment;
  onChange: (adjustment: TattooCameraAdjustment) => void;
  onReset: () => void;
  hasTattoo: boolean;
}

type AdjustmentKey = keyof TattooCameraAdjustment;

export default function SnapshotCameraControls({ adjustment, onChange, onReset, hasTattoo }: SnapshotCameraControlsProps) {
  const id = useId(), value = normalizeTattooCamera(adjustment);
  const update = (key: AdjustmentKey, next: number) => {
    if (Number.isFinite(next)) onChange(normalizeTattooCamera({ ...value, [key]: next }));
  };
  const nudge = (key: AdjustmentKey, direction: number, coarse = false) => {
    const step = key === 'zoom' ? coarse ? .1 : .01 : coarse ? 5 : 1;
    update(key, value[key] + step * direction);
  };
  const control = (key: AdjustmentKey, label: string, less: string, more: string, description: string) => {
    const factor = key === 'zoom' ? 100 : 1, unit = key === 'zoom' ? '%' : '°';
    const { min, max } = TATTOO_CAMERA_LIMITS[key];
    const displayed = Math.round(value[key] * factor * 10) / 10;
    return <div className="snapshot-camera-control">
      <AdjustmentControl id={`${id}-${key}-range`} label={label} value={displayed}
        min={min * factor} max={max * factor} step={key === 'zoom' ? 1 : .1} unit={unit}
        resetValue={key === 'zoom' ? 100 : 0} onChange={next => update(key, next / factor)} />
      <div className="snapshot-camera-nudges"><button type="button" disabled={value[key] <= min} title={`${less}: ${key === 'zoom' ? '1%' : '1°'}; hold Shift for ${key === 'zoom' ? '10%' : '5°'}`} onClick={event => nudge(key, -1, event.shiftKey)}><span aria-hidden="true">−</span>{less}</button><button type="button" disabled={value[key] >= max} title={`${more}: ${key === 'zoom' ? '1%' : '1°'}; hold Shift for ${key === 'zoom' ? '10%' : '5°'}`} onClick={event => nudge(key, 1, event.shiftKey)}>{more}<span aria-hidden="true">+</span></button></div>
      <p id={`${id}-${key}-hint`}>{description}</p>
    </div>;
  };
  return <div className="snapshot-camera-controls">
    <div className="snapshot-camera-heading"><h3>Camera</h3><button type="button" onClick={onReset}>Reset view</button></div>
    <p className="snapshot-controls-hint">{hasTattoo ? 'The center stays on your tattoo. Adjust the view without moving its placement.' : 'The center stays on the visible body. Add a tattoo later to frame it automatically.'}</p>
    {control('azimuth', hasTattoo ? 'Around tattoo' : 'Around figure', 'Left', 'Right', 'Turn around the center of your shot.')}
    {control('elevation', 'View height', 'Lower', 'Higher', 'Look from below or above the center.')}
    {control('zoom', 'Zoom', 'Wider', 'Closer', 'Move closer while keeping the same center.')}
    <p className="snapshot-controls-hint snapshot-camera-tip">Arrow keys make small adjustments. Hold Shift for larger steps.</p>
  </div>;
}
