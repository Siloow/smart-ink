import type { LightDefinition } from './config/lightingPresets';

interface LightingControlsProps {
  lights: LightDefinition[];
  selectedIndex: number | null;
  onSelectLight: (i: number) => void;
  onChange: (lights: LightDefinition[]) => void;
  onReset: () => void;
}

const AXES: Array<{ axis: 0 | 1 | 2; label: string }> = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
];

export default function LightingControls({
  lights,
  selectedIndex,
  onSelectLight,
  onChange,
  onReset,
}: LightingControlsProps) {
  const positionable = lights
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.type !== 'ambient');
  const sel = selectedIndex != null ? lights[selectedIndex] : null;

  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    if (selectedIndex == null) return;
    onChange(
      lights.map((l, i) =>
        i === selectedIndex
          ? {
              ...l,
              position: l.position.map((p, a) => (a === axis ? value : p)) as [
                number,
                number,
                number,
              ],
            }
          : l
      )
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, color: '#e7e7ea' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Lighting</span>
        <button
          onClick={onReset}
          style={{
            fontSize: 12,
            color: '#9a9aa2',
            background: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {positionable.map(({ i }, n) => (
          <button
            key={i}
            onClick={() => onSelectLight(i)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)',
              color: i === selectedIndex ? '#e7e7ea' : '#9a9aa2',
              border: `1px solid ${i === selectedIndex ? '#4d7cff' : 'rgba(255,255,255,0.12)'}`,
            }}
          >
            {n === 0 ? 'Key' : n === 1 ? 'Fill' : `Light ${n + 1}`}
          </button>
        ))}
      </div>

      {sel && sel.type !== 'ambient' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {AXES.map(({ axis, label }) => (
            <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 14, color: '#9a9aa2' }}>{label}</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.1}
                value={sel.position[axis]}
                onChange={(e) => setAxis(axis, parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 36, textAlign: 'right' }}>{sel.position[axis].toFixed(1)}</span>
            </label>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 12, color: '#9a9aa2' }}>Select a light to move it.</span>
      )}
    </div>
  );
}
