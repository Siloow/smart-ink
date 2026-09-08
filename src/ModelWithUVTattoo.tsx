import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useLoader, useThree, useFrame } from '@react-three/fiber';
import { DRACOLoader, GLTFLoader } from 'three-stdlib';
import * as THREE from 'three';
import { TextureLoader } from 'three';
import { TATTOO_LAYER_GLSL } from './render/tattooLayer';
import { findById, REGISTRY } from './render/registry';
import type { LightDefinition } from './config/lightingPresets';
import {
  applyBodyShape,
  DEFAULT_BODY_SHAPE,
  prepareDeformable,
  shapeBounds,
  type BodyShape,
  type Deformable,
  type ShapeBounds,
} from './render/bodyShape';
import {
  REGION_BY_INDEX,
  REGION_INDEX,
  classifyPoint,
  regionFrame,
  type BodyRegionId,
} from './render/bodyRegions';

/** Moves a group so its (possibly reshaped) bounds are centred on the origin. */
function recenterGroup(group: THREE.Object3D): void {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  group.position.sub(center);
}

const MAX_SCENE_LIGHTS = 4;

/**
 * The body atlas is 24 UDIM tiles repacked into a 5x5 grid, so a cell is one
 * body part and neighbouring cells are unrelated parts. A tattoo that ran past
 * a cell edge would reappear somewhere else on the figure, so placement is
 * clamped inside whichever cell the pointer landed in rather than inside one
 * global rectangle.
 */
const UV_GRID = 5;
const UV_CELL = 1 / UV_GRID;
/** Keeps the tattoo off the very edge of its cell, where the bake bleeds. */
const UV_CELL_MARGIN = 0.004;

/** World height the figure is scaled to, so camera presets frame any mesh alike. */
const TARGET_BODY_HEIGHT = 4.2;

/** Bounds of the atlas cell containing `uv`, inset by the bleed margin. */
function cellBounds(u: number, v: number): THREE.Vector4 {
  const cu = Math.min(UV_GRID - 1, Math.max(0, Math.floor(u / UV_CELL)));
  const cv = Math.min(UV_GRID - 1, Math.max(0, Math.floor(v / UV_CELL)));
  return new THREE.Vector4(
    cu * UV_CELL + UV_CELL_MARGIN,
    (cu + 1) * UV_CELL - UV_CELL_MARGIN,
    cv * UV_CELL + UV_CELL_MARGIN,
    (cv + 1) * UV_CELL - UV_CELL_MARGIN
  );
}

const DRACO_DECODER_PATH = '/draco/';

