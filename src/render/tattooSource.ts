/** The example design uses the same preview and export path as uploaded art. */
export const DEFAULT_TATTOO_SOURCE = '/logo.png';

export function resolveTattooSource(uploadedImage: string | null): string {
  if (uploadedImage === '/tattoos/ornamental-dagger.png') return '/tattoos/ornamental-dagger.png?v=transparent-2';
  return uploadedImage ?? DEFAULT_TATTOO_SOURCE;
}
