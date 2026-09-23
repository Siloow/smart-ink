import * as THREE from 'three';
import {
  buildSurfaceChart,
  createSurfaceTopology,
  validateSurfaceAnchor,
  type SurfaceAnchor,
  type SurfaceChart,
} from '../render/surfacePlacement';

const HERO_MESH_ID = 'hero-forearm';

/** Use the editor's triangle + barycentric skin anchor, independent of UV seams. */
export function heroAnchorFromHit(hit: THREE.Intersection): SurfaceAnchor | null {
  const mesh = hit.object as THREE.Mesh;
  if (!mesh.isMesh || !hit.face || hit.faceIndex == null) return null;
  const local = mesh.worldToLocal(hit.point.clone());
  const positions = mesh.geometry.getAttribute('position');
  const vertices = [hit.face.a, hit.face.b, hit.face.c].map(
    (i) => new THREE.Vector3().fromBufferAttribute(positions, i),
  );
  const bary = THREE.Triangle.getBarycoord(local, vertices[0], vertices[1], vertices[2], new THREE.Vector3());
  if (!bary) return null;
  const anchor: SurfaceAnchor = {
    bodyMeshId: HERO_MESH_ID,
    faceIndex: hit.faceIndex,
    barycentric: [bary.x, bary.y, bary.z],
  };
  return validateSurfaceAnchor(anchor, mesh.geometry) ? anchor : null;
}

/** A private render mesh: the cached OBJ must never receive placement attributes. */
export function createHeroTattooSurface(source: THREE.BufferGeometry) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('aTattooUv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('aTattooMask', new THREE.BufferAttribute(new Float32Array(count), 1));
  const topology = createSurfaceTopology(geometry);
  const center = new THREE.Vector3();
  let anchor: SurfaceAnchor | null = null;
  let chart: SurfaceChart | null = null;

  function place(next: SurfaceAnchor, matrixWorld: THREE.Matrix4): boolean {
    if (next.bodyMeshId !== HERO_MESH_ID || !validateSurfaceAnchor(next, geometry)) return false;
    const candidate = buildSurfaceChart(topology, geometry, matrixWorld, next);
    // Same acceptance threshold and whole-face rejection as ModelWithUVTattoo.
    // Failed placement retains the last valid tattoo, including its chosen size.
    if (!candidate || candidate.maxSize < 0.045) return false;
    const mask = candidate.mask.slice();
    for (let face = 0; face < candidate.faceMask.length; face++) {
      if (candidate.faceMask[face] < 0.5) mask.fill(0, face * 3, face * 3 + 3);
    }
    geometry.setAttribute('aTattooUv', new THREE.BufferAttribute(candidate.uv, 2));
    geometry.setAttribute('aTattooMask', new THREE.BufferAttribute(mask, 1));
    const positions = geometry.getAttribute('position');
    center.set(0, 0, 0);
    for (let corner = 0; corner < 3; corner++) {
      center.addScaledVector(
        new THREE.Vector3().fromBufferAttribute(positions, next.faceIndex * 3 + corner),
        next.barycentric[corner],
      );
    }
    anchor = { ...next, barycentric: [...next.barycentric] };
    chart = candidate;
    return true;
  }

  return {
    geometry,
    center,
    place,
    get anchor() { return anchor; },
    get chart() { return chart; },
    dispose() { geometry.dispose(); },
  };
}

/** Place the initial emblem on the real front surface at the familiar height. */
export function createInitialHeroTattoo(source: THREE.BufferGeometry) {
  const surface = createHeroTattooSurface(source);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(surface.geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.7, 4), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObject(mesh, false)[0];
  const anchor = hit ? heroAnchorFromHit(hit) : null;
  material.dispose();
  if (!anchor || !surface.place(anchor, mesh.matrixWorld)) {
    surface.dispose();
    throw new Error('The homepage tattoo could not be placed on the forearm.');
  }
  return surface;
}
