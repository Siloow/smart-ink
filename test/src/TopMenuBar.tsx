import React, { useRef } from 'react';
import { FaUpload, FaCube, FaLightbulb, FaUndo, FaRegImage } from 'react-icons/fa';

interface TopMenuBarProps {
  setUploadedImage: (img: string | null) => void;
  uploadedImage: string | null;
  onModelSelect: (model: string) => void;
  currentModel: string;
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
  background: string;
  setBackground: (bg: string) => void;
  lightingPreset: string;
  setLightingPreset: (preset: string) => void;
  LIGHTING_PRESETS: Record<string, string>;
  cameraPreset: string;
  onCameraPresetChange: (preset: string) => void;
  CAMERA_PRESETS: Record<string, { name: string; position: [number, number, number]; target: [number, number, number]; fov: number }>;
  performanceMode: boolean;
  setPerformanceMode: (v: boolean) => void;
  onExport: () => void;
}

const sectionTitle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.78rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 12,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 10,
  flexWrap: 'wrap' as const,
};

const label: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '0.82rem',
  flexShrink: 0,
};

const selectFieldStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  fontSize: '0.8rem',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  fontFamily: 'var(--font)',
};

const models = [
  { name: 'Monk', value: 'Monk' },
  { name: 'FinalBaseMesh', value: 'FinalBaseMesh' },
];

const BG_LABELS: Record<string, string> = {
  white: 'White',
  dark: 'Dark',
  gray: 'Gray',
  bluepurple: 'Blue-Purple',
  peach: 'Peach',
};

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

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 18,
  padding: 8,
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default function TopMenuBar({
  setUploadedImage,
  uploadedImage,
  onModelSelect,
  currentModel,
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
  background,
  setBackground,
  lightingPreset,
  setLightingPreset,
  LIGHTING_PRESETS,
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
    <aside className="editor-right-panel">
      <div className="editor-right-panel-header">
        <span className="editor-right-panel-title">Inspector</span>
      </div>

      <div className="panel-section">
        <div style={sectionTitle}>Source</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <button
            type="button"
            className="editor-panel-icon-btn"
            style={iconBtn}
            title="Upload PNG decal"
            onClick={() => fileInputRef.current?.click()}
          >
            <FaUpload />
          </button>
          <select
            value={currentModel}
            onChange={(e) => onModelSelect(e.target.value)}
            style={{ ...selectFieldStyle, flex: 1 }}
            aria-label="3D model"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="editor-panel-icon-btn"
          style={{
            ...iconBtn,
            width: '100%',
            justifyContent: 'center',
            gap: 8,
            background: photoMode ? 'rgba(77, 124, 255, 0.2)' : 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            color: photoMode ? 'var(--accent-blue)' : 'var(--text-secondary)',
          }}
          onClick={() => setPhotoMode(!photoMode)}
        >
          <FaRegImage /> Photo mode
        </button>
        {decalVisible && (
          <button
            type="button"
            className="editor-panel-icon-btn"
            style={{
              ...iconBtn,
              width: '100%',
              marginTop: 8,
              justifyContent: 'center',
              background: decalVisible ? 'rgba(0, 208, 132, 0.15)' : 'rgba(255, 77, 166, 0.1)',
              color: decalVisible ? 'var(--accent-green)' : 'var(--accent-pink)',
              border: '1px solid var(--border-color)',
            }}
            onClick={() => onDecalVisibleChange(!decalVisible)}
          >
            Toggle before / after (A/B)
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/png" hidden onChange={handleFileChange} />
        {uploadedImage && (
          <div className="editor-panel-preview">
            <img src={uploadedImage} alt="Decal preview" />
          </div>
        )}
      </div>

      <div className="panel-section">
        <div style={sectionTitle}>Camera</div>
        <div style={row}>
          <span style={label}>Preset</span>
          <select
            value={cameraPreset}
            onChange={(e) => onCameraPresetChange(e.target.value)}
            style={selectFieldStyle}
          >
            {Object.keys(CAMERA_PRESETS).map((key) => (
              <option key={key} value={key}>
                {CAMERA_PRESETS[key].name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['front', 'profile', 'closeup'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="editor-panel-pill"
              onClick={() => onCameraPresetChange(k)}
            >
              {CAMERA_PRESETS[k].name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div style={sectionTitle}>
          <FaLightbulb style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          Lighting
        </div>
        <div style={row}>
          <span style={label}>Preset</span>
          <select
            value={lightingPreset}
            onChange={(e) => setLightingPreset(e.target.value)}
            style={selectFieldStyle}
          >
            {Object.keys(LIGHTING_PRESETS).map((key) => (
              <option key={key} value={key}>
                {LIGHTING_PRESETS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel-section">
        <div style={sectionTitle}>Background</div>
        <div style={row}>
          <span style={label}>Style</span>
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            style={selectFieldStyle}
          >
            {Object.keys(BG_LABELS).map((key) => (
              <option key={key} value={key}>
                {BG_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {decalVisible && (
        <div className="panel-section">
          <div style={sectionTitle}>
            <FaCube style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Decal
          </div>
          <div style={row}>
            <span style={label}>Rotation</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={decalRotation}
              onChange={(e) => onDecalRotationChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              value={decalRotation}
              onChange={(e) => onDecalRotationChange(Number(e.target.value))}
              className="editor-panel-num"
            />
          </div>
          <div style={row}>
            <span style={label}>Scale</span>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.01}
              value={decalScale}
              onChange={(e) => onDecalScaleChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              step={0.01}
              value={decalScale}
              onChange={(e) => onDecalScaleChange(Number(e.target.value))}
              className="editor-panel-num"
            />
          </div>
          <div style={row}>
            <span style={label}>Color</span>
            <input
              type="color"
              value={decalColor}
              onChange={(e) => onDecalColorChange(e.target.value)}
              style={{ width: 36, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
            <select
              value={decalColor}
              onChange={(e) => onDecalColorChange(e.target.value)}
              style={{ ...selectFieldStyle, maxWidth: 140 }}
            >
              {TATTOO_COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={row}>
            <span style={label}>Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={decalOpacity}
              onChange={(e) => onDecalOpacityChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <button type="button" className="editor-panel-reset" onClick={onDecalReset}>
            <FaUndo /> Reset decal
          </button>
        </div>
      )}

      <div className="panel-section">
        <div style={sectionTitle}>Export</div>
        <button type="button" className="editor-panel-export-btn" onClick={onExport}>
          Export image
        </button>
      </div>

      <div className="panel-section panel-section--last">
        <div style={sectionTitle}>Performance</div>
        <button
          type="button"
          className="editor-panel-perf"
          data-on={performanceMode ? 'true' : 'false'}
          onClick={() => setPerformanceMode(!performanceMode)}
        >
          {performanceMode ? 'Performance mode ON' : 'Performance mode OFF'}
        </button>
      </div>
    </aside>
  );
}
