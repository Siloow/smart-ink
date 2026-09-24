import { useEffect, useRef, useState } from 'react';
import { FaArrowLeft, FaArrowRight, FaRuler, FaTimes } from 'react-icons/fa';
import { MEASURE_STEPS, type MeasureStep } from './steps';
import './measurements.css';

import { measurementError, type Measurements } from './profile';
interface Props {
  initial?: Measurements;
  baseline?: Measurements;
  onFocus: (step: MeasureStep | null) => void;
  onClose: () => void;
  onComplete: (values: Measurements) => Promise<void>;
  completeLabel: string;
}
export default function MeasurementOverlay({ initial, baseline, onFocus, onClose, onComplete, completeLabel }: Props) {
  const [answers, setAnswers] = useState<Measurements>(() => ({ ...initial }));
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => initial?.height?.toString() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState(false);
  const input = useRef<HTMLInputElement>(null), apply = useRef<HTMLButtonElement>(null);
  const step = MEASURE_STEPS[index];
  useEffect(() => { onFocus(review ? null : step); if (review) apply.current?.focus(); else input.current?.focus({ preventScroll: true }); }, [step, review, onFocus]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!busy) onClose(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose, busy]);
  const go = (i: number) => { setIndex(i); setValue(answers[MEASURE_STEPS[i].key]?.toString() ?? ''); setError(''); setTips(false); setReview(false); };
  const submit = () => {
    const message = measurementError(value, step.key, answers, baseline);
    if (message) { setError(message); input.current?.focus(); return; }
    setAnswers(previous => ({ ...previous, [step.key]: Number(value) })); setError('');
    if (editing || index === MEASURE_STEPS.length - 1) { setEditing(false); setReview(true); }
    else go(index + 1);
  };
  const save = async () => {
    for (let i = 0; i < MEASURE_STEPS.length; i++) {
      const key = MEASURE_STEPS[i].key, message = measurementError(String(answers[key] ?? ''), key, answers, baseline);
      if (message) { go(i); setEditing(true); setError(message); return; }
    }
    setBusy(true); setError('');
    try { await onComplete(answers); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save measurements. Try again.'); setBusy(false); }
  };
  const tip = ['forearmLow', 'forearm', 'belowElbow'].includes(step.key) && answers.armLength
    ? `For your ${answers.armLength} cm forearm, measure ${((step.key === 'forearmLow' ? 1 / 3 : step.key === 'forearm' ? 2 / 3 : .95) * answers.armLength).toFixed(1)} cm from your wrist. Keep the tape perpendicular to your arm.` : step.tip;
  return <div className="measure-overlay" role="region" aria-label="Measure your body">
    <div className="measure-hud"><div className="measure-mode-label"><FaRuler aria-hidden="true" /><span>Measure body</span></div>
      <div className="measure-progress"><span aria-live="polite">{review ? 'Review measurements' : `${index + 1} / ${MEASURE_STEPS.length}`}</span><progress aria-label="Measurement progress" max={15} value={review ? 15 : index} /></div>
      <button type="button" className="ep-btn measure-exit" disabled={busy} onClick={onClose}><FaTimes aria-hidden="true" />Exit</button>
    </div>
    <svg className="measure-connector" aria-hidden="true"><path /><circle r="3.5" /></svg>
    <section className={`measure-card${review ? ' measure-card--review' : ''}`} aria-label={review ? 'Review your measurements' : step.title}>
      {review ? <>
        <span className="ep-section-label">Your measurements</span><h2>Ready when you are.</h2><p>Check your values before continuing. All measurements are in centimetres.</p>
        <ol className="measure-review">{MEASURE_STEPS.map((item, i) => <li key={item.key}><span>{item.title}</span><strong>{answers[item.key]?.toFixed(1)}<small> cm</small></strong><button className="ep-btn" disabled={busy} onClick={() => { go(i); setEditing(true); }} aria-label={`Edit ${item.title.toLowerCase()}`}>Edit</button></li>)}</ol>
        {error && <p className="measure-error" role="alert">{error}</p>}
        <button ref={apply} className="ep-btn ep-btn--primary measure-complete" disabled={busy} onClick={() => void save()}>{busy ? 'Applying…' : completeLabel}</button>
        <button className="measure-back" disabled={busy} onClick={onClose}>Cancel</button>
      </> : <>
        <span className="ep-section-label">{step.kind === 'length' ? 'Length' : 'Circumference'}</span><h2>{step.title}</h2><p>{step.instruction}</p>
        <form onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
          <label htmlFor="body-measure-value">Your measurement</label>
          <div className="measure-entry"><div className="measure-input"><input id="body-measure-value" ref={input} type="number" inputMode="decimal" step=".1" autoComplete="off" value={value} placeholder="Enter cm" aria-invalid={!!error} aria-describedby={error ? 'body-measure-error' : undefined} onChange={e => { setValue(e.target.value); setError(''); }} /><span>cm</span></div>
            <button className="ep-btn ep-btn--primary" type="submit">{editing ? 'Save' : index === 14 ? 'Review' : 'Next'}<FaArrowRight aria-hidden="true" /></button></div>
          {error && <p id="body-measure-error" className="measure-error" role="alert">{error}</p>}
          <button className="measure-back" type="button" disabled={!index && !editing} onClick={() => {
            if (editing) { setEditing(false); setReview(true); setError(''); return; }
            if (value && !measurementError(value, step.key, answers, baseline)) setAnswers(previous => ({ ...previous, [step.key]: Number(value) }));
            go(index - 1);
          }}><FaArrowLeft aria-hidden="true" />{editing ? 'Back to review' : 'Back'}</button>
        </form>
        <details className="measure-tips" open={tips} onToggle={e => setTips(e.currentTarget.open)}><summary>Measuring tips</summary><p>{tip}</p><p>The bands mark estimated locations. Use a flexible tape against your skin without pulling tight.</p></details>
      </>}
    </section>
  </div>;
}
