import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OBJLoader } from 'three-stdlib';
import * as THREE from 'three';
import { SplitFigure } from './PipelineFigures';

/**
 * Live version of the hero pipeline figure: the real forearm mesh, split down
 * the middle of the viewport — wireframe geometry on one side, lit skin with the
 * design on the other. Dragging turns the limb; holding ⌘ drags the design
 * itself over the surface, a taste of the placement step in the editor.
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
/**
 * Height along the limb that sits at the centre of frame. Framed down by the
 * wrist rather than on the middle of the shaft: cropped to the shaft alone the
 * limb was an anonymous tube, so the shot now runs from the forearm, where the
 * design goes, down through the wrist to the hand.
 */
const VIEW_CENTER_Y = -1.8;
/** Half turn to choose between the palm and the back of the hand. */
const HAND_FACE_TURN = 0;
/**
 * A long lens flattens the limb into a column, so the camera comes in close on a
 * wider one: the shaft tapers away and the near surface reads as round.
 */
const CAMERA_FOV = 38;
const CAMERA_DISTANCE = 5.15;
/**
 * Lean of the limb across the frame. Upright, it sat parallel to the divider —
 * two vertical lines down the middle of the panel — so it now runs corner to
 * corner and crosses the divider instead.
 */
const LIMB_TILT = -0.2;
/**
 * The design is placed in cylindrical surface coordinates — an angle around the
 * limb and a height along it — rather than projected from a fixed direction, so
 * that it can be dragged to any point on the skin and stays there as the limb
 * turns, including round the far side.
 */
const DESIGN_EXTENT = 0.58;
/** Radius of the limb once normalised, which sets the arc a square design spans. */
const LIMB_RADIUS = TARGET_WIDTH / 2;
const DESIGN_SIZE = new THREE.Vector2(DESIGN_EXTENT / LIMB_RADIUS, DESIGN_EXTENT);
/** Angle 0 faces the camera at rest; the height is in mesh units. */
const DESIGN_CENTER = new THREE.Vector2(0, 0.7);
/**
 * Holds a dragged design to the forearm: below, it would run onto the wrist and
 * the hand, where a mapping built around the limb's axis has nothing sensible to
 * say about a flat palm.
 */
const DESIGN_HEIGHT_MIN = 0.35;
const DESIGN_HEIGHT_MAX = 1.15;
/**
 * Hits below this are on the wrist or the hand. A drag ignores them, holding the
 * design at its last place on the forearm: the flat of the hand sits across the
 * limb's axis, so hits there swing the angle about wildly.
 */
const FOREARM_BOTTOM_Y = 0.05;
/** Spacing of the mesh half's UV grid: rings along the limb, seams around it. */
const RING_SPACING = 0.44;
const SEAM_SPACING = Math.PI / 6;
/**
 * Idle sweep, in radians either side of the rest pose. A sine rather than the
 * ramp it used to be, which reversed abruptly at each end and read as a
 * metronome; and centred a little off-axis, since dead-on is the dullest pose.
 */
const SWING = 0.3;
/** Phase advance per second, for a sweep of about eleven seconds. */
const SWING_SPEED = 0.55;
/**
 * Rest pose. Turned a little towards the render side, so the design carries onto
 * the lit skin — the half worth looking at — rather than sitting square on the
 * divider or drifting round to the wireframe.
 */
const SWING_CENTER = 0.16;
/** How much of a dragged pose is shed per second, easing back to the rest one. */
const RETURN_RATE = 0.45;
/** Radians of limb rotation per pixel dragged. */
const DRAG_SENSITIVITY = 0.008;
/** Camera travel at the edge of the panel as the pointer crosses it. */
const PARALLAX = 0.17;
/** Share of the remaining parallax distance covered per second. */
const PARALLAX_EASE = 3.5;
/** Height along the limb that the key light pools on — the forearm and design. */
const LIGHT_CENTER = 0.7;

