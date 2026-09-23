import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import ModelWithUVTattoo, { type ModelWithUVTattooHandle } from './ModelWithUVTattoo';
import CinematicLights from './CinematicLights';
import StudioBackdrop from './StudioBackdrop';
import ErrorBoundary from './ErrorBoundary';
import { LIGHTING_PRESETS } from './config/lightingPresets';
import { DEFAULT_STUDIO } from './render/studioSettings';
import { fitRegionCamera } from './render/focusCamera';
import { SCENE_TEMPLATES, templatePreviewCache, type TemplatePreview } from './sceneTemplates';

const noPlacement = () => {};
const lighting = LIGHTING_PRESETS.studio;

function Snapshot({ template, onReady, onError }: {
  template: typeof SCENE_TEMPLATES[number];
  onReady: (preview: TemplatePreview) => void;
  onError: () => void;
}) {
  const model = useRef<ModelWithUVTattooHandle>(null);
  const frames = useRef(0);
  const finished = useRef(false);
  const fitted = useRef<TemplatePreview['camera'] | null>(null);
  useFrame(({ gl, scene, camera }) => {
    if (finished.current || !(camera instanceof PerspectiveCamera)) return;
    if (!fitted.current) {
      const framing = model.current?.getRegionFraming();
      if (!framing) return;
      fitted.current = fitRegionCamera(framing, [0.35, 0.08, 1], 45, camera.aspect);
      camera.position.fromArray(fitted.current.position);
      camera.lookAt(...fitted.current.target);
      camera.updateProjectionMatrix();
    }
    // Allow material, region-mask and backdrop effects to settle before encoding.
    gl.render(scene, camera);
    if (++frames.current < 6) return;
    finished.current = true;
    try {
      onReady({ image: gl.domElement.toDataURL('image/jpeg', 0.88), camera: fitted.current });
    } catch { onError(); }
  }, 1);
  return <>
    <CinematicLights preset="studio" />
    <StudioBackdrop studio={DEFAULT_STUDIO} isolateRegion={template.region} performanceMode={false} />
    <ModelWithUVTattoo ref={model} uploadedImage={null} skinToneId="tone_03" bodyMeshId="body_full"
      decalRotation={0} decalScale={1} decalColor="#ffffff" decalOpacity={1}
      setDecalVisible={noPlacement} visible={false} editingEnabled={false}
      lights={lighting.lights} intensityScale={lighting.threeIntensityScale} isolateRegion={template.region} />
  </>;
}

/** One temporary renderer generates all cards in sequence, then unmounts. */
export default function TemplatePreviewRenderer({ onPreview, onError }: {
  onPreview: (id: string, preview: TemplatePreview) => void;
  onError: () => void;
}) {
  const [index, setIndex] = useState(0);
  const template = SCENE_TEMPLATES[index];
  const ready = useCallback((preview: TemplatePreview) => {
    templatePreviewCache[template.id] = preview;
    onPreview(template.id, preview);
    setIndex(index + 1);
  }, [template, onPreview, index]);
  useEffect(() => {
    if (!template) return;
    const cached = templatePreviewCache[template.id];
    if (cached) { onPreview(template.id, cached); setIndex(index + 1); }
  }, [template, onPreview, index]);
  useEffect(() => {
    if (!template) return;
    const timeout = window.setTimeout(onError, 45000);
    return () => window.clearTimeout(timeout);
  }, [template, onError]);
  if (!template || templatePreviewCache[template.id]) return null;
  return <div className="template-snapshot-renderer" aria-hidden="true">
    <ErrorBoundary onError={onError} fallback={() => null}>
      <Canvas shadows dpr={1} camera={{ position: [6, 4, 6], fov: 45 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <Suspense fallback={null}>
          <Snapshot key={template.id} template={template} onReady={ready} onError={onError} />
        </Suspense>
      </Canvas>
    </ErrorBoundary>
  </div>;
}
