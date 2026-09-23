import { get, update } from 'idb-keyval';

export interface TattooAsset { id: string; name: string; source: string; category: string }
export const STARTER_TATTOOS: TattooAsset[] = [
  { id: 'rose', name: 'Botanical rose', source: '/tattoos/botanical-rose.png', category: 'Botanical' },
  { id: 'moth', name: 'Lunar moth', source: '/tattoos/lunar-moth.png', category: 'Celestial' },
  { id: 'dagger', name: 'Ornamental dagger', source: '/tattoos/ornamental-dagger.png', category: 'Ornamental' },
];
const listeners = new Set<(items: TattooAsset[]) => void>();
export function subscribeTattooLibrary(listener: (items: TattooAsset[]) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const publish = (items: TattooAsset[]) => listeners.forEach(listener => listener(items));
const KEY = 'smartink:tattoo-library:v1';
function assets(value: unknown): TattooAsset[] {
  return Array.isArray(value) ? value.filter((item): item is TattooAsset => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.source === 'string' && item.source.startsWith('data:image/png;base64,'))) : [];
}
export async function loadTattooLibrary(): Promise<TattooAsset[]> { return assets(await get(KEY)); }
export async function rememberTattoo(source: string, name = 'Imported artwork'): Promise<TattooAsset[]> {
  if (!source.startsWith('data:image/png;base64,')) return loadTattooLibrary();
  let result: TattooAsset[] = [];
  await update(KEY, (stored) => {
    const current = assets(stored);
    if (current.some(item => item.source === source)) { result = current; return current; }
    if (current.length >= 100 || current.reduce((size, item) => size + item.source.length, source.length) > 120 * 1024 * 1024) {
      throw new Error('Your local library is full. Remove an unused design before adding more.');
    }
    result = [{ id: crypto.randomUUID(), name: name.replace(/\.png$/i, '').trim().slice(0, 80) || 'Imported artwork', source, category: 'Your upload' }, ...current];
    return result;
  });
  publish(result);
  return result;
}
export async function removeTattoo(id: string): Promise<TattooAsset[]> {
  let result: TattooAsset[] = [];
  await update(KEY, stored => { result = assets(stored).filter(item => item.id !== id); return result; });
  publish(result);
  return result;
}
