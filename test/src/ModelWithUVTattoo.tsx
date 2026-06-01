import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useLoader, useThree, useFrame } from '@react-three/fiber';
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import * as THREE from 'three';
import { TextureLoader } from 'three';

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
  uniform sampler2D skinTexture;
  uniform sampler2D tattooTexture;
  uniform vec2 tattooCenter;
  uniform float tattooScale;
  uniform float tattooRotation;
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

    vec2 offset = vUv - tattooCenter;
    float c = cos(tattooRotation);
    float s = sin(tattooRotation);
    offset = vec2(c * offset.x + s * offset.y, -s * offset.x + c * offset.y);
    vec2 tattooUV = offset / tattooScale + 0.5;

    if (tattooUV.x >= 0.0 && tattooUV.x <= 1.0 &&
        tattooUV.y >= 0.0 && tattooUV.y <= 1.0) {
      vec4 tattoo = texture2D(tattooTexture, tattooUV);
      tattoo.rgb *= 0.85;
      float edgeFade = 1.0;
      float fadeWidth = 0.04;
      edgeFade *= smoothstep(0.0, fadeWidth, tattooUV.x);
      edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - tattooUV.x);
      edgeFade *= smoothstep(0.0, fadeWidth, tattooUV.y);
      edgeFade *= smoothstep(0.0, fadeWidth, 1.0 - tattooUV.y);
      float alpha = tattoo.a * edgeFade;
      skin.rgb = mix(skin.rgb, tattoo.rgb * light, alpha);
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

function createSkinTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d4a574';
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

interface ModelWithUVTattooProps {
  uploadedImage: string | null;
  model: ModelType;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  setDecalVisible: (visible: boolean) => void;
  showSafeZone?: boolean;
}

export default function ModelWithUVTattoo({
  uploadedImage,
  model,
  decalRotation,
  decalScale,
  setDecalVisible,
  showSafeZone = true,
}: ModelWithUVTattooProps) {
  const { camera } = useThree();
  const [cloneGroup, setCloneGroup] = useState<THREE.Object3D | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const tattooCenter = useRef(new THREE.Vector2(0.5, 0.5));
  const [hasPlaced, setHasPlaced] = useState(false);
  const isDragging = useRef(false);

  const logoTexture = useLoader(TextureLoader, '/logo.png');
  const monkGltf = useLoader(GLTFLoader, '/monk.glb');
  const baseObj = useLoader(OBJLoader, '/FinalBaseMesh.obj');

  const skinTexture = useMemo(() => createSkinTexture(), []);
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

  const scaleInUV = useMemo(
    () => Math.max(0.01, decalScale) * 0.12,
    [decalScale]
  );

  useFrame(() => {
    shaderMaterial.uniforms.tattooCenter.value.copy(tattooCenter.current);
    shaderMaterial.uniforms.tattooScale.value = scaleInUV;
    shaderMaterial.uniforms.tattooRotation.value =
      THREE.MathUtils.degToRad(decalRotation);
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
      mouse.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera);
      const m = meshRef.current;
      if (!m) return null;
      const hits = raycaster.current.intersectObject(m);
      if (hits.length > 0 && hits[0].uv) return hits[0].uv.clone();
      return null;
    },
    [camera]
  );

  const clampToSafeZone = useCallback((uv: THREE.Vector2, scale: number) => {
    const half = scale * 0.5;
    uv.x = Math.max(SAFE_ZONE.uMin + half, Math.min(SAFE_ZONE.uMax - half, uv.x));
    uv.y = Math.max(SAFE_ZONE.vMin + half, Math.min(SAFE_ZONE.vMax - half, uv.y));
    return uv;
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const uv = getUVFromEvent(e);
      if (uv) {
        isDragging.current = true;
        setHasPlaced(true);
        clampToSafeZone(uv, scaleInUV);
        tattooCenter.current.copy(uv);
      }
    },
    [getUVFromEvent, scaleInUV, clampToSafeZone]
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
    isDragging.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onPointerDown, onPointerMove, onPointerUp]);

  if (!cloneGroup) return null;
  return <primitive object={cloneGroup} />;
}
