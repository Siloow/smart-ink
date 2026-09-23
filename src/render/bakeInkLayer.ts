import * as THREE from 'three';
import { SURFACE_TATTOO_GLSL, TATTOO_LAYER_GLSL } from './tattooLayer';

const LEGACY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SURFACE_VERTEX = /* glsl */ `
  attribute vec2 aTattooUv;
  attribute float aTattooMask;
  varying vec2 vTattooUv;
  varying float vTattooMask;
  void main() {
    vTattooUv = aTattooUv;
    vTattooMask = aTattooMask;
    // GLTFLoader keeps glTF's downward V axis; Blender converts it back to
    // upward V during import. Bake into the UV coordinates Blender will use.
    vec2 atlasUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(atlasUv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const OUTPUT_COLOR = /* glsl */ `
  vec3 inkToSRGB(vec3 linearColor) {
    return mix(
      linearColor * 12.92,
      1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), linearColor)
    );
  }
`;

const LEGACY_FRAGMENT = /* glsl */ `
  ${TATTOO_LAYER_GLSL}
  ${OUTPUT_COLOR}
  uniform sampler2D tattooTexture;
  uniform vec2 tattooCenter;
  uniform float tattooScale;
  uniform float tattooRotation;
  varying vec2 vUv;
  void main() {
    vec4 ink = sampleTattooLayer(tattooTexture, vUv, tattooCenter, tattooScale, tattooRotation);
    gl_FragColor = vec4(inkToSRGB(ink.rgb), ink.a);
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  ${SURFACE_TATTOO_GLSL}
  ${OUTPUT_COLOR}
  uniform sampler2D tattooTexture;
  uniform float tattooSize;
  uniform float tattooAspect;
  uniform float tattooRotation;
  uniform vec3 tattooTint;
  uniform float tattooOpacity;
  varying vec2 vTattooUv;
  varying float vTattooMask;
  void main() {
    vec4 ink = sampleSurfaceTattoo(
      tattooTexture, vTattooUv, vTattooMask, tattooSize, tattooAspect,
      tattooRotation, tattooTint, tattooOpacity
    );
    gl_FragColor = vec4(inkToSRGB(ink.rgb), ink.a);
  }
`;

/**
 * Pad only the empty space outside UV islands. Expanding every transparent
 * pixel would thicken fine tattoo lines and fill intentional gaps in the art.
 */
function padIslandEdges(pixels: Uint8Array, coverage: Uint8Array, size: number): void {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pixels[(y * size + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return;

  for (let pass = 0; pass < 3; pass++) {
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(size - 1, maxX + 1);
    maxY = Math.min(size - 1, maxY + 1);
    const previous = pixels.slice();
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const target = (y * size + x) * 4;
        if (coverage[target] !== 0 || previous[target + 3] !== 0) continue;
        let source = -1;
        let sourceAlpha = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            const candidate = (ny * size + nx) * 4;
            if (previous[candidate + 3] > sourceAlpha) {
              source = candidate;
              sourceAlpha = previous[candidate + 3];
            }
          }
        }
        if (source >= 0) pixels.set(previous.subarray(source, source + 4), target);
      }
    }
  }
}

function loadTexture(src: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Snapshot preparation cancelled', 'AbortError')); return; }
    let pending: THREE.Texture | undefined;
    let outcome: 'pending' | 'loaded' | 'failed' = 'pending';
    const disposed = new Set<THREE.Texture>();
    const dispose = (texture?: THREE.Texture) => {
      if (texture && !disposed.has(texture)) { disposed.add(texture); texture.dispose(); }
    };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => {
      if (outcome !== 'pending') return;
      outcome = 'failed'; cleanup(); dispose(pending); reject(error);
    };
    const abort = () => fail(signal?.reason ?? new DOMException('Snapshot preparation cancelled', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('The design image took too long to load. Please try again.')),
      Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60_000, timeoutMs)) : 20_000);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      pending = new THREE.TextureLoader().load(src, (texture) => {
        // TextureLoader cannot abort its image request. Never retain a texture
        // that arrives after timeout/cancel, or start a renderer for that shot.
        if (outcome !== 'pending') { dispose(texture); return; }
        outcome = 'loaded'; cleanup(); texture.colorSpace = THREE.SRGBColorSpace; resolve(texture);
      }, undefined, fail);
      // Also handle a synchronous loader failure without retaining its texture.
      if ((outcome as string) === 'failed') dispose(pending);
    } catch (error) { fail(error); }
  });
}

export interface SurfaceBakeParams {
  /** Original body atlas, with continuous aTattooUv and aTattooMask attributes. */
  geometry: THREE.BufferGeometry;
  /** Longest side of the design, in body units. */
  size: number;
  /** Source image width / height. */
  aspect: number;
  color: string;
  opacity: number;
}

export interface BakeParams {
  tattooImage: string;
  surface?: SurfaceBakeParams;
  /** Legacy atlas placement, used only when surface is omitted. */
  center?: [number, number];
  scaleUV?: number;
  rotationRad?: number;
  /** Output width and height in pixels. */
  size?: number;
  /** Abort preparation when Snapshot mode closes or the user cancels. */
  signal?: AbortSignal;
  /** Bounded source-image timeout; defaults to twenty seconds. */
  textureTimeoutMs?: number;
}

/** Returns a straight-alpha sRGB PNG of the body atlas's tattoo layer. */
export async function bakeInkLayer(params: BakeParams): Promise<Blob> {
  params.signal?.throwIfAborted();
  const size = params.size ?? 2048;
  if (!Number.isInteger(size) || size < 1 || size > 8192) {
    throw new Error('Tattoo export resolution must be between 1 and 8192 pixels.');
  }
  const surface = params.surface;
  if (surface) {
    const count = surface.geometry.getAttribute('position')?.count;
    for (const attribute of ['uv', 'aTattooUv', 'aTattooMask']) {
      if (!count || surface.geometry.getAttribute(attribute)?.count !== count) {
        throw new Error(`Tattoo export is missing valid ${attribute} coordinates.`);
      }
    }
    if (!Number.isFinite(surface.size) || surface.size <= 0 ||
        !Number.isFinite(surface.aspect) || surface.aspect <= 0) {
      throw new Error('Tattoo export needs a positive design size and aspect ratio.');
    }
  } else if (!params.center || !params.scaleUV || params.scaleUV <= 0) {
    throw new Error('Place a tattoo before exporting its ink layer.');
  }

  let texture: THREE.Texture | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let target: THREE.WebGLRenderTarget | undefined;
  let material: THREE.ShaderMaterial | undefined;
  let coverageMaterial: THREE.ShaderMaterial | undefined;
  let ownedGeometry: THREE.BufferGeometry | undefined;

  try {
    // Snapshot before the asynchronous image load: dragging in the editor can
    // replace the live surface coordinates while an export is in progress.
    if (surface) ownedGeometry = surface.geometry.clone();
    texture = await loadTexture(params.tattooImage, params.signal, params.textureTimeoutMs);
    params.signal?.throwIfAborted();
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.debug.onShaderError = () => {
      throw new Error('The graphics driver could not render the tattoo export. Reload the preview and try again.');
    };
    renderer.setSize(size, size, false);
    target = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      // Explicit conversion in the shader makes PNG encoding independent of
      // renderer output settings and render-target sRGB hardware support.
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });

    const uniforms: Record<string, THREE.IUniform> = {
      tattooTexture: { value: texture },
      tattooRotation: { value: params.rotationRad ?? 0 },
    };
    if (surface) {
      Object.assign(uniforms, {
        tattooSize: { value: surface.size },
        tattooAspect: { value: surface.aspect },
        tattooTint: { value: new THREE.Color(surface.color) },
        tattooOpacity: { value: surface.opacity },
      });
    } else {
      Object.assign(uniforms, {
        tattooCenter: { value: new THREE.Vector2(...params.center!) },
        tattooScale: { value: params.scaleUV },
      });
      ownedGeometry = new THREE.PlaneGeometry(2, 2);
    }

    material = new THREE.ShaderMaterial({
      vertexShader: surface ? SURFACE_VERTEX : LEGACY_VERTEX,
      fragmentShader: surface ? SURFACE_FRAGMENT : LEGACY_FRAGMENT,
      uniforms,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      // Blending on transparent black would premultiply RGB. PNG/Blender
      // expect straight alpha, so write all four shader channels unchanged.
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(ownedGeometry!, material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);

    if (surface) {
      coverageMaterial = new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERTEX,
        fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      mesh.material = coverageMaterial;
      renderer.clear();
      renderer.render(scene, camera);
      const coverage = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, coverage);
      padIslandEdges(pixels, coverage, size);
    }
    renderer.setRenderTarget(null);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the tattoo export image.');
    const image = context.createImageData(size, size);
    const stride = size * 4;
    for (let y = 0; y < size; y++) {
      const source = (size - 1 - y) * stride;
      image.data.set(pixels.subarray(source, source + stride), y * stride);
    }
    context.putImageData(image, 0, 0);
    params.signal?.throwIfAborted();
    return await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const cleanup = () => params.signal?.removeEventListener('abort', abort);
      const abort = () => {
        if (settled) return;
        settled = true; cleanup();
        reject(params.signal?.reason ?? new DOMException('Snapshot preparation cancelled', 'AbortError'));
      };
      params.signal?.addEventListener('abort', abort, { once: true });
      if (params.signal?.aborted) { abort(); return; }
      try {
        canvas.toBlob(
          (blob) => {
            if (settled) return;
            settled = true; cleanup();
            if (blob) resolve(blob); else reject(new Error('Unable to encode the tattoo PNG.'));
          },
          'image/png',
        );
      } catch (error) { settled = true; cleanup(); reject(error); }
    });
  } finally {
    material?.dispose();
    coverageMaterial?.dispose();
    ownedGeometry?.dispose();
    target?.dispose();
    texture?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
