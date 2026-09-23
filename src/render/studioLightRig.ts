import * as THREE from 'three';
import type { LightDefinition } from '../config/lightingPresets';
import { lightSoftness, softboxSize } from './studioLighting';

export const MAX_STUDIO_LIGHTS = 4;
export const MAX_STUDIO_SAMPLES = MAX_STUDIO_LIGHTS * 4;
export interface StudioLightSample {
  type: 'directional' | 'point' | 'spot';
  position: THREE.Vector3;
  target: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distanceScale: number;
  angle: number;
  penumbra: number;
  castShadow: boolean;
  sourceIndex: number;
}
export interface StudioRig { ambientColor: THREE.Color; ambientStrength: number; samples: StudioLightSample[] }

/** Four-point quadrature of a finite rectangular emitter. Skin and standard
 * materials use these exact sources, targets, energy and spot cones. */
export function resolveStudioLightRig(lights: LightDefinition[], scale = 1): StudioRig {
  const ambient = new THREE.Color(0, 0, 0), samples: StudioLightSample[] = [];
  let ambientStrength = 0, sourceCount = 0;
  lights.forEach((light, sourceIndex) => {
    if (light.enabled === false) return;
    const intensity = Math.max(0, light.intensity * scale);
    if (!Number.isFinite(intensity) || intensity === 0) return;
    const color = new THREE.Color(light.color);
    if (light.type === 'ambient') {
      ambient.add(color.multiplyScalar(intensity)); ambientStrength += intensity; return;
    }
    if (sourceCount >= MAX_STUDIO_LIGHTS) return;
    sourceCount++;
    const position = new THREE.Vector3(...light.position), target = new THREE.Vector3(...(light.target ?? [0, 0, 0]));
    const axis = position.clone().sub(target);
    if (axis.lengthSq() < 1e-8) {
      axis.set(0, 1, 0);
      // A lowered overhead light may meet its aim point. Keep a defined
      // downward beam rather than sending normalize(vec3(0)) to the shader.
      if (light.type !== 'point') target.copy(position).addScaledVector(axis, -1);
    }
    const distanceScale = Math.max(.25, position.distanceToSquared(target));
    axis.normalize();
    const right = new THREE.Vector3().crossVectors(Math.abs(axis.y) > .98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), axis).normalize();
    const up = new THREE.Vector3().crossVectors(axis, right).normalize();
    const softness = lightSoftness(light), diameter = softboxSize(softness);
    const width = light.blenderAreaSize?.[0] ?? diameter, height = light.blenderAreaSize?.[1] ?? diameter;
    const offsets = softness <= 1e-6 ? [[0, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [x, y] of offsets) samples.push({
      type: light.type,
      position: position.clone().addScaledVector(right, x * width / (2 * Math.sqrt(3))).addScaledVector(up, y * height / (2 * Math.sqrt(3))),
      target: target.clone(), color: new THREE.Color(light.color), intensity: intensity / offsets.length,
      distanceScale, angle: THREE.MathUtils.clamp(light.angle ?? Math.PI / 6, .01, Math.PI / 2),
      penumbra: THREE.MathUtils.clamp(light.penumbra ?? .5, 0, 1), castShadow: light.castShadow ?? false, sourceIndex,
    });
  });
  if (ambientStrength > 0) ambient.multiplyScalar(1 / ambientStrength);
  return { ambientColor: ambient, ambientStrength, samples };
}

/** CPU counterpart of the shader attenuation, also used by regression tests. */
export function studioSampleAttenuation(sample: StudioLightSample, point: THREE.Vector3): number {
  if (sample.type === 'directional') return 1;
  const toLight = sample.position.clone().sub(point), squared = toLight.lengthSq();
  let attenuation = sample.distanceScale / Math.max(.01, squared);
  if (sample.type === 'spot') {
    const direction = sample.target.clone().sub(sample.position).normalize();
    const cosine = toLight.negate().normalize().dot(direction), outer = Math.cos(sample.angle), inner = Math.cos(sample.angle * (1 - sample.penumbra));
    attenuation *= inner - outer < 1e-6 ? Number(cosine >= outer) : THREE.MathUtils.smoothstep(cosine, outer, inner);
  }
  return attenuation;
}

export function createSkinLightUniforms(rig: StudioRig) {
  const slots = Array.from({ length: MAX_STUDIO_SAMPLES }, (_, i) => rig.samples[i]);
  return {
    uAmbientColor: { value: rig.ambientColor }, uAmbientStrength: { value: rig.ambientStrength },
    uNumLights: { value: rig.samples.length },
    uLightPos: { value: slots.map((s) => s?.position ?? new THREE.Vector3()) },
    uLightTarget: { value: slots.map((s) => s?.target ?? new THREE.Vector3()) },
    uLightColor: { value: slots.map((s) => s?.color ?? new THREE.Color(0, 0, 0)) },
    uLightIntensity: { value: slots.map((s) => s?.intensity ?? 0) },
    uLightType: { value: slots.map((s) => s?.type === 'spot' ? 2 : s?.type === 'point' ? 1 : 0) },
    uLightDistanceScale: { value: slots.map((s) => s?.distanceScale ?? 1) },
    uLightCone: { value: slots.map((s) => Math.cos(s?.angle ?? 0)) },
    uLightInnerCone: { value: slots.map((s) => Math.cos((s?.angle ?? 0) * (1 - (s?.penumbra ?? 0)))) },
  };
}

