import * as THREE from 'three';

/** Raycaster traverses invisible children too. A garment's triangle indices
 * never belong to the body mesh and must not become a saved tattoo anchor. */
export function appearanceHit(object: THREE.Object3D): 'clothing' | 'hair' | 'eyes' | 'hidden' | null {
  let kind: 'clothing' | 'hair' | 'eyes' | null = null;
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return 'hidden';
    if (node.userData.previewAppearance === 'clothing' || node.userData.previewAppearance === 'hair' || node.userData.previewAppearance === 'eyes') kind = node.userData.previewAppearance;
  }
  return kind;
}

export function disposeAppearance(group: THREE.Group): void {
  group.removeFromParent();
  const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => materials.add(m));
  });
  geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
}
