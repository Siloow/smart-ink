export type Measurements = Record<string, number>;
export interface MeasurementProfile { version: 1; values: Measurements; bodyMeshId: string; updatedAt: string }
export function measurementError(raw: string, key: string, values: Measurements, baseline?: Measurements): string {
  if (!raw.trim()) return 'Enter your measurement to continue.';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number in centimetres.';
  const min = baseline ? Math.ceil(baseline[key] * .75 * 10) / 10 : .1;
  const max = baseline ? Math.floor(baseline[key] * 1.4 * 10) / 10 : 300;
  if (n < min || n > max) return `Enter a value between ${min.toFixed(1)} and ${max.toFixed(1)} cm.`;
  if (key === 'inseam' && values.height && n >= values.height) return 'Your inseam must be shorter than your height.';
  return '';
}

import type { BodyFit } from './fitter';
import { MEASURE_STEPS } from './steps';
/** Never let corrupted stored recipes put NaNs or another template into the mesh. */
export function normalizeBodyFit(value: unknown, bodyMeshId: string): BodyFit | null {
  if (!value || typeof value !== 'object') return null;
  const fit = value as BodyFit;
  if (fit.version !== 1 || fit.bodyMeshId !== bodyMeshId || !['body_full', 'body_full_female'].includes(bodyMeshId)) return null;
  if (!fit.measurements || MEASURE_STEPS.some(s => !Number.isFinite(fit.measurements[s.key]) || fit.measurements[s.key] <= 0 || fit.measurements[s.key] > 300)) return null;
  if (!Array.isArray(fit.parameters) || fit.parameters.length !== 20 || fit.parameters.some(n => !Number.isFinite(n) || Math.abs(n) > .85)) return null;
  if (!Array.isArray(fit.armDeltas) || fit.armDeltas.length !== 2 || fit.armDeltas.some(n => !Number.isFinite(n) || Math.abs(n) > .5)) return null;
  if (!Number.isFinite(fit.maxErrorMm) || fit.maxErrorMm < 0 || fit.maxErrorMm > 2) return null;
  return fit;
}
