import { useState } from 'react';
import { REGISTRY, findById } from './render/registry';

interface EditorLeftPanelProps {
  sceneName: string;
  bodyMeshId: string;
  onBack: () => void;
}

export default function EditorLeftPanel({ sceneName, bodyMeshId, onBack }: EditorLeftPanelProps) {
  const [objectsTab, setObjectsTab] = useState(true);
  const bodyLabel = findById(REGISTRY.bodyMeshes, bodyMeshId)?.label ?? bodyMeshId;

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
        <a href="#" className="editor-left-link" onClick={(e) => e.preventDefault()}>
          ✦ Templates
        </a>
        <a href="#" className="editor-left-link" onClick={(e) => e.preventDefault()}>
          ? Help &amp; Feedback
        </a>
      </div>
    </aside>
  );
}
