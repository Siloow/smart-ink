# Cinematic snapshot presets

Open Snapshot, then choose Editorial, Sculpted light or Ink detail under Choose a look. Each applies a lens, camera angle, light rig, background and depth of field. Camera and lighting controls remain available for adjustment. Ink detail intentionally crops closer; Editorial is the safest starting point for the complete design.

The rig rotates around the tattoo-facing camera and targets the tattoo center, including back and limb placements. The preset does not change body measurements, pose or tattoo placement. The current custom setup remains the default when opening Snapshot.

The Blender material uses finer, weaker cell relief, less coat/specular shine and shallower subsurface scattering to reduce the stamped-cell and waxy appearance in close-ups. These changes improve presentation; they do not replace the underlying model with a scan.

## Render verification

`node tools/cinematic-preset-fixtures.mjs` creates three contracts using the production framing and lighting functions. Run `tools/cinematic-preset-renders.py` in background Blender from the repository to generate 960 × 1200, 256-sample render proofs in `/tmp/smartink-cinematic`. It uses the existing botanical rose asset on the actual native male model. The three preview JPEGs in `public/renders/presets` are resized copies of these renders, not simulated mockups.

Optional: put the previous sceneImporter.py at `/tmp/smartink-cinematic/baseline.py` to render the same detail shot with the previous skin material for comparison.

Automated coverage: front/back/side/pole framing, portrait/square/landscape aspects, light orientation, valid render contracts, preserved preset depth of field in Quick and Detailed, actual Workspace capture, and existing snapshot/export regression tests. Native Blender proofs were inspected directly. Browser visual verification was unavailable during implementation because browser security policy verification failed.
