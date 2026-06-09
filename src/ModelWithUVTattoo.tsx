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
import { TATTOO_LAYER_GLSL } from './render/tattooLayer';
import { findById, REGISTRY } from './render/registry';

const SAFE_ZONE = { uMin: 0.05, uMax: 0.95, vMin: 0.08, vMax: 0.92 };

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  ${TATTOO_LAYER_GLSL}

  uniform sampler2D skinTexture;
  uniform sampler2D tattooTexture;
  uniform vec2 tattooCenter;
  uniform float tattooScale;
  uniform float tattooRotation;
  uniform float tattooVisible;
  uniform float showSafeZone;
  uniform vec4 safeZoneBounds;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 skin = texture2D(skinTexture, vUv);

    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0);
    float ambient = 0.35;
    float light = ambient + diff * 0.65;
    skin.rgb *= light;

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
        skin.rgb = mix(skin.rgb, tattooRgb * light, tattooLayer.a);
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

type ModelType = 'Monk' | 'FinalBaseMesh';

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
    },
    ref
  ) {
    const { camera, scene, gl } = useThree();
    const [cloneGroup, setCloneGroup] = useState<THREE.Object3D | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    const tattooCenter = useRef(new THREE.Vector2(0.5, 0.5));
    const [hasPlaced, setHasPlaced] = useState(false);
    const hasPlacedRef = useRef(false);
    const isDragging = useRef(false);

    useEffect(() => {
      hasPlacedRef.current = hasPlaced;
    }, [hasPlaced]);

    const logoTexture = useLoader(TextureLoader, '/logo.png');
    const monkGltf = useLoader(GLTFLoader, '/monk.glb');
    const baseObj = useLoader(OBJLoader, '/FinalBaseMesh.obj');

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
      shaderMaterial.uniforms.showSafeZone.value = showSafeZone ? 1.0 : 0.0;
    });

    useEffect(() => {
      let modelGroup: THREE.Object3D;
      if (model === 'Monk') {
        modelGroup = monkGltf.scene;
      } else {
        modelGroup = baseObj;
      }
      const group = modelGroup.clone();
      const box = new THREE.Box3().setFromObject(group);
      const center = new THREE.Vector3();
      box.getCenter(center);
      group.position.sub(center);

      let targetMesh: THREE.Mesh | null = null;
      group.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh && !targetMesh) targetMesh = m;
      });
      if (targetMesh) {
        const geo = (targetMesh.geometry as THREE.BufferGeometry).clone();
        ensureUVs(geo);
        targetMesh.geometry = geo;
        targetMesh.material = shaderMaterial;
        meshRef.current = targetMesh;
        setCloneGroup(group);
      } else {
        setCloneGroup(null);
      }
    }, [model, monkGltf, baseObj, shaderMaterial]);

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
        const m = meshRef.current;
        if (!m) return null;
        const hits = raycaster.current.intersectObject(m);
        if (hits.length > 0 && hits[0].uv) return hits[0].uv.clone();
        return null;
      },
      [camera, gl]
    );

    const clampToSafeZone = useCallback((uv: THREE.Vector2, scale: number) => {
      const half = scale * 0.5;
      uv.x = Math.max(SAFE_ZONE.uMin + half, Math.min(SAFE_ZONE.uMax - half, uv.x));
      uv.y = Math.max(SAFE_ZONE.vMin + half, Math.min(SAFE_ZONE.vMax - half, uv.y));
      return uv;
    }, []);

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
