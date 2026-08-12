"""
Build a right-arm armature on human.obj and export a skinned GLB for the
Smart Ink editor preview (elbow bend + UV tattoo deformation test).

Usage:
  blender -b --factory-startup -noaudio --python rig_human_arm.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OBJ_PATH = ROOT / "human.obj"
OUT_GLB = ROOT / "human_arm_rig.glb"
OUT_BLEND = ROOT / "assets" / "human_arm_rig.blend"

ARM_CHAIN = ["r_shoulder", "r_upperarm", "r_forearm", "r_hand"]
HAND_GROUPS = [
    "r_thumb1",
    "r_thumb2",
    "r_thumb3",
    "r_index1",
    "r_index2",
    "r_index3",
    "r_mid1",
    "r_mid2",
    "r_mid3",
    "r_ring1",
    "r_ring2",
    "r_ring3",
    "r_pinky1",
    "r_pinky2",
    "r_pinky3",
]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for item in list(block):
            block.remove(item)


def import_human() -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(
        filepath=str(OBJ_PATH),
        use_split_objects=True,
        use_split_groups=False,
        import_vertex_groups=True,
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
    )
    imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not imported:
        raise RuntimeError(f"No mesh imported from {OBJ_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for o in imported:
        o.select_set(True)
    bpy.context.view_layer.objects.active = imported[0]
    if len(imported) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "HumanBody"
    print("vertex groups:", [g.name for g in body.vertex_groups])
    return body


def centroid_of_group(body: bpy.types.Object, name: str) -> Vector | None:
    vg = body.vertex_groups.get(name)
    if not vg:
        return None
    idx = vg.index
    points: list[Vector] = []
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == idx and g.weight > 0.01:
                points.append(body.matrix_world @ v.co)
                break
    if not points:
        return None
    acc = Vector((0.0, 0.0, 0.0))
    for p in points:
        acc += p
    return acc / len(points)


def group_points(body: bpy.types.Object, name: str) -> list[Vector]:
    vg = body.vertex_groups.get(name)
    if not vg:
        return []
    idx = vg.index
    pts: list[Vector] = []
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == idx and g.weight > 0.01:
                pts.append(body.matrix_world @ v.co)
                break
    return pts


def joint_along_arm(body: bpy.types.Object) -> dict[str, Vector]:
    """Estimate anatomical joints from group point clouds along the arm axis."""
    pts = []
    for name in ARM_CHAIN:
        pts.extend(group_points(body, name))
    if len(pts) < 8:
        raise RuntimeError("Not enough arm vertices to place bones")

    # PCA main axis
    n = len(pts)
    mean = Vector((0, 0, 0))
    for p in pts:
        mean += p
    mean /= n
    # covariance via power iteration for principal axis
    axis = Vector((0.0, 1.0, 0.0))
    for _ in range(24):
        acc = Vector((0, 0, 0))
        for p in pts:
            d = p - mean
            acc += d * d.dot(axis)
        if acc.length < 1e-12:
            break
        axis = acc.normalized()

    hand_c = centroid_of_group(body, "r_hand")
    shoulder_c = centroid_of_group(body, "r_shoulder")
    if hand_c and shoulder_c and (hand_c - shoulder_c).dot(axis) < 0:
        axis = -axis

    def mean_t(name: str) -> float:
        local = group_points(body, name)
        if not local:
            raise RuntimeError(f"empty group {name}")
        return sum((p - mean).dot(axis) for p in local) / len(local)

    t_shoulder = mean_t("r_shoulder")
    t_upper = mean_t("r_upperarm")
    t_fore = mean_t("r_forearm")
    t_hand = mean_t("r_hand")

    # Joints sit between segment means so bones have usable length.
    t_sh_joint = t_shoulder
    t_elbow = 0.5 * (t_upper + t_fore)
    t_wrist = 0.5 * (t_fore + t_hand)
    t_hand_end = t_hand + abs(t_hand - t_wrist)

    def at(t: float) -> Vector:
        return mean + axis * t

    joints = {
        "r_shoulder": at(t_sh_joint),
        "r_upperarm": at(t_elbow),  # upperarm bone tail / forearm head = elbow
        "r_forearm": at(t_wrist),
        "r_hand": at(t_hand_end),
    }
    print("arm axis", tuple(round(x, 4) for x in axis))
    print("t means", t_shoulder, t_upper, t_fore, t_hand)
    print("joints", {k: tuple(round(x, 3) for x in v) for k, v in joints.items()})
    return joints


def create_armature(body: bpy.types.Object) -> bpy.types.Object:
    joints = joint_along_arm(body)

    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm_obj = bpy.context.object
    arm_obj.name = "Armature"
    arm = arm_obj.data
    arm.name = "Armature"

    edit = arm.edit_bones
    for b in list(edit):
        edit.remove(b)

    root = edit.new("root")
    root.head = Vector((0.0, 0.0, 0.0))
    root.tail = Vector((0.0, 0.0, 0.2))

    # Chain: shoulder (clav/shoulder) -> upperarm -> forearm -> hand
    # Bone head/tail:
    #  r_shoulder: root-ish shoulder joint -> elbow? No:
    #  r_shoulder head=shoulder, tail=elbow start of upperarm
    # Actually: 
    #  r_shoulder: shoulder -> mid-upper (or elbow for simplicity use shoulder->elbow as upperarm)
    #
    # Simpler 3-bone deform chain used by weights:
    #  r_shoulder: shoulder joint -> elbow (covers shoulder+upperarm skin)
    # Wait - we have 4 weight groups. Map bones:
    #  r_shoulder bone: shoulder -> upperarm mean
    #  r_upperarm bone: upperarm mean -> elbow
    #  r_forearm bone: elbow -> wrist
    #  r_hand bone: wrist -> hand end

    shoulder = joints["r_shoulder"]
    elbow = joints["r_upperarm"]
    wrist = joints["r_forearm"]
    hand_end = joints["r_hand"]
    # mid upperarm between shoulder and elbow
    mid_upper = shoulder.lerp(elbow, 0.55)

    def add(name: str, parent, head: Vector, tail: Vector):
        b = edit.new(name)
        b.parent = parent
        b.use_connect = False
        if (tail - head).length < 1e-4:
            tail = head + Vector((0.0, 0.05, 0.0))
        b.head = head
        b.tail = tail
        return b

    b_sh = add("r_shoulder", root, shoulder, mid_upper)
    b_up = add("r_upperarm", b_sh, mid_upper, elbow)
    b_fo = add("r_forearm", b_up, elbow, wrist)
    add("r_hand", b_fo, wrist, hand_end)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def assign_weights(body: bpy.types.Object, arm_obj: bpy.types.Object) -> None:
    # Keep a copy of source group membership before parenting replaces groups.
    source: dict[str, list[int]] = {}
    for g in body.vertex_groups:
        idxs = []
        gi = g.index
        for v in body.data.vertices:
            for item in v.groups:
                if item.group == gi and item.weight > 0.01:
                    idxs.append(v.index)
                    break
        source[g.name] = idxs

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE", keep_transform=True)

    bone_names = ["root", "r_shoulder", "r_upperarm", "r_forearm", "r_hand"]
    for name in bone_names:
        if name not in body.vertex_groups:
            body.vertex_groups.new(name=name)

    n = len(body.data.vertices)
    weights: list[dict[str, float]] = [dict() for _ in range(n)]

    mapping: dict[str, str] = {name: name for name in ARM_CHAIN}
    for name in HAND_GROUPS:
        mapping[name] = "r_hand"

    for src_name, bone_name in mapping.items():
        for vi in source.get(src_name, []):
            weights[vi][bone_name] = 1.0

    # Soften elbow: blend upperarm/forearm by projection onto arm axis.
    joints = joint_along_arm(body)
    elbow = joints["r_upperarm"]
    axis = (joints["r_forearm"] - joints["r_shoulder"]).normalized()
    blend = (joints["r_forearm"] - joints["r_shoulder"]).length * 0.12
    blend = max(blend, 0.04)

    for v in body.data.vertices:
        w = weights[v.index]
        if "r_upperarm" not in w and "r_forearm" not in w:
            continue
        world = body.matrix_world @ v.co
        t = (world - elbow).dot(axis)
        x = max(0.0, min(1.0, (t + blend) / (2 * blend)))
        s = x * x * (3 - 2 * x)
        upper = w.get("r_upperarm", 0.0)
        fore = w.get("r_forearm", 0.0)
        total = upper + fore
        if total <= 0:
            continue
        w["r_upperarm"] = total * (1.0 - s)
        w["r_forearm"] = total * s

    for i, w in enumerate(weights):
        if not w:
            w["root"] = 1.0

    keep = set(bone_names)
    for vg in list(body.vertex_groups):
        if vg.name not in keep:
            body.vertex_groups.remove(vg)

    for name in bone_names:
        if name not in body.vertex_groups:
            body.vertex_groups.new(name=name)
        body.vertex_groups[name].add(list(range(n)), 0.0, "REPLACE")

    for i, w in enumerate(weights):
        items = sorted(w.items(), key=lambda kv: kv[1], reverse=True)[:4]
        total = sum(v for _, v in items) or 1.0
        for name, value in items:
            body.vertex_groups[name].add([i], value / total, "REPLACE")

    for mod in list(body.modifiers):
        if mod.type == "ARMATURE":
            body.modifiers.remove(mod)
    mod = body.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    mod.use_vertex_groups = True


def strip_accessory_faces(body: bpy.types.Object) -> None:
    hide_keys = ("eye", "lash", "tear", "brow", "moisture", "mouth", "tooth", "teeth")
    remove = {
        i
        for i, slot in enumerate(body.material_slots)
        if slot.material and any(k in slot.material.name.lower() for k in hide_keys)
    }
    if not remove:
        return
    mesh = body.data
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="OBJECT")
    for poly in mesh.polygons:
        poly.select = poly.material_index in remove
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")


def export_glb(arm_obj: bpy.types.Object, body: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    if not OBJ_PATH.exists():
        print(f"Missing {OBJ_PATH}", file=sys.stderr)
        sys.exit(1)

    clear_scene()
    print("Importing", OBJ_PATH)
    body = import_human()
    strip_accessory_faces(body)

    missing = [n for n in ARM_CHAIN if n not in body.vertex_groups]
    if missing:
        raise RuntimeError(f"Missing arm vertex groups after import: {missing}")

    print("Creating armature…")
    arm_obj = create_armature(body)
    print("Assigning weights…")
    assign_weights(body, arm_obj)

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    print("Exporting", OUT_GLB)
    export_glb(arm_obj, body)

    for b in arm_obj.data.bones:
        print(
            "bone",
            b.name,
            "len",
            round((b.tail_local - b.head_local).length, 4),
            "head",
            tuple(round(x, 3) for x in b.head_local),
        )
    print("verts", len(body.data.vertices))
    print("Done.")


if __name__ == "__main__":
    main()
