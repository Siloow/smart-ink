# Pose regression and visual audit

Run the actual GLB/production-code regression with `node tools/body-pose.test.mjs`.
It checks both body models, every control endpoint and preset, mixed shape extremes,
seeded combinations, intermediate poses, and the discovered narrow-shoulder regression.
It verifies linked limits, non-accumulation, rigid hands/feet/head, exact reset, seam
continuity, tattoo anchors/UVs, and real GLB tangent frames.

Generate the evidence with `node tools/body-pose-visual.mjs --stage current`.
Python requires NumPy and Pillow; set `BODY_POSE_PYTHON` to its executable if needed.
Use `--audit-only` for metrics, `--quick` for presets/stress pictures, or
`--render-only --case female-preset-flex` to inspect an existing fixture quickly.

Outputs are under `reports/body-pose/<stage>/`. `preset-gallery.png` shows both
figures in every preset with diagnostic tattoos. The `*-endpoints-*.png` sheets
show each control at both limits from front, the controlled side, and back.
Source snapshots, their combined hash, poses, shape values, meshes and metrics
are retained alongside the pictures for reproducibility.

These are CPU renders of the actual production geometry, not browser screenshots.
Joint skin stretches during bending. The audit checks triangle collapse and edge
strain; rotating a face normal past 90 degrees is deliberately not considered a
failure. These checks do not prove the absence of every possible self-intersection.
