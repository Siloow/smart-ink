import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OBJLoader } from 'three-stdlib';
import * as THREE from 'three';
import { SplitFigure } from './PipelineFigures';

/**
 * Live version of the hero pipeline figure: the real forearm mesh, split down
 * the middle of the viewport — wireframe geometry on one side, lit skin with the
 * design on the other. The design is projected in object space, so it stays put
 * on the surface as the limb turns.
 *
 * The forearm is the only body asset light enough for a landing page (156 KB);
 * three.js itself is already in the bundle for the editor, so this costs no
 * extra JS.
 */

const MESH_URL = '/forearm.obj';
/**
 * The mesh is normalised by the width of the forearm rather than its length: it
 * is a ~5:1 shaft, so length-based framing leaves a thin sliver in the middle of
 * a near-square panel. At a width of 1 the limb is about 4.5 long, and the
 * camera below shows a little over 2 — a cropped section, as in the drawn figure.
 */
const TARGET_WIDTH = 1;
/** Sits the view on the clean shaft, below the flare at the elbow end. */
const VIEW_CENTER_Y = -0.35;
const CAMERA_DISTANCE = 5.2;
const DESIGN_CENTER = new THREE.Vector2(0, -0.05);
const DESIGN_SIZE = new THREE.Vector2(0.58, 0.58);
/** Spacing of the mesh half's UV grid: rings along the limb, seams around it. */
const RING_SPACING = 0.34;
const SEAM_SPACING = Math.PI / 6;
/** Idle sweep, in radians either side of the design facing the camera. */
const SWING = 0.42;
const SWING_SPEED = 0.22;
/** Radians of limb rotation per pixel dragged. */
const DRAG_SENSITIVITY = 0.008;

const COLORS = {
  meshFill: new THREE.Color('#16161b'),
  meshLine: new THREE.Color('#e8e8ec'),
  designLine: new THREE.Color('#e8e8ec'),
  skinShadow: new THREE.Color('#2f1d13'),
  skinMid: new THREE.Color('#b9855e'),
  skinLight: new THREE.Color('#ecd0b6'),
  ink: new THREE.Color('#1b0f08'),
  rim: new THREE.Color('#ffe2be'),
};

/** The same emblem as the drawn figures, as an alpha mask for the shader. */
function createDesignTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const r = size * 0.42;

  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.lineWidth = size * 0.016;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = size * 0.0095;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = size * 0.016;
  ctx.beginPath();
  ctx.moveTo(c, c - r * 0.56);
  ctx.lineTo(c + r * 0.5, c + r * 0.33);
  ctx.lineTo(c - r * 0.5, c + r * 0.33);
  ctx.closePath();
  ctx.stroke();

  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * r * 0.2, c + Math.sin(angle) * r * 0.2);
    ctx.lineTo(c + Math.cos(angle) * r * 0.31, c + Math.sin(angle) * r * 0.31);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(c, c, r * 0.1, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Blender writes stray unconnected edges as `l` elements. OBJLoader treats any
 * object containing one as line geometry and throws away its faces, so the
 * forearm arrives as LineSegments unless they're stripped first.
 */
function stripLooseEdges(text: string): string {
  return text.replace(/^l[ \t].*$/gm, '');
}

/**
 * The forearm is cut from a posed body, so it sits at an angle. Rotate it so the
 * axis between the wrist end and the elbow end points straight up — measured
 * from the averaged extremes rather than the bounding box, which a bent limb
 * would skew.
 */
function standUpright(geo: THREE.BufferGeometry): void {
  const position = geo.attributes.position;
  if (!position || position.count === 0) return;

  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const span = box.max.y - box.min.y;
  if (span <= 0) return;

  const lowCut = box.min.y + span * 0.15;
  const highCut = box.max.y - span * 0.15;
  const low = new THREE.Vector3();
  const high = new THREE.Vector3();
  let lowCount = 0;
  let highCount = 0;

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y <= lowCut) {
      low.x += position.getX(i);
      low.y += y;
      low.z += position.getZ(i);
      lowCount++;
    } else if (y >= highCut) {
      high.x += position.getX(i);
      high.y += y;
      high.z += position.getZ(i);
      highCount++;
    }
  }
  if (!lowCount || !highCount) return;

  const axis = high.divideScalar(highCount).sub(low.divideScalar(lowCount)).normalize();
  geo.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0))
  );
}

interface Band {
  midX: number;
  midZ: number;
  width: number;
}

