#!/usr/bin/env python3
"""
Bake the tone-neutral skin mask set for a body mesh into assets/derived/.

Usage (one body at a time; see tools/bake-body-textures.sh for both):
  blender -b smartink-live/body_full.blend -P tools/bake_body_textures.py -- \
      --prefix body_male_realistic --out assets/derived

The maps are deliberately *tone-neutral*: none of them carries a skin colour.
One texture set therefore serves every swatch in registry.ts, and the tone
stays a parameter in skins.blend rather than being baked in four times.

  <prefix>_cavity.png     ambient occlusion off the multires sculpt. Darkens
                          creases and pore floors. This is what makes pores
                          read as pores instead of as noise.
  <prefix>_curvature.png  surface pointiness, 0.5 = flat. Convex above,
                          concave below. Skin over bony ridges -- knuckles,
                          elbows, knees, clavicles, shins -- is thicker,
                          darker and redder, and those ridges are exactly what
                          the convex half of this map picks out.
  <prefix>_normal.png     re-bake of the sculpt normals, so the map the
                          renderer already depends on is reproducible from the
                          .blend instead of existing only as a build artifact.

Both derived masks come from the geometry, so they land on the anatomy every
time -- which is the part procedural noise can never get right, because noise
does not know where a knuckle is.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List

import bpy

# The bake reads the sculpt, so it has to run at the level the renderer uses.
BAKE_SAMPLES = 64
# AO reach, as a fraction of the figure's height. Large enough to catch the
# creases between fingers, small enough that a raised arm does not shade the
# ribs beneath it.
AO_DISTANCE_FRACTION = 0.035
# Pointiness clusters in a band a couple of hundredths wide, and where that
# band sits depends on the mesh. Hard-coding a remap produces a flat grey map,
# so the bake is normalised against its own histogram instead.
CURVATURE_PERCENTILE = 2.0


def _parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bake skin mask maps for a body mesh.")
    parser.add_argument("--prefix", required=True, help="Output basename, e.g. body_male_realistic")
    parser.add_argument("--out", default="assets/derived", help="Output directory")
    parser.add_argument("--object", default="Body", help="Mesh object to bake")
    parser.add_argument("--size", type=int, default=4096, help="Bake resolution (square)")
    parser.add_argument("--samples", type=int, default=BAKE_SAMPLES)
    parser.add_argument(
        "--maps",
        default="cavity,curvature",
        help="Comma-separated subset of: cavity, curvature, normal",
    )
    return parser.parse_args(argv)


def _script_args() -> List[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def _prepare_object(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != "MESH":
        raise SystemExit(f"No mesh object named '{name}' in {bpy.data.filepath}")
    if not obj.data.uv_layers:
        raise SystemExit(f"'{name}' has no UVs; nothing to bake into.")

    for other in bpy.data.objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Baking reads the evaluated mesh, so the multires viewport level has to be
    # raised to the render level or the sculpt detail simply is not there.
    for modifier in obj.modifiers:
        if modifier.type == "MULTIRES":
            modifier.levels = modifier.render_levels
            print(f"Multires raised to level {modifier.levels} for baking")
    return obj


def _new_target_image(name: str, size: int, is_data: bool) -> bpy.types.Image:
    image = bpy.data.images.get(name)
    if image is not None:
        bpy.data.images.remove(image)
    image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=True)
    # These are masks, not pictures. sRGB-encoding them on write would bend
    # every value the shader later reads back.
    image.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
    return image


def _bake_material(obj: bpy.types.Object, image: bpy.types.Image, build) -> None:
    """Swap in a throwaway material whose emission is the map being baked."""
    material = bpy.data.materials.new("bake_pass")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (-200, 0)
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    build(material.node_tree, emission)

    # The active image texture node is where Cycles writes the bake.
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target

    obj.data.materials.clear()
    obj.data.materials.append(material)


def _build_cavity(tree, emission, ao_distance: float) -> None:
    ao = tree.nodes.new("ShaderNodeAmbientOcclusion")
    ao.location = (-500, 0)
    ao.samples = 16
    ao.only_local = True
    ao.inputs["Distance"].default_value = ao_distance
    tree.links.new(ao.outputs["Color"], emission.inputs["Color"])


def _build_curvature(tree, emission) -> None:
    """Emit raw pointiness; the useful range is found afterwards, not guessed."""
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    geometry.location = (-500, 0)
    tree.links.new(geometry.outputs["Pointiness"], emission.inputs["Color"])


NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def _erode(mask, iterations: int):
    """Drop the outermost ring of texels from a coverage mask.

    Texels straddling an island boundary are only partly covered by geometry,
    so the bake averages them against empty space and they come out too dark.
    Left in, they normalise into a black outline around every island and read
    as a seam on the model, which is exactly what a mask like this must not do.
    """
    import numpy as np

    for _ in range(iterations):
        eroded = mask.copy()
        for dy, dx in NEIGHBOURS:
            eroded &= np.roll(mask, (dy, dx), axis=(0, 1))
        mask = eroded
    return mask


def _dilate_fill(values, mask, iterations: int):
    """Grow trusted interior values outward to replace the discarded edge ring.

    This is the same job Blender's bake margin does, redone after the erosion
    so the bleed carries clean interior values rather than the contaminated
    boundary ones.
    """
    import numpy as np

    values = values.copy()
    mask = mask.copy()
    for _ in range(iterations):
        if mask.all():
            break
        for dy, dx in NEIGHBOURS:
            shifted_values = np.roll(values, (dy, dx), axis=(0, 1))
            shifted_mask = np.roll(mask, (dy, dx), axis=(0, 1))
            fill = shifted_mask & ~mask
            values[fill] = shifted_values[fill]
            mask |= fill
    return values, mask


def _finish_map(
    image: bpy.types.Image,
    neutral: float,
    margin: int,
    normalise: bool,
    coverage_threshold: float,
) -> None:
    """Clean island edges, optionally normalise, and fill empty atlas space."""
    import numpy as np

    width, height = image.size
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    pixels = buffer.reshape(height, width, 4)
    values = pixels[:, :, 0].copy()

    covered = _erode(values > coverage_threshold, 2)
    if not covered.any():
        print("  warning: bake produced no covered texels")
        return

    if normalise:
        # Percentiles rather than min/max: a handful of pinched texels would
        # otherwise set the range and flatten everything else back to grey.
        sample = values[covered]
        median = float(np.median(sample))
        low = float(np.percentile(sample, CURVATURE_PERCENTILE))
        high = float(np.percentile(sample, 100.0 - CURVATURE_PERCENTILE))
        spread = max(median - low, high - median, 1e-6)
        print(f"  pointiness median {median:.4f}, band {low:.4f}..{high:.4f}")
        values = np.clip(0.5 + (values - median) / (2.0 * spread), 0.0, 1.0)

    values[~covered] = neutral
    values, filled = _dilate_fill(values, covered, margin)
    values[~filled] = neutral

    for channel in range(3):
        pixels[:, :, channel] = values
    pixels[:, :, 3] = 1.0
    image.pixels.foreach_set(pixels.ravel())


def _save(image: bpy.types.Image, path: str) -> None:
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    print(f"  wrote {path}")


def _bake_multires_normal(obj: bpy.types.Object, image: bpy.types.Image, path: str) -> None:
    """Blender's dedicated multires bake, which is what produced the shipped map."""
    scene = bpy.context.scene
    material = bpy.data.materials.new("bake_normal")
    material.use_nodes = True
    target = material.node_tree.nodes.new("ShaderNodeTexImage")
    target.image = image
    material.node_tree.nodes.active = target
    obj.data.materials.clear()
    obj.data.materials.append(material)

    scene.render.use_bake_multires = True
    scene.render.bake_type = "NORMALS"
    try:
        bpy.ops.object.bake_image()
        _save(image, path)
    finally:
        scene.render.use_bake_multires = False


