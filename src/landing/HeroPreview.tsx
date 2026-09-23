import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { BokehPass, EffectComposer, OBJLoader, RenderPass, ShaderPass } from 'three-stdlib';
import * as THREE from 'three';
import { SplitFigure } from './PipelineFigures';
import { SURFACE_TATTOO_GLSL } from '../render/tattooLayer';
import type { SurfaceAnchor } from '../render/surfacePlacement';
import { createInitialHeroTattoo, heroAnchorFromHit } from './heroTattooPlacement';

/**
 * Live version of the hero pipeline figure: the real forearm mesh, split down
 * a vertical divider — wireframe geometry on one side, lit skin with the
 * design on the other. Dragging turns the limb; holding ⌘ drags the design
 * itself over the surface, a taste of the placement step in the editor.
 *
 * The forearm is the only body asset light enough for a landing page (156 KB);
 * three.js itself is already in the bundle for the editor, so this costs no
 * extra JS.
 */

const MESH_URL = '/models/forearm.obj';
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
 * A wide lens close in, rather than a long one further back: the limb is pitched
 * towards the camera below, and it is the perspective of a short lens that makes
 * the hand loom and the forearm fall away behind it.
 */
const CAMERA_FOV = 46;
const CAMERA_DISTANCE = 4.3;
/**
 * The camera sits slightly to the right and almost level with the wrist.
 * This keeps the reaching fingertips readable without hiding the forearm.
 * Radians round the limb's axis, and up from level.
 */
const CAMERA_AZIMUTH = 0.4;
const CAMERA_ELEVATION = 0.1;
/** Near and far planes kept tight round the limb, for a usable depth buffer. */
const CAMERA_NEAR = 1;
const CAMERA_FAR = 24;
/** Frame above the wrist, leaving space below for the reaching fingers. */
const LOOK_AT = new THREE.Vector3(0, 0.2, 0);
/**
 * Pitch of the limb about the wrist, towards the lens: the hand reaches out of
 * the frame at the viewer while the forearm recedes into the focus falloff.
 * Negative brings the hand end forward.
 */
const LIMB_PITCH = -0.85;
/**
 * Lean of the limb across the frame. Upright, it sat parallel to the divider —
 * two vertical lines down the middle of the panel — so it runs a little off
 * true and crosses the divider instead.
 */
const LIMB_TILT = -0.25;
/**
 * Depth of field. The aperture is in the bokeh shader's own units — a coefficient
 * on the depth difference from the focus plane — and the blur is capped so the
 * fingers nearest the lens soften rather than smear.
 */
const DOF_APERTURE = 0.011;
const DOF_MAX_BLUR = 0.014;
/** Amplitude of the grain laid over the final frame, and how far the lens
    spreads the colour channels at the corners. */
const GRAIN = 0.045;
const FRINGE = 0.03;
/** Place the screen-space divider through the forearm, with more skin visible. */
const SPLIT_POSITION = 0.575;
/** Longest side in model units, using the same physical scale convention as the editor. */
const DESIGN_EXTENT = 0.58;
/** Keep the open elbow cutoff beyond the normal placement area. */
const DESIGN_HEIGHT_MAX = 2.3;
/** Fade after the highest tattoo edge, ending before the lowest open elbow edge
 * (y = 2.927). Object-space height keeps the cutoff hidden at every rotation. */
const REAR_FADE_START = DESIGN_HEIGHT_MAX + DESIGN_EXTENT / 2;
const REAR_FADE_END = 2.9;
/** Spacing of the mesh half's UV grid: rings along the limb, seams around it. */
const RING_SPACING = 0.44;
const SEAM_SPACING = Math.PI / 6;
/**
 * A restrained idle sweep keeps the fingertips directed toward the viewer
 * and the tattoo surface exposed. Manual rotation still covers a full turn.
 */
