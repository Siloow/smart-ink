import { useEffect, useId, useRef, useState } from 'react';
import { FaChevronDown, FaDownload, FaShareAlt } from 'react-icons/fa';

export default function EditorOutputMenu({ onExport, onShare }: { onExport: () => void; onShare: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = (action: () => void) => { setOpen(false); trigger.current?.focus(); action(); };
  return <div className="editor-output" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    }}>
    <button type="button" className="tool-btn tool-btn--ghost" ref={trigger} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>Output <FaChevronDown aria-hidden /></button>
    {open && <div className="editor-output-popover" id={id} role="group" aria-label="Output options">
      <button type="button" onClick={() => choose(onExport)}><FaDownload aria-hidden /><span>Export<small>Download an image or Blender files</small></span></button>
      <button type="button" onClick={() => choose(onShare)}><FaShareAlt aria-hidden /><span>Renders &amp; sharing<small>View and share saved renders</small></span></button>
    </div>}
  </div>;
}
