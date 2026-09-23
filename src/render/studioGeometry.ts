import * as THREE from 'three';

/** ShadowMaterial normally multiplies every light's visibility. Our softbox
 * samples share one emitter's energy, so average their visibility instead:
 * one blocked corner out of four must produce a quarter shadow, not black. */
export function createStudioShadowMaterial(): THREE.ShadowMaterial {
  const material = new THREE.ShadowMaterial({ color: '#171921', opacity: .4, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
  const averagedMask = THREE.ShaderChunk.shadowmask_pars_fragment
    .replace('float shadow = 1.0;', 'float shadow = 0.0; float sampleCount = 0.0;')
    .replace(/shadow \*= ([^;]+);/g, 'shadow += $1; sampleCount += 1.0;')
    .replace('return shadow;', 'return sampleCount > 0.0 ? shadow / sampleCount : 1.0;');
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmask_pars_fragment>', averagedMask);
  };
  material.customProgramCacheKey = () => 'studio-averaged-ground-shadow-v1';
  return material;
}

/** Camera-facing seamless paper sweep, matching Blender's build_cyclorama.
 * Local +Z faces the camera, Y=0 is the floor. Its bounds are deliberately
 * excluded from figure framing and tattoo raycasts. */
export function createStudioSweepGeometry(bodyHeight: number, cameraDistance: number): THREE.BufferGeometry {
  const H = Math.max(.1, Number.isFinite(bodyHeight) ? bodyHeight : 4.2);
  const D = Math.max(.1, Number.isFinite(cameraDistance) ? cameraDistance : 8);
  const radius = Math.max(3, H * 1.1), start = Math.max(H * 1.2, D * .30);
  const wallHeight = Math.max(H * 3, D, radius + .1), halfWidth = Math.max(H * 4, D), front = Math.max(H * 3, D * .6);
  const profile: [number, number][] = [[-front, 0], [start, 0]];
  for (let i = 1; i <= 16; i++) {
    const angle = i / 16 * Math.PI / 2;
    profile.push([start + radius * Math.sin(angle), radius * (1 - Math.cos(angle))]);
  }
  profile.push([start + radius, wallHeight]);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [distance, height] = profile[i];
    const angle = i <= 1 ? 0 : i === profile.length - 1 ? Math.PI / 2 : (i - 1) / 16 * Math.PI / 2;
    positions.push(-halfWidth, height, -distance, halfWidth, height, -distance);
    normals.push(0, Math.cos(angle), Math.sin(angle), 0, Math.cos(angle), Math.sin(angle));
    if (i > 0) { const a = (i - 1) * 2, b = i * 2; indices.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function studioFloor(body: THREE.Mesh): { floor: number; height: number } | null {
  if (!body.geometry.boundingBox) body.geometry.computeBoundingBox();
  if (!body.geometry.boundingBox || body.geometry.boundingBox.isEmpty()) return null;
  const box = body.geometry.boundingBox.clone().applyMatrix4(body.matrixWorld);
  return { floor: box.min.y - .02, height: Math.max(.1, box.max.y - box.min.y) };
}