/** Silhouette midpoint and width of each horizontal slice of the limb. */
function measureBands(geo: THREE.BufferGeometry, count: number): Band[] {
  const position = geo.attributes.position;
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const step = (max.y - min.y) / count;
  const bands: Band[] = [];

  for (let band = 0; band < count; band++) {
    const from = min.y + band * step;
    const to = from + step;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < from || y > to) continue;
      const x = position.getX(i);
      const z = position.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (minX === Infinity) continue;
    bands.push({ midX: (minX + maxX) / 2, midZ: (minZ + maxZ) / 2, width: maxX - minX });
  }
  return bands;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Puts the shaft of the limb on the Y axis at a known width. Bounding-box
 * centring would be thrown off by the flare at the elbow end and by the bend in
 * the limb, leaving the part actually on screen off to one side; medians over
 * horizontal slices ignore both.
 */
function frameOnShaft(geo: THREE.BufferGeometry): void {
  const bands = measureBands(geo, 16);
  if (bands.length === 0) return;

  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(
    -median(bands.map((b) => b.midX)),
    -(box.min.y + box.max.y) / 2,
    -median(bands.map((b) => b.midZ))
  );

  const width = median(bands.map((b) => b.width));
  if (width > 0) {
    const scale = TARGET_WIDTH / width;
    geo.scale(scale, scale, scale);
  }
  geo.translate(0, -VIEW_CENTER_Y, 0);
}

/** Loads the forearm as a single geometry, normalised and centred for framing. */
class ForearmGeometryLoader extends THREE.Loader<THREE.BufferGeometry> {
  load(
    url: string,
    onLoad: (geometry: THREE.BufferGeometry) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void
  ): void {
    const fileLoader = new THREE.FileLoader(this.manager);
    fileLoader.setResponseType('text');
    fileLoader.load(
      url,
      (data) => {
        try {
          const parsed = new OBJLoader().parse(stripLooseEdges(data as string));
          let geometry: THREE.BufferGeometry | null = null;
          parsed.traverse((child) => {
            if (geometry) return;
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh.geometry) geometry = mesh.geometry as THREE.BufferGeometry;
          });
          if (!geometry) throw new Error(`No mesh geometry in ${url}`);

          const geo = geometry as THREE.BufferGeometry;
          if (!geo.attributes.normal) geo.computeVertexNormals();
          standUpright(geo);
          frameOnShaft(geo);
          onLoad(geo);
        } catch (error) {
          onError?.(error);
        }
      },
      onProgress,
      onError
    );
  }
}

const vertexShader = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vObjPos = position;
    vObjNormal = normal;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uSplit;
  uniform sampler2D uDesign;
  uniform vec2 uDesignCenter;
  uniform vec2 uDesignSize;
  uniform float uRingSpacing;
  uniform float uSeamSpacing;
  uniform vec3 uMeshFill;
  uniform vec3 uMeshLine;
  uniform vec3 uDesignLine;
  uniform vec3 uSkinShadow;
  uniform vec3 uSkinMid;
  uniform vec3 uSkinLight;
  uniform vec3 uInk;
  uniform vec3 uRim;

  varying vec3 vObjPos;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  /** Screen-space-consistent line along multiples of "spacing". */
  float gridLine(float coord, float spacing, float widthPx) {
    float scaled = coord / spacing;
    float dist = abs(fract(scaled - 0.5) - 0.5);
    float w = fwidth(scaled) * widthPx;
    return 1.0 - smoothstep(0.0, max(w, 1e-5), dist);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    float facingCamera = max(dot(N, V), 0.0);

    // Projected design, in object space so it travels with the surface.
    vec2 duv = (vObjPos.xy - uDesignCenter) / uDesignSize + 0.5;
    float inside =
      step(0.0, duv.x) * step(duv.x, 1.0) *
      step(0.0, duv.y) * step(duv.y, 1.0);
    float towardProjector = smoothstep(0.05, 0.55, normalize(vObjNormal).z);
    float ink = texture2D(uDesign, duv).a * inside * towardProjector;

    // — Mesh half: cylindrical UV grid over a flat fill.
    float rings = gridLine(vObjPos.y, uRingSpacing, 1.1);
    float seams = gridLine(atan(vObjPos.x, vObjPos.z), uSeamSpacing, 1.1);
    float silhouette = 1.0 - smoothstep(0.0, 0.55, facingCamera);
    vec3 meshColor = mix(uMeshFill, uMeshLine, max(rings, seams) * 0.75);
    meshColor = mix(meshColor, uMeshLine, silhouette * 0.7);
    meshColor = mix(meshColor, uDesignLine, ink * 0.92);

    // — Render half: key light from the render side, soft fill from the other.
    float key = max(dot(N, normalize(vec3(0.62, 0.4, 0.68))), 0.0);
    float fill = max(dot(N, normalize(vec3(-0.8, -0.1, 0.5))), 0.0);
    vec3 skin = mix(uSkinShadow, uSkinMid, smoothstep(-0.15, 0.85, key));
    skin = mix(skin, uSkinLight, smoothstep(0.55, 1.0, key) * 0.85);
    skin += uSkinMid * (fill * 0.14 + 0.1);
    skin = mix(skin, uInk, ink * 0.88);
    skin += uRim * pow(1.0 - facingCamera, 3.0) * 0.3;

    vec3 color = gl_FragCoord.x < uSplit ? meshColor : skin;
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface SpinState {
  angle: React.RefObject<number>;
  direction: React.RefObject<number>;
  dragging: React.RefObject<boolean>;
  /** When false the limb only turns under the pointer. */
  autoSwing: boolean;
}

const Forearm: React.FC<{ spin: SpinState; onReady: () => void }> = ({ spin, onReady }) => {
  const geometry = useLoader(ForearmGeometryLoader, MESH_URL);
  const groupRef = useRef<THREE.Group>(null);
  const { size, viewport, invalidate } = useThree();

  const design = useMemo(createDesignTexture, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uSplit: { value: 0 },
          uDesign: { value: design },
          uDesignCenter: { value: DESIGN_CENTER.clone() },
          uDesignSize: { value: DESIGN_SIZE.clone() },
          uRingSpacing: { value: RING_SPACING },
          uSeamSpacing: { value: SEAM_SPACING },
          uMeshFill: { value: COLORS.meshFill },
          uMeshLine: { value: COLORS.meshLine },
          uDesignLine: { value: COLORS.designLine },
          uSkinShadow: { value: COLORS.skinShadow },
          uSkinMid: { value: COLORS.skinMid },
          uSkinLight: { value: COLORS.skinLight },
          uInk: { value: COLORS.ink },
          uRim: { value: COLORS.rim },
        },
      }),
    [design]
  );

  useEffect(() => {
    onReady();
  }, [onReady]);

  /* The geometry is owned by useLoader's cache, so only the locally created
     material and texture are disposed here. */
  useEffect(
    () => () => {
      material.dispose();
      design.dispose();
    },
    [material, design]
  );

  /* The split is a vertical line down the middle of the drawing buffer.
     Explicitly request a frame, since the loop is on demand when idle. */
  useEffect(() => {
    material.uniforms.uSplit.value = (size.width * viewport.dpr) / 2;
    invalidate();
  }, [material, size.width, viewport.dpr, invalidate]);

  useFrame((_, delta) => {
    if (spin.autoSwing && !spin.dragging.current) {
      spin.angle.current += spin.direction.current * delta * SWING_SPEED;
      if (spin.angle.current > SWING && spin.direction.current > 0) spin.direction.current = -1;
      if (spin.angle.current < -SWING && spin.direction.current < 0) spin.direction.current = 1;
    }
    if (groupRef.current) groupRef.current.rotation.y = spin.angle.current;
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={material} />
    </group>
  );
};

