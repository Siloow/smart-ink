# Viewport hair checks

Run `node tools/hair.test.mjs` for actual male/female GLB regressions. The checks cover none/buzz/short, all six tones, head shape and pose limits, deterministic rebuilding, no source-mesh changes, and rigid attachment through rotation/translation. Hair remains under 8,000 triangles per figure.

Generate close front/side/back geometry inspection sheets with:

```sh
node tools/hair-visual.mjs
```

This needs Python 3 with NumPy and Pillow. Set `HAIR_PYTHON=/path/to/python3` if these libraries live in a separate environment. Outputs are under `reports/hair/final/`: male/female style and head-pose sheets, six-tone sheet, and actual generated geometry buffers. Rendering uses production `previewHair.ts`, `bodyShape.ts` and `bodyPose.ts`; the inspection shader uses simple CPU lighting and does not establish WebGL/Blender pixel parity.

Hair is parented to the body mesh. Rebuild after shape, pose, style or tone changes and dispose its previous geometry/material through `disposePreviewHair`. `createHairCoverage` is original-vertex data for protecting scalp tattoo picks; it remains attached as the figure deforms. Show the group in full-figure and head Focus only.
