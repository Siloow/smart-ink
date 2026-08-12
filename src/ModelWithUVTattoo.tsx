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
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import * as THREE from 'three';
import { TextureLoader } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TATTOO_LAYER_GLSL } from './render/tattooLayer';
import { findById, REGISTRY, type PreviewModel } from './render/registry';
import type { LightDefinition } from './config/lightingPresets';

const SAFE_ZONE = { uMin: 0.05, uMax: 0.95, vMin: 0.08, vMax: 0.92 };
const MAX_SCENE_LIGHTS = 4;
const HUMAN_ELBOW_BONE = 'r_forearm';

const vertexShader = `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;

    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>

    #include <begin_vertex>
    #include <skinning_vertex>

    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = `
  ${TATTOO_LAYER_GLSL}

  #define MAX_SCENE_LIGHTS ${MAX_SCENE_LIGHTS}

  uniform sampler2D skinTexture;
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

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  vec3 shadeSkin(vec3 albedo) {
    vec3 N = normalize(vWorldNormal);
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
    vec4 skin = texture2D(skinTexture, vUv);
    vec3 litRgb = shadeSkin(skin.rgb);
    skin.rgb = litRgb;

    if (showSafeZone > 0.5) {
      bool inSafe = vUv.x >= safeZoneBounds.x && vUv.x <= safeZoneBounds.y &&
                    vUv.y >= safeZoneBounds.z && vUv.y <= safeZoneBounds.w;
      if (!inSafe) {
        skin.rgb = mix(skin.rgb, vec3(0.4, 0.15, 0.15), 0.25);
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

    gl_FragColor = skin;
  }
`;

/** Generate box-projection UVs from position when geometry has no UVs (e.g. OBJ without vt). */
function ensureUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  const pos = geometry.attributes.position;
  if (!pos) return;
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

const HUMAN_TARGET_HEIGHT = 20.74;

function isHumanAccessoryMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((mat) => /eye|lash|tear|brow|moisture|mouth|tooth|nail/i.test(mat.name));
}

function centerAndScaleToHeight(group: THREE.Object3D, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  box.getCenter(center);
  group.position.sub(center);

  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) {
    group.scale.setScalar(targetHeight / size.y);
  }
}

function findElbowBone(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (found) return;
    const bone = obj as THREE.Bone;
    if (bone.isBone && bone.name === HUMAN_ELBOW_BONE) found = bone;
  });
  return found;
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

type ModelType = PreviewModel;

export interface UVTattooPlacementSnapshot {
  center: [number, number];
  scaleUV: number;
  rotationRad: number;
  hasPlaced: boolean;
}

export interface ModelWithUVTattooHandle {
  getPlacement: () => UVTattooPlacementSnapshot;
}

interface ModelWithUVTattooProps {
  uploadedImage: string | null;
  model: ModelType;
  skinToneId: string;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  setDecalVisible: (visible: boolean) => void;
  showSafeZone?: boolean;
  lights?: LightDefinition[];
  intensityScale?: number;
  performanceMode?: boolean;
  /** Degrees of right-elbow flexion for the skinned Human preview. */
  armBendDeg?: number;
}

const ModelWithUVTattoo = forwardRef<ModelWithUVTattooHandle, ModelWithUVTattooProps>(
  function ModelWithUVTattoo(
    {
      uploadedImage,
      model,
      skinToneId,
      decalRotation,
      decalScale,
      setDecalVisible,
      showSafeZone = true,
      lights = [],
      intensityScale = 1,
      performanceMode = false,
      armBendDeg = 0,
    },
    ref
  ) {
    const { camera, scene, gl } = useThree();
    const [cloneGroup, setCloneGroup] = useState<THREE.Object3D | null>(null);
    const pickTargetRef = useRef<THREE.Object3D | null>(null);
    const elbowBoneRef = useRef<THREE.Bone | null>(null);
    const tattooCenter = useRef(new THREE.Vector2(0.5, 0.5));
    const [hasPlaced, setHasPlaced] = useState(false);
    const hasPlacedRef = useRef(false);
    const isDragging = useRef(false);

    useEffect(() => {
      hasPlacedRef.current = hasPlaced;
    }, [hasPlaced]);

    const logoTexture = useLoader(TextureLoader, '/logo.png');
    const monkGltf = useLoader(GLTFLoader, '/monk.glb');
    const humanGltf = useLoader(GLTFLoader, '/human_arm_rig.glb');
    const baseObj = useLoader(OBJLoader, '/FinalBaseMesh.obj');

    const enforceSafeZone = model !== 'Human';
    const safeZoneVisible = showSafeZone && enforceSafeZone;

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
            tattooTexture: { value: tattooTexture },
            tattooCenter: { value: new THREE.Vector2(0.5, 0.5) },
            tattooScale: { value: 0.12 },
            tattooRotation: { value: 0 },
            tattooVisible: { value: 0.0 },
            showSafeZone: { value: 1.0 },
            safeZoneBounds: {
              value: new THREE.Vector4(
                SAFE_ZONE.uMin,
                SAFE_ZONE.uMax,
                SAFE_ZONE.vMin,
                SAFE_ZONE.vMax
              ),
            },
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
          },
          side: THREE.DoubleSide,
        }),
      [skinTexture, tattooTexture]
    );

    const scaleInUV = useMemo(() => Math.max(0.01, decalScale) * 0.12, [decalScale]);

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
      shaderMaterial.uniforms.showSafeZone.value = safeZoneVisible ? 1.0 : 0.0;

      const bone = elbowBoneRef.current;
      if (bone) {
        // Local X is the elbow hinge for this armature export.
        bone.rotation.set(THREE.MathUtils.degToRad(armBendDeg), 0, 0);
        bone.updateMatrixWorld(true);
      }

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
      let modelGroup: THREE.Object3D;
      if (model === 'Monk') {
        modelGroup = monkGltf.scene;
      } else if (model === 'Human') {
        modelGroup = humanGltf.scene;
      } else {
        modelGroup = baseObj;
      }

      const group =
        model === 'Human' ? cloneSkinned(modelGroup) : modelGroup.clone(true);

      elbowBoneRef.current = null;

      if (model === 'Human') {
        group.traverse((child) => {
          const m = child as THREE.Mesh;
          if (!m.isMesh) return;
          if (isHumanAccessoryMaterial(m.material)) {
            m.visible = false;
            return;
          }
          if (!m.geometry.attributes.uv) ensureUVs(m.geometry);
          m.material = shaderMaterial;
          const skinned = m as THREE.SkinnedMesh;
          if (skinned.isSkinnedMesh) {
            skinned.bind(skinned.skeleton, skinned.bindMatrix);
          }
        });
        centerAndScaleToHeight(group, HUMAN_TARGET_HEIGHT);
        elbowBoneRef.current = findElbowBone(group);
        pickTargetRef.current = group;
        setCloneGroup(group);
        return;
      }

      const box = new THREE.Box3().setFromObject(group);
      const center = new THREE.Vector3();
      box.getCenter(center);
      group.position.sub(center);

      let targetMesh: THREE.Mesh | null = null;
      group.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh && !targetMesh) targetMesh = m;
      });
      const mesh = targetMesh as THREE.Mesh | null;
      if (mesh) {
        const geo = (mesh.geometry as THREE.BufferGeometry).clone();
        ensureUVs(geo);
        mesh.geometry = geo;
        mesh.material = shaderMaterial;
        pickTargetRef.current = group;
        setCloneGroup(group);
      } else {
        pickTargetRef.current = null;
        setCloneGroup(null);
      }
    }, [model, monkGltf, humanGltf, baseObj, shaderMaterial]);

    useEffect(() => {
      setDecalVisible(hasPlaced);
    }, [hasPlaced, setDecalVisible]);

    const raycaster = useRef(new THREE.Raycaster());
    const mouse = useRef(new THREE.Vector2());

    const getUVFromEvent = useCallback(
      (event: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(mouse.current, camera);
        const target = pickTargetRef.current;
        if (!target) return null;
        const hits = raycaster.current.intersectObject(target, true);
        if (hits.length > 0 && hits[0].uv) return hits[0].uv.clone();
        return null;
      },
      [camera, gl]
    );

    const clampToSafeZone = useCallback(
      (uv: THREE.Vector2, scale: number) => {
        if (!enforceSafeZone) return uv;
        const half = scale * 0.5;
        uv.x = Math.max(SAFE_ZONE.uMin + half, Math.min(SAFE_ZONE.uMax - half, uv.x));
        uv.y = Math.max(SAFE_ZONE.vMin + half, Math.min(SAFE_ZONE.vMax - half, uv.y));
        return uv;
      },
      [enforceSafeZone]
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
        const uv = getUVFromEvent(e);
        if (!uv) return;
        clampToSafeZone(uv, scaleInUV);

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
      [getUVFromEvent, scaleInUV, clampToSafeZone, setOrbitEnabled]
    );

    const onPointerMove = useCallback(
      (e: PointerEvent) => {
        if (!isDragging.current) return;
        const uv = getUVFromEvent(e);
        if (uv) {
          clampToSafeZone(uv, scaleInUV);
          tattooCenter.current.copy(uv);
        }
      },
      [getUVFromEvent, scaleInUV, clampToSafeZone]
    );

    const onPointerUp = useCallback(() => {
      if (isDragging.current) {
        isDragging.current = false;
        setOrbitEnabled(true);
      }
    }, [setOrbitEnabled]);

    useEffect(() => {
      const el = gl.domElement;
      el.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      return () => {
        el.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };
    }, [onPointerDown, onPointerMove, onPointerUp, gl]);

    if (!cloneGroup) return null;
    return <primitive object={cloneGroup} />;
  }
);

export default ModelWithUVTattoo;
