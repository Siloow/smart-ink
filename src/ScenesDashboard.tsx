import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { loadScenes, addScene, deleteScene, updateScene } from './sceneStorage';
import { FINAL_SAMPLES } from './render/registry';
import type { SceneData } from './types';
import type { BetaSession } from './auth/types';
import AccountSettings from './AccountSettings';
import './dashboard.css';
import TemplatePreviewRenderer from './TemplatePreviewRenderer';
import { SCENE_TEMPLATES, templatePreviewCache, type TemplatePreview } from './sceneTemplates';

interface Props {
  onSelectScene: (scene: SceneData) => void;
  onOpenLanding?: () => void;
  session: BetaSession;
  onSignOut: () => void;
}

export default function ScenesDashboard({ onSelectScene, onOpenLanding, session, onSignOut }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [template, setTemplate] = useState('blank');
  const templates = SCENE_TEMPLATES;
  const [previews, setPreviews] = useState<Record<string, TemplatePreview>>(() => ({ ...templatePreviewCache }));
  const [previewError, setPreviewError] = useState(false);
  const receivePreview = useCallback((id: string, preview: TemplatePreview) => {
    setPreviews((previous) => ({ ...previous, [id]: preview }));
  }, []);
  const failPreview = useCallback(() => setPreviewError(true), []);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const loadingRef = useRef(false);
  const cancelledRename = useRef(false);

  const refreshScenes = useCallback(async () => {
    if (loadingRef.current || mutating.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    setLoadError(false);
    try {
      const loaded = await loadScenes();
      if (mounted.current) setScenes(loaded);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? `Could not load scenes: ${e.message}` : 'Could not load scenes. Please try again.');
        setLoadError(true);
      }
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshScenes();
    return () => { mounted.current = false; };
  }, [refreshScenes]);

  const runMutation = async (key: string, action: string, work: () => Promise<void>) => {
    // A ref closes the double-click gap before React paints the disabled UI.
    // Serializing mutations also protects the local store's read/write cycle.
    if (mutating.current || loadingRef.current || loadError) return;
    mutating.current = true;
    setBusy(key);
    setError('');
    setLoadError(false);
    try {
      await work();
    } catch (e) {
      if (mounted.current) setError(`Could not ${action}. ${e instanceof Error ? e.message : 'Please try again.'}`);
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const unavailable = loading || busy !== null || loadError;
  const openScene = (scene: SceneData) => {
    if (!mutating.current && !loadingRef.current) onSelectScene(scene);
  };

  const filteredScenes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const recent = [...scenes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (!q) return recent;
    return recent.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, searchQuery]);

  const handleNewScene = () => {
    if (mutating.current || loadingRef.current || loadError) return;
    const newScene: SceneData = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: template === 'blank' ? 'Untitled project' : `${templates.find((item) => item.id === template)?.label} preview`,
      bodyRegion: templates.find((item) => item.id === template)?.region ?? null,
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
      thumbnail: previews[template]?.image ?? null,
      camera: previews[template]?.camera ?? {
        position: [6, 4, 6],
        target: [0, 0, 0],
        fov: 45,
      },
      bodyMeshId: 'body_full',
      skinToneId: 'tone_03',
      poseId: 'neutral',
      lookId: 'studio_softbox',
      qualityTier: 'preview',
      finalSamples: FINAL_SAMPLES.default,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: session.userId ?? session.email,
    };
    void runMutation('create', 'create the scene', async () => {
      await addScene(newScene);
      if (mounted.current) {
        setScenes((previous) => [...previous, newScene]);
        onSelectScene(newScene);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (mutating.current || loadingRef.current || loadError) return;
    const name = scenes.find((scene) => scene.id === id)?.name ?? 'this scene';
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    void runMutation(`delete:${id}`, 'delete the scene', async () => {
      await deleteScene(id);
      if (mounted.current) setScenes((previous) => previous.filter((scene) => scene.id !== id));
    });
  };

  const handleNameClick = (scene: SceneData) => {
    if (mutating.current || loadingRef.current || loadError) return;
    cancelledRename.current = false;
    setEditingId(scene.id);
    setEditValue(scene.name);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  const handleNameBlur = (scene: SceneData) => {
    if (cancelledRename.current) { cancelledRename.current = false; return; }
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== scene.name) {
      const updated = { ...scene, name: trimmed, updatedAt: new Date() };
      void runMutation(`rename:${scene.id}`, 'rename the scene', async () => {
        await updateScene(updated);
        if (mounted.current) {
          setScenes((previous) => previous.map((item) => item.id === updated.id ? updated : item));
          setEditingId(null);
        }
      });
    } else setEditingId(null);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      cancelledRename.current = true;
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


  return (
    <div className="dashboard">
      <aside className="sidebar">
        <button type="button" className="sidebar-header dashboard-brand" onClick={onOpenLanding} aria-label="Smart Ink — front page" title="Go to front page">
          <span className="nav-logo nav-logo--sm" aria-hidden />
          <span className="sidebar-workspace">Smart Ink</span>
        </button>
        <nav className="sidebar-nav" aria-label="Workspace">
          <a href="#projects" className={!settingsOpen ? 'active' : ''} onClick={(event) => { event.preventDefault(); setSettingsOpen(false); }}>
            <span className="nav-icon" aria-hidden>◻</span> My Projects
          </a>
        </nav>
        <div className="dashboard-account">
          <button type="button" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(true)}>⚙ Account settings</button>
          <span>{session.email}</span>
        </div>
      </aside>

      <div className="main-content">
        {settingsOpen ? <AccountSettings session={session} onSignOut={onSignOut} /> : <>
        <div className="top-bar">
          <div className="top-bar-left">
            <h1>My Projects</h1>

          </div>
        </div>
        <div className="dashboard-actions">
            <button type="button" className="new-project-card dashboard-create" onClick={handleNewScene} disabled={unavailable}>
              <span className="new-project-icon icon-3d" aria-hidden="true">+</span>
              {busy === 'create' ? 'Creating…' : 'Create tattoo preview'}
            </button>
          <div className="top-bar-right">
            <div className="search-box">
              <span className="search-icon" aria-hidden>
                🔍
              </span>
              <input
                type="search"
                placeholder="Search projects"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search projects"
              />
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ marginBottom: 16, padding: 14, border: '1px solid #a94e59', borderRadius: 10, color: '#ffc0c8' }}>
            {error}
            {loadError && <button type="button" className="btn-open" style={{ marginLeft: 12 }} onClick={() => void refreshScenes()} disabled={loading || busy !== null}>Retry</button>}
          </div>
        )}
        {loading && <p role="status">Loading scenes…</p>}
        {busy && <p role="status">{busy === 'create' ? 'Creating scene…' : busy.startsWith('delete:') ? 'Deleting scene…' : 'Saving scene name…'}</p>}

        <section className="template-section" aria-labelledby="templates-title">
          <h2 id="templates-title">Start from a template</h2>
          <p>Choose your starting point, then create your tattoo preview.</p>
          <div className="template-grid" role="group" aria-label="Scene template">
            {templates.map((item) => <button key={item.id} type="button" className="template-card" aria-pressed={template === item.id} disabled={unavailable} onClick={() => setTemplate(item.id)}>
              <span className="template-art">
                {previews[item.id] ? <img src={previews[item.id].image} alt={`${item.label} scene preview`} /> : <span className="template-loading">{previewError ? 'Preview unavailable' : 'Preparing scene preview…'}</span>}
              </span>
              <span className="template-label">{item.label}<span aria-hidden>{template === item.id ? '✓' : ''}</span></span>
              <span className="template-detail">{item.detail}</span>
            </button>)}
          </div>
          {!previewError && <TemplatePreviewRenderer onPreview={receivePreview} onError={failPreview} />}
          {previewError && <p className="template-preview-error">Some previews could not load. <button type="button" onClick={() => setPreviewError(false)}>Retry previews</button></p>}
        </section>
        <section aria-labelledby="recent-title" className="recent-section">
        <h2 id="recent-title">Recent projects</h2>
        {loading || loadError ? null : filteredScenes.length === 0 ? (
          <div className="empty-scenes">
            {scenes.length === 0 ? (
              <>
                Your projects will appear here once you create your first tattoo preview.
              </>
            ) : (
              <>No projects match your search.</>
            )}
          </div>
        ) : (
          <div className="file-grid">
            {filteredScenes.map((scene) => (
              <div key={scene.id} className="file-card">
                <div
                  className="file-thumb"
                  role="button"
                  tabIndex={unavailable ? -1 : 0}
                  aria-disabled={unavailable}
                  aria-label={`Open ${scene.name}`}
                  onClick={() => openScene(scene)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScene(scene); } }}
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
                      disabled={unavailable}
                      aria-label="Scene name"
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
                  <button type="button" className="btn-open" onClick={() => openScene(scene)} disabled={unavailable}>
                    Open
                  </button>
                  <button type="button" className="btn-delete" onClick={() => handleDelete(scene.id)} disabled={unavailable}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </section>
        </>}
      </div>
    </div>
  );
}