const COLORS = {
  meshFill: new THREE.Color('#16161b'),
  meshLine: new THREE.Color('#e8e8ec'),
  designLine: new THREE.Color('#e8e8ec'),
  skinShadow: new THREE.Color('#33180e'),
  skinMid: new THREE.Color('#c08355'),
  skinLight: new THREE.Color('#e8b487'),
  /** Light scattering through the skin, warmest where the key falls away. */
  subsurface: new THREE.Color('#93361a'),
  /** Cool bounce off the far side, to set against the warm key. */
  bounce: new THREE.Color('#4a86ad'),
  sheen: new THREE.Color('#fff0dc'),
  rim: new THREE.Color('#ffe2be'),
};

/** Ink multiplies the lit skin rather than replacing it, so it is a factor. */
const INK_TINT = new THREE.Vector3(0.11, 0.09, 0.1);

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

/**
 * The hand is flat, and it is cut from the body turned edge-on to the camera: a
 * blade a third of the width of the wrist, which reads as nothing at all. Turn
 * the limb about its own axis until the palm is broadside and the fingers spread
 * across the view. The forearm is round in section, so turning it costs the rest
 * of the frame nothing.
 */
function faceHandForward(geo: THREE.BufferGeometry): void {
  const position = geo.attributes.position;
  if (!position || position.count === 0) return;

  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const span = box.max.y - box.min.y;
  if (span <= 0) return;
  /* The hand is the outer fifth of the limb, at the low end after standUpright. */
  const cut = box.min.y + span * 0.2;

  let count = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > cut) continue;
    cx += position.getX(i);
    cz += position.getZ(i);
    count++;
  }
  if (count < 8) return;
  cx /= count;
  cz /= count;

  /* Spread of the hand around the axis, as a covariance in the XZ plane. */
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > cut) continue;
    const dx = position.getX(i) - cx;
    const dz = position.getZ(i) - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  /* Angle of the widest direction of that spread, turned onto the screen's
     horizontal. Which face this lands on — palm or back of the hand — is the
     half turn the covariance can't distinguish, hence the constant. */
  const widest = 0.5 * Math.atan2(2 * xz, xx - zz);
  geo.rotateY(widest + HAND_FACE_TURN);
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

