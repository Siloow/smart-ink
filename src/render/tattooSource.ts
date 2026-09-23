/** The example design uses the same preview and export path as uploaded art. */
export const DEFAULT_TATTOO_SOURCE = '/logo.png';

export function resolveTattooSource(uploadedImage: string | null): string {
  return uploadedImage ?? DEFAULT_TATTOO_SOURCE;
}
