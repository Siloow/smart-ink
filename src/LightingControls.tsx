import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import AdjustmentControl from './AdjustmentControl';
import { LIGHTING_PRESETS, resolveRig, type LightDefinition, type LightingPresetKey } from './config/lightingPresets';
import { LIGHT_COLOR_CHOICES, STUDIO_LIGHT_LIMITS, lightLabel, lightPlacement, lightSoftness, moveLightOnMap, resetSelectedLight, selectedLightIndex, updateLightControl, type LightControl } from './render/studioLighting';
import './studio-light-controls.css';

interface LightingControlsProps {
  lights: LightDefinition[];
  selectedIndex: number | null;
  onSelectLight: (i: number) => void;
  onChange: (lights: LightDefinition[]) => void;
  onReset: () => void;
  preset: LightingPresetKey;
  onPresetChange: (preset: LightingPresetKey) => void;
  showGuides?: boolean;
  onShowGuidesChange?: (show: boolean) => void;
}

function compass(angle: number): string {
  const sector = Math.round((((angle % 360) + 360) % 360) / 45) % 8;
  return ['Front', 'Front right', 'Right', 'Back right', 'Back', 'Back left', 'Left', 'Front left'][sector];
}

export default function LightingControls({ lights, selectedIndex, onSelectLight, onChange, onReset, preset, onPresetChange, showGuides = true, onShowGuidesChange }: LightingControlsProps) {
  const id = useId(), mapRef = useRef<SVGSVGElement>(null), dragRef = useRef<{ index: number; pointer: number } | null>(null);
  const selected = selectedLightIndex(lights, selectedIndex), light = selected == null ? null : lights[selected];
  const placement = light ? lightPlacement(light) : null;
  const defaults = resolveRig(preset);
  const lightSignature = (entry: LightDefinition) => JSON.stringify({
    type: entry.type, position: entry.position.map(value => Number(value.toFixed(5))),
    target: (entry.target ?? [0, 0, 0]).map(value => Number(value.toFixed(5))),
    intensity: Number(entry.intensity.toFixed(5)), color: entry.color.toLowerCase(),
    enabled: entry.enabled !== false, castShadow: Boolean(entry.castShadow),
    softness: Number(lightSoftness(entry).toFixed(5)), area: entry.blenderAreaSize,
  });
  const custom = lights.length !== defaults.length || lights.some((entry, index) => !defaults[index] || lightSignature(entry) !== lightSignature(defaults[index]));
  const resetLight = selected == null ? null : resetSelectedLight(lights, selected, preset)[selected];

  const update = (index: number, value: LightDefinition) => onChange(lights.map((entry, i) => i === index ? value : entry));
  const control = (key: LightControl, value: number) => { if (selected != null && light) update(selected, updateLightControl(light, key, value)); };
  const drag = (event: PointerEvent<SVGSVGElement>) => {
    const active = dragRef.current, box = mapRef.current?.getBoundingClientRect();
    if (!active || event.pointerId !== active.pointer || !box || box.width <= 0 || box.height <= 0 || !lights[active.index]) return;
    const x = ((event.clientX - box.left) / box.width * 280 - 140) / 88 * 18;
    const z = ((event.clientY - box.top) / box.height * 250 - 125) / 88 * 18;
    update(active.index, moveLightOnMap(lights[active.index], x, z));
  };
  const stopDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointer !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const mapKey = (event: KeyboardEvent<SVGGElement>, index: number) => {
    const current = lightPlacement(lights[index]);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectLight(index); return; }
    const step = event.shiftKey ? 1 : 5;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); onSelectLight(index);
      const angle = current.azimuth + (event.key === 'ArrowRight' ? step : -step);
      update(index, updateLightControl(lights[index], 'azimuth', ((angle + 540) % 360) - 180));
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); onSelectLight(index); update(index, updateLightControl(lights[index], 'distance', current.distance + (event.key === 'ArrowUp' ? -.5 : .5)));
    }
  };
  const slider = (key: LightControl, label: string, value: number, display: string, step = .1) => {
    const initial = resetLight ? key === 'brightness' ? resetLight.intensity * 100 : key === 'softness' ? lightSoftness(resetLight) : lightPlacement(resetLight)[key] : 0;
    const percent = key === 'softness';
    return <AdjustmentControl id={`${id}-${key}`} label={label} value={percent ? value * 100 : value}
      min={STUDIO_LIGHT_LIMITS[key][0] * (percent ? 100 : 1)} max={STUDIO_LIGHT_LIMITS[key][1] * (percent ? 100 : 1)}
      step={step * (percent ? 100 : 1)} unit={key === 'brightness' || percent ? '%' : key === 'azimuth' ? '°' : ''}
      resetValue={initial * (percent ? 100 : 1)} onChange={next => control(key, next / (percent ? 100 : 1))}
      hint={key === 'brightness' ? undefined : display} />;
  };
  return <div className="studio-light-controls">
    <div className="sl-heading"><div><h3>Lighting</h3></div><button type="button" className="sl-text-button" onClick={onReset}>Reset setup</button></div>
    <label className="sl-preset" htmlFor={`${id}-preset`}><span>Lighting preset{custom && <strong className="sl-custom-status">Custom</strong>}</span><select className="ep-select" id={`${id}-preset`} value={custom ? 'custom' : preset} onChange={(event) => onPresetChange(event.currentTarget.value as LightingPresetKey)}>{custom && <option value="custom" disabled>Custom · {LIGHTING_PRESETS[preset].name}</option>}{Object.entries(LIGHTING_PRESETS).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
    {!lights.length ? <p className="sl-hint">Choose a look to add your studio lights.</p> : <>
      <div className="sl-light-list" aria-label="Studio lights">{lights.map((entry, index) => <button key={index} type="button" className={`sl-light-chip ${index === selected ? 'is-selected' : ''} ${entry.enabled === false ? 'is-off' : ''}`} aria-pressed={index === selected} onClick={() => onSelectLight(index)}><span className="sl-light-dot" style={{ backgroundColor: entry.color }} />{lightLabel(lights, index)}{entry.enabled === false && <small>Off</small>}</button>)}</div>
      <div className="sl-map-wrap">
        <svg ref={mapRef} className="sl-map" viewBox="0 0 280 250" aria-labelledby={`${id}-map-title`} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
          <title id={`${id}-map-title`}>Studio from above. Drag a light, or use arrow keys to move it.</title>
          <circle cx="140" cy="125" r="88" className="sl-map-ring" /><circle cx="140" cy="125" r="49" className="sl-map-ring sl-map-ring-inner" />
          <path d="M140 31V219M46 125H234" className="sl-map-axis" />
          <text x="140" y="22" className="sl-map-caption">BACK</text><text x="140" y="237" className="sl-map-caption">FRONT</text>
          <ellipse cx="140" cy="125" rx="16" ry="9" className="sl-map-figure" /><circle cx="140" cy="123" r="6" className="sl-map-head" /><path d="m136 141 4 6 4-6" className="sl-map-front" />
          {lights.map((entry, index) => {
            if (entry.type === 'ambient') return null;
            const p = lightPlacement(entry), distance = Math.min(18, p.distance), angle = p.azimuth * Math.PI / 180;
            const x = 140 + Math.sin(angle) * distance / 18 * 88, y = 125 + Math.cos(angle) * distance / 18 * 88, name = lightLabel(lights, index);
            return <g key={index} role="button" tabIndex={0} aria-label={`${name}, ${entry.enabled === false ? 'off' : 'on'}, ${compass(p.azimuth)}. Arrow keys move this light.`} aria-pressed={selected === index} className={`sl-map-light ${selected === index ? 'is-selected' : ''} ${entry.enabled === false ? 'is-off' : ''}`} onFocus={() => onSelectLight(index)} onClick={() => onSelectLight(index)} onKeyDown={(event) => mapKey(event, index)} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); onSelectLight(index); dragRef.current = { index, pointer: event.pointerId }; mapRef.current?.setPointerCapture(event.pointerId); }}>
              <line x1={x} y1={y} x2="140" y2="125" className="sl-map-beam" />
              <circle cx={x} cy={y} r="16" className="sl-map-hit" /><circle cx={x} cy={y} r="10" fill={entry.color} className="sl-map-marker" />
              <text x={x} y={y + 4} className="sl-map-letter">{name.slice(0, 1).toUpperCase()}</text>
            </g>;
          })}
        </svg>
        <p className="sl-hint">Drag a light around the figure. Arrow keys work too.</p>
      </div>
      {light && placement && selected != null && <div className="sl-selected-controls">
        <div className="sl-selected-heading"><strong>{lightLabel(lights, selected)}</strong><label className="sl-toggle"><input type="checkbox" checked={light.enabled !== false} onChange={(event) => update(selected, { ...light, enabled: event.currentTarget.checked })} /><span>Light on</span></label></div>
        {slider('brightness', 'Brightness', light.intensity * 100, `${Math.round(light.intensity * 100)}%`, 1)}
        <fieldset className="sl-colors"><legend>Light color</legend><div>{LIGHT_COLOR_CHOICES.map(({ label, color }) => <button type="button" key={label} aria-label={`${label} light color`} aria-pressed={light.color.toLowerCase() === color} className={light.color.toLowerCase() === color ? 'is-selected' : ''} onClick={() => update(selected, { ...light, color })}><span style={{ background: color }} />{label}</button>)}<label className="sl-custom-color"><input type="color" aria-label="Custom light color" value={/^#[\da-f]{6}$/i.test(light.color) ? light.color : '#ffffff'} onChange={(event) => update(selected, { ...light, color: event.currentTarget.value })} /><span>Custom</span></label></div></fieldset>
        {light.type !== 'ambient' && <>
          {slider('softness', 'Softness', lightSoftness(light), lightSoftness(light) < .25 ? 'Crisp' : lightSoftness(light) > .7 ? 'Very soft' : 'Soft', .01)}
          <div className="sl-position-controls">
            {slider('azimuth', 'Around figure', placement.azimuth, compass(placement.azimuth), 1)}
            {slider('height', 'Light height', placement.height, placement.height > 4 ? 'High' : placement.height > 1 ? 'Raised' : placement.height > -.5 ? 'Level' : 'Low')}
            {slider('distance', 'Distance', placement.distance, placement.distance < 1 ? 'Overhead' : placement.distance < 5 ? 'Near' : placement.distance < 11 ? 'Medium' : 'Far')}
            {slider('aimHeight', 'Aim at', placement.aimHeight, placement.aimHeight > 1.3 ? 'Head' : placement.aimHeight > .4 ? 'Chest' : placement.aimHeight > -.5 ? 'Waist' : placement.aimHeight > -1.4 ? 'Legs' : 'Feet')}
          </div>
        </>}
        <button type="button" className="sl-reset-light" onClick={() => onChange(resetSelectedLight(lights, selected, preset))}>Reset {lightLabel(lights, selected).toLowerCase()}</button>
      </div>}
    </>}
    {onShowGuidesChange && <label className="sl-toggle sl-guides"><input type="checkbox" checked={showGuides} onChange={(event) => onShowGuidesChange(event.currentTarget.checked)} /><span>Show lights in the studio</span></label>}
  </div>;
}
