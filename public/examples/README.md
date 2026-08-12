# Landing page examples

The three "How it works" cards on the landing page ship with drawn technical
figures (`src/landing/PipelineFigures.tsx`) so the page never depends on assets
that don't exist yet. Each one can be replaced with a real capture.

## Replacing a figure

1. Put the image in this folder, e.g. `placement.png`.
2. Point the matching key at it in `EXAMPLE_IMAGES` in `src/LandingPage.tsx`:

```ts
const EXAMPLE_IMAGES: Record<StepKey, string | null> = {
  artwork: null,
  placement: '/examples/placement.png',
  render: null,
};
```

Anything still set to `null` keeps using its drawn figure, so you can swap them
in one at a time.

## What each slot wants

| Key | Shows | Notes |
| --- | --- | --- |
| `artwork` | The flat design going in | A transparent PNG on a dark card reads best. |
| `placement` | The design on the mesh in the editor | Crop to the viewport — leave the panels out. |
| `render` | The finished Cycles render | This is the one that sells it. Worth the most effort. |

Aim for a roughly 14:13 ratio (the drawn figures are 280×260) so the cards stay
the same height, and keep each file under a few hundred KB — they load on first
paint. Images are drawn with `object-fit: contain`, so an off-ratio image is
letterboxed rather than cropped.
