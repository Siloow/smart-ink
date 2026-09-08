import { useState } from 'react';

interface EditorLeftPanelProps {
  sceneName: string;
  /** What the viewport is showing: the whole figure, or one cut-out region. */
  bodyLabel: string;
  onBack: () => void;
}

export default function EditorLeftPanel({ sceneName, bodyLabel, onBack }: EditorLeftPanelProps) {
  const [objectsTab, setObjectsTab] = useState(true);

  return (
    <aside className="editor-left-panel ep-sidebar">
      <div className="editor-tabs">
        <button
          type="button"
          className={`editor-tab${objectsTab ? ' active' : ''}`}
          onClick={() => setObjectsTab(true)}
        >
          Objects
        </button>
        <button
          type="button"
          className={`editor-tab${!objectsTab ? ' active' : ''}`}
          onClick={() => setObjectsTab(false)}
        >
          Assets
        </button>
      </div>

      <div className="ep-sidebar-body editor-left-body">
        <header className="ep-header">
          <span className="ep-title">Scene</span>
          <span className="ep-hint">{sceneName}</span>
        </header>

        <div className="editor-left-scene-tree">
          <div className="scene-item active">
            <span className="scene-check" aria-hidden>✓</span>
            {sceneName}
          </div>
          <input type="search" className="editor-search" placeholder="Search" aria-label="Search scene" />
          <div className="scene-item child">
            <span className="scene-tree-prefix" aria-hidden>└</span>
            <span className="scene-tree-emoji" aria-hidden>🧊</span>
            {bodyLabel}
          </div>
        </div>
      </div>

      <div className="editor-left-bottom">
        <button type="button" className="editor-left-link" onClick={onBack}>
          ← Back to scenes
        </button>
      </div>
    </aside>
  );
}
