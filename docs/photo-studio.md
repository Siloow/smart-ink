# Photo studio viewport

Open **Photo studio** in the right-hand Inspector and choose **Studio sweep**. The backdrop is a curved paper sweep, with six paper colors, a custom color picker and adjustable ground-shadow strength. The floor follows the actual reshaped/posed body bounds and the sweep turns with the camera. Focus views retain the color and hide the floor; viewing from below also hides the floor. Fast mode disables ground shadows.

The **Lighting** panel provides six starting looks: soft portrait, left/right softbox, rim portrait, editorial and warm gels. Select a light in the top-down map or the Key/Fill/Rim/Room fill buttons. Drag a map marker around the figure, or use its arrow keys. The selected light offers brightness, color, softness, height, distance and aiming-height controls. Turn individual lights off, reset only the selected light, or reset the whole setup. Position controls use fixed studio directions relative to the figure: the front of the figure is at the bottom of the map.

**Show lights in the studio** reveals selectable softbox guides and the selected aiming line. These guides disappear in Photo mode and image exports. A guide in front of the skin owns the click; an occluded guide behind the figure cannot block tattoo placement. The map remains the direct way to move lights regardless of where the camera is pointing.

Studio settings and the full custom light list save with each scene. Blender exports now honor custom lights in preview and cinematic modes, including individual off switches and an explicitly empty rig. The chosen backdrop color does not secretly illuminate the body. Older saved scenes use the simple viewport background until a sweep is selected; the original background selector still supplies simple canvas colors/gradients. Simple gradients export to Blender using their first color.

The preview uses four emitter samples per softbox, matching the skin and standard-material lighting directions and energy. Spotlight cones and target positions are honored. Floor shadows average the samples so increasing softness does not multiply the shadow darkness. Skin uses the same tone-mapping pipeline as the clothing and backdrop. Body shadow passes respect both Focus and clothing masks.

The viewport is an interactive studio approximation. Blender uses continuous physical area lights and can differ in reflections, shading and shadow shape. The ground-shadow control uses an opacity overlay in the viewport and a camera-only flat/lit material blend in Blender. This keeps the control lightweight in both renderers; it is not a claim of pixel-identical output.

## Checks

- `npm run test:studio` covers real controls and pointer/keyboard handlers, bounded edits, preset preservation, settings migration/export, sweep geometry and production backdrop updates, real Three targets, sample energy, spot cones, empty/disabled rigs, masked shadows and helper ownership.
- `npm run test:demo` includes all existing tattoo placement, upload, save/load, figure, pose, Focus, appearance and studio regressions.
- `npm run test:studio-server` checks server/importer validation, paper geometry and emitter parameters.
- Native Blender audit: `Blender -b -t 2 --python tools/studio-native.py -- --assets /path/to/smartink-live --output reports/studio/blender --render`.
- Offline diffuse diagnostics: `node tools/studio-lighting-visual.mjs`, then Python with NumPy/Pillow running `tools/studio-lighting-visual.py reports/studio/preview-lighting`.

Generated evidence lives under `reports/studio/`. The native audit covers both bodies, posed floor height, sweep/plain modes, all-disabled and empty lights, preview/cinematic styles, Focus, below-floor cameras and legacy contracts.

Live browser automation was unavailable: the browser-control service could not verify the admin-enforced policy. Validation therefore uses actual component handlers, geometry/material updates, offline lighting diagnostics and native Blender renders. These checks do not establish live WebGL pixel parity or browser interaction performance.
