import TattooLibrary from './TattooLibrary';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

interface EditorLeftPanelProps {
  disabled?: boolean;
  currentImage: string | null;
  onChooseArtwork: (source: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function EditorLeftPanel({ disabled = false, collapsed, onToggleCollapsed,
  currentImage, onChooseArtwork }: EditorLeftPanelProps) {
  return (
    <aside className={`editor-left-panel ep-sidebar scene-navigation asset-sidebar${collapsed ? ' scene-navigation--collapsed' : ''}`} inert={disabled} aria-label="Tattoo library">
      <div className="scene-navigation-heading">
        {!collapsed && <span>Tattoo library</span>}
        <button type="button" className="scene-icon-button" onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand tattoo library' : 'Collapse tattoo library'} aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <FaChevronRight aria-hidden /> : <FaChevronLeft aria-hidden />}
        </button>
      </div>
      <div className="asset-library-body" hidden={collapsed}><TattooLibrary currentImage={currentImage} onChoose={onChooseArtwork} disabled={disabled} /></div>
    </aside>
  );
}
