import { rememberTattoo } from './storage/tattooLibrary';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FaUpload, FaUndo, FaRegImage } from 'react-icons/fa';
import PoseControls, { type PoseControlsProps } from './PoseControls';
import AppearanceControls, { type AppearanceControlsProps } from './AppearanceControls';
import StudioControls, { type StudioControlsProps } from './StudioControls';
import CharacterBuilderSections from './CharacterBuilderSections';
import LightingControls from './LightingControls';
import type { LightDefinition, LightingPresetKey } from './config/lightingPresets';
import { resolveRig } from './config/lightingPresets';
import type { BodyShape } from './render/bodyShape';
import type { BodyRegionId } from './render/bodyRegions';
import { REGISTRY } from './render/registry';
import { readTattooPng } from './utils/tattooUpload';
import { resolveTattooSource } from './render/tattooSource';
import AdjustmentControl from './AdjustmentControl';

interface TopMenuBarProps extends PoseControlsProps, AppearanceControlsProps, StudioControlsProps {
  disabled?: boolean;
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  bodyMeshId: string;
  onBodyMeshChange: (id: string) => void;
  skinToneId: string;
  lookId: string;
  onSkinChange: (id: string) => void;
  onLookChange: (id: string) => void;
  bodyShape: BodyShape;
  onBodyShapeChange: (shape: BodyShape) => void;
  isolateRegion: BodyRegionId | null;
  onIsolateRegionChange: (region: BodyRegionId | null) => void;
  onHighlightRegions: (regions: BodyRegionId[]) => void;
  setUploadedImage: (img: string | null) => void;
  uploadedImage: string | null;
  decalVisible: boolean;
  hasPlacement: boolean;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  onDecalRotationChange: (deg: number) => void;
  onDecalScaleChange: (scale: number) => void;
  onDecalColorChange: (color: string) => void;
  onDecalOpacityChange: (opacity: number) => void;
  onDecalVisibleChange: (visible: boolean) => void;
  onDecalReset: () => void;
  photoMode: boolean;
  setPhotoMode: (v: boolean) => void;
  cameraPreset: string;
  onCameraPresetChange: (preset: string) => void;
  CAMERA_PRESETS: Record<string, { name: string; position: [number, number, number]; target: [number, number, number]; fov: number }>;
  performanceMode: boolean;
  setPerformanceMode: (v: boolean) => void;
  onExport: () => void;
  lights: LightDefinition[];
  selectedLight: number | null;
  lightingPreset: LightingPresetKey;
  onLightingPresetChange: (preset: LightingPresetKey) => void;
  onSelectLight: (i: number) => void;
  onLightsChange: (lights: LightDefinition[]) => void;
}

const TATTOO_COLORS = [
  { name: 'Black', value: '#000000' },
  { name: 'Dark Blue', value: '#1a237e' },
  { name: 'Navy', value: '#0d47a1' },
  { name: 'Red', value: '#d32f2f' },
  { name: 'Burgundy', value: '#880e4f' },
  { name: 'Green', value: '#2e7d32' },
  { name: 'Olive', value: '#827717' },
  { name: 'Brown', value: '#5d4037' },
  { name: 'Purple', value: '#6a1b9a' },
  { name: 'Orange', value: '#e65100' },
  { name: 'Yellow', value: '#f57f17' },
  { name: 'Original colors', value: '#ffffff' },
];

const INSPECTOR_TABS = [
  { id: 'tattoo', label: 'Tattoo' },
  { id: 'figure', label: 'Figure' },
  { id: 'studio', label: 'Studio' },
] as const;
export type InspectorTab = typeof INSPECTOR_TABS[number]['id'];

