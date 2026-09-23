# Seam-free placement demo

The editor now maps each design onto a continuous local patch of skin, independently of the body’s existing texture atlas. The original atlas still supplies skin detail and receives the baked tattoo for Blender exports.

## Current experiment: fixed size

Automatic size fitting is currently disabled. Moving a tattoo keeps the selected size; preview and export use that same size. The safe-size calculation remains in the code and can be restored by setting `AUTO_FIT_TATTOO_SIZE` to `true` in `ModelWithUVTattoo.tsx`. The earlier safe-fit validation below describes the original bounded behavior. Surface connectivity and placement rejection remain active; large artwork can reach the edge of the local surface patch.

The shoulder/armpit duplication is now clipped: only one connected, non-overlapping sheet of the flattened skin map can receive ink. This preserves the selected size and mapping coordinates. Conflicting triangles lose their ink rather than repeating part of the design on the chest. Difficult folds can therefore leave clipped artwork or small gaps. The body itself remains intact, and preview/export use the same per-triangle support.

## Demo controls

1. Upload a PNG, then click the skin to place it.
2. Drag normally to orbit. Hold **⌘** or **Ctrl** while dragging to move the tattoo.
3. Use **Focus** to isolate the torso, an arm, or a leg, then choose a camera angle.
4. Rotate and scale with the tattoo controls. The image keeps its original proportions.
5. **Show before / Show tattoo** compares the result without deleting the placement.
6. Size stays at the selected value as you move between body areas. An unsuitable folded area retains the last valid placement.

Placements are saved as a triangle and barycentric coordinates, and follow body shape changes. Existing older scenes that never saved a placement anchor need one new click to place their design.

## Approach and tradeoffs

The mesh’s coincident vertices are joined for placement calculations, including vertices split by UV seams. A connected skin patch is flattened using least-squares conformal mapping; it minimizes local angle distortion rather than projecting the image through the body. The same coordinates drive preview and export. The method is based on [Lévy et al., Least Squares Conformal Maps (SIGGRAPH 2002)](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levy02.pdf).

With automatic fitting enabled, the tattoo footprint stays inside a checked circle so arbitrary rotation remains safe. Folded or excessively distorted triangles reduce the fitted size. In the current fixed-size experiment, that size limit is calculated but not applied. This is local tattoo placement, not a full-circumference sleeve tool. Curved skin necessarily changes a flat design somewhat; limits are intended to keep that change reasonable. The included body-part views remain available for working on difficult angles.

Exports snapshot the placed geometry before asynchronous image loading, preserve straight alpha, and pad only the space outside atlas islands. Source image proportions, tint, opacity, and rotation use the same sampling convention in the editor and atlas bake.

## Validation

Run from the project directory:

```sh
npm run typecheck
npm run lint
npm run build
npm run test:placement
node tools/surface-placement.test.mjs --sweep
```

The focused tests cover both male and female bodies: sternum, abdomen, back, side ribs, shoulders, upper arms, forearms, thighs, knees, calves, and feet. They also cover square, portrait, and landscape designs at 0°, 45°, 90°, and 180°; samples across each maximum-sized footprint; continuous dragging across a real sternum seam; malformed saved anchors; nearby disconnected surfaces; and UV seams split at every edge on analytical plane/cylinder/sphere fixtures.

Saved anchors also round-trip through JSON with identical rebuilt coordinates. Thirty-two shape/placement combinations cover both bodies, chest and forearm, all six presets, and all-slider minimum/maximum extremes; tattoo coordinates and seam connections survive deformation and reset.

A dense front/back sweep exercised 452 mesh locations: 447 accepted, 5 safely restricted. Accepted charts had finite coordinates, a centered anchor, and identical coordinates on both sides of atlas seams. With overlap rejection, typical limb charts took about 8–20 ms; the dense sweep measured a 95th percentile around 47–52 ms and a worst case around 78 ms on this machine.

Save/navigation tests use controlled asynchronous storage to check immediate navigation, edits arriving during a save, cross-scene write ordering, and unmount flushing.

Export tests cover straight alpha, island-edge padding without thicker artwork, isolation from live edits, and cleanup after image-loading failure.

Fixed-size overlap regression: 108 offline cases cover both bodies, shoulder/upper arm/armpit, sizes 0.42/0.7/1.0, rotations 0°/45°/90°, and grid/arrow designs. Previously 46 cases duplicated source pixels; after per-triangle rejection, none did (maximum sampled copies: 2 → 1). Every case kept exactly the same size and anchor. Another 110,592 geometry coverage samples include size 1.26 with no duplication. See the [fixed-size before/after comparison](placement-overlap-fix.png). These checks measure sampled coverage, while the implementation rejects positive-area intersections between retained triangles.

The face-mask integration test checks every original face anchor and atlas coordinate on both models, independent masking of neighboring triangles, and four body shapes after expanding the render geometry. It also checks that preview and export receive the same attributes.

Offline visual comparisons use the actual Draco-decoded body meshes and production placement coordinates, with a CPU rasterizer comparing the new chart, original atlas placement, and planar projection. They are geometry/placement evidence, not screenshots of the WebGL app. See [body-area comparisons](placement-comparison.png), [rotation and scale](placement-rotation-scale.png), and [opposite-side checks](placement-bleed-check.png). The atlas and planar columns are baseline mappings; the planar baseline is unbounded, not a recreation of every depth/mask safeguard in earlier experimental branches.

To regenerate the evidence, run `node tools/placement-render.mjs`. This requires Python with NumPy and Pillow; set `PLACEMENT_PYTHON` to choose the Python interpreter. The script rebuilds against the current placement source and writes `reports/placement/`. For the current fixed-size shoulder/armpit regression, run `node tools/placement-render.mjs --fixed-size --stage current`.

An interactive diagnostic page is available during development at `/tools/placement-lab.html`.

**Remaining verification limit:** browser automation was blocked by an unavailable browser access-policy check. Blender also crashed on startup in this environment. Therefore the full interactive WebGL flow and actual Blender final renders have not been visually certified. Source checks, geometry tests, export lifecycle tests, and offline rendered comparisons passed. Before the live demo, exercise one upload → placement → rotate/scale → save/reopen → export sequence in your browser.
