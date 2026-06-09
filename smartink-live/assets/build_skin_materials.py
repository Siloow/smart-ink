#!/usr/bin/env python3
"""
Build photoreal procedural skin materials in skins.blend.

Run from repo root:
  blender -b smartink-live/assets/skins.blend -P smartink-live/assets/build_skin_materials.py

Keeps a Principled BSDF as the surface shader so apply_uv_ink_layer can mix tattoos
into Base Color.
"""

from __future__ import annotations

import bpy
from mathutils import Color

# Mirrors sceneImporter.py SKIN_TONES / registry.ts swatches
SKIN_TONES = {
    "skin_fair": (0.945, 0.788, 0.647),
    "skin_medium": (0.831, 0.647, 0.455),
    "skin_tan": (0.663, 0.467, 0.294),
    "skin_deep": (0.420, 0.263, 0.153),
}


def _shift_rgb(rgb: tuple[float, float, float], red: float = 0.0, darken: float = 0.0) -> tuple[float, float, float]:
    r, g, b = rgb
    r = max(0.0, min(1.0, r + red))
    g = max(0.0, min(1.0, g - darken * 0.5))
    b = max(0.0, min(1.0, b - darken))
    return (r, g, b)


def build_skin_material(name: str, base_rgb: tuple[float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (520, 0)

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.label = "Skin BSDF"
    bsdf.location = (220, 0)
    if hasattr(bsdf, "subsurface_method"):
        bsdf.subsurface_method = "RANDOM_WALK"

    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    # --- Procedural albedo: subtle large-scale tone variation ---
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-1180, -120)

    mapping = nodes.new("ShaderNodeMapping")
    mapping.location = (-980, -120)
    mapping.inputs["Scale"].default_value = (2.5, 2.5, 2.5)
    links.new(tex_coord.outputs["UV"], mapping.inputs["Vector"])

    color_noise = nodes.new("ShaderNodeTexNoise")
    color_noise.label = "Skin tone variation"
    color_noise.location = (-760, -40)
    color_noise.inputs["Scale"].default_value = 6.0
    color_noise.inputs["Detail"].default_value = 4.0
    color_noise.inputs["Roughness"].default_value = 0.55
    links.new(mapping.outputs["Vector"], color_noise.inputs["Vector"])

    color_ramp = nodes.new("ShaderNodeValToRGB")
    color_ramp.label = "Variation mask"
    color_ramp.location = (-540, -40)
    color_ramp.color_ramp.elements[0].position = 0.38
    color_ramp.color_ramp.elements[1].position = 0.62
    links.new(color_noise.outputs["Fac"], color_ramp.inputs["Fac"])

    base_a = nodes.new("ShaderNodeRGB")
    base_a.label = "Base tone"
    base_a.location = (-540, 180)
    base_a.outputs[0].default_value = (*base_rgb, 1.0)

    base_b = nodes.new("ShaderNodeRGB")
    base_b.label = "Warm variation"
    base_b.location = (-540, 20)
    warm = _shift_rgb(base_rgb, red=0.04, darken=0.06)
    base_b.outputs[0].default_value = (*warm, 1.0)

    albedo_mix = nodes.new("ShaderNodeMix")
    albedo_mix.label = "Albedo"
    albedo_mix.data_type = "RGBA"
    albedo_mix.blend_type = "MIX"
    albedo_mix.location = (-280, 120)
    albedo_mix.inputs["Factor"].default_value = 0.35
    links.new(color_ramp.outputs["Color"], albedo_mix.inputs["Factor"])
    links.new(base_a.outputs["Color"], albedo_mix.inputs["A"])
    links.new(base_b.outputs["Color"], albedo_mix.inputs["B"])
    links.new(albedo_mix.outputs["Result"], bsdf.inputs["Base Color"])

    # --- Micro surface detail (pores) via bump ---
    bump_noise = nodes.new("ShaderNodeTexNoise")
    bump_noise.label = "Pore detail"
    bump_noise.location = (-760, -280)
    bump_noise.inputs["Scale"].default_value = 180.0
    bump_noise.inputs["Detail"].default_value = 8.0
    bump_noise.inputs["Roughness"].default_value = 0.65
    links.new(mapping.outputs["Vector"], bump_noise.inputs["Vector"])

    bump = nodes.new("ShaderNodeBump")
    bump.label = "Skin micro-relief"
    bump.location = (-40, -220)
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.0015
    links.new(bump_noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    # --- Roughness variation (breaks up plastic-looking specular blobs) ---
    rough_noise = nodes.new("ShaderNodeTexNoise")
    rough_noise.label = "Roughness variation"
    rough_noise.location = (-760, -480)
    rough_noise.inputs["Scale"].default_value = 24.0
    rough_noise.inputs["Detail"].default_value = 6.0
    rough_noise.inputs["Roughness"].default_value = 0.5
    links.new(mapping.outputs["Vector"], rough_noise.inputs["Vector"])

    rough_range = nodes.new("ShaderNodeMapRange")
    rough_range.label = "Roughness range"
    rough_range.location = (-280, -420)
    rough_range.inputs["From Min"].default_value = 0.0
    rough_range.inputs["From Max"].default_value = 1.0
    rough_range.inputs["To Min"].default_value = 0.55
    rough_range.inputs["To Max"].default_value = 0.78
    links.new(rough_noise.outputs["Fac"], rough_range.inputs["Value"])
    links.new(rough_range.outputs["Result"], bsdf.inputs["Roughness"])

    # --- Principled skin response (matte; skin scatters more than it specular-reflects) ---
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.22
    if "Diffuse Roughness" in bsdf.inputs:
        bsdf.inputs["Diffuse Roughness"].default_value = 0.28
    bsdf.inputs["Subsurface Weight"].default_value = 0.24
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.25, 0.12)
    bsdf.inputs["Subsurface Scale"].default_value = 0.015

    # Slight red scatter tint (more visible on deeper tones)
    scatter = Color(base_rgb)
    scatter.r = min(1.0, scatter.r + 0.08)
    scatter.g *= 0.85
    scatter.b *= 0.7
    if "Subsurface Color" in bsdf.inputs:
        bsdf.inputs["Subsurface Color"].default_value = (scatter.r, scatter.g, scatter.b, 1.0)

    mat.use_fake_user = True
    return mat


def main() -> None:
    for mat_name, rgb in SKIN_TONES.items():
        build_skin_material(mat_name, rgb)
        print(f"Built photoreal material: {mat_name}")

    # Keep one preview mesh assigned if the file has objects
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data.materials:
            medium = bpy.data.materials.get("skin_medium")
            if medium:
                obj.data.materials[0] = medium

    bpy.ops.wm.save_mainfile()
    print("Saved skins.blend")


if __name__ == "__main__":
    main()
