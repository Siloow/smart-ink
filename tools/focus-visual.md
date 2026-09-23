# Focus visual regression

`node tools/focus-visual.mjs --stage final --audit-only` runs against the actual male/female GLBs and current production region masks, body shape, pose, clipped-boundary collection and camera helpers. It asserts seam-identical masks, visible distal hand vertices, and full visible-surface/cut-edge framing with a 15% margin. The 1,764 frame checks cover six regions, two bodies, seven pose/shape cases, three viewport aspects and seven camera directions, including the poles.

To generate and inspect the offline images, install NumPy and Pillow for Python 3, then run:

```sh
node tools/focus-visual.mjs --stage final
```

Set `FOCUS_PYTHON=/path/to/python3` when those libraries live in a separate Python environment. Reports go under `reports/focus/<stage>/` and include a combined production-source hash, snapshots, metrics, binary fixtures and PNG sheets. Large intermediate reports are for local review, not required application assets.

The comparison sheets show the previous mask/elevated camera, the previous mask under a level fitted camera, then the current mask at that same camera. Pink highlights fragments that the old numeric-ID interpolation incorrectly assigned to regions absent from the triangle's vertices. The pose/shape sheets include both arms and torso, plus a side arm view. Camera up stays at global Y, so the model's actual arm angle remains visible.

These are perspective-correct CPU renders of actual production geometry and masks, using simple inspection lighting. They verify geometry, masking and framing, not browser materials, animated transitions, or pixel parity with WebGL/Blender.
