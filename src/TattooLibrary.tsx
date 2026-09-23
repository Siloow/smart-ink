import { useEffect, useRef, useState } from 'react';
import { FaPlus, FaSearch, FaCheck, FaTrash } from 'react-icons/fa';
import { readTattooPng } from './utils/tattooUpload';
import { loadTattooLibrary, subscribeTattooLibrary, rememberTattoo, removeTattoo, STARTER_TATTOOS, type TattooAsset } from './storage/tattooLibrary';

interface Props { currentImage: string | null; onChoose: (source: string) => void; disabled?: boolean }
export default function TattooLibrary({ currentImage, onChoose, disabled = false }: Props) {
  const [uploads, setUploads] = useState<TattooAsset[]>([]);
  const [collection, setCollection] = useState<'all' | 'uploads' | 'starter'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const chooseRef = useRef(onChoose); chooseRef.current = onChoose;
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeTattooLibrary(items => { if (mounted.current) setUploads(items); });
    loadTattooLibrary().then(items => { if (mounted.current) { setUploads(items); } })
      .catch(() => { if (mounted.current) setError('Saved uploads could not be opened. Starter designs are still available.'); });
    return () => { unsubscribe(); mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => { if (disabled) { request.current?.abort(); setBusy(false); } }, [disabled]);
  const importFiles = async (files: File[]) => {
    if (!files.length || disabled) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setNotice('');
    let added = 0, first: string | null = null;
    try {
      for (const file of files) {
        const source = await readTattooPng(file, controller.signal);
        controller.signal.throwIfAborted();
        const items = await rememberTattoo(source, file.name);
        if (controller.signal.aborted || !mounted.current) return;
        setUploads(items); first ??= source; added++;
      }
      setCollection('uploads'); setQuery('');
      if (first) chooseRef.current(first);
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : 'Could not import this artwork.');
    } finally {
      if (request.current === controller && mounted.current) {
        setBusy(false); request.current = null;
        if (added) setNotice(`${added} ${added === 1 ? 'design added' : 'designs added'} to My uploads.`);
      }
    }
  };
  const remove = async (asset: TattooAsset) => {
    try { setUploads(await removeTattoo(asset.id)); setNotice(`${asset.name} removed from the library. Your placed tattoo is unchanged.`); }
    catch { setError('Could not remove this saved design. Please try again.'); }
  };
  const matches = (item: TattooAsset) => `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase());
  const groups = [
    { id: 'uploads', title: 'My uploads', items: uploads.filter(matches) },
    { id: 'starter', title: 'Starter designs', items: STARTER_TATTOOS.filter(matches) },
  ].filter(group => collection === 'all' || collection === group.id);
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);
  return <div className="tattoo-library" aria-label="Tattoo asset browser">
    <div className="tattoo-library-intro"><strong>Your next piece</strong><p>Choose a design to try it on. Click the skin to reposition.</p></div>
    <button type="button" className="ep-btn tattoo-library-upload" onClick={() => fileRef.current?.click()} disabled={busy || disabled}><FaPlus aria-hidden />{busy ? 'Adding artwork…' : 'Add artwork'}</button>
    <input ref={fileRef} type="file" accept="image/png,.png" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />
    <label className="tattoo-library-search"><FaSearch aria-hidden /><input type="search" aria-label="Search tattoo designs" placeholder="Search designs…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="tattoo-library-filters" aria-label="Artwork collections">{([['all', 'All'], ['uploads', 'My uploads'], ['starter', 'Starter']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={collection === id} onClick={() => setCollection(id)}>{label}</button>)}</div>
    {error && <p className="tattoo-library-error" role="alert">{error}</p>}
    {notice && <p className="tattoo-library-note" role="status">{notice}</p>}
    <div className="tattoo-library-results">
      {groups.map(group => group.items.length > 0 && <section key={group.id} aria-label={group.title}>
        <h3>{group.title}<span>{group.items.length}</span></h3>
        <div className="tattoo-library-grid">{group.items.map(asset => <div className="tattoo-asset" key={asset.id}>
          <button type="button" className="tattoo-asset-select" aria-label={`Use ${asset.name}`} aria-pressed={currentImage === asset.source} disabled={disabled || busy} onClick={() => { setNotice(`${asset.name} selected. Click the skin to adjust its placement.`); chooseRef.current(asset.source); }}>
            <span className="tattoo-asset-art"><img src={asset.source} alt="" loading="lazy" draggable={false} />{currentImage === asset.source && <span className="tattoo-asset-check"><FaCheck aria-hidden /></span>}</span>
            <strong>{asset.name}</strong><small>{asset.category}</small>
          </button>
          {group.id === 'uploads' && <button type="button" className="tattoo-asset-remove" aria-label={`Remove ${asset.name} from library`} title="Remove from library" disabled={busy || disabled} onClick={() => void remove(asset)}><FaTrash aria-hidden /></button>}
        </div>)}</div>
      </section>)}
      {!count && <div className="tattoo-library-empty"><strong>{query ? 'No matching designs' : 'Make this collection yours'}</strong><p>{query ? 'Try another name or collection.' : 'Add your PNG artwork to keep it here for your next session.'}</p></div>}
    </div>
    <p className="tattoo-library-footnote">Uploads stay in this browser. PNG · up to 20 MB each.</p>
  </div>;
}
