# Measurement mode

Open **Figure → Measure body** in the editor. The existing canvas becomes a 15-step guide with camera transitions, highlighted tape sections and an input card styled with the editor tokens. Both shipped body models are supported. Review supports editing individual values. Exit/Escape discards the draft; Fit my body applies a completed fit as one undoable edit.

The calculation runs in a Web Worker, using versioned male/female assets under `public/measurements/`. It needs no local Python server or new hosted endpoint. Assets are gzip bytes with a `.bin` extension so static hosts do not decompress them before the explicit browser decompression step. The two assets total about 1.8 MB and load only when needed.

The fit preserves triangle order and UVs. It is applied before existing posing, clothing and tattoo behavior. Its recipe and measurements are saved in scene JSON, restored on reopening and included in undo/redo. Switching models removes the old fit; undo can restore it. Remove measurement fit returns to the existing shape controls. Invalid combinations, inverted/collapsed faces, or fits outside the 2 mm numerical circumference tolerance are rejected without replacing the previous body. This is a template fit with estimated anatomical landmarks, not a body scan or a guarantee of personal anatomy accuracy.

## Current output scope

Viewport previews, image exports, Blender snapshots and render exports all use the saved measurement recipe. The shot builder copies that recipe before asynchronous tattoo baking and omits the previous shape sliders. Blender replays the same versioned deformation basis before the existing pose, region cut, clothing and skin pipeline.

The browser mesh splits UV seams and has quantized positions. Blender retains its original multires cage, maps each undeformed vertex to the browser basis within 0.15 mm, and transfers its displacement. This preserves the native UVs, topology and sculpt detail. A different mesh version or an inverted/collapsed fit fails explicitly. Legacy shots without a fit keep their existing behavior.

The worker bundles the same `public/measurements/*-v1.bin` assets. Deploy worker support before enabling the frontend; an older worker does not understand the fit field. Renderer rollout keeps the existing endpoint, GPU pool, scale-to-zero and max-one-worker settings.

## Verification

- `npm run test:measurements`: eight male/female baseline/slimmer/fuller/taller cases compared to independently generated SciPy reference geometry; maximum sampled geometry difference below 0.1 mm, tested circumference error below 0.4 mm. Height and inseam landmarks, invalid inputs, profile normalization and save/reload reconstruction checked.
- `npm run test:demo`, `npm run typecheck`, `npm run lint`, `npm run build` passed. Build output is below the existing 25 MB limit.
- Browser: all 15 steps for male and female; blank validation; review editing; actual fitting; reopen values; cancellation; scene navigation/save; undo/redo; temporary neutral pose and restoration; desktop and 390 × 844 layout with expanded tips. No browser console errors after the asset loading correction.
- Real mobile software keyboard was not tested.
- `node tools/measurement-render.test.mjs`: all 12,010 template vertices agree between browser and Python to 1e-12 metres across eight male/female fits.
- `python tools/measurement-server.test.py`: valid recipes, invalid versions/values, model mismatch, incompatible shape sliders and legacy requests.
- Native Blender: eight fits retain UVs/topology/multires; all cage vertices remain within 0.09 mm of the browser surface; posed textured render checked visually. Run `/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python tools/measurement-blender.test.py -- --render /tmp/measured-body/fitted.png` (or `blender` on Linux).
- Container CI renders both a legacy job and a measured job through the real worker SDK before publishing its image.

Assets were generated from the original-mesh prototype at commit `19abc9e`, using its `FullBody` descriptors and shipped meshes. To regenerate, run `tools/export-measurement-assets.py /path/to/experiments/original-mesh` in that prototype's numpy/scipy/trimesh environment. The numerical fixture in `tools/fixtures/measurement-reference.json` is the independent SciPy solver's sampled output, not browser-solver output.
