import { useState } from 'react';

interface EditorLeftPanelProps {
  sceneName: string;
  model: string;
  onBack: () => void;
}

export default function EditorLeftPanel({ sceneName, model, onBack }: EditorLeftPanelProps) {
  const [objectsTab, setObjectsTab] = useState(true);

  return (
    <aside className="editor-left-panel">
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
      <div className="editor-left-title">
        <span>Scenes ▾</span>
        <span className="editor-left-plus" aria-hidden>
          +
        </span>
      </div>
      <div className="scene-item active">
        <span className="scene-check">✓</span> {sceneName}
      </div>
      <input type="search" className="editor-search" placeholder="Search" aria-label="Search scene" />
      <div className="scene-item child">
        <span className="scene-tree-prefix">└</span>
        <span className="scene-tree-emoji">🧊</span> {model}
      </div>
      <div className="editor-left-bottom">
        <button type="button" className="editor-left-link" onClick={onBack}>
          ← Back to scenes
        </button>
        <a href="#" className="editor-left-link" onClick={(e) => e.preventDefault()}>
          ✦ Templates
        </a>
        <a href="#" className="editor-left-link" onClick={(e) => e.preventDefault()}>
          ? Help & Feedback
        </a>
      </div>
    </aside>
  );
}