class PreviewBoundary extends React.Component<
  { children: React.ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[Smart Ink] 3D hero preview unavailable, using the drawn figure.', error);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const HeroPreview: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const angle = useRef(0);
  const direction = useRef(1);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const [autoSwing, setAutoSwing] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const spin: SpinState = { angle, direction, dragging, autoSwing };
  const handleReady = useCallback(() => setReady(true), []);
  const handleFail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAutoSwing(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* Don't burn frames while the hero is off screen. */
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = e.clientX;
    setDragActive(true);
  };

  /* Tracked on the window so a drag survives the pointer leaving the panel. */
  useEffect(() => {
    if (!dragActive) return;

    const onMove = (e: PointerEvent) => {
      angle.current += (e.clientX - lastX.current) * DRAG_SENSITIVITY;
      lastX.current = e.clientX;
    };
    const onEnd = () => {
      dragging.current = false;
      direction.current = angle.current > 0 ? -1 : 1;
      setDragActive(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [dragActive]);

  const showFallback = failed || !ready;

  return (
    <div
      className={showFallback ? 'hero-preview' : 'hero-preview hero-preview--live'}
      ref={wrapperRef}
      onPointerDown={showFallback ? undefined : startDrag}
    >
      {showFallback && (
        <div className="hero-preview-fallback">
          <SplitFigure />
        </div>
      )}

      {!failed && (
        <PreviewBoundary onFail={handleFail}>
          <Canvas
            className="hero-preview-canvas"
            camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 30 }}
            dpr={[1, 2]}
            frameloop={visible ? (autoSwing || dragActive ? 'always' : 'demand') : 'never'}
            gl={{ antialias: true, alpha: true }}
            style={{ opacity: ready ? 1 : 0 }}
          >
            <Suspense fallback={null}>
              <Forearm spin={spin} onReady={handleReady} />
            </Suspense>
          </Canvas>
        </PreviewBoundary>
      )}

      {!showFallback && (
        <>
          <span className="hero-preview-divider" aria-hidden />
          <span className="hero-preview-label hero-preview-label--mesh">mesh</span>
          <span className="hero-preview-label hero-preview-label--render">render</span>
          <span className="hero-preview-hint">drag to rotate</span>
        </>
      )}
    </div>
  );
};

export default HeroPreview;