export const STUDIO_LIGHTING_GLSL = `
  #define MAX_SCENE_LIGHTS ${MAX_STUDIO_SAMPLES}
  uniform vec3 uAmbientColor;
  uniform float uAmbientStrength;
  uniform int uNumLights;
  uniform vec3 uLightPos[MAX_SCENE_LIGHTS];
  uniform vec3 uLightTarget[MAX_SCENE_LIGHTS];
  uniform vec3 uLightColor[MAX_SCENE_LIGHTS];
  uniform float uLightIntensity[MAX_SCENE_LIGHTS];
  uniform float uLightType[MAX_SCENE_LIGHTS];
  uniform float uLightDistanceScale[MAX_SCENE_LIGHTS];
  uniform float uLightCone[MAX_SCENE_LIGHTS];
  uniform float uLightInnerCone[MAX_SCENE_LIGHTS];
  vec3 studioLighting(vec3 N, vec3 worldPosition) {
    vec3 light = uAmbientColor * uAmbientStrength;
    for (int i = 0; i < MAX_SCENE_LIGHTS; i++) {
      if (i >= uNumLights) break;
      vec3 L; float attenuation = 1.0;
      if (uLightType[i] > .5) {
        vec3 delta = uLightPos[i] - worldPosition;
        float distanceSquared = dot(delta, delta);
        L = delta / max(sqrt(distanceSquared), .0001);
        attenuation = uLightDistanceScale[i] / max(distanceSquared, .01);
        if (uLightType[i] > 1.5) {
          vec3 axis = normalize(uLightTarget[i] - uLightPos[i]);
          float cosine = dot(-L, axis);
          attenuation *= uLightInnerCone[i] - uLightCone[i] < .000001
            ? step(uLightCone[i], cosine)
            : smoothstep(uLightCone[i], uLightInnerCone[i], cosine);
        }
      } else L = normalize(uLightPos[i] - uLightTarget[i]);
      light += uLightColor[i] * uLightIntensity[i] * max(dot(N, L), 0.0) * attenuation;
    }
    return light;
  }
`;

/** Targets are siblings in world space, not unattached child decorations. */
export function createStudioLightObjects(rig: StudioRig, performanceMode = false): THREE.Group {
  const group = new THREE.Group(); group.name = 'Studio lighting';
  if (rig.ambientStrength > 0) group.add(new THREE.AmbientLight(rig.ambientColor, rig.ambientStrength * Math.PI));
  for (const sample of rig.samples) {
    // MeshStandard's diffuse BRDF includes 1/PI; the matte skin shader already
    // expresses reflected radiance. This keeps fabric and skin levels aligned.
    const intensity = sample.intensity * Math.PI * (sample.type === 'directional' ? 1 : sample.distanceScale);
    const light = sample.type === 'directional' ? new THREE.DirectionalLight(sample.color, intensity)
      : sample.type === 'spot' ? new THREE.SpotLight(sample.color, intensity, 0, sample.angle, sample.penumbra, 2)
        : new THREE.PointLight(sample.color, intensity, 0, 2);
    light.position.copy(sample.position); light.castShadow = !performanceMode && sample.castShadow;
    light.userData.studioSourceIndex = sample.sourceIndex;
    const shadowSize = sample.type === 'point' ? 256 : 1024;
    light.shadow.mapSize.set(shadowSize, shadowSize); light.shadow.bias = -.0002; light.shadow.normalBias = .015; light.shadow.radius = 2;
    light.shadow.camera.near = .05; light.shadow.camera.far = 50;
    if (light instanceof THREE.DirectionalLight) {
      Object.assign(light.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
      light.target.position.copy(sample.target); group.add(light.target);
    } else if (light instanceof THREE.SpotLight) {
      light.target.position.copy(sample.target); group.add(light.target);
    }
    light.shadow.camera.updateProjectionMatrix(); group.add(light);
  }
  return group;
}

/** The same skin visibility test must also run in directional/spot depth and
 * point-light distance shadow passes, otherwise Focus casts a whole body. */
export function createBodyShadowMaterials(isolate: THREE.IUniform<number>) {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const distance = new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide });
  for (const material of [depth, distance]) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uIsolateRegion = isolate;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute float aFocusMask; attribute float aClothingMask;
        varying float vBodyFocus; varying float vBodyClothing;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyFocus = aFocusMask; vBodyClothing = aClothingMask;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uIsolateRegion; varying float vBodyFocus; varying float vBodyClothing;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if ((uIsolateRegion >= 0.0 && vBodyFocus < 0.0) || vBodyClothing >= 0.0) discard;`);
    };
    material.customProgramCacheKey = () => 'smartink-masked-shadow-v1';
  }
  return { depth, distance };
}

export function isVisibleEditorHelper(object: THREE.Object3D): boolean {
  let marked = false;
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    if (!parent.visible) return false;
    if (parent.userData.editorHelper) marked = true;
  }
  return marked;
}

/** Compare this distance with the first actually visible skin/accessory hit;
 * guides hidden behind the figure must not swallow placement clicks. */
export function nearestEditorHelperDistance(raycaster: THREE.Raycaster, scene: THREE.Scene): number {
  const roots: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.userData.editorHelper && isVisibleEditorHelper(object) && !object.parent?.userData.editorHelper) roots.push(object);
  });
  return raycaster.intersectObjects(roots, true).find((hit) => isVisibleEditorHelper(hit.object))?.distance ?? Infinity;
}

export function rayHitsEditorHelper(raycaster: THREE.Raycaster, scene: THREE.Scene): boolean {
  return Number.isFinite(nearestEditorHelperDistance(raycaster, scene));
}
