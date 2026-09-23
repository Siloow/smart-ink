import * as THREE from 'three';
export { fitRegionCamera as frameRegionCamera } from './focusCamera';

export const BACKGROUNDS = {
  white: { css: '#fff', stops: ['#fff'] },
  dark: { css: '#181818', stops: ['#181818'] },
  gray: { css: 'linear-gradient(135deg, #444 0%, #888 100%)', stops: ['#444', '#888'] },
  bluepurple: { css: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)', stops: ['#3a1c71', '#d76d77', '#ffaf7b'] },
  peach: { css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', stops: ['#ffecd2', '#fcb69f'] },
};
export type BackgroundId = keyof typeof BACKGROUNDS;

export const EXPORT_PRESETS = {
  instagram: { width: 1080, height: 1080, name: 'Instagram Square' },
  instagramStory: { width: 1080, height: 1920, name: 'Instagram Story' },
  instagramPortrait: { width: 1080, height: 1350, name: 'Instagram Portrait' },
  twitter: { width: 1200, height: 675, name: 'Twitter/X Post' },
  facebook: { width: 1200, height: 630, name: 'Facebook Post' },
  portfolio: { width: 1920, height: 1080, name: 'Portfolio HD' },
  print: { width: 3000, height: 2000, name: 'Print Quality' },
};
export type ExportPreset = keyof typeof EXPORT_PRESETS;

/** Both export paths use this format; a Blender preview keeps its aspect at 512px. */
export function exportDimensions(preset: ExportPreset, quality?: 'preview' | 'final') {
  const { width, height } = EXPORT_PRESETS[preset];
  const scale = quality === 'preview' ? Math.min(1, 512 / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function paintExportBackground(ctx: CanvasRenderingContext2D, width: number, height: number, background: BackgroundId) {
  const { stops } = BACKGROUNDS[background];
  if (stops.length === 1) ctx.fillStyle = stops[0];
  else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
}

/** The user's editing helpers must never become part of a downloaded picture. */
export function withoutEditorHelpers<T>(scene: THREE.Object3D, render: () => T): T {
  const hidden: Array<[THREE.Object3D, boolean]> = [];
  const highlights = new Map<THREE.IUniform, unknown>();
  scene.traverse((object) => {
    if (object.userData.editorHelper) { hidden.push([object, object.visible]); object.visible = false; }
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const uniforms = (material as THREE.ShaderMaterial | undefined)?.uniforms;
      for (const name of ['uHighlightRegion', 'uHighlightRegion2']) {
        const uniform = uniforms?.[name];
        if (uniform && !highlights.has(uniform)) { highlights.set(uniform, uniform.value); uniform.value = -1; }
      }
    }
  });
  try { return render(); }
  finally {
    for (const [object, visible] of hidden) object.visible = visible;
    for (const [uniform, value] of highlights) uniform.value = value;
  }
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the PNG. Please try again.')), 'image/png'));
}

export function blankInkLayer(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvasPng(canvas);
}