/** Folds an angle into (-PI, PI], matching the shader's wrap. */
function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor(angle / turn + 0.5);
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
          faceHandForward(geo);
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
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vObjPos = position;
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
  uniform vec3 uSubsurface;
  uniform vec3 uBounce;
  uniform vec3 uSheen;
  uniform vec3 uInk;
  uniform vec3 uRim;
  uniform float uLightCenter;

  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  const float TAU = 6.283185307;
  /**
   * The render half shows the right of the limb, so the key is set just inside
   * it, high and a little to the right of the lens: brightest where the design
   * sits by the divider, then turning away to the far silhouette, where the rim
   * picks the arm back off the background. Any further round and the whole half
   * is lit evenly and the form goes flat; any further left and the lit area
   * narrows to a slit against the divider.
   */
  const vec3 KEY_DIR = vec3(0.22, 0.52, 0.82);
  const vec3 BOUNCE_DIR = vec3(0.9, -0.34, 0.26);

  /** Screen-space-consistent line along multiples of "spacing". */
  float gridLine(float coord, float spacing, float widthPx) {
    float scaled = coord / spacing;
    float dist = abs(fract(scaled - 0.5) - 0.5);
    float w = fwidth(scaled) * widthPx;
    return 1.0 - smoothstep(0.0, max(w, 1e-5), dist);
  }

  /**
   * Filmic curve and sRGB encode for the render half. The palette is in the
   * linear working space, and a custom shader gets none of the conversion that
   * three's own materials do, so without this the skin is written out crushed
   * and the highlights clip flat instead of rolling off.
   */
  vec3 film(vec3 color) {
    color *= 0.56;
    vec3 curved = clamp(
      (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14),
      0.0,
      1.0
    );
    return pow(curved, vec3(1.0 / 2.2));
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    float facingCamera = max(dot(N, V), 0.0);

    /* The design sits in the limb's own cylindrical coordinates: an angle
       around it and a height along it. Every surface point maps to one place in
       the design, so the ink is on the skin rather than projected through it. */
    float aroundLimb = atan(vObjPos.x, vObjPos.z);
    float angleFromCenter = aroundLimb - uDesignCenter.x;
    // Shortest way round, so the design may straddle the back of the limb.
    angleFromCenter -= TAU * floor(angleFromCenter / TAU + 0.5);
    vec2 duv = vec2(angleFromCenter, vObjPos.y - uDesignCenter.y) / uDesignSize + 0.5;
    float inside =
      step(0.0, duv.x) * step(duv.x, 1.0) *
      step(0.0, duv.y) * step(duv.y, 1.0);
    float ink = texture2D(uDesign, duv).a * inside;

    // — Mesh half: cylindrical UV grid over a flat fill.
    float rings = gridLine(vObjPos.y, uRingSpacing, 1.1);
    float seams = gridLine(aroundLimb, uSeamSpacing, 1.1);
    float silhouette = 1.0 - smoothstep(0.0, 0.55, facingCamera);
    vec3 meshColor = mix(uMeshFill, uMeshLine, max(rings, seams) * 0.75);
    meshColor = mix(meshColor, uMeshLine, silhouette * 0.7);
    meshColor = mix(meshColor, uDesignLine, ink * 0.92);

    /* — Render half: a warm key against a cool bounce, pooling on the mid
       shaft so the light falls away where the crop leaves the limb. */
    vec3 keyDir = normalize(KEY_DIR);
    /* Falls away far enough down the limb to leave the hand dimmer than the
       forearm, without losing it to the dark. */
    float pool = 1.0 - smoothstep(0.8, 3.2, abs(vObjPos.y - uLightCenter));
    /* Wrapped rather than clamped at the terminator: light entering skin
       scatters before it leaves, so it carries on around the form instead of
       stopping dead where the surface turns away. */
    float key = max((dot(N, keyDir) + 0.4) / 1.4, 0.0) * mix(0.5, 1.0, pool);
    float bounce = max(dot(N, normalize(BOUNCE_DIR)), 0.0);

    vec3 skin = mix(uSkinShadow, uSkinMid, smoothstep(-0.05, 0.85, key));
    /* Held short of the full highlight colour: taken all the way, the top of the
       ramp goes achromatic and the skin reads as ivory rather than skin. */
    skin = mix(skin, uSkinLight, smoothstep(0.72, 1.0, key) * 0.6);
    /* The band where the key falls off is where light has travelled furthest
       through the skin before coming back out — the flesh under it glows. */
    float terminator = smoothstep(0.02, 0.4, key) * (1.0 - smoothstep(0.28, 0.78, key));
    skin = mix(skin, uSubsurface, terminator * 0.45);
    skin += uBounce * bounce * 0.25;
    // Shade the form as it turns away from the lens, to give it some weight.
    skin *= mix(0.68, 1.0, smoothstep(0.0, 0.6, facingCamera));

    /* Ink lies under the skin, so it darkens the surface rather than covering
       it, and the sheen added below still runs across the tattoo. The line work
       is about a pixel wide here, so its coverage is firmed up first: against
       the dark mesh half a half-covered pixel still reads, but a 40% darkening
       of lit skin does not. */
    skin *= mix(vec3(1.0), uInk, smoothstep(0.06, 0.6, ink));

    float sheen = pow(max(dot(N, normalize(keyDir + V)), 0.0), 26.0);
    skin += uSheen * sheen * smoothstep(0.0, 0.3, key) * 0.26;
    /* The background is nearly black too, so the shadow side needs an edge to
       lift the silhouette off it. Kept tight: spread wide, it washes most of the
       shadow side to a pale grey instead of reading as an edge light. */
    skin += uRim * pow(1.0 - facingCamera, 5.0) * 1.5;
    skin = film(skin);

    vec3 color = gl_FragCoord.x < uSplit ? meshColor : skin;
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface SpinState {
  /** Phase of the idle sweep, in radians. */
  phase: React.RefObject<number>;
  /** Rotation carried over from dragging, which eases back to zero. */
  offset: React.RefObject<number>;
  /** Held while the pointer is down, in either mode, to still the idle swing. */
  interacting: React.RefObject<boolean>;
  /** When false the limb only turns under the pointer. */
  autoSwing: boolean;
}

interface DesignDrag {
  /** Client position of the pointer while the design is being moved, else null. */
  pointer: React.RefObject<{ x: number; y: number } | null>;
  /** Pointer position over the panel as -1..1 from the centre, for parallax. */
  hover: React.RefObject<THREE.Vector2>;
}

const Forearm: React.FC<{ spin: SpinState; drag: DesignDrag; onReady: () => void }> = ({
  spin,
  drag,
  onReady,
}) => {
  const geometry = useLoader(ForearmGeometryLoader, MESH_URL);
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, gl, size, viewport, invalidate } = useThree();

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
          uSubsurface: { value: COLORS.subsurface },
          uBounce: { value: COLORS.bounce },
          uSheen: { value: COLORS.sheen },
          uInk: { value: INK_TINT },
          uRim: { value: COLORS.rim },
          uLightCenter: { value: LIGHT_CENTER },
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

  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  /** Surface-space vector from the point being held to the design's centre. */
  const grabOffset = useRef<THREE.Vector2 | null>(null);

  /** Where the pointer meets the skin, as (angle around the limb, height). */
  const surfaceUnderPointer = useCallback(
    (clientX: number, clientY: number): THREE.Vector2 | null => {
      const mesh = meshRef.current;
      if (!mesh) return null;

      const rect = gl.domElement.getBoundingClientRect();
      ndc.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.current.setFromCamera(ndc.current, camera);

      /* The material is front-sided, so this is the near face of the limb. */
      const hit = raycaster.current.intersectObject(mesh, false)[0];
      if (!hit) return null;

      const local = mesh.worldToLocal(hit.point.clone());
      return new THREE.Vector2(Math.atan2(local.x, local.z), local.y);
    },
    [camera, gl]
  );

  useFrame((_, delta) => {
    if (spin.autoSwing && !spin.interacting.current) {
      spin.phase.current += delta * SWING_SPEED;
      /* Shed the dragged pose gradually, so the limb drifts back to the one the
         panel was framed around instead of staying where it was left. */
      spin.offset.current *= Math.exp(-delta * RETURN_RATE);
    }
    const group = groupRef.current;
    if (group) {
      group.rotation.y =
        spin.offset.current + SWING_CENTER + Math.sin(spin.phase.current) * SWING;
    }

    /* Drift the camera with the pointer: a few millimetres of travel is enough
       to part the limb from the background and give the panel some depth. */
    if (spin.autoSwing) {
      const hover = drag.hover.current;
      const follow = 1 - Math.exp(-delta * PARALLAX_EASE);
      camera.position.x += (hover.x * PARALLAX - camera.position.x) * follow;
      camera.position.y += (-hover.y * PARALLAX * 0.6 - camera.position.y) * follow;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }

    const pointer = drag.pointer.current;
    if (!pointer) {
      grabOffset.current = null;
      return;
    }
    /* Hit-test against the orientation just set above, not last frame's. */
    group?.updateMatrixWorld(true);
    const surface = surfaceUnderPointer(pointer.x, pointer.y);
    if (!surface || surface.y < FOREARM_BOTTOM_Y) return;

    const center = material.uniforms.uDesignCenter.value as THREE.Vector2;
    if (!grabOffset.current) {
      const offset = new THREE.Vector2(wrapAngle(center.x - surface.x), center.y - surface.y);
      /* Taking hold of the design carries it by the point held; taking hold of
         bare skin brings it under the cursor instead. */
      const onDesign =
        Math.abs(offset.x) <= DESIGN_SIZE.x / 2 && Math.abs(offset.y) <= DESIGN_SIZE.y / 2;
      grabOffset.current = onDesign ? offset : new THREE.Vector2(0, 0);
    }
    center.set(
      wrapAngle(surface.x + grabOffset.current.x),
      THREE.MathUtils.clamp(
        surface.y + grabOffset.current.y,
        DESIGN_HEIGHT_MIN,
        DESIGN_HEIGHT_MAX
      )
    );
  });

  /* Two groups so the sweep turns the limb about its own axis and the lean is
     applied to the result; as one Euler the lean would make the sweep wobble. */
  return (
    <group rotation-z={LIMB_TILT}>
      <group ref={groupRef}>
        <mesh ref={meshRef} geometry={geometry} material={material} />
      </group>
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

/** ⌘ on a Mac, Ctrl elsewhere: hold to move the design instead of the limb. */
function movesDesign(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

export const HeroPreview: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const phase = useRef(0);
  const offset = useRef(0);
  const interacting = useRef(false);
  const lastX = useRef(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hover = useRef(new THREE.Vector2());
  const [autoSwing, setAutoSwing] = useState(true);
  const [dragMode, setDragMode] = useState<'rotate' | 'design' | null>(null);
  const [modifierHeld, setModifierHeld] = useState(false);
  const spin: SpinState = { phase, offset, interacting, autoSwing };
  const drag: DesignDrag = { pointer, hover };
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

  /* So the cursor can advertise the design drag before the pointer goes down.
     Cleared on blur, since ⌘-tabbing away swallows the keyup. */
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setModifierHeld(movesDesign(e));
    const clear = () => setModifierHeld(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    interacting.current = true;
    if (movesDesign(e)) {
      /* Without this the modified drag is taken as a text selection. */
      e.preventDefault();
      pointer.current = { x: e.clientX, y: e.clientY };
      setDragMode('design');
      return;
    }
    lastX.current = e.clientX;
    setDragMode('rotate');
  };

  const trackHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    hover.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      ((e.clientY - rect.top) / rect.height) * 2 - 1
    );
  };
  const clearHover = () => hover.current.set(0, 0);

  /* Tracked on the window so a drag survives the pointer leaving the panel. The
     mode is fixed at the press, so releasing ⌘ mid-drag won't swap modes. */
  useEffect(() => {
    if (!dragMode) return;

    const onMove = (e: PointerEvent) => {
      if (dragMode === 'design') {
        pointer.current = { x: e.clientX, y: e.clientY };
        return;
      }
      offset.current += (e.clientX - lastX.current) * DRAG_SENSITIVITY;
      lastX.current = e.clientX;
    };
    const onEnd = () => {
      interacting.current = false;
      pointer.current = null;
      setDragMode(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    /* A context menu or a switch of window can swallow the release. */
    window.addEventListener('contextmenu', onEnd);
    window.addEventListener('blur', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('contextmenu', onEnd);
      window.removeEventListener('blur', onEnd);
    };
  }, [dragMode]);

  const showFallback = failed || !ready;
  const designMode = dragMode === 'design' || (modifierHeld && !dragMode);

  return (
    <div
      className={[
        'hero-preview',
        showFallback ? '' : 'hero-preview--live',
        !showFallback && designMode ? 'hero-preview--move' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={wrapperRef}
      onPointerDown={showFallback ? undefined : startDrag}
      onPointerMove={showFallback ? undefined : trackHover}
      onPointerLeave={showFallback ? undefined : clearHover}
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
            camera={{ position: [0, 0, CAMERA_DISTANCE], fov: CAMERA_FOV }}
            dpr={[1, 2]}
            frameloop={visible ? (autoSwing || dragMode ? 'always' : 'demand') : 'never'}
            gl={{ antialias: true, alpha: true }}
            style={{ opacity: ready ? 1 : 0 }}
          >
            <Suspense fallback={null}>
              <Forearm spin={spin} drag={drag} onReady={handleReady} />
            </Suspense>
          </Canvas>
        </PreviewBoundary>
      )}

      {!showFallback && (
        <>
          <span className="hero-preview-defocus" aria-hidden />
          <span className="hero-preview-divider" aria-hidden />
          <span className="hero-preview-label hero-preview-label--mesh">mesh</span>
          <span className="hero-preview-label hero-preview-label--render">render</span>
          <span className="hero-preview-hint">
            {designMode ? 'drag to move the design' : 'drag to rotate · ⌘ drag to move'}
          </span>
        </>
      )}
    </div>
  );
};

export default HeroPreview;