const vertexShader = `
  #include <common>

  attribute float aRegion;
  attribute vec4 tangent;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldTangent;
  varying vec3 vWorldBitangent;
  varying vec3 vWorldPosition;
  varying float vRegion;

  void main() {
    vUv = uv;
    vRegion = aRegion;

    #include <beginnormal_vertex>
    #include <begin_vertex>

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    // glTF hands us mikktspace tangents, matching how Blender baked the map.
    vWorldTangent = normalize(mat3(modelMatrix) * tangent.xyz);
    vWorldBitangent = normalize(cross(vWorldNormal, vWorldTangent) * tangent.w);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = `
  ${TATTOO_LAYER_GLSL}

  #define MAX_SCENE_LIGHTS ${MAX_SCENE_LIGHTS}

  uniform sampler2D skinTexture;
  uniform sampler2D normalMap;
  uniform float normalMapStrength;
  uniform sampler2D tattooTexture;
  uniform vec2 tattooCenter;
  uniform float tattooScale;
  uniform float tattooRotation;
  uniform float tattooVisible;
  uniform float showSafeZone;
  uniform vec4 safeZoneBounds;
  uniform vec3 uAmbientColor;
  uniform float uAmbientStrength;
  uniform int uNumLights;
  uniform vec3 uLightPos[MAX_SCENE_LIGHTS];
  uniform vec3 uLightTarget[MAX_SCENE_LIGHTS];
  uniform vec3 uLightColor[MAX_SCENE_LIGHTS];
  uniform float uLightIntensity[MAX_SCENE_LIGHTS];
  uniform float uLightIsPoint[MAX_SCENE_LIGHTS];
  /** Region to keep, or -1 to show the whole figure. */
  uniform float uIsolateRegion;
  /** Up to two regions to tint (a symmetric pair), or -1 for none. */
  uniform float uHighlightRegion;
  uniform float uHighlightRegion2;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldTangent;
  varying vec3 vWorldBitangent;
  varying vec3 vWorldPosition;
  varying float vRegion;

  /**
   * Surface normal with the baked sculpt detail folded in. The base cage is
   * only 10.5k faces; everything that reads as muscle definition lives here.
   */
  vec3 surfaceNormal() {
    vec3 N = normalize(vWorldNormal);
    if (normalMapStrength <= 0.0) return N;
    vec3 T = normalize(vWorldTangent);
    vec3 B = normalize(vWorldBitangent);
    vec3 sampled = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    sampled.xy *= normalMapStrength;
    return normalize(mat3(T, B, N) * sampled);
  }

  vec3 shadeSkin(vec3 albedo) {
    vec3 N = surfaceNormal();
    vec3 lit = albedo * uAmbientColor * uAmbientStrength;

    for (int i = 0; i < MAX_SCENE_LIGHTS; i++) {
      if (i >= uNumLights) break;
      vec3 L;
      float atten = 1.0;
      if (uLightIsPoint[i] > 0.5) {
        vec3 toLight = uLightPos[i] - vWorldPosition;
        float dist = length(toLight);
        L = toLight / max(dist, 0.0001);
        atten = 1.0 / (1.0 + dist * dist * 0.02);
      } else {
        L = normalize(uLightPos[i] - uLightTarget[i]);
      }
      float diff = max(dot(N, L), 0.0);
      lit += albedo * uLightColor[i] * uLightIntensity[i] * diff * atten;
    }

    return lit;
  }

  void main() {
    // Cutting a region out is a fragment reject, so UVs, the placed tattoo
    // and the shape maths all still refer to the whole figure.
    if (uIsolateRegion >= 0.0 && abs(vRegion - uIsolateRegion) > 0.5) discard;

    vec4 skin = texture2D(skinTexture, vUv);
    vec3 litRgb = shadeSkin(skin.rgb);
    skin.rgb = litRgb;

    // The safe zone is now the atlas cell the tattoo currently sits in: the
    // area it can be dragged across without crossing onto another body part.
    // Marking the inside is the useful hint, since everything outside is
    // simply a different part of the figure rather than a forbidden margin.
    if (showSafeZone > 0.5 && tattooVisible > 0.5) {
      bool inCell = vUv.x >= safeZoneBounds.x && vUv.x <= safeZoneBounds.y &&
                    vUv.y >= safeZoneBounds.z && vUv.y <= safeZoneBounds.w;
      if (inCell) {
        skin.rgb = mix(skin.rgb, vec3(0.20, 0.35, 0.55), 0.10);
      }
    }

    if (tattooVisible > 0.5) {
      vec4 tattooLayer = sampleTattooLayer(
        tattooTexture, vUv, tattooCenter, tattooScale, tattooRotation
      );
      if (tattooLayer.a > 0.0) {
        vec3 tattooRgb = tattooLayer.rgb * 0.85;
        skin.rgb = mix(skin.rgb, shadeSkin(tattooRgb), tattooLayer.a);
      }
    }

    bool lit = (uHighlightRegion >= 0.0 && abs(vRegion - uHighlightRegion) < 0.5) ||
               (uHighlightRegion2 >= 0.0 && abs(vRegion - uHighlightRegion2) < 0.5);
    if (lit) {
      skin.rgb = mix(skin.rgb, vec3(0.30, 0.49, 1.0), 0.22);
    }

    gl_FragColor = skin;
  }