const SWING = 0.16;
/** Phase advance per second, for a sweep of about eleven seconds. */
const SWING_SPEED = 0.55;
/**
 * Rest pose. The camera is round to the right, so the limb turns to meet it, and
 * a little further so the design carries onto the lit skin — the half worth
 * looking at — rather than sitting square on the divider or drifting round to
 * the wireframe.
 */
const SWING_CENTER = CAMERA_AZIMUTH + 0.16;
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

/** Bend only the hand toward the lens; the tattoo-bearing shaft stays unchanged.
 * Blend through the wrist so the gesture does not introduce a hard joint. */
function poseHeroHand(geo: THREE.BufferGeometry): void {
  const position = geo.attributes.position;
  const normal = geo.attributes.normal;
  const point = new THREE.Vector3();
  const n = new THREE.Vector3();
  const axis = new THREE.Vector3(1, 0, 0);
  const pivot = new THREE.Vector3(0, 0, -0.3);
  const bend = 0.65;
  const blendLength = 0.7;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (point.y >= 0) continue;
    const t = THREE.MathUtils.clamp(-point.y / blendLength, 0, 1);
    const angle = -bend * t * t * (3 - 2 * t);
    point.sub(pivot);
    if (normal) {
      n.fromBufferAttribute(normal, i);
      // Inverse-transpose of the blended bend, including its changing angle.
      const derivative = t < 1 ? bend * 6 * t * (1 - t) / blendLength : 0;
      const correction = derivative * (-point.z * n.y + point.y * n.z)
        / (1 - derivative * point.z);
      n.y -= correction;
      n.applyAxisAngle(axis, angle).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
    point.applyAxisAngle(axis, angle).add(pivot);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
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
          poseHeroHand(geo);
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
  attribute vec2 aTattooUv;
  attribute float aTattooMask;
  varying vec2 vTattooUv;
  varying float vTattooMask;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vTattooUv = aTattooUv;
    vTattooMask = aTattooMask;
    vObjPos = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  ${SURFACE_TATTOO_GLSL}
  varying vec2 vTattooUv;
  varying float vTattooMask;
  uniform float uSplit;
  uniform vec2 uRearFade;
  uniform sampler2D uDesign;
  uniform float uDesignExtent;
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

  /**
   * The render half shows the right of the limb, so the key is set just inside
   * it, high and a little to the right of the lens: brightest where the design
   * sits by the divider, then turning away to the far silhouette, where the rim
   * picks the arm back off the background. Any further round and the whole half
   * is lit evenly and the form goes flat; any further left and the lit area
   * narrows to a slit against the divider. Both directions are swung round the
   * limb with the camera (see CAMERA_AZIMUTH), so they keep that relation to
   * the lens.
   */
  const vec3 KEY_DIR = vec3(0.64, 0.52, 0.55);
  const vec3 BOUNCE_DIR = vec3(0.89, -0.34, -0.29);

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

    // Exactly the editor's surface chart, physical sizing and edge sampling.
    vec4 tattoo = sampleSurfaceTattoo(
      uDesign, vTattooUv, vTattooMask, uDesignExtent,
      1.0, 0.0, uInk, 1.0
    );
    float ink = tattoo.a;
    // Cylindrical coordinates are only the decorative wireframe grid now.
    float aroundLimb = atan(vObjPos.x, vObjPos.z);

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
       it, and the sheen added below still runs across the tattoo. Coverage and
       edge softness come from the same sampler as the editor. */
    skin *= mix(vec3(1.0), tattoo.rgb, ink);

    float sheen = pow(max(dot(N, normalize(keyDir + V)), 0.0), 26.0);
    skin += uSheen * sheen * smoothstep(0.0, 0.3, key) * 0.26;
    /* The background is nearly black too, so the shadow side needs an edge to
       lift the silhouette off it. Kept tight: spread wide, it washes most of the
       shadow side to a pale grey instead of reading as an edge light. */
    skin += uRim * pow(1.0 - facingCamera, 5.0) * 1.5;
    skin = film(skin);

    vec3 color = gl_FragCoord.x < uSplit ? meshColor : skin;
    // Premultiplied coverage lets the open elbow fade into the real page.
    // Quintic easing has no visible start/end band, even along the bright rim.
    float fade = clamp((vObjPos.y - uRearFade.x) / (uRearFade.y - uRearFade.x), 0.0, 1.0);
    fade = fade * fade * fade * (fade * (fade * 6.0 - 15.0) + 10.0);
    float alpha = 1.0 - fade;
    gl_FragColor = vec4(color * alpha, alpha);
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

/**
 * Where the camera rests, and the screen-right and screen-up directions there,
 * along which the pointer parallax moves it.
 */
const CAMERA_HOME = (() => {
  const position = new THREE.Vector3(
    Math.sin(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION),
    Math.sin(CAMERA_ELEVATION),
    Math.cos(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION)
  ).multiplyScalar(CAMERA_DISTANCE);
  const forward = LOOK_AT.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { position, right, up };
})();

const Forearm: React.FC<{
  spin: SpinState;
  drag: DesignDrag;
  /** Written each frame with the design's place in the world, for the focus. */
  focus: React.RefObject<THREE.Vector3>;
  onReady: () => void;
  onPlacementStatus: (message: string | null) => void;
}> = ({ spin, drag, focus, onReady, onPlacementStatus }) => {
  const sourceGeometry = useLoader(ForearmGeometryLoader, MESH_URL);
  const surface = useMemo(() => createInitialHeroTattoo(sourceGeometry), [sourceGeometry]);
  const geometry = surface.geometry;
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
          uRearFade: { value: new THREE.Vector2(REAR_FADE_START, REAR_FADE_END) },
          uDesign: { value: design },
          uDesignExtent: { value: DESIGN_EXTENT },
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

  /* Aimed once here, since the per-frame aim below is skipped under reduced
     motion, and the canvas only places the camera. */
  useEffect(() => {
    camera.lookAt(LOOK_AT);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, invalidate]);

  /* The surface owns its clone. Leave useLoader's cached source untouched. */
  useEffect(
    () => () => {
      material.dispose();
      design.dispose();
      surface.dispose();
    },
    [material, design, surface]
  );

  /* Match the divider position in the annotation layer to the drawing buffer.
     Explicitly request a frame, since the loop is on demand when idle. */
  useEffect(() => {
    material.uniforms.uSplit.value = size.width * viewport.dpr * SPLIT_POSITION;
    invalidate();
  }, [material, size.width, viewport.dpr, invalidate]);

  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const cameraTarget = useRef(new THREE.Vector3());
  /** Pick the real triangle and barycentric point, just as the editor does. */
  const surfaceUnderPointer = useCallback(
    (clientX: number, clientY: number): SurfaceAnchor | null => {
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
      if (local.y > REAR_FADE_START) return null;
      return heroAnchorFromHit(hit);
    },
    [camera, gl]
  );

  useFrame((_, delta) => {
    // At most one chart solve per new pointer position, never once per idle frame.
    const pending = drag.pointer.current;
    drag.pointer.current = null;
    if (spin.autoSwing && !spin.interacting.current && !pending) {
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
    if (spin.autoSwing && !spin.interacting.current && !pending) {
      const hover = drag.hover.current;
      const follow = 1 - Math.exp(-delta * PARALLAX_EASE);
      const target = cameraTarget.current
        .copy(CAMERA_HOME.position)
        .addScaledVector(CAMERA_HOME.right, hover.x * PARALLAX)
        .addScaledVector(CAMERA_HOME.up, -hover.y * PARALLAX * 0.6);
      camera.position.lerp(target, follow);
      camera.lookAt(LOOK_AT);
      camera.updateMatrixWorld();
    }

    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    if (pending) {
      const anchor = surfaceUnderPointer(pending.x, pending.y);
      if (anchor) {
        const placed = surface.place(anchor, mesh.matrixWorld);
        onPlacementStatus(!placed
          ? 'Too folded here — try a flatter spot'
          : surface.chart && surface.chart.maxSize < DESIGN_EXTENT
            ? 'Edges may clip here — try a broader area'
            : null);
      }
    }
    // Focus tracks the actual anchored skin point, including hand placements.
    focus.current.copy(surface.center).applyMatrix4(mesh.matrixWorld);
  });

  /* Nested groups so the sweep turns the limb about its own axis and the lean
     and pitch are applied to the result; as one Euler they would make the
     sweep wobble. */
  return (
    <group rotation-x={LIMB_PITCH}>
      <group rotation-z={LIMB_TILT}>
        <group ref={groupRef}>
          <mesh ref={meshRef} geometry={geometry} material={material} />
        </group>
      </group>
    </group>
  );
};

/**
 * The look of a lens on the final frame: a touch of colour fringing that grows
 * towards the corners, a gentle contrast curve, a vignette, and grain that
 * changes every frame. Runs after the depth of field, so the grain sits on top
 * of the blur as it would on film rather than being smeared by it.
 */
const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: GRAIN },
    uFringe: { value: FRINGE },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uFringe;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      float r2 = dot(fromCenter, fromCenter);

      /* Lateral chromatic aberration: nothing at the centre, growing with the
         square of the distance out, as it does in glass. */
      vec2 shift = fromCenter * r2 * uFringe;
      vec4 center = texture2D(tDiffuse, vUv);
      if (center.a < 0.0001) {
        gl_FragColor = vec4(0.0);
        return;
      }
      vec4 redSample = texture2D(tDiffuse, vUv - shift);
      vec4 blueSample = texture2D(tDiffuse, vUv + shift);
      // Blur averages premultiplied coverage. Grade straight colour, then
      // premultiply again for the canvas, keeping its empty pixels transparent.
      vec3 color = vec3(
        redSample.r / max(redSample.a, 0.0001),
        center.g / center.a,
        blueSample.b / max(blueSample.a, 0.0001)
      );

      // A soft S-curve: deeper shadows, highlights held back from clipping.
      color = mix(color, color * color * (3.0 - 2.0 * color), 0.35);

      float vignette = 1.0 - smoothstep(0.25, 0.95, sqrt(r2) * 1.4);
      color *= mix(0.55, 1.0, vignette);

      /* Grain, heavier in the shadows where film shows it most; the time is
         folded into the hash so it crawls rather than sitting still. */
      float grain = hash(floor(gl_FragCoord.xy) + fract(uTime * 0.37) * 331.0) - 0.5;
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color += grain * uGrain * mix(1.0, 0.4, smoothstep(0.1, 0.7, luma));

      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * center.a, center.a);
    }
  `,
};

/**
 * Takes over rendering from the canvas with a depth of field pass and the lens
 * grade above. The focus plane is set each frame at the design, so the design
 * is what stays sharp while the hand reaching out of the frame and the forearm
 * receding behind it soften off.
 */
const Cinematic: React.FC<{ focus: React.RefObject<THREE.Vector3> }> = ({ focus }) => {
  const { gl, scene, camera, size, viewport } = useThree();

  const passes = useMemo(() => {
    const composer = new EffectComposer(gl);
    const bokeh = new BokehPass(scene, camera as THREE.PerspectiveCamera, {
      focus: CAMERA_DISTANCE,
      aperture: DOF_APERTURE,
      maxblur: DOF_MAX_BLUR,
    });
    /* The bokeh pass is written to be the last in a chain and leaves its output
       in the write buffer; swapping lets the grade read it. */
    bokeh.needsSwap = true;
    // The bundled BokehShader averages RGBA, then forces alpha to 1. Keep its
    // averaged coverage so softened edges reveal the page without a dark halo.
    bokeh.materialBokeh.fragmentShader = bokeh.materialBokeh.fragmentShader.replace(
      /gl_FragColor\.a\s*=\s*1\.0\s*;/,
      ''
    );
    const grade = new ShaderPass(gradeShader);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bokeh);
    composer.addPass(grade);
    return { composer, bokeh, grade };
  }, [gl, scene, camera]);

  useEffect(() => {
    const background = scene.background;
    const clearColor = gl.getClearColor(new THREE.Color());
    const clearAlpha = gl.getClearAlpha();
    scene.background = null;
    gl.setClearColor(0x000000, 0);
    return () => {
      scene.background = background;
      gl.setClearColor(clearColor, clearAlpha);
    };
  }, [gl, scene]);

  useEffect(() => {
    passes.composer.setPixelRatio(viewport.dpr);
    passes.composer.setSize(size.width, size.height);
    passes.bokeh.uniforms.aspect.value = size.width / size.height;
  }, [passes, size.width, size.height, viewport.dpr]);

  useEffect(
    () => () => {
      passes.grade.dispose();
      passes.bokeh.renderTargetDepth.dispose();
      passes.bokeh.materialDepth.dispose();
      passes.bokeh.materialBokeh.dispose();
      passes.composer.dispose();
    },
    [passes]
  );

  /* Priority 1 replaces the canvas's own render, on demand or otherwise. */
  useFrame(({ clock }) => {
    passes.bokeh.uniforms.focus.value = camera.position.distanceTo(focus.current);
    passes.grade.uniforms.uTime.value = clock.elapsedTime;
    passes.composer.render();
  }, 1);

  return null;
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
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hover = useRef(new THREE.Vector2());
  const focus = useRef(LOOK_AT.clone());
  const [autoSwing, setAutoSwing] = useState(true);
  const [dragMode, setDragMode] = useState<'rotate' | 'design' | null>(null);
  const [modifierHeld, setModifierHeld] = useState(false);
  const [placementStatus, setPlacementStatus] = useState<string | null>(null);
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
    if (e.button !== 0 || !e.isPrimary) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
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
      const start = press.current;
      if (!start || e.pointerId !== start.id) return;
      start.moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5;
      if (dragMode === 'design') {
        pointer.current = { x: e.clientX, y: e.clientY };
        return;
      }
      offset.current += (e.clientX - lastX.current) * DRAG_SENSITIVITY;
      lastX.current = e.clientX;
    };
    const onEnd = (e: Event) => {
      const start = press.current;
      if (e instanceof PointerEvent && start && e.pointerId !== start.id) return;
      if (e.type === 'pointerup' && e instanceof PointerEvent && start &&
          (dragMode === 'design' || !start.moved)) {
        // Keep the last position queued until the render loop applies it.
        pointer.current = { x: e.clientX, y: e.clientY };
      } else {
        pointer.current = null;
      }
      press.current = null;
      interacting.current = false;
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
      style={{ '--hero-split': `${SPLIT_POSITION * 100}%` } as React.CSSProperties}
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
            camera={{
              position: CAMERA_HOME.position.toArray(),
              fov: CAMERA_FOV,
              near: CAMERA_NEAR,
              far: CAMERA_FAR,
            }}
            dpr={[1, 2]}
            frameloop={visible ? (autoSwing || dragMode ? 'always' : 'demand') : 'never'}
            gl={{ antialias: true, alpha: true }}
            style={{ opacity: ready ? 1 : 0 }}
          >
            <Suspense fallback={null}>
              <Forearm spin={spin} drag={drag} focus={focus} onReady={handleReady} onPlacementStatus={setPlacementStatus} />
              <Cinematic focus={focus} />
            </Suspense>
          </Canvas>
        </PreviewBoundary>
      )}

      {!showFallback && (
        <>
          <span className="hero-preview-divider" aria-hidden />
          <span className="hero-preview-label hero-preview-label--mesh">mesh</span>
          <span className="hero-preview-label hero-preview-label--render">render</span>
          <span className="hero-preview-hint">
            {placementStatus || (designMode ? 'drag to move the design' : (
              <>
                <span className="hero-preview-hint-desktop">click to place · drag to rotate · ⌘/Ctrl move</span>
                <span className="hero-preview-hint-touch">tap to place · swipe sideways to rotate</span>
              </>
            ))}
          </span>
        </>
      )}
    </div>
  );
};

export default HeroPreview;
