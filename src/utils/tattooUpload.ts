/** Validate before decoding so a replacement cannot discard a working design. */
export const MAX_TATTOO_BYTES = 20 * 1024 * 1024;
export const MAX_TATTOO_DIMENSION = 8192;
export const MAX_TATTOO_PIXELS = 32 * 1024 * 1024;

function abortError(): DOMException {
  return new DOMException('Upload cancelled.', 'AbortError');
}

function validateDimensions(width: number, height: number): void {
  if (width < 1 || height < 1 || width > MAX_TATTOO_DIMENSION || height > MAX_TATTOO_DIMENSION || width * height > MAX_TATTOO_PIXELS) {
    throw new Error('This PNG is too large to preview. Use up to 8192 pixels per side and 32 megapixels.');
  }
}

function readDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The file could not be read. Please choose it again.'));
    };
    const onAbort = () => { finish(abortError()); reader.abort(); };
    reader.onload = () => finish();
    reader.onerror = () => finish(new Error('The file could not be read. Please choose it again.'));
    reader.onabort = () => finish(abortError());
    if (signal?.aborted) { finish(abortError()); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    try { reader.readAsDataURL(file); }
    catch { finish(new Error('The file could not be read. Please choose it again.')); }
  });
}

function decodeImage(source: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      image.onload = image.onerror = null;
      if (error) reject(error); else resolve();
    };
    const onAbort = () => { finish(abortError()); image.src = ''; };
    image.onload = () => {
      try { validateDimensions(image.naturalWidth, image.naturalHeight); finish(); }
      catch (error) { finish(error instanceof Error ? error : new Error('The PNG could not be decoded.')); }
    };
    image.onerror = () => finish(new Error('This PNG could not be opened. Try exporting the artwork as a new PNG.'));
    if (signal?.aborted) { finish(abortError()); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = source;
  });
}

export async function readTattooPng(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw abortError();
  if (file.type && file.type.toLowerCase() !== 'image/png') {
    throw new Error('Choose a PNG image. Your current tattoo has been kept.');
  }
  if (file.size > MAX_TATTOO_BYTES) throw new Error('Choose a PNG of 20 MB or less. Your current tattoo has been kept.');
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.slice(0, 33).arrayBuffer()); }
  catch { throw new Error('The file could not be read. Please choose it again.'); }
  if (signal?.aborted) throw abortError();
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value) ||
      bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error('This file is not a valid PNG. Your current tattoo has been kept.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  validateDimensions(header.getUint32(16), header.getUint32(20));
  const source = await readDataUrl(file, signal);
  await decodeImage(source, signal);
  if (signal?.aborted) throw abortError();
  return source;
}