`;

/** Generate box-projection UVs from position when geometry has no UVs (e.g. OBJ without vt). */
function ensureUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  const pos = geometry.attributes.position;
  if (!(pos instanceof THREE.BufferAttribute)) return;
  const count = pos.count;
  const box = new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  box.getSize(size);
  const min = box.min;
  const uvArray = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (pos.getX(i) - min.x) / (size.x || 1);
    const y = (pos.getY(i) - min.y) / (size.y || 1);
    uvArray[i * 2] = x;
    uvArray[i * 2 + 1] = 1 - y;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
}

/**
 * Tags every vertex with the body region it belongs to, from the undeformed
 * pose. Membership is a property of the figure, not of the sliders, so this
 * is computed once and survives every reshape.
 */
function tagRegions(geometry: THREE.BufferGeometry, base: Float32Array, bounds: ShapeBounds): void {
  const frame = regionFrame(bounds);
  const count = base.length / 3;
  const regions = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    regions[i] = REGION_INDEX[classifyPoint(base[i * 3], base[i * 3 + 1], frame)];
  }
  geometry.setAttribute('aRegion', new THREE.BufferAttribute(regions, 1));
}

function createSkinTexture(hexColor: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hexColor;
  ctx.fillRect(0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 12;
    imgData.data[i] += noise;
    imgData.data[i + 1] += noise * 0.8;
    imgData.data[i + 2] += noise * 0.5;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export interface UVTattooPlacementSnapshot {
  center: [number, number];
  scaleUV: number;
  rotationRad: number;
  hasPlaced: boolean;
}

export interface RegionFraming {
  center: [number, number, number];
  radius: number;
}

export interface ModelWithUVTattooHandle {
  getPlacement: () => UVTattooPlacementSnapshot;
}

interface ModelWithUVTattooProps {
  uploadedImage: string | null;
  skinToneId: string;
  /** Which figure to load; falls back to the first registry entry. */
  bodyMeshId?: string;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  setDecalVisible: (visible: boolean) => void;
  showSafeZone?: boolean;
  lights?: LightDefinition[];
  intensityScale?: number;
  performanceMode?: boolean;
  /** Sims-style shape sliders; identity when omitted. */
  bodyShape?: BodyShape;
  /** Only this region is drawn, and only it can take a tattoo. */
  isolateRegion?: BodyRegionId | null;
  /** Tinted in the viewport, e.g. while a slider for them is hovered. */
  highlightRegions?: BodyRegionId[];
  /** Pointer moved over (or off) a region, for the hover tint. */
  onHoverRegion?: (region: BodyRegionId | null) => void;
  /** Right-press on a region: where the radial shape menu should open. */
  onRegionPress?: (
    region: BodyRegionId,
    clientX: number,
    clientY: number,
    pointerId: number
  ) => void;
  /** Bounds of a newly isolated region, so the camera can frame it. */
  onFrameRegion?: (framing: RegionFraming | null) => void;
}

const ModelWithUVTattoo = forwardRef<ModelWithUVTattooHandle, ModelWithUVTattooProps>(
  function ModelWithUVTattoo(
    {
      uploadedImage,
      skinToneId,
      bodyMeshId,
      decalRotation,
      decalScale,
      setDecalVisible,
      showSafeZone = true,
      lights = [],
      intensityScale = 1,
      performanceMode = false,
      bodyShape = DEFAULT_BODY_SHAPE,
      isolateRegion = null,
      highlightRegions,
      onHoverRegion,
      onRegionPress,
      onFrameRegion,
    },
    ref
  ) {
    const { camera, scene, gl } = useThree();
    const [cloneGroup, setCloneGroup] = useState<THREE.Object3D | null>(null);
    const pickTargetRef = useRef<THREE.Object3D | null>(null);
    const deformablesRef = useRef<{ items: Deformable[]; bounds: ShapeBounds } | null>(null);
    const tattooCenter = useRef(new THREE.Vector2(0.5, 0.5));
    const [hasPlaced, setHasPlaced] = useState(false);
    const hasPlacedRef = useRef(false);
    const isDragging = useRef(false);
    const isolateRef = useRef<BodyRegionId | null>(isolateRegion);
    const hoverRef = useRef<BodyRegionId | null>(null);

    useEffect(() => {
      hasPlacedRef.current = hasPlaced;
    }, [hasPlaced]);

    useEffect(() => {
      isolateRef.current = isolateRegion;
    }, [isolateRegion]);

    const bodyDef =
      (bodyMeshId ? findById(REGISTRY.bodyMeshes, bodyMeshId) : undefined) ??
      REGISTRY.bodyMeshes[0];

    const logoTexture = useLoader(TextureLoader, '/logo.png');
    const gltf = useLoader(GLTFLoader, bodyDef.previewUrl, (loader) => {
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_DECODER_PATH);
      (loader as GLTFLoader).setDRACOLoader(draco);
    });
    const normalMap = useLoader(TextureLoader, bodyDef.normalMapUrl);
    useEffect(() => {
      // A normal map is vector data, not colour: sampling it through sRGB
      // would bend every normal it encodes.
      normalMap.colorSpace = THREE.NoColorSpace;
      normalMap.flipY = false;
      normalMap.needsUpdate = true;
    }, [normalMap]);

    const skinSwatch =
      findById(REGISTRY.skinTones, skinToneId)?.swatch ?? REGISTRY.skinTones[1].swatch;
    const skinTexture = useMemo(() => createSkinTexture(skinSwatch), [skinSwatch]);
    const tattooTexture = useMemo(() => {
      if (uploadedImage) {
        const tex = new THREE.Texture();
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = uploadedImage;
        img.onload = () => {
          tex.image = img;
          tex.needsUpdate = true;
        };
        return tex;
      }
      return logoTexture;
    }, [uploadedImage, logoTexture]);

    const shaderMaterial = useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: {
            skinTexture: { value: skinTexture },
            normalMap: { value: normalMap },
            normalMapStrength: { value: 1.0 },
            tattooTexture: { value: tattooTexture },
            tattooCenter: { value: new THREE.Vector2(0.5, 0.5) },
            tattooScale: { value: 0.12 },
            tattooRotation: { value: 0 },
            tattooVisible: { value: 0.0 },
            showSafeZone: { value: 1.0 },
            safeZoneBounds: { value: cellBounds(0.5, 0.5) },
            uAmbientColor: { value: new THREE.Color('#ffffff') },
            uAmbientStrength: { value: 0.35 },
            uNumLights: { value: 0 },
            uLightPos: {
              value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector3()),
            },
            uLightTarget: {
              value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector3()),
            },
            uLightColor: {
              value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Color('#ffffff')),
            },
            uLightIntensity: { value: new Array<number>(MAX_SCENE_LIGHTS).fill(0) },
            uLightIsPoint: { value: new Array<number>(MAX_SCENE_LIGHTS).fill(0) },
            uIsolateRegion: { value: -1 },
            uHighlightRegion: { value: -1 },
            uHighlightRegion2: { value: -1 },
          },
          side: THREE.DoubleSide,
        }),
      [skinTexture, tattooTexture, normalMap]
    );

    useEffect(() => {
      shaderMaterial.uniforms.uIsolateRegion.value =
        isolateRegion === null ? -1 : REGION_INDEX[isolateRegion];
    }, [shaderMaterial, isolateRegion]);

    const highlightA = highlightRegions?.[0] ?? null;
    const highlightB = highlightRegions?.[1] ?? null;
    useEffect(() => {
      shaderMaterial.uniforms.uHighlightRegion.value =
        highlightA === null ? -1 : REGION_INDEX[highlightA];
      shaderMaterial.uniforms.uHighlightRegion2.value =
        highlightB === null ? -1 : REGION_INDEX[highlightB];
    }, [shaderMaterial, highlightA, highlightB]);

    // A slider unit is a fraction of one atlas cell, not of the whole sheet.
    // The old 0.12 was 12% of a single sheet covering the entire body; a cell
    // now holds just one body part, so the equivalent-looking tattoo is a much
    // larger share of it. 0.4 of a cell reads like a palm-sized piece.
    const scaleInUV = useMemo(
      () => Math.max(0.01, decalScale) * 0.4 * UV_CELL,
      [decalScale]
    );

    useImperativeHandle(
      ref,
      () => ({
        getPlacement: (): UVTattooPlacementSnapshot => ({
          center: [tattooCenter.current.x, tattooCenter.current.y],
          scaleUV: scaleInUV,
          rotationRad: THREE.MathUtils.degToRad(decalRotation),
          hasPlaced: hasPlacedRef.current,
        }),
      }),
      [scaleInUV, decalRotation]
    );

    useFrame(() => {
      shaderMaterial.uniforms.tattooCenter.value.copy(tattooCenter.current);
      shaderMaterial.uniforms.tattooScale.value = scaleInUV;
      shaderMaterial.uniforms.tattooRotation.value = THREE.MathUtils.degToRad(decalRotation);
      shaderMaterial.uniforms.tattooVisible.value = hasPlacedRef.current ? 1.0 : 0.0;
      shaderMaterial.uniforms.showSafeZone.value = showSafeZone ? 1.0 : 0.0;

      const perf = performanceMode ? 0.5 : 1;
      let ambientStrength = 0;
      const ambientColor = new THREE.Color(0, 0, 0);
      let lightCount = 0;

      for (const light of lights) {
        if (light.type === 'ambient') {
          const strength = light.intensity * intensityScale * perf;
          ambientStrength += strength;
          ambientColor.r += new THREE.Color(light.color).r * strength;
          ambientColor.g += new THREE.Color(light.color).g * strength;
          ambientColor.b += new THREE.Color(light.color).b * strength;
          continue;
        }
        if (lightCount >= MAX_SCENE_LIGHTS) break;

        const pos = shaderMaterial.uniforms.uLightPos.value[lightCount] as THREE.Vector3;
        const target = shaderMaterial.uniforms.uLightTarget.value[lightCount] as THREE.Vector3;
        const color = shaderMaterial.uniforms.uLightColor.value[lightCount] as THREE.Color;
        pos.set(light.position[0], light.position[1], light.position[2]);
        const t = light.target ?? [0, 0, 0];
        target.set(t[0], t[1], t[2]);
        color.set(light.color);
        shaderMaterial.uniforms.uLightIntensity.value[lightCount] =
          light.intensity * intensityScale * perf;
        shaderMaterial.uniforms.uLightIsPoint.value[lightCount] = light.type === 'point' ? 1 : 0;
        lightCount += 1;
      }

      if (ambientStrength > 0) {
        ambientColor.multiplyScalar(1 / ambientStrength);
      } else {
        ambientColor.set('#ffffff');
      }

      shaderMaterial.uniforms.uAmbientStrength.value = ambientStrength;
      shaderMaterial.uniforms.uAmbientColor.value.copy(ambientColor);
      shaderMaterial.uniforms.uNumLights.value = lightCount;
    });

    useEffect(() => {
      const group = gltf.scene.clone(true);
      deformablesRef.current = null;

      // The GLB carries the body plus two eyeballs. Only the body is kept:
      // the shape sliders, the region tagging and the UV tattoo all assume a
      // single mesh in a single UV space, and the eyes have neither.
      const meshes: THREE.Mesh[] = [];
      group.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) meshes.push(m);
      });
      const mesh = meshes.reduce<THREE.Mesh | null>(
        (best, m) =>
          !best || m.geometry.getAttribute('position').count > best.geometry.getAttribute('position').count
            ? m
            : best,
        null
      );
      if (!mesh) {
        pickTargetRef.current = null;
        setCloneGroup(null);
        return;
      }
      for (const m of meshes) {
        if (m !== mesh) m.removeFromParent();
      }

      // The GLB is in metres; scale to a fixed world height so the camera
      // presets frame this figure the same as any other mesh we might ship.
      group.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(group);
      const rawHeight = raw.max.y - raw.min.y;
      if (rawHeight > 1e-6) {
        group.scale.multiplyScalar(TARGET_BODY_HEIGHT / rawHeight);
      }
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const center = new THREE.Vector3();
      box.getCenter(center);
      group.position.sub(center);

      const geo = (mesh.geometry as THREE.BufferGeometry).clone();
      ensureUVs(geo);
      mesh.geometry = geo;
      mesh.material = shaderMaterial;
      const deformable = prepareDeformable(geo);
      const bounds = shapeBounds([deformable]);
      tagRegions(geo, deformable.base, bounds);
      deformablesRef.current = { items: [deformable], bounds };
      pickTargetRef.current = group;
      setCloneGroup(group);
    }, [gltf, shaderMaterial]);

    // Reshape whenever the sliders change or the group is rebuilt. Positions
    // are always recomputed from the undeformed snapshot, so sliders never
    // compound, and the UV-placed tattoo rides along with the skin.
    useEffect(() => {
      const prepared = deformablesRef.current;
      if (!cloneGroup || !prepared) return;
      applyBodyShape(prepared.items, prepared.bounds, bodyShape);
      recenterGroup(cloneGroup);
    }, [cloneGroup, bodyShape]);

    /** World-space bounds of one region of the reshaped figure. */
    const regionFraming = useCallback(
      (region: BodyRegionId | null): RegionFraming | null => {
        const group = cloneGroup;
        if (!group) return null;
        group.updateMatrixWorld(true);
        const box = new THREE.Box3();
        if (region === null) {
          box.setFromObject(group);
        } else {
          const want = REGION_INDEX[region];
          const point = new THREE.Vector3();
          group.traverse((child) => {
            const m = child as THREE.Mesh;
            if (!m.isMesh) return;
            const pos = m.geometry.getAttribute('position');
            const reg = m.geometry.getAttribute('aRegion');
            if (!pos || !reg) return;
            for (let i = 0; i < pos.count; i++) {
              if (Math.abs(reg.getX(i) - want) > 0.5) continue;
              point.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld);
              box.expandByPoint(point);
            }
          });
        }
        if (box.isEmpty()) return null;
        const c = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(c);
        box.getSize(size);
        return { center: [c.x, c.y, c.z], radius: Math.max(0.001, size.length() / 2) };
      },
      [cloneGroup]
    );

    // Frame the camera when the isolated region changes, but not while the
    // sliders move it: reframing on every tick would fight the user.
    const lastFramedRef = useRef<BodyRegionId | null | undefined>(undefined);
    useEffect(() => {
      if (!cloneGroup || !onFrameRegion) return;
      if (lastFramedRef.current === isolateRegion) return;
      lastFramedRef.current = isolateRegion;
      onFrameRegion(regionFraming(isolateRegion));
    }, [cloneGroup, isolateRegion, regionFraming, onFrameRegion]);

    useEffect(() => {
      setDecalVisible(hasPlaced);
    }, [hasPlaced, setDecalVisible]);

    const raycaster = useRef(new THREE.Raycaster());
    const mouse = useRef(new THREE.Vector2());

    /** First hit that is actually on screen: cut-away regions are not pickable. */
    const pick = useCallback(
      (event: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(mouse.current, camera);
        const target = pickTargetRef.current;
        if (!target) return null;
        const isolate = isolateRef.current;
        for (const hit of raycaster.current.intersectObject(target, true)) {
          const mesh = hit.object as THREE.Mesh;
          const reg = mesh.geometry?.getAttribute('aRegion');
          const index = hit.face?.a;
          const region: BodyRegionId | null =
            reg && index !== undefined ? (REGION_BY_INDEX[reg.getX(index)] ?? null) : null;
          if (isolate && region !== isolate) continue;
          return { uv: hit.uv ? hit.uv.clone() : null, region };
        }
        return null;
      },
      [camera, gl]
    );

    /**
     * Holds the tattoo inside the atlas cell the pointer landed on, and points
     * the safe-zone overlay at that same cell. Without this a tattoo near a
     * cell edge would spill into the neighbouring cell, which is a different
     * body part entirely — an arm tattoo bleeding onto the scalp.
     */
    const clampToSafeZone = useCallback(
      (uv: THREE.Vector2, scale: number) => {
        const cell = cellBounds(uv.x, uv.y);
        const half = Math.min(scale * 0.5, (UV_CELL - 2 * UV_CELL_MARGIN) * 0.5);
        uv.x = Math.max(cell.x + half, Math.min(cell.y - half, uv.x));
        uv.y = Math.max(cell.z + half, Math.min(cell.w - half, uv.y));
        (shaderMaterial.uniforms.safeZoneBounds.value as THREE.Vector4).copy(cell);
        return uv;
      },
      [shaderMaterial]
    );

    const setOrbitEnabled = useCallback(
      (enabled: boolean) => {
        const controls = (scene as THREE.Scene & { orbitControls?: { enabled: boolean } })
          .orbitControls;
        if (controls) controls.enabled = enabled;
      },
      [scene]
    );

    const onPointerDown = useCallback(
      (e: PointerEvent) => {
        // Right-press opens the radial shape menu. It stays off the left
        // button so orbiting and placing a tattoo are untouched.
        if (e.button === 2) {
          const hit = pick(e);
          if (hit?.region && onRegionPress) {
            e.preventDefault();
            setOrbitEnabled(false);
            onRegionPress(hit.region, e.clientX, e.clientY, e.pointerId);
          }
          return;
        }
        if (e.button !== 0) return;

        const hit = pick(e);
        if (!hit?.uv) return;
        const uv = clampToSafeZone(hit.uv, scaleInUV);

        if (e.metaKey) {
          if (!hasPlacedRef.current) return;
          isDragging.current = true;
          setOrbitEnabled(false);
          tattooCenter.current.copy(uv);
          return;
        }

        setHasPlaced(true);
        hasPlacedRef.current = true;
        tattooCenter.current.copy(uv);
        isDragging.current = false;
      },
      [pick, scaleInUV, clampToSafeZone, setOrbitEnabled, onRegionPress]
    );

    const onPointerMove = useCallback(
      (e: PointerEvent) => {
        if (isDragging.current) {
          const hit = pick(e);
          if (hit?.uv) tattooCenter.current.copy(clampToSafeZone(hit.uv, scaleInUV));
          return;
        }
        // Hover tint. Skipped while any button is down so orbiting stays cheap.
        if (!onHoverRegion || e.buttons !== 0) return;
        if (e.target !== gl.domElement) {
          if (hoverRef.current !== null) {
            hoverRef.current = null;
            onHoverRegion(null);
          }
          return;
        }
        const region = pick(e)?.region ?? null;
        if (region !== hoverRef.current) {
          hoverRef.current = region;
          onHoverRegion(region);
        }
      },
      [pick, scaleInUV, clampToSafeZone, onHoverRegion, gl]
    );

    // Any release re-enables orbiting, which also covers the radial menu:
    // it opens on right-press and closes on the matching release.
    const onPointerUp = useCallback(() => {
      isDragging.current = false;
      setOrbitEnabled(true);
    }, [setOrbitEnabled]);

    useEffect(() => {
      const el = gl.domElement;
      const blockContextMenu = (e: MouseEvent) => e.preventDefault();
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('contextmenu', blockContextMenu);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      return () => {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('contextmenu', blockContextMenu);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
    }, [onPointerDown, onPointerMove, onPointerUp, gl]);

    if (!cloneGroup) return null;
    return <primitive object={cloneGroup} />;
  }
);

export default ModelWithUVTattoo;
