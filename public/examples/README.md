# Homepage images

The old “How it works” illustration cards have been removed. The homepage now
includes a finished-render showcase followed by artist benefits.

The showcase source is configured in `src/landing/RenderShowcase.tsx` under
`FEATURED_RENDER`. It currently points to `/renders/hero-arm.webp`, matching the
existing hero image. Put the exported image at `public/renders/hero-arm.webp`,
or update that source, alt text and caption for the final selected image.

The source is never cropped: portrait/square images use an image-led two-column
composition; landscape images open into a full-width composition. The original
file can be opened with “View full render.” Until it is available, the page uses
an intentional “coming soon” state without a broken image or active download.

For a different full-resolution original, point the caption link to that asset
while keeping a compressed WebP in the inline showcase.
