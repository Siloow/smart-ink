import TattooLibrary from './TattooLibrary';
import { FaUser, FaRegImage, FaLightbulb, FaEye, FaEyeSlash, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import type { InspectorTab } from './TopMenuBar';

interface EditorLeftPanelProps {
  disabled?: boolean;
  currentImage: string | null;
  onChooseArtwork: (source: string) => void;
  bodyLabel: string;
  studioLabel: string;
  activeTab: InspectorTab;
  onSelect: (tab: InspectorTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tattooVisible: boolean;
  onToggleTattoo: () => void;
}

export default function EditorLeftPanel({ disabled = false, bodyLabel, studioLabel, activeTab, onSelect,
  collapsed, onToggleCollapsed, tattooVisible, onToggleTattoo, currentImage, onChooseArtwork }: EditorLeftPanelProps) {
  const items = [
    { id: 'figure' as const, label: 'Figure', detail: bodyLabel, Icon: FaUser },
    { id: 'tattoo' as const, label: 'Tattoos', detail: tattooVisible ? 'Visible on figure' : 'Hidden', Icon: FaRegImage },
    { id: 'studio' as const, label: 'Studio', detail: studioLabel, Icon: FaLightbulb },
  ];
  return (
    <aside className={`editor-left-panel ep-sidebar scene-navigation asset-sidebar${collapsed ? ' scene-navigation--collapsed' : ''}`} inert={disabled} aria-label="Tattoo library and scene controls">
      <div className="scene-navigation-heading">
        {!collapsed && <span>Tattoo library</span>}
        <button type="button" className="scene-icon-button" onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand scene sidebar' : 'Collapse scene sidebar'} aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <FaChevronRight aria-hidden /> : <FaChevronLeft aria-hidden />}
        </button>
      </div>
      <nav className="asset-scene-shortcuts" aria-label="Scene sections">
        {items.map(({ id, label, detail, Icon }) => <div className="scene-navigation-row" key={id}>
          <button type="button" className="scene-navigation-item" aria-current={activeTab === id ? 'true' : undefined}
            aria-label={label} title={collapsed ? `${label} · ${detail}` : undefined} onClick={() => onSelect(id)}>
            <Icon aria-hidden />
            {!collapsed && <span><strong>{label}</strong><small>{detail}</small></span>}
          </button>
          {id === 'tattoo' && !collapsed && <button type="button" className="scene-icon-button scene-visibility"
            aria-label={tattooVisible ? 'Hide tattoo' : 'Show tattoo'} aria-pressed={tattooVisible}
            title={tattooVisible ? 'Hide tattoo' : 'Show tattoo'} onClick={onToggleTattoo}>
            {tattooVisible ? <FaEye aria-hidden /> : <FaEyeSlash aria-hidden />}
          </button>}
        </div>)}
      </nav>
      <div className="asset-library-body" hidden={collapsed}><TattooLibrary currentImage={currentImage} onChoose={onChooseArtwork} disabled={disabled} /></div>
    </aside>
  );
}
