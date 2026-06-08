import * as THREE from 'three';
import { TATTOO_LAYER_GLSL } from './tattooLayer';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FRAG = /* glsl */ `
  ${TATTOO_LAYER_GLSL}
  uniform sampler2D tattooTexture;
  uniform vec2 tattooCenter;
  uniform float tattooScale;
  uniform float tattooRotation;
  varying vec2 vUv;
  void main() {
    gl_FragColor = sampleTattooLayer(tattooTexture, vUv, tattooCenter, tattooScale, tattooRotation);
  }
`;

function loadTexture(src: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      src,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}

export interface BakeParams {
  tattooImage: string;
  center: [number, number];
  scaleUV: number;
  rotationRad: number;
  size?: number;
}

/** Returns a PNG Blob of the UV-space ink layer. */
export async function bakeInkLayer(params: BakeParams): Promise<Blob> {
  const size = params.size ?? 2048;
  const tex = await loadTexture(params.tattooImage);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(size, size, false);

  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
  });

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    uniforms: {
      tattooTexture: { value: tex },
      tattooCenter: { value: new THREE.Vector2(params.center[0], params.center[1]) },
      tattooScale: { value: params.scaleUV },
      tattooRotation: { value: params.rotationRad },
    },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);

  const buf = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(null);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const stride = size * 4;
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * stride;
    img.data.set(buf.subarray(src, src + stride), y * stride);
  }
  ctx.putImageData(img, 0, 0);

  mat.dispose();
  quad.geometry.dispose();
  rt.dispose();
  tex.dispose();
  renderer.dispose();

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
}