def main() -> None:
    args = _parse_args(_script_args())
    requested = [m.strip() for m in args.maps.split(",") if m.strip()]

    obj = _prepare_object(args.object)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False

    ao_distance = float(obj.dimensions.z) * AO_DISTANCE_FRACTION
    print(f"Baking {args.prefix} at {args.size}px, AO distance {ao_distance:.3f} u")

    # The atlas has a lot of island edges; too small a margin and mip sampling
    # pulls empty space into the shading at grazing angles.
    margin = max(16, args.size // 128)

    def bake_cavity(img, path):
        _bake_material(obj, img, lambda tree, emit: _build_cavity(tree, emit, ao_distance))
        bpy.ops.object.bake(type="EMIT", use_clear=True, margin=margin)
        # Unoccluded is 1.0, so empty atlas space shades as open skin.
        _finish_map(img, 1.0, margin, normalise=False, coverage_threshold=0.02)
        _save(img, path)

    def bake_curvature(img, path):
        _bake_material(obj, img, _build_curvature)
        bpy.ops.object.bake(type="EMIT", use_clear=True, margin=margin)
        # Raw pointiness on real geometry sits near 0.5, so anything under 0.25
        # is empty space or a half-covered edge texel rather than surface.
        _finish_map(img, 0.5, margin, normalise=True, coverage_threshold=0.25)
        _save(img, path)

    passes = {
        "cavity": bake_cavity,
        "curvature": bake_curvature,
        "normal": lambda img, path: _bake_multires_normal(obj, img, path),
    }

    for name in requested:
        if name not in passes:
            raise SystemExit(f"Unknown map '{name}'. Choose from: {', '.join(passes)}")
        print(f"Baking {name}...")
        image = _new_target_image(f"bake_{name}", args.size, is_data=True)
        passes[name](image, os.path.join(out_dir, f"{args.prefix}_{name}.png"))

    print("Bake complete.")


if __name__ == "__main__":
    main()
