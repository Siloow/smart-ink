import { LIGHTING_PRESETS, resolveRig, type LightDefinition, type LightingPresetKey } from '../config/lightingPresets';

export const STUDIO_LIGHT_LIMITS = {
  brightness: [0, 200], softness: [0, 1], azimuth: [-180, 180],
  height: [-2, 12], distance: [1, 18], aimHeight: [-2.1, 2.1],
} as const;
export type LightControl = keyof typeof STUDIO_LIGHT_LIMITS;
export const LIGHT_COLOR_CHOICES = [
  { label: 'Warm', color: '#ffd6ad' }, { label: 'Neutral', color: '#ffffff' }, { label: 'Cool', color: '#c9e1ff' },
] as const;
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function softboxSize(softness: number): number { return .25 + 3.75 * clamp(finite(softness, .45), 0, 1); }
export function lightSoftness(light: LightDefinition): number {
  if (Number.isFinite(light.softness)) return clamp(light.softness!, 0, 1);
  const area = light.blenderAreaSize;
  return area && area.every(Number.isFinite) ? clamp(((area[0] + area[1]) / 2 - .25) / 3.75, 0, 1) : .45;
}
/** Read-only view; loading an older rig must not silently rewrite it. */
export function lightPlacement(light: LightDefinition) {
  const x = finite(light.position[0], 0), z = finite(light.position[2], 6);
  return { azimuth: Math.atan2(x, z) * 180 / Math.PI, height: finite(light.position[1], 3), distance: Math.hypot(x, z), aimHeight: finite(light.target?.[1] ?? 0, 0) };
}
/** Edits touch only the chosen control; source rigs and other fields stay intact. */
export function updateLightControl(light: LightDefinition, key: LightControl, input: number): LightDefinition {
  if (!Number.isFinite(input)) return light;
  const [min, max] = STUDIO_LIGHT_LIMITS[key], value = clamp(input, min, max);
  if (key === 'brightness') return { ...light, intensity: value / 100 };
  if (key === 'softness') { const size = softboxSize(value); return { ...light, softness: value, blenderAreaSize: [size, size] }; }
  if (key === 'aimHeight') return { ...light, target: [light.target?.[0] ?? 0, value, light.target?.[2] ?? 0] };
  if (key === 'height') return { ...light, position: [light.position[0], value, light.position[2]] };
  const current = lightPlacement(light), angle = (key === 'azimuth' ? value : current.azimuth) * Math.PI / 180;
  const distance = key === 'distance' ? value : Math.max(1, current.distance);
  return { ...light, position: [Math.sin(angle) * distance, light.position[1], Math.cos(angle) * distance] };
}
/** X/Z coordinates from the overhead map, bounded to the walkable studio ring. */
export function moveLightOnMap(light: LightDefinition, x: number, z: number): LightDefinition {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return light;
  const radius = Math.hypot(x, z), previous = lightPlacement(light);
  const angle = radius > 1e-8 ? Math.atan2(x, z) : previous.azimuth * Math.PI / 180;
  const distance = clamp(radius, ...STUDIO_LIGHT_LIMITS.distance);
  return { ...light, position: [Math.sin(angle) * distance, light.position[1], Math.cos(angle) * distance] };
}
export function lightLabel(lights: LightDefinition[], index: number): string {
  const light = lights[index]; if (!light) return 'Light';
  if (light.name?.trim()) return light.name.trim();
  if (light.type === 'ambient') return 'Room fill';
  const ordinal = lights.slice(0, index).filter((entry) => entry.type !== 'ambient').length;
  return ['Key', 'Fill', 'Rim'][ordinal] ?? `Light ${ordinal + 1}`;
}
export function resetSelectedLight(lights: LightDefinition[], index: number, preset: LightingPresetKey): LightDefinition[] {
  const light = lights[index]; if (!light || !LIGHTING_PRESETS[preset]) return lights;
  const defaults = resolveRig(preset), ordinal = lights.slice(0, index).filter((entry) => (entry.type === 'ambient') === (light.type === 'ambient')).length;
  const fallback = defaults.filter((entry) => (entry.type === 'ambient') === (light.type === 'ambient'))[ordinal];
  if (!fallback) return lights;
  return lights.map((entry, i) => i === index ? { ...fallback, position: [...fallback.position], target: fallback.target ? [...fallback.target] : undefined, blenderAreaSize: fallback.blenderAreaSize ? [...fallback.blenderAreaSize] : undefined } : entry);
}
export function selectedLightIndex(lights: LightDefinition[], index: number | null): number | null {
  if (index != null && lights[index]) return index;
  const first = lights.findIndex((light) => light.type !== 'ambient');
  return first >= 0 ? first : lights.length ? 0 : null;
}
