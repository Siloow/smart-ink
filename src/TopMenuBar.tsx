import { useRef } from 'react';
import { FaUpload, FaUndo, FaRegImage } from 'react-icons/fa';
import CharacterBuilderSections from './CharacterBuilderSections';

interface TopMenuBarProps {
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  lookId: string;
  onBodyChange: (id: string) => void;
  onSkinChange: (id: string) => void;
  onPoseChange: (id: string) => void;
  onLookChange: (id: string) => void;
  setUploadedImage: (img: string | null) => void;
  uploadedImage: string | null;
  decalVisible: boolean;
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
  { name: 'White', value: '#ffffff' },
];

const CAMERA_SHORTCUTS = ['front', 'profile', 'closeup'] as const;

export default function TopMenuBar({
  bodyMeshId,
  skinToneId,
  poseId,
  lookId,
  onBodyChange,
  onSkinChange,
  onPoseChange,
  onLookChange,
  setUploadedImage,
  uploadedImage,
  decalVisible,
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
  photoMode,
  setPhotoMode,
  cameraPreset,
  onCameraPresetChange,
  CAMERA_PRESETS,
  performanceMode,
  setPerformanceMode,
  onExport,
}: TopMenuBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'image/png') {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (typeof event.target?.result === 'string') {
          setUploadedImage(event.target.result);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setUploadedImage(null);
    }
    e.target.value = '';
  };

  return (
    <aside className="editor-right-panel ep-sidebar">
      <div className="ep-sidebar-body">
        <header className="ep-header">
          <span className="ep-title">Inspector</span>
          <span className="ep-hint">Character, tattoo &amp; camera</span>
        </header>

        <CharacterBuilderSections
          bodyMeshId={bodyMeshId}
          skinToneId={skinToneId}
          poseId={poseId}
          lookId={lookId}
          onBodyChange={onBodyChange}
          onSkinChange={onSkinChange}
          onPoseChange={onPoseChange}
          onLookChange={onLookChange}
        />

        <section className="ep-section">
          <p className="ep-section-label">Tattoo</p>
          <div className="ep-stack">
            <button
              type="button"
              className="ep-btn ep-btn--block"
              title="Upload PNG decal"
              onClick={() => fileInputRef.current?.click()}
            >
              <FaUpload /> Upload tattoo
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--block"
              aria-pressed={photoMode}
              onClick={() => setPhotoMode(!photoMode)}
            >
              <FaRegImage /> Photo mode
            </button>
            {decalVisible && (
              <button
                type="button"
                className="ep-btn ep-btn--block"
                aria-pressed={decalVisible}
                onClick={() => onDecalVisibleChange(!decalVisible)}
              >
                Toggle before / after
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/png" hidden onChange={handleFileChange} />
          {uploadedImage && (
            <div className="ep-preview">
              <img src={uploadedImage} alt="Decal preview" />
            </div>
          )}
        </section>

        <section className="ep-section">
          <p className="ep-section-label">Camera</p>
          <div className="ep-field">
            <span className="ep-field-label">Preset</span>
            <select
              className="ep-select"
              value={cameraPreset}
              onChange={(e) => onCameraPresetChange(e.target.value)}
              aria-label="Camera preset"
            >
              {Object.keys(CAMERA_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {CAMERA_PRESETS[key].name}
                </option>
              ))}
            </select>
          </div>
          <div className="ep-pill-row">
            {CAMERA_SHORTCUTS.map((k) => (
              <button
                key={k}
                type="button"
                className="ep-pill"
                aria-pressed={cameraPreset === k}
                onClick={() => onCameraPresetChange(k)}
              >
                {CAMERA_PRESETS[k].name.split(' ')[0]}
              </button>
            ))}
          </div>
        </section>

        {decalVisible && (
          <section className="ep-section">
            <p className="ep-section-label">Decal</p>
            <div className="ep-field">
              <div className="ep-field-row">
                <span className="ep-field-label">Rotation</span>
                <input
                  type="number"
                  className="ep-num-input"
                  value={decalRotation}
                  onChange={(e) => onDecalRotationChange(Number(e.target.value))}
                  aria-label="Decal rotation"
                />
              </div>
              <input
                type="range"
                className="ep-range"
                min={-180}
                max={180}
                value={decalRotation}
                onChange={(e) => onDecalRotationChange(Number(e.target.value))}
                aria-label="Decal rotation slider"
              />
            </div>
            <div className="ep-field">
              <div className="ep-field-row">
                <span className="ep-field-label">Scale</span>
                <input
                  type="number"
                  className="ep-num-input"
                  step={0.01}
                  value={decalScale}
                  onChange={(e) => onDecalScaleChange(Number(e.target.value))}
                  aria-label="Decal scale"
                />
              </div>
              <input
                type="range"
                className="ep-range"
                min={0.1}
                max={3}
                step={0.01}
                value={decalScale}
                onChange={(e) => onDecalScaleChange(Number(e.target.value))}
                aria-label="Decal scale slider"
              />
            </div>
            <div className="ep-field">
              <span className="ep-field-label">Color</span>
              <div className="ep-field-row">
                <input
                  type="color"
                  className="ep-color-input"
                  value={decalColor}
                  onChange={(e) => onDecalColorChange(e.target.value)}
                  aria-label="Decal color"
                />
                <select
                  className="ep-select"
                  value={decalColor}
                  onChange={(e) => onDecalColorChange(e.target.value)}
                  aria-label="Decal color preset"
                >
                  {TATTOO_COLORS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ep-field">
              <span className="ep-field-label">Opacity</span>
              <input
                type="range"
                className="ep-range"
                min={0}
                max={1}
                step={0.01}
                value={decalOpacity}
                onChange={(e) => onDecalOpacityChange(Number(e.target.value))}
                aria-label="Decal opacity"
              />
            </div>
            <button type="button" className="ep-btn ep-btn--block ep-btn--ghost" onClick={onDecalReset}>
              <FaUndo /> Reset decal
            </button>
          </section>
        )}

        <section className="ep-section">
          <p className="ep-section-label">Export</p>
          <button type="button" className="ep-btn ep-btn--block ep-btn--success" onClick={onExport}>
            Export image
          </button>
        </section>

        <section className="ep-section">
          <p className="ep-section-label">Performance</p>
          <button
            type="button"
            className="ep-btn ep-btn--block"
            aria-pressed={performanceMode}
            onClick={() => setPerformanceMode(!performanceMode)}
          >
            {performanceMode ? 'Performance mode on' : 'Performance mode off'}
          </button>
        </section>
      </div>
    </aside>
  );
}
