# Snapshot rendering

Snapshots use the cinematic Blender materials with the current camera, figure,
tattoo, clothes, studio, and explicit light list. `camera.preserveFraming: true`
disables the legacy 85 mm lens/dolly adjustment: position, aim, and vertical field
of view remain unchanged. Its default aperture is f/8, scaled for the model's
scene units. An explicit aperture still wins. Focus uses the tattoo's optical-axis
depth rather than the longer distance to an off-centre point.

The material changes are restrained: less subsurface blur, gentler sculpt-normal
and oil highlights, less duplicated cavity darkening, subtle fabric fibres and
sheen, and iris texture instead of a uniform red tint. Tattoo pigment receives a
small contribution from the actual underlying skin; the former fixed blue-grey
lift made black ink unnaturally pale on deep skin. Source ink alpha and the body
atlas are unchanged.

A separate tattoo roughness bug is corrected: the old Float Mix replaced skin
roughness with 0.06 instead of adding 0.06, making ink mirror-like. The shader
now explicitly adds an alpha-weighted roughness increment. Blender's
[Mix node documentation](https://docs.blender.org/manual/en/4.5/render/shader_nodes/color/mix.html)
specifies that blend modes apply only to Color, not Float.

These are shading improvements, not new scanned assets. The existing face and
eye-socket geometry, procedural skin colour, simplified scalp locks and fitted
garment shells remain visibly synthetic in close portraits. The renderer does
not provide scan-quality photorealism. AgX in Blender and ACES in the viewport,
plus real area-light transport versus the viewport approximation, also mean
their pixels are not identical.

## Verification

- `python tools/render-realism.test.py`: production server validation for the
  framing flag, preserved camera values and malformed requests.
- `Blender -b -t 2 --python tools/render-realism-native.py -- --assets /path/to/smartink-live --output reports/realism/verified --render --cases male-tattoo,male-dark-tattoo,female-portrait,male-clothing`
  builds real scenes, checks camera/FOV, aperture, off-axis focus, legacy lens
  behavior, chosen lights, normal textures, fabric nodes, pigment links, and the
  actual selected skin material. Add `--cpu` to force CPU rendering.
- The tattoo fixture is generated from the current body's triangle UVs with
  atlas padding; it does not rely on an old UV layout. The deep-skin case uses
  the UI's `tone_07` / `skin_deep` material.
- Before/after visual comparisons use identical camera, f/8, lights, output
  dimensions and samples. A saved prior importer can be supplied with
  `--importer /path/to/baseline-importer.py --baseline`; the baseline option
  suppresses its legacy lens compression only for a fair material comparison.

Native results and images are written beside the requested output directory.
