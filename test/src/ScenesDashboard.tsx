import React, { useState, useEffect, useMemo } from 'react';
import { loadScenes, addScene, deleteScene, updateScene } from './sceneStorage';
import type { SceneData } from './types';
import CommunityPage from './components/community/CommunityPage';

interface Props {
  onSelectScene: (scene: SceneData, mode?: 'creative' | 'business') => void;
  onOpenLanding?: () => void;
}

export default function ScenesDashboard({ onSelectScene, onOpenLanding }: Props) {
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'myScenes' | 'community'>('myScenes');

  useEffect(() => {
    setScenes(loadScenes());
  }, []);

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
      version: 1,
      status: 'draft',
      tags: [],
      referenceImages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'admin-1',
    };
    addScene(newScene);
    setScenes(loadScenes());
    onSelectScene(newScene);
  };

  const handleDelete = (id: string) => {
    deleteScene(id);
    setScenes(loadScenes());
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
      updateScene(updated);
      setScenes(loadScenes());
    }
    setEditingId(null);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, _scene: SceneData) => {
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

  const handleOpenMyScenes = (e: React.MouseEvent) => {
    prevent(e);
    setActiveView('myScenes');
  };

  const handleOpenCommunity = (e: React.MouseEvent) => {
    prevent(e);
    setActiveView('community');
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-avatar">S</div>
          <span className="sidebar-workspace">Smart Ink</span>
          <span className="sidebar-chevron" aria-hidden>
            ▾
          </span>
        </div>
        <nav className="sidebar-nav">
          <a href="#" onClick={prevent}>
            <span className="nav-icon">⌂</span> Home
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">◎</span> Discover
          </a>
          <a href="#" className={activeView === 'myScenes' ? 'active' : ''} onClick={handleOpenMyScenes}>
            <span className="nav-icon">◻</span> My Scenes
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">✦</span> Templates
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">✧</span> Generate
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">⊕</span> Shared with me
          </a>
          <a href="#" className={activeView === 'community' ? 'active' : ''} onClick={handleOpenCommunity}>
            <span className="nav-icon">☍</span> Community
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">◈</span> Academy <span className="badge-new">NEW</span>
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
        <div className="sidebar-section-title">Projects</div>
        <nav className="sidebar-nav sidebar-nav--compact">
          <a href="#" onClick={prevent}>
            <span className="nav-icon">⊞</span> Overview
          </a>
          <a href="#" onClick={prevent}>
            <span className="nav-icon">+</span> New Project
          </a>
        </nav>
        <div className="sidebar-bottom-upgrade">
          <div className="upgrade-title">
            <span className="bolt">⚡</span> Upgrade workspace
          </div>
          <div className="upgrade-desc">Unlock all features on Smart Ink.</div>
          <button type="button" className="btn-upgrade">
            Upgrade
          </button>
        </div>
      </aside>

      <div className="main-content">
        <div className="top-bar">
          <div className="top-bar-left">
            <h1>{activeView === 'myScenes' ? 'My Scenes' : 'Community'}</h1>
            {activeView === 'myScenes' && (
              <button type="button" className="btn-new-folder" onClick={handleNewScene}>
                + New Scene
              </button>
            )}
          </div>
          {activeView === 'myScenes' && (
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
              <button type="button" className="btn-ai-gen" onClick={prevent}>
                ✦ AI preview
              </button>
              <button type="button" className="btn-create" onClick={handleNewScene}>
                + Create ▾
              </button>
            </div>
          )}
        </div>

        {activeView === 'myScenes' ? (
          <>
            <div className="announcement">
              <span className="announcement-icon" aria-hidden>
                🔷
              </span>
              <div>
                <div className="announcement-title">3D decal workflow</div>
                <div className="announcement-desc">
                  Upload PNG artwork and place it on the mesh in the editor. <span className="arrow-link">↗</span>
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
                <span className="label">3D Design</span>
              </div>
              <div className="new-project-card" role="presentation">
                <div className="new-project-icon icon-2d">🟣</div>
                <span className="label">2D Design</span>
              </div>
              <div className="new-project-card" role="presentation">
                <div className="new-project-icon icon-import">↓</div>
                <span className="label">Import</span>
              </div>
            </div>

            {filteredScenes.length === 0 ? (
              <div className="empty-scenes">
                {scenes.length === 0 ? (
                  <>
                    No scenes yet. Use <strong style={{ color: 'var(--text-secondary)' }}>3D Design</strong> or{' '}
                    <strong style={{ color: 'var(--text-secondary)' }}>+ New Scene</strong> to begin.
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
                          onKeyDown={(e) => handleNameKeyDown(e, scene)}
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
                      <button
                        type="button"
                        className="btn-dash btn-manage"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectScene(scene, 'business');
                        }}
                      >
                        Business
                      </button>
                      <button type="button" className="btn-delete" onClick={() => handleDelete(scene.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <CommunityPage />
        )}
      </div>
    </div>
  );
}
