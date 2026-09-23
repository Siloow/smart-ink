import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RenderStatus, RenderProgress } from './services/cloudRenderService';
import './snapshot-mode.css';

export interface SnapshotOverlayProps {
  mode: 'compose' | 'result';
  status: RenderStatus;
  imageUrl: string | null;
  previewUrl?: string | null;
  progress?: RenderProgress | null;
  message: string;
  /** Elapsed render time in seconds. */
  elapsed: number;
  quality: 'quick' | 'detailed';
  onQualityChange: (quality: 'quick' | 'detailed') => void;
  onRender: () => void;
  onCancel: () => void;
  onClose: () => void;
  onDownload: () => void;
  onAdjust: () => void;
  cameraControls?: ReactNode;
  lightingControls?: ReactNode;
  framingHint?: string;
  warning?: string;
  /** False when the live viewport no longer has the captured image's aspect. */
  comparisonAvailable?: boolean;
  comparisonUnavailableReason?: string;
}

function elapsedLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function SnapshotOverlay({ mode, status, imageUrl, previewUrl, progress, message, elapsed, quality, onQualityChange, onRender, onCancel, onClose, onDownload, onAdjust, cameraControls, lightingControls, framingHint, warning, comparisonAvailable = true, comparisonUnavailableReason }: SnapshotOverlayProps) {
  const id = useId(), [compare, setCompare] = useState(false);
  const [panel, setPanel] = useState<'camera' | 'lighting'>('camera');
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 700px)').matches);
  const busy = status === 'uploading' || status === 'rendering';
  const [loadedFinal, setLoadedFinal] = useState<string | null>(null);
  const fraction = progress?.phase === 'final' && progress.total && progress.sample !== undefined ? progress.sample / progress.total : 0;
  const composing = mode === 'compose' && !busy;
  const containerRef = useRef<HTMLElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  const previousComposing = useRef(composing);
  const previousFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const box = containerRef.current?.getBoundingClientRect();
    if (box && ((box.width > 0 && box.width < 640) || (box.height > 0 && box.height < 420))) setPanelOpen(false);
    const previous = previousFocusRef.current;
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (previewUrl) setCompare(false); }, [previewUrl]);
  useEffect(() => { if (!comparisonAvailable || composing) setCompare(false); }, [comparisonAvailable, composing]);
  useEffect(() => {
    if (previousComposing.current !== composing) closeRef.current?.focus({ preventScroll: true });
    previousComposing.current = composing;
  }, [composing]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const container = containerRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]'))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
    const active = document.activeElement;
    if (!focusable.length) { event.preventDefault(); container.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!focusable.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  };
  const hasPreview = Boolean(previewUrl) && !composing;
  const hasImage = Boolean(imageUrl), showLive = !composing && !(busy && hasPreview) && compare && hasImage && comparisonAvailable;
  const failed = !composing && status === 'error', cancelled = !composing && status === 'cancelled';
  const stateTitle = composing ? 'Compose your snapshot' : busy
    ? hasPreview ? 'Refining details…' : hasImage ? 'Updating snapshot…' : status === 'uploading' ? 'Preparing snapshot…' : 'Rendering in Blender…'
    : failed ? 'Snapshot couldn’t finish' : cancelled ? 'Snapshot cancelled' : hasImage ? 'Snapshot ready' : 'Ready for a snapshot';
  const detail = composing ? framingHint?.trim() || 'Choose your angle and lighting, then render when you’re ready.' : message.trim() || (busy ? status === 'uploading' ? 'Preparing this view for rendering.' : 'Keep this view open while your image develops.'
    : failed ? 'Try again, or return to editing.' : cancelled ? hasImage ? 'Your previous snapshot is still available.' : 'You can try again whenever you’re ready.'
      : hasImage ? 'Compare it with the live view, or save the image.' : 'Render this view with studio lighting and shadows.');
  const renderLabel = composing ? 'Render snapshot' : failed || cancelled ? 'Try again' : hasImage ? 'Render again' : 'Render snapshot';
  const choosePanel = (next: 'camera' | 'lighting') => { setPanel(next); setPanelOpen(true); };
  const panelKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'camera' : event.key === 'End' ? 'lighting' : panel === 'camera' ? 'lighting' : 'camera';
    choosePanel(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-panel="${next}"]`)?.focus();
  };
  return <section ref={containerRef} role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={handleKeyDown} className={`snapshot-overlay ${showLive || composing ? 'snapshot-overlay--live' : ''} ${composing ? 'snapshot-overlay--compose' : ''}`} aria-labelledby={`${id}-title`} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header className="snapshot-toolbar">
      <div className="snapshot-title"><span className="snapshot-title-icon" aria-hidden="true">▣</span><div><h2 id={`${id}-title`}>Snapshot</h2><p>{composing ? 'Compose · live view' : showLive ? 'Live view · comparison' : hasImage ? 'Rendered studio image' : 'Studio render'}</p></div></div>
      <button ref={closeRef} type="button" className="snapshot-button snapshot-button--back" onClick={onClose}>Back to editing <span aria-hidden="true">↗</span></button>
    </header>

    <div className="snapshot-stage" aria-busy={busy}>
      {hasPreview && !showLive && <img className="snapshot-image snapshot-preview" src={previewUrl!} alt="Early preview of your tattoo snapshot" draggable={false} style={{ filter: `blur(${0.7 + 3.3 * (1 - fraction)}px)`, opacity: status === 'done' && loadedFinal === imageUrl ? 0 : 1 }} />}
      {hasImage && <img key={imageUrl} onLoad={() => setLoadedFinal(imageUrl)} style={hasPreview ? { opacity: status === 'done' && loadedFinal === imageUrl ? 1 : 0 } : undefined} className={`snapshot-image snapshot-final ${showLive || composing ? 'snapshot-image--hidden' : ''}`} src={imageUrl!} alt="Rendered tattoo studio snapshot" draggable={false} />}
      {showLive && <div className="snapshot-live-label">Live view<span>The camera stays in place for comparison.</span></div>}
      {!hasImage && !hasPreview && !composing && <div className="snapshot-empty">
        <div className={`snapshot-empty-icon ${busy ? 'snapshot-empty-icon--busy' : ''}`} aria-hidden="true">{busy ? <span className="snapshot-spinner" /> : failed ? '!' : '▣'}</div>
        <h3>{stateTitle}</h3><p>{detail}</p>
        {!busy && <button type="button" className="snapshot-button snapshot-button--primary" onClick={onRender}>{renderLabel}</button>}
      </div>}
      {!hasPreview && hasImage && !showLive && !composing && (busy || failed || cancelled) && <div className={`snapshot-image-notice ${failed ? 'snapshot-image-notice--error' : ''}`}>
        {busy && <span className="snapshot-spinner" aria-hidden="true" />}<span>{busy ? 'Showing your previous snapshot while the new one renders.' : failed ? 'The previous snapshot is still available.' : 'Rendering stopped. Your previous snapshot is still available.'}</span>
      </div>}
    </div>

    {composing && <aside className={`snapshot-compose-rail ${panelOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Compose snapshot">
      <div className="snapshot-rail-heading"><strong>Set up your shot</strong><button type="button" className="snapshot-rail-toggle" aria-expanded={panelOpen} aria-controls={`${id}-controls`} onClick={() => setPanelOpen(value => !value)}>{panelOpen ? 'Hide controls' : 'Show controls'}<span aria-hidden="true">{panelOpen ? '−' : '+'}</span></button></div>
      <div id={`${id}-controls`} className="snapshot-rail-body" hidden={!panelOpen}>
        <div className="snapshot-panel-tabs" role="tablist" aria-label="Snapshot controls">
          {(['camera', 'lighting'] as const).map(value => <button key={value} id={`${id}-${value}-tab`} type="button" role="tab" data-panel={value} aria-selected={panel === value} aria-controls={`${id}-${value}-panel`} tabIndex={panel === value ? 0 : -1} onKeyDown={panelKey} onClick={() => choosePanel(value)}>{value === 'camera' ? 'Camera' : 'Lighting'}</button>)}
        </div>
        <div id={`${id}-camera-panel`} role="tabpanel" aria-labelledby={`${id}-camera-tab`} hidden={panel !== 'camera'}>{cameraControls ?? <p className="snapshot-controls-hint">The camera is ready for this view.</p>}</div>
        <div id={`${id}-lighting-panel`} role="tabpanel" aria-labelledby={`${id}-lighting-tab`} hidden={panel !== 'lighting'}>{lightingControls ?? <p className="snapshot-controls-hint">Your current studio lighting will be used.</p>}</div>
      </div>
    </aside>}

    <footer className="snapshot-footer">
      {busy && progress?.phase === 'final' && <div className="snapshot-progress">
        <div className="snapshot-progress-copy"><span>{fraction === 1 ? 'Finishing details…' : 'Refining details…'}</span><span aria-hidden="true">{progress.total ? `${progress.sample ?? 0} / ${progress.total} samples` : 'Rendering'}</span></div>
        <progress aria-label="Final render samples" max={1} value={progress.total ? fraction : undefined} />
      </div>}
      <div className={`snapshot-status-row ${failed ? 'snapshot-status-row--error' : ''}`}>
        <div className="snapshot-status-copy" role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
          <strong>{stateTitle}</strong><span>{detail}</span>
        </div>
        {!composing && (busy || elapsed > 0) && <span className="snapshot-elapsed" aria-label={`Elapsed time ${elapsedLabel(elapsed)}`} aria-live="off">{busy && <span className="snapshot-spinner" aria-hidden="true" />}{elapsedLabel(elapsed)}</span>}
      </div>
      {warning && <p className="snapshot-warning" role="note"><span aria-hidden="true">ⓘ</span>{warning}</p>}
      {!composing && hasImage && !comparisonAvailable && <p id={`${id}-comparison-hint`} className="snapshot-warning" role="note">{comparisonUnavailableReason?.trim() || 'The view changed size. Resize back to the captured view to compare.'}</p>}
      <div className="snapshot-actions">
        <fieldset className="snapshot-quality" disabled={busy} aria-describedby={`${id}-quality-hint`}><legend>Quality</legend>
          <button type="button" aria-pressed={quality === 'quick'} onClick={() => onQualityChange('quick')}>Quick</button>
          <button type="button" aria-pressed={quality === 'detailed'} onClick={() => onQualityChange('detailed')}>Detailed</button>
        </fieldset>
        <span id={`${id}-quality-hint`} className="snapshot-quality-hint">{quality === 'quick' ? 'Faster preview' : '2560 px · sharp tattoo detail · longer render'}</span>
        <div className="snapshot-action-buttons">
          {!composing && !busy && <button type="button" className="snapshot-button" onClick={onAdjust}>Adjust shot</button>}
          {!composing && <button type="button" className={`snapshot-button snapshot-button--compare ${showLive ? 'is-active' : ''}`} aria-pressed={showLive} aria-describedby={hasImage && !comparisonAvailable ? `${id}-comparison-hint` : undefined} disabled={!hasImage || !comparisonAvailable || (busy && hasPreview)} onClick={() => { if (hasImage && comparisonAvailable) setCompare(value => !value); }}>{showLive ? 'Show snapshot' : comparisonAvailable ? 'Compare with live' : 'Compare unavailable'}</button>}
          {(!composing || hasImage) && <button type="button" className="snapshot-button" disabled={!hasImage} onClick={onDownload}>{composing || (busy && hasPreview) ? 'Download previous' : 'Download'}</button>}
          {busy ? <button type="button" className="snapshot-button snapshot-button--cancel" onClick={onCancel}>Cancel render</button> : <button type="button" className="snapshot-button snapshot-button--primary" onClick={onRender}>{renderLabel}</button>}
        </div>
      </div>
    </footer>
  </section>;
}
