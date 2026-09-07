import { useCallback, useEffect, useState } from 'react';
import { REGISTRY, findById } from './render/registry';
import {
  canShareRenders,
  clearRenderHistory,
  createRenderShareLink,
  deleteRenderHistory,
  getRenderImageBlob,
  listRenderHistory,
  type RenderHistoryEntry,
} from './renderHistoryStorage';

interface RenderHistoryModalProps {
  onClose: () => void;
}

function formatSource(entry: RenderHistoryEntry): string {
  if (entry.source === 'cycles') {
    const tier = entry.qualityTier === 'final' ? 'Final' : 'Preview';
    return `Cycles · ${tier}`;
  }
  return entry.exportPreset ? `Canvas · ${entry.exportPreset}` : 'Canvas export';
}

function formatMeta(entry: RenderHistoryEntry): string {
  const parts = [`${entry.width}×${entry.height}`];
  if (entry.sceneName) parts.push(entry.sceneName);
  if (entry.lookId) {
    const look = findById(REGISTRY.looks, entry.lookId);
    if (look) parts.push(look.label);
  }
  return parts.join(' · ');
}

export default function RenderHistoryModal({ onClose }: RenderHistoryModalProps) {
  const [entries, setEntries] = useState<RenderHistoryEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [share, setShare] = useState<{ id: string; text: string; url?: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareable = canShareRenders();

  const handleShare = async (entry: RenderHistoryEntry) => {
    setSharing(true);
    setShare(null);
    try {
      const { url, expiresAt } = await createRenderShareLink(entry.id);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      const until = new Date(expiresAt).toLocaleDateString();
      setShare({
        id: entry.id,
        url,
        text: `${copied ? 'Link copied.' : 'Link ready.'} Anyone with it can view this render until ${until}.`,
      });
    } catch (e) {
      setShare({ id: entry.id, text: e instanceof Error ? e.message : 'Could not create a share link.' });
    } finally {
      setSharing(false);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listRenderHistory();
      setEntries(list);
      if (list.length > 0 && (!selectedId || !list.some((e) => e.id === selectedId))) {
        setSelectedId(list[0].id);
      }
      if (list.length === 0) {
        setSelectedId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load render history');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};

    void (async () => {
      await Promise.all(
        entries.map(async (entry) => {
          const blob = await getRenderImageBlob(entry.id);
          if (blob && !cancelled) {
            urls[entry.id] = URL.createObjectURL(blob);
          }
        })
      );
      if (!cancelled) {
        setThumbUrls((prev) => {
          Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
          return urls;
        });
      }
    })();

    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [entries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const selectedUrl = selected ? thumbUrls[selected.id] : null;

  const handleDelete = async (id: string) => {
    await deleteRenderHistory(id);
    await refresh();
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete all saved renders? This cannot be undone.')) return;
    await clearRenderHistory();
    setThumbUrls((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    await refresh();
  };

  const handleDownload = (entry: RenderHistoryEntry) => {
    const url = thumbUrls[entry.id];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-ink-${entry.source}-${entry.createdAt}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="modal-overlay render-history-overlay" role="dialog" aria-labelledby="render-history-title">
      <div className="modal-card render-history-card">
        <div className="render-history-header">
          <h2 id="render-history-title">Render history</h2>
          <button type="button" className="btn-modal-cancel" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="render-history-desc">
          {shareable
            ? 'Cycles renders and canvas exports are saved to your account (up to 100). Share gives you a read-only link for a client.'
            : 'Cycles renders and canvas exports from this browser are saved locally (up to 40). Share links need the hosted backend.'}
        </p>

        {loading && <p className="render-history-empty">Loading…</p>}
        {error && <p className="render-history-error">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="render-history-empty">No renders yet. Export an image or run a Cycles render to build history.</p>
        )}

        {!loading && !error && entries.length > 0 && (
          <>
            {selected && selectedUrl && (
              <div className="render-history-preview">
                <img src={selectedUrl} alt="Selected render" />
                <div className="render-history-preview-meta">
                  <div>
                    <strong>{formatSource(selected)}</strong>
                    <span>{new Date(selected.createdAt).toLocaleString()}</span>
                  </div>
                  <span>{formatMeta(selected)}</span>
                </div>
                <div className="render-history-preview-actions">
                  <button type="button" className="btn-modal-primary" onClick={() => handleDownload(selected)}>
                    Download
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    disabled={!shareable || sharing}
                    title={shareable ? 'Copy a read-only link' : 'Share links need the hosted backend'}
                    onClick={() => void handleShare(selected)}
                  >
                    {sharing ? 'Creating link…' : 'Share link'}
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    onClick={() => void handleDelete(selected.id)}
                  >
                    Delete
                  </button>
                </div>
                {share && share.id === selected.id && (
                  <p className="render-history-share" role="status">
                    {share.text}
                    {share.url && (
                      <>
                        {' '}
                        <a href={share.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="render-history-grid">
              {entries.map((entry) => {
                const url = thumbUrls[entry.id];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`render-history-thumb${entry.id === selectedId ? ' render-history-thumb--active' : ''}`}
                    onClick={() => setSelectedId(entry.id)}
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    {url ? (
                      <img src={url} alt="" />
                    ) : (
                      <span className="render-history-thumb-placeholder">…</span>
                    )}
                    <span className="render-history-thumb-label">{formatSource(entry)}</span>
                  </button>
                );
              })}
            </div>

            <div className="render-history-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => void handleClearAll()}>
                Clear all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