export default function TopMenuBar({
  disabled = false,
  activeTab: controlledTab,
  onTabChange,
  bodyMeshId,
  onBodyMeshChange,
  skinToneId,
  lookId,
  onSkinChange,
  onLookChange,
  bodyShape,
  bodyAppearance,
  onAppearanceChange,
  studio,
  onStudioChange,
  background,
  onBackgroundChange,
  onBodyShapeChange,
  poseId,
  bodyPose,
  onPosePresetChange,
  onBodyPoseChange,
  onFramePose,
  isolateRegion,
  onIsolateRegionChange,
  onHighlightRegions,
  setUploadedImage,
  uploadedImage,
  decalVisible,
  hasPlacement,
  decalRotation,
  decalScale,
  decalColor,
  decalOpacity,
  onDecalRotationChange,
  onDecalScaleChange,
  onDecalColorChange,
  onDecalOpacityChange,
  onDecalVisibleChange,
  onDecalReset,
  lights,
  selectedLight,
  lightingPreset,
  onLightingPresetChange,
  onSelectLight,
  onLightsChange,
}: TopMenuBarProps) {
  const inspectorId = useId();
  const [localTab, setLocalTab] = useState<InspectorTab>('tattoo');
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = (tab: InspectorTab) => { setLocalTab(tab); onTabChange?.(tab); };
  const panels = useRef<Partial<Record<InspectorTab, HTMLDivElement>>>({});
  const tabButtons = useRef<Partial<Record<InspectorTab, HTMLButtonElement>>>({});
  const scrollPositions = useRef<Record<InspectorTab, number>>({ tattoo: 0, figure: 0, studio: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => () => { uploadRef.current?.abort(); uploadRef.current = null; }, []);

  useEffect(() => {
    const panel = panels.current[activeTab];
    if (panel) panel.scrollTop = scrollPositions.current[activeTab];
  }, [activeTab]);

  const selectTab = (next: InspectorTab) => {
    const current = panels.current[activeTab];
    if (current) scrollPositions.current[activeTab] = current.scrollTop;
    onHighlightRegions([]);
    setActiveTab(next);
  };
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: InspectorTab) => {
    const current = INSPECTOR_TABS.findIndex((item) => item.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? INSPECTOR_TABS.length - 1
      : event.key === 'ArrowRight' ? (current + 1) % INSPECTOR_TABS.length
      : event.key === 'ArrowLeft' ? (current + INSPECTOR_TABS.length - 1) % INSPECTOR_TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = INSPECTOR_TABS[next].id;
    selectTab(target);
    tabButtons.current[target]?.focus();
  };
  const panel = (tab: InspectorTab, children: ReactNode) => (
    <div key={tab} id={`${inspectorId}-${tab}-panel`} role="tabpanel"
      aria-labelledby={`${inspectorId}-${tab}-tab`} tabIndex={0}
      className="ep-sidebar-body ep-inspector-panel" hidden={activeTab !== tab}
      ref={(element) => { if (element) panels.current[tab] = element; else delete panels.current[tab]; }}
      onScroll={(event) => { if (activeTab === tab) scrollPositions.current[tab] = event.currentTarget.scrollTop; }}>
      {children}
    </div>
  );

  const chooseFile = () => {
    // Opening a newer picker cancels pending work even if that picker is cancelled.
    uploadRef.current?.abort();
    uploadRef.current = null;
    setUploading(false);
    fileInputRef.current?.click();
  };

  const useExampleTattoo = () => {
    uploadRef.current?.abort();
    uploadRef.current = null;
    setUploading(false);
    setUploadError(null);
    setUploadedImage(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadRef.current?.abort();
    const request = new AbortController();
    uploadRef.current = request;
    setUploading(true);
    setUploadError(null);
    try {
      const source = await readTattooPng(file, request.signal);
      if (uploadRef.current === request) {
        setUploadedImage(source);
        try { await rememberTattoo(source, file.name); }
        catch { throw new Error('Artwork loaded, but it could not be saved to your library.'); }
      }
    } catch (error) {
      if (uploadRef.current === request && !request.signal.aborted) {
        setUploadError(error instanceof Error ? error.message : 'The PNG could not be loaded. Please try again.');
      }
    } finally {
      if (uploadRef.current === request) { uploadRef.current = null; setUploading(false); }
    }
  };

  return (
    <aside className="editor-right-panel ep-sidebar ep-inspector" aria-label="Inspector" inert={disabled}>
      <header className="ep-header ep-inspector-header">
        <span className="ep-title">Inspector</span>
        <span className="ep-hint">Design your tattoo, figure and studio.</span>
        <div className="ep-inspector-tabs" role="tablist" aria-label="Inspector sections">
          {INSPECTOR_TABS.map((tab) => <button key={tab.id} type="button" role="tab"
            className="ep-inspector-tab" id={`${inspectorId}-${tab.id}-tab`}
            aria-controls={`${inspectorId}-${tab.id}-panel`} aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            ref={(element) => { if (element) tabButtons.current[tab.id] = element; else delete tabButtons.current[tab.id]; }}
            onClick={() => selectTab(tab.id)} onKeyDown={(event) => tabKeyDown(event, tab.id)}>
            {tab.label}
          </button>)}
        </div>
      </header>

      {panel('tattoo', <>
        <section className="ep-section ep-tattoo-artwork" aria-label="Tattoo artwork">
          <div className="ep-artwork-heading">
            <p className="ep-section-label">Artwork</p>
            <span className="ep-hint">{uploadedImage === null ? 'Example tattoo' : 'Your tattoo'}</span>
          </div>
          <div className="ep-preview">
            <img src={resolveTattooSource(uploadedImage)} alt={uploadedImage === null ? 'Example tattoo preview' : 'Your tattoo preview'} />
          </div>
          <div className="ep-stack ep-tattoo-actions">
            <button type="button" className="ep-btn ep-btn--block" onClick={chooseFile}>
              <FaUpload aria-hidden /> {uploading ? 'Reading tattoo…' : 'Replace image'}
            </button>
            <button type="button" className="ep-btn ep-btn--block ep-btn--ghost" onClick={useExampleTattoo}
              aria-pressed={uploadedImage === null}>
              <FaRegImage aria-hidden /> Use example tattoo
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/png" aria-label="Choose tattoo PNG" hidden onChange={handleFileChange} />
          <p className="ep-hint">PNG, up to 20 MB. Transparent backgrounds work best.</p>
          {uploading && <p className="ep-hint" role="status">Checking the new artwork. Your current tattoo stays in place.</p>}
          {uploadError && <p className="ep-hint ep-upload-error" role="alert">{uploadError}</p>}
          <p className="ep-hint ep-placement-hint" role="status">{!hasPlacement
            ? `Click the skin to place ${uploadedImage === null ? 'the example tattoo' : 'your tattoo'}.`
            : decalVisible ? 'Click another spot on the skin to move the tattoo. Its size stays the same.'
              : 'Tattoo hidden for a before view. Show tattoo to see your design again.'}</p>
          {hasPlacement && <button type="button" className="ep-btn ep-btn--block"
            aria-pressed={!decalVisible} onClick={() => onDecalVisibleChange(!decalVisible)}>
            {decalVisible ? 'Show before' : 'Show tattoo'}
          </button>}
        </section>

        <section className="ep-section" aria-label="Tattoo adjustments">
          <p className="ep-section-label">Adjust tattoo</p>
          <AdjustmentControl label="Size" ariaLabel="Tattoo size" value={decalScale * 100}
            min={10} max={300} step={1} unit="%" resetValue={100}
            onChange={(value) => onDecalScaleChange(value / 100)} />
          <AdjustmentControl label="Rotation" ariaLabel="Tattoo rotation" value={decalRotation}
            min={-180} max={180} step={1} unit="°" resetValue={0} onChange={onDecalRotationChange} />
          <AdjustmentControl label="Opacity" ariaLabel="Tattoo opacity" value={decalOpacity * 100}
            min={0} max={100} step={1} unit="%" resetValue={100}
            onChange={(value) => onDecalOpacityChange(value / 100)} />
          <div className="ep-field">
            <div className="ep-field-row">
              <span className="ep-field-label">Tint</span>
              <button type="button" className="ep-reset-control" aria-label="Reset tattoo tint"
                title="Reset tattoo tint" disabled={decalColor.toLowerCase() === '#ffffff'}
                onClick={() => onDecalColorChange('#ffffff')}><FaUndo aria-hidden /></button>
            </div>
            <div className="ep-field-row">
              <input type="color" className="ep-color-input" value={decalColor}
                onChange={(event) => onDecalColorChange(event.target.value)} aria-label="Tattoo tint" />
              <select className="ep-select" value={decalColor} onChange={(event) => onDecalColorChange(event.target.value)}
                aria-label="Tattoo tint preset">
                {!TATTOO_COLORS.some((color) => color.value === decalColor) && <option value={decalColor}>Custom tint</option>}
                {TATTOO_COLORS.map((color) => <option key={color.value} value={color.value}>{color.name}</option>)}
              </select>
            </div>
            <p className="ep-hint">Tint changes existing colors. Black ink stays black.</p>
          </div>
          <button type="button" className="ep-btn ep-btn--block ep-btn--ghost" onClick={onDecalReset}
            disabled={decalScale === 1 && decalRotation === 0 && decalColor.toLowerCase() === '#ffffff' && decalOpacity === 1}>
            <FaUndo aria-hidden /> Reset tattoo adjustments
          </button>
        </section>
      </>)}

      {panel('figure', <>
        <section className="ep-section">
          <label className="ep-field-label" htmlFor={`${inspectorId}-body-model`}>Body model</label>
          <select id={`${inspectorId}-body-model`} className="ep-select" value={bodyMeshId}
            onChange={(event) => onBodyMeshChange(event.target.value)}>
            {REGISTRY.bodyMeshes.map((body) => <option key={body.id} value={body.id}>{body.label}</option>)}
          </select>
        </section>
        <CharacterBuilderSections skinToneId={skinToneId} lookId={lookId} onSkinChange={onSkinChange}
          onLookChange={onLookChange} bodyShape={bodyShape} onBodyShapeChange={onBodyShapeChange}
          isolateRegion={isolateRegion} onIsolateRegionChange={onIsolateRegionChange}
          onFrameFocus={onFramePose} onHighlightRegions={onHighlightRegions} />
        <PoseControls poseId={poseId} bodyPose={bodyPose} onPosePresetChange={onPosePresetChange}
          onBodyPoseChange={onBodyPoseChange} onFramePose={onFramePose} onHighlightRegions={onHighlightRegions} />
        <AppearanceControls bodyAppearance={bodyAppearance} onAppearanceChange={onAppearanceChange} isolateRegion={isolateRegion} />
      </>)}

      {panel('studio', <>
        <StudioControls studio={studio} onStudioChange={onStudioChange} isolateRegion={isolateRegion}
          background={background} onBackgroundChange={onBackgroundChange} />
        <section className="ep-section" aria-label="Studio lighting">
          <LightingControls lights={lights} selectedIndex={selectedLight} onSelectLight={onSelectLight}
            onChange={onLightsChange} onReset={() => onLightsChange(resolveRig(lightingPreset))}
            preset={lightingPreset} onPresetChange={onLightingPresetChange} showGuides={studio.showGuides}
            onShowGuidesChange={(showGuides) => onStudioChange({ ...studio, showGuides })} />
        </section>
      </>)}
    </aside>
  );
}
