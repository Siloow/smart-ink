export interface StudioSettings {
  mode: 'plain' | 'sweep';
  /** Screen-aligned plain backdrop; never used as lighting. */
  gradient?: string[];
  color: string;
  shadow: number;
  showGuides: boolean;
}

export const DEFAULT_STUDIO: StudioSettings = { mode: 'sweep', color: '#d6cdc1', shadow: 0.4, showGuides: false };
export const STUDIO_PAPERS = [
  { name: 'Warm paper', color: '#d6cdc1' }, { name: 'White', color: '#ededeb' },
  { name: 'Charcoal', color: '#30343c' }, { name: 'Slate blue', color: '#657b91' },
  { name: 'Rose', color: '#b99093' }, { name: 'Sage', color: '#929c89' },
];

export function normalizeStudio(input?: Partial<StudioSettings> | null): StudioSettings {
  const value = input && typeof input === 'object' ? input : {};
  return {
    mode: value.mode === 'plain' || value.mode === 'sweep' ? value.mode : DEFAULT_STUDIO.mode,
    ...(value.mode === 'plain' && Array.isArray(value.gradient) && value.gradient.length >= 2 && value.gradient.length <= 8 && value.gradient.every(c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)) ? { gradient: value.gradient.map(c => c.toLowerCase()) } : {}),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : DEFAULT_STUDIO.color,
    shadow: typeof value.shadow === 'number' && Number.isFinite(value.shadow) ? Math.max(0, Math.min(1, value.shadow)) : DEFAULT_STUDIO.shadow,
    showGuides: typeof value.showGuides === 'boolean' ? value.showGuides : false,
  };
}

/** Plain canvas backgrounds use their selected flat color in Blender. */
export function studioForExport(settings: StudioSettings, plainColor: string, stops?: readonly string[]): StudioSettings {
  const color = /^#[\da-f]{3}$/i.test(plainColor) ? '#' + [...plainColor.slice(1)].map(c => c + c).join('') : plainColor;
  const gradient = settings.mode === 'plain' && stops && stops.length > 1 ? stops.map(c => /^#[\da-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(v => v + v).join('') : c) : undefined;
  return normalizeStudio({ ...settings, gradient, color: settings.mode === 'plain' ? color : settings.color });
}

export function studioValidationErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['studio must be an object'];
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'gradient') {
      if (!Array.isArray(entry) || entry.length < 2 || entry.length > 8 || !entry.every(c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c))) errors.push('invalid studio.gradient');
    } else if (!Object.hasOwn(DEFAULT_STUDIO, key)) errors.push(`unknown studio key ${key}`);
    else if (key === 'mode' && entry !== 'plain' && entry !== 'sweep') errors.push('unsupported studio.mode');
    else if (key === 'color' && (typeof entry !== 'string' || !/^#[\da-f]{6}$/i.test(entry))) errors.push('studio.color must be a six-digit hex color');
    else if (key === 'shadow' && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1)) errors.push('studio.shadow must be between zero and one');
    else if (key === 'showGuides' && typeof entry !== 'boolean') errors.push('studio.showGuides must be a boolean');
  }
  return errors;
}
