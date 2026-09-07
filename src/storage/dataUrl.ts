/** True for inline image data the store still has to upload. */
export function isDataUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Shrinks a rendered canvas to a dashboard-sized thumbnail before encoding.
 * The editor canvas is ~1500 px wide at DPR 2; encoding that on every idle
 * pause produced multi-megabyte data URLs.
 */
export function captureThumbnail(source: HTMLCanvasElement, maxWidth = 512): string | null {
  const scale = Math.min(1, maxWidth / Math.max(1, source.width));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  const dataUrl = target.toDataURL('image/png');
  return dataUrl.length > 100 ? dataUrl : null;
}
