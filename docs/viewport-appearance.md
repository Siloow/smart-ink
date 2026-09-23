# Clothes and hair in the viewport

The **Appearance** section sits below the figure selector in the right-hand editor panel.

- **Casual** selects a T-shirt and trousers. **T-shirt & shorts** leaves more of the legs exposed.
- Top and bottoms can be selected independently, with cream, charcoal, navy, sage and burgundy colors.
- Hair offers None, Buzz cut and Short hair in six tones. Hair selection is independent of the outfit.
- **No clothes** preserves hair and colors. **Reset appearance** clears clothes and hair and restores default colors.
- Choices are saved with the scene and included in browser snapshots and Blender render requests. Older saved scenes start with no clothes and no scalp hair.

Clothes automatically disappear in any **Focus** view so tattoos remain accessible. Returning to Full figure restores the outfit. Hair stays visible only in the full figure and Head Focus. For scalp tattoos, choose Hair → None.

Clothing and hair follow figure proportions and poses. Garment meshes are relaxed before posing and then follow the local skin frame. Clothing masks the skin underneath, preventing skin or tattoos from poking through. Clicking a covered area does not place a tattoo behind the fabric; the placement message explains how to expose the skin. Adding or removing appearance meshes does not change the body origin, UVs, saved tattoo anchors, or tattoo size.

The initial styles are lightweight generated geometry: a casual T-shirt, straight cropped trousers, shorts, buzz cut and short swept hair. They do not use cloth simulation. The simple fabric follows the skin at joints; it does not simulate folds or free-hanging fabric. The viewport and Blender share the garment and scalp geometry algorithm. Lighting, skin shading and cinematic eyebrows/lashes can differ.

## Verification

`npm run test:appearance` exercises the actual appearance controls, migration, contracts, 48 actual Model effect rebuilds with stable body origin and tattoo anchors, accessory ray ownership/disposal, both shipped body meshes, clothing coverage, hair attachment, shape/pose limits, deterministic rebuilding and preview/Python geometry parity. `npm run test:demo` also includes the existing placement, saving, upload, lighting/export, body adjustment, pose and Focus regressions.

`npm run test:appearance-server` checks server validation, supported choices and colors, legacy contracts, both render styles and every Focus region.

Visual inspection sheets use the actual generated geometry:

- `node tools/clothing-visual.mjs final`, then `python3 tools/clothing-visual.py reports/clothing/final` (NumPy and Pillow required).
- `node tools/hair-visual.mjs` (see `tools/hair-visual.md` for the Python environment override).

Generated inspection artifacts are ignored under `reports/clothing`, `reports/hair` and `reports/appearance`.

Native Blender checks are available with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python tools/appearance-native.py -- --assets "$PWD/smartink-live" --output "$PWD/reports/appearance/blender" --render
```

The native audit covers both figures, casual outfits, posed shorts, arm/head Focus, preview/cinematic styles, explicit no-hair and legacy contracts. It verifies that garment creation preserves body positions, topology, UVs and centering, that separate objects follow the final posed body transform, and that hidden skin cannot emit body hair through clothing.

Direct browser interaction could not be exercised in this session because the browser-control security check was unavailable. The visual evidence comes from the production mesh generators and native Blender renders, with the actual Model update/picking callbacks exercised separately.
