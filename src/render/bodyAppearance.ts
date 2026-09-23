export type TopStyle = 'none' | 'tshirt';
export type BottomStyle = 'none' | 'shorts' | 'trousers';
export type HairStyle = 'none' | 'buzz' | 'short';
export type HairTone = 'black' | 'dark_brown' | 'brown' | 'auburn' | 'blond' | 'grey';

export interface BodyAppearance {
  top: TopStyle;
  bottom: BottomStyle;
  topColor: string;
  bottomColor: string;
  hairStyle: HairStyle;
  hairTone: HairTone;
}

export const DEFAULT_BODY_APPEARANCE: BodyAppearance = {
  top: 'none', bottom: 'none', topColor: '#e8e3d9', bottomColor: '#263449',
  hairStyle: 'none', hairTone: 'dark_brown',
};
export const TOP_OPTIONS: { id: TopStyle; label: string }[] = [{ id: 'none', label: 'No top' }, { id: 'tshirt', label: 'T-shirt' }];
export const BOTTOM_OPTIONS: { id: BottomStyle; label: string }[] = [{ id: 'none', label: 'No bottoms' }, { id: 'shorts', label: 'Shorts' }, { id: 'trousers', label: 'Trousers' }];
export const HAIR_OPTIONS: { id: HairStyle; label: string }[] = [{ id: 'none', label: 'None' }, { id: 'buzz', label: 'Buzz cut' }, { id: 'short', label: 'Short hair' }];
export const HAIR_TONES: { id: HairTone; label: string; color: string }[] = [
  { id: 'black', label: 'Black', color: '#171411' },
  { id: 'dark_brown', label: 'Dark brown', color: '#302219' },
  { id: 'brown', label: 'Brown', color: '#634530' },
  { id: 'auburn', label: 'Auburn', color: '#874c30' },
  { id: 'blond', label: 'Blond', color: '#bd9b64' },
  { id: 'grey', label: 'Grey', color: '#96938d' },
];
export const CLOTHING_COLORS = [
  { label: 'Cream', value: '#e8e3d9' }, { label: 'Charcoal', value: '#303238' },
  { label: 'Navy', value: '#263449' }, { label: 'Sage', value: '#6c7764' },
  { label: 'Burgundy', value: '#763d45' },
];

/** Persist only supported choices; old scenes retain their unclothed preview. */
export function normalizeAppearance(value?: Partial<BodyAppearance> | null): BodyAppearance {
  const v = value && typeof value === 'object' ? value : {};
  const hex = (color: unknown, fallback: string) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  return {
    top: TOP_OPTIONS.some((option) => option.id === v.top) ? v.top! : DEFAULT_BODY_APPEARANCE.top,
    bottom: BOTTOM_OPTIONS.some((option) => option.id === v.bottom) ? v.bottom! : DEFAULT_BODY_APPEARANCE.bottom,
    topColor: hex(v.topColor, DEFAULT_BODY_APPEARANCE.topColor),
    bottomColor: hex(v.bottomColor, DEFAULT_BODY_APPEARANCE.bottomColor),
    hairStyle: HAIR_OPTIONS.some((option) => option.id === v.hairStyle) ? v.hairStyle! : DEFAULT_BODY_APPEARANCE.hairStyle,
    hairTone: HAIR_TONES.some((option) => option.id === v.hairTone) ? v.hairTone! : DEFAULT_BODY_APPEARANCE.hairTone,
  };
}

export function appearanceValidationErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['bodyAppearance must be an object'];
  const errors: string[] = [];
  const normalized = normalizeAppearance(value as Partial<BodyAppearance>);
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_BODY_APPEARANCE, key)) errors.push(`unknown bodyAppearance key ${key}`);
    else if (key === 'topColor' || key === 'bottomColor') {
      if (typeof entry !== 'string' || !/^#[\da-f]{6}$/i.test(entry)) errors.push(`bodyAppearance.${key} must be a six-digit hex color`);
    } else if (entry !== normalized[key as keyof BodyAppearance]) errors.push(`unsupported bodyAppearance.${key}`);
  }
  return errors;
}
