import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import { GLTFLoader, OBJLoader } from 'three-stdlib';
import { DecalGeometry } from 'three-stdlib';
import * as THREE from 'three';
import { TextureLoader, Object3D, Mesh, MeshBasicMaterial, Vector3, Texture, Group, Euler } from 'three';

const DECAL_SIZE = new Vector3(1, 1, 1);

type ModelType = 'Monk' | 'FinalBaseMesh';

interface MonkWithDecalProps {
  uploadedImage: string | null;
  model: ModelType;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  setDecalVisible: (visible: boolean) => void;
  setDecalOriginData?: (data: { position: [number, number, number], normal: [number, number, number] } | null) => void;
  decalPosition?: [number, number, number] | null;
  decalNormal?: [number, number, number] | null;
}

// Helper to create Euler from degrees
function eulerFromDeg(deg: number, normal: THREE.Vector3) {
  // Align decal to normal, then apply Z rotation
  const euler = new THREE.Euler();
  // Default decal orientation: normal is +Z, so align to normal
  euler.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
  // Apply Z rotation (decalRotation)
  euler.z += THREE.MathUtils.degToRad(deg);
  return euler;
}

export default function ModelWithDecal({ uploadedImage, model, decalRotation, decalScale, decalColor, decalOpacity, setDecalVisible, setDecalOriginData, decalPosition, decalNormal }: MonkWithDecalProps) {
  const group = useRef<THREE.Group>(null);
  const { camera, scene } = useThree();
  const [targetMesh, setTargetMesh] = useState<Mesh | null>(null);
  const [decal, setDecal] = useState<Mesh | null>(null);
  const [isMovingDecal, setIsMovingDecal] = useState(false);
  const [decalMaterial, setDecalMaterial] = useState<MeshBasicMaterial | null>(null);
  const [helper] = useState(() => new Object3D());
  const raycaster = useRef(new THREE.Raycaster());
  const logoTexture = useLoader(TextureLoader, '/logo.png');
  const monkGltf = useLoader(GLTFLoader, '/monk.glb');
  const baseObj = useLoader(OBJLoader, '/FinalBaseMesh.obj');

  // Store original decal placement for re-creation
  const [decalOrigin, setDecalOrigin] = useState<null | {
    position: THREE.Vector3;
    normal: THREE.Vector3;
  }>(null);

  // Memoize uploaded texture
  const uploadedTexture = useMemo(() => {
    if (uploadedImage) {
      const texture = new Texture();
      const image = new window.Image();
      image.src = uploadedImage;
      image.onload = () => {
        texture.image = image;
        texture.needsUpdate = true;
      };
      return texture;
    }
    return null;
  }, [uploadedImage]);

  // Setup decal material
  useEffect(() => {
    const tex = uploadedTexture || logoTexture;
    if (tex) {
      setDecalMaterial(
        new MeshBasicMaterial({
          map: tex,
          color: new THREE.Color(decalColor),
          transparent: true,
          opacity: decalOpacity,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        })
      );
    }
  }, [logoTexture, uploadedTexture, decalColor, decalOpacity]);

  // Find the mesh in the selected model
  useEffect(() => {
    let found: Mesh | null = null;
    let modelGroup: THREE.Object3D | null = null;
    if (model === 'Monk') {
      monkGltf.scene.traverse((child: THREE.Object3D) => {
        if ((child as Mesh).isMesh && !found) {
          found = child as Mesh;
        }
      });
      modelGroup = monkGltf.scene;
    } else if (model === 'FinalBaseMesh') {
      baseObj.traverse((child: THREE.Object3D) => {
        if ((child as Mesh).isMesh && !found) {
          found = child as Mesh;
        }
      });
      // Fallback: add a basic material if missing
      baseObj.traverse((child: THREE.Object3D) => {
        if ((child as Mesh).isMesh && !(child as Mesh).material) {
          (child as Mesh).material = new MeshBasicMaterial({ color: 0xcccccc });
        }
      });
      modelGroup = baseObj;
    }
    // Center the model at the origin
    if (modelGroup) {
      const box = new THREE.Box3().setFromObject(modelGroup);
      const center = new THREE.Vector3();
      box.getCenter(center);
      modelGroup.position.sub(center);
    }
    if (found) {
      if ((found as Mesh).geometry) (found as Mesh).geometry.computeVertexNormals();
      setTargetMesh(found);
    }
  }, [monkGltf, baseObj, model]);

  // Remove decal when model changes
  useEffect(() => {
    if (decal) {
      scene.remove(decal);
      (decal.geometry as THREE.BufferGeometry).dispose();
      (decal.material as MeshBasicMaterial).dispose();
      setDecal(null);
    }
    setDecalVisible(false);
    setDecalOrigin(null);
    if (setDecalOriginData) setDecalOriginData(null);
  }, [model]);

  // Show/hide sidebar based on decal presence
  useEffect(() => {
    setDecalVisible(!!decal);
  }, [decal, setDecalVisible]);

  // When rotation/scale changes, recreate decal geometry at original position
  useEffect(() => {
    if (decal && decalOrigin && targetMesh && decalMaterial) {
      // Remove old geometry
      (decal.geometry as THREE.BufferGeometry).dispose();
      // Compute rotation from normal and user rotation
      const euler = eulerFromDeg(decalRotation, decalOrigin.normal);
      const size = new Vector3(decalScale, decalScale, decalScale);
      decal.geometry = new DecalGeometry(targetMesh, decalOrigin.position, euler, size);
    }
  }, [decalRotation, decalScale, decal, decalOrigin, targetMesh, decalMaterial]);

  // Restore decal from saved position/normal
  useEffect(() => {
    if (
      decalPosition &&
      decalNormal &&
      !decal &&
      targetMesh &&
      decalMaterial
    ) {
      const position = new THREE.Vector3(...decalPosition);
      const normal = new THREE.Vector3(...decalNormal);
      const euler = eulerFromDeg(decalRotation, normal);
      const size = new Vector3(decalScale, decalScale, decalScale);
      const decalGeometry = new DecalGeometry(targetMesh, position, euler, size);
      const newDecal = new Mesh(decalGeometry, decalMaterial.clone());
      scene.add(newDecal);
      setDecal(newDecal);
      setDecalOrigin({ position, normal });
      if (setDecalOriginData) setDecalOriginData({ position: [position.x, position.y, position.z], normal: [normal.x, normal.y, normal.z] });
    }
    // eslint-disable-next-line
  }, [decalPosition, decalNormal, targetMesh, decalMaterial]);

  // Handle pointer down
  const onPointerDown = useCallback((event: PointerEvent) => {
    if (!targetMesh || !decalMaterial) return;
    const metaKey = event.metaKey;
    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.current.setFromCamera(mouse, camera);
    if (metaKey && decal) {
      // Check if pointer is over the decal
      const intersects = raycaster.current.intersectObject(decal);
      if (intersects.length > 0) {
        setIsMovingDecal(true);
        (scene as any).orbitControls && ((scene as any).orbitControls.enabled = false);
      }
      return;
    }
    // Place new decal
    const intersects = raycaster.current.intersectObject(targetMesh);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const position = intersect.point.clone();
      const normal = intersect.face?.normal.clone().transformDirection(targetMesh.matrixWorld) || new Vector3(0, 1, 0);
      helper.position.copy(position);
      helper.lookAt(position.clone().add(normal));
      if (decal) {
        scene.remove(decal);
        (decal.geometry as THREE.BufferGeometry).dispose();
        (decal.material as MeshBasicMaterial).dispose();
        setDecal(null);
      }
      // Compute rotation from normal and user rotation
      const euler = eulerFromDeg(decalRotation, normal);
      const size = new Vector3(decalScale, decalScale, decalScale);
      const decalGeometry = new DecalGeometry(targetMesh, position, euler, size);
      const newDecal = new Mesh(decalGeometry, decalMaterial.clone());
      scene.add(newDecal);
      setDecal(newDecal);
      setDecalOrigin({ position, normal });
      if (setDecalOriginData) setDecalOriginData({ position: [position.x, position.y, position.z], normal: [normal.x, normal.y, normal.z] });
    }
  }, [targetMesh, decal, decalMaterial, camera, helper, scene, decalRotation, decalScale]);

  // Handle pointer move
  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!isMovingDecal || !targetMesh || !decal) return;
    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.current.setFromCamera(mouse, camera);
    const intersects = raycaster.current.intersectObject(targetMesh);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const position = intersect.point.clone();
      const normal = intersect.face?.normal.clone().transformDirection(targetMesh.matrixWorld) || new Vector3(0, 1, 0);
      helper.position.copy(position);
      helper.lookAt(position.clone().add(normal));
      // Update decal geometry and origin
      if (decalOrigin) {
        setDecalOrigin({ position, normal });
      }
      if (decal) {
        (decal.geometry as THREE.BufferGeometry).dispose();
        const euler = eulerFromDeg(decalRotation, normal);
        const size = new Vector3(decalScale, decalScale, decalScale);
        decal.geometry = new DecalGeometry(targetMesh, position, euler, size);
      }
      if (setDecalOriginData) setDecalOriginData({ position: [position.x, position.y, position.z], normal: [normal.x, normal.y, normal.z] });
    }
  }, [isMovingDecal, targetMesh, decal, camera, helper, decalOrigin, decalRotation, decalScale]);

  // Handle pointer up
  const onPointerUp = useCallback(() => {
    if (isMovingDecal) {
      setIsMovingDecal(false);
      (scene as any).orbitControls && ((scene as any).orbitControls.enabled = true);
    }
  }, [isMovingDecal, scene]);

  // Attach/detach event listeners
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

  // Render model
  if (model === 'FinalBaseMesh') {
    return <primitive object={baseObj as Group} ref={group} />;
  }
  // Monk
  return targetMesh ? <primitive object={targetMesh} ref={group} /> : null;
} 