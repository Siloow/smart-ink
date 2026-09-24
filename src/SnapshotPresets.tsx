import { CINEMATIC_PRESETS, type CinematicPresetId } from './render/cinematicPresets';
export default function SnapshotPresets({ selected, onSelect }: { selected: CinematicPresetId | null; onSelect: (id: CinematicPresetId) => void }) {
  return <section className="snapshot-presets" aria-label="Cinematic presets">
    <div className="snapshot-presets-heading"><strong>Choose a look</strong><span>Camera + lighting</span></div>
    <div className="snapshot-preset-grid">{CINEMATIC_PRESETS.map(p => <button type="button" key={p.id} className="snapshot-preset" aria-pressed={selected === p.id} onClick={() => onSelect(p.id)}>
      <img src={`/renders/presets/${p.id}.jpg`} alt="" loading="lazy" />
      <span className="snapshot-preset-name">{p.name}</span><span className="snapshot-preset-description">{p.description}</span>
    </button>)}</div>
    <p className="snapshot-controls-hint">Start with a look, then fine-tune below. Ink detail deliberately crops closer.</p>
  </section>;
}
