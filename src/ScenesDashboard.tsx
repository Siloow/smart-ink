import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadScenes, addScene, deleteScene, updateScene } from './sceneStorage';
import type { SceneData } from './types';

interface Props {
  onSelectScene: (scene: SceneData) => void;
  onOpenLanding?: () => void;
}

export default function ScenesDashboard({ onSelectScene, onOpenLanding }: Props) {
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const refreshScenes = useCallback(async () => {
    setScenes(await loadScenes());
  }, []);

  useEffect(() => {
    void refreshScenes();
  }, [refreshScenes]);

  const filteredScenes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scenes;
    return scenes.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, searchQuery]);

  const handleNewScene = () => {
    const newScene: SceneData = {
      id: Date.now().toString(),
      name: 'Untitled Scene',
      model: 'FinalBaseMesh',
      decalImage: null,
      decalRotation: 0,
      decalScale: 1,
      decalColor: '#ffffff',
      decalOpacity: 1,
      decalVisible: false,
      decalPosition: null,
      decalNormal: null,
      lightingPreset: 'studio',
      background: 'white',
      thumbnail: null,
      camera: {
        position: [6, 4, 6],
        target: [0, 0, 0],
        fov: 45,
      },
      bodyMeshId: 'body_full',
      skinToneId: 'tone_03',
      poseId: 'neutral',
      lookId: 'studio_softbox',
      qualityTier: 'final',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'demo',
    };
    void addScene(newScene).then(() => {
      void refreshScenes();
      onSelectScene(newScene);
    });
  };

  const handleDelete = (id: string) => {
    void deleteScene(id).then(refreshScenes);
  };

  const handleNameClick = (scene: SceneData) => {
    setEditingId(scene.id);
    setEditValue(scene.name);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  const handleNameBlur = (scene: SceneData) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== scene.name) {
      const updated = { ...scene, name: trimmed };
      void updateScene(updated).then(refreshScenes);
    }
    setEditingId(null);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const formatUpdated = (d: Date) => {
    try {
      const date = d instanceof Date ? d : new Date(d);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

  const prevent = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-avatar">S</div>
          <span className="sidebar-workspace">Smart Ink</span>
        </div>
        <nav className="sidebar-nav">
          <a href="#" className="active" onClick={prevent}>
            <span className="nav-icon">◻</span> My Renders
          </a>
          {onOpenLanding && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenLanding();
              }}
            >
              <span className="nav-icon">🏠</span> Landing
            </a>
          )}
        </nav>
      </aside>

      <div className="main-content">
        <div className="top-bar">
          <div className="top-bar-left">
            <h1>My Renders</h1>
            <button type="button" className="btn-new-folder" onClick={handleNewScene}>
              + New Scene
            </button>
          </div>
          <div className="top-bar-right">
            <div className="search-box">
              <span className="search-icon" aria-hidden>
                🔍
              </span>
              <input
                type="search"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search scenes"
              />
            </div>
            <button type="button" className="btn-create" onClick={handleNewScene}>
              + Create
            </button>
          </div>
        </div>

        <div className="announcement">
          <span className="announcement-icon" aria-hidden>
            🔷
          </span>
          <div>
            <div className="announcement-title">UV tattoo workflow</div>
            <div className="announcement-desc">
              Upload PNG artwork, place it on the mesh, and render with Blender Cycles.
            </div>
          </div>
        </div>

        <div className="new-project-row">
          <div
            className="new-project-card"
            onClick={handleNewScene}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleNewScene()}
          >
            <div className="new-project-icon icon-3d">🔷</div>
            <span className="label">New Render</span>
          </div>
        </div>

        {filteredScenes.length === 0 ? (
          <div className="empty-scenes">
            {scenes.length === 0 ? (
              <>
                No scenes yet. Use <strong style={{ color: 'var(--text-secondary)' }}>New Render</strong> to begin.
              </>
            ) : (
              <>No scenes match your search.</>
            )}
          </div>
        ) : (
          <div className="file-grid">
            {filteredScenes.map((scene) => (
              <div key={scene.id} className="file-card">
                <div
                  className="file-thumb"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectScene(scene)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectScene(scene)}
                  style={{ cursor: 'pointer' }}
                >
                  {scene.thumbnail ? (
                    <img
                      src={scene.thumbnail}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: '2rem', opacity: 0.15 }}>◇</span>
                  )}
                </div>
                <div className="file-info">
                  {editingId === scene.id ? (
                    <input
                      className="scene-name-input"
                      value={editValue}
                      onChange={handleNameChange}
                      onBlur={() => handleNameBlur(scene)}
                      onKeyDown={handleNameKeyDown}
                      autoFocus
                    />
                  ) : (
                    <div
                      className="file-name"
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleNameClick(scene)}
                      title="Click to rename"
                    >
                      {scene.name}
                    </div>
                  )}
                  <div className="file-edited">
                    {scene.model} · Updated {formatUpdated(scene.updatedAt)}
                  </div>
                </div>
                <div className="file-card-actions">
                  <button type="button" className="btn-open" onClick={() => onSelectScene(scene)}>
                    Open
                  </button>
                  <button type="button" className="btn-delete" onClick={() => handleDelete(scene.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
