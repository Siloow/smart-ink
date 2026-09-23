import { useId, useRef, useState, type CSSProperties } from 'react';
import './inspector-controls.css';

export interface AdjustmentControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  resetValue?: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  rangeStyle?: CSSProperties;
}

/** A number can be typed in full before it changes the scene. */
export default function AdjustmentControl({ label, value, min, max, step = 1, unit = '', resetValue = 0, onChange, ariaLabel = label, hint, disabled = false, id, rangeStyle }: AdjustmentControlProps) {
  const generatedId = useId(), inputId = id ?? generatedId;
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const current = clamp(Number.isFinite(value) ? value : resetValue);
  const format = (next: number) => String(Number(next.toFixed(4)));
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
  const skipBlur = useRef(false);
  const commit = (text: string) => {
    const next = text.trim() === '' ? NaN : Number(text);
    if (Number.isFinite(next)) {
      const bounded = clamp(Number(next.toFixed(4)));
      if (bounded !== current) onChange(bounded);
    }
    setEditing(false);
  };
  return <div className="ep-adjustment">
    <div className="ep-adjustment-heading">
      <label htmlFor={inputId}>{label}</label>
      <div className="ep-adjustment-actions">
        <div className="ep-adjustment-number">
          <input type="text" inputMode="decimal" aria-label={`${ariaLabel}, exact value${unit ? ` (${unit})` : ''}`}
            aria-describedby={hint ? `${inputId}-hint` : undefined} disabled={disabled}
            value={editing ? draft : format(current)}
            onFocus={() => { skipBlur.current = false; setDraft(format(current)); setEditing(true); }}
            onChange={event => { setDraft(event.currentTarget.value); setEditing(true); }}
            onBlur={event => { if (!skipBlur.current) commit(event.currentTarget.value); skipBlur.current = false; }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); skipBlur.current = true;
                if (event.key === 'Enter') commit(event.currentTarget.value); else setEditing(false);
                event.currentTarget.blur();
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const typed = event.currentTarget.value.trim() === '' ? NaN : Number(event.currentTarget.value);
                const next = clamp(Number(((Number.isFinite(typed) ? typed : current) + step * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)).toFixed(4)));
                setDraft(format(next)); setEditing(true); if (next !== current) onChange(next);
              }
            }} />
          {unit && <span aria-hidden="true">{unit}</span>}
        </div>
        <button type="button" className="ep-reset-control" aria-label={`Reset ${ariaLabel.toLowerCase()}`}
          title={`Reset ${label.toLowerCase()} to ${format(clamp(resetValue))}${unit}`}
          disabled={disabled || current === clamp(resetValue)}
          onClick={() => { setEditing(false); onChange(clamp(resetValue)); }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M3 5.5A5 5 0 1 1 3 10M3 2.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
    <input id={inputId} className="ep-adjustment-range" type="range" min={min} max={max} step={step}
      style={rangeStyle} value={current} disabled={disabled} aria-label={ariaLabel}
      aria-valuetext={`${format(current)}${unit}`} aria-describedby={hint ? `${inputId}-hint` : undefined}
      onChange={event => { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) { setEditing(false); onChange(clamp(next)); } }} />
    {hint && <p id={`${inputId}-hint`} className="ep-control-hint">{hint}</p>}
  </div>;
}
