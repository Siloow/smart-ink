interface Commands {
  blocked: boolean;
  gesturesBlocked?: boolean;
  undo: () => void;
  redo: () => void;
  beginGesture: () => void;
  endGesture: () => void;
}

const element = (target: EventTarget | null): Element | null => target && 'closest' in target ? target as Element : null;
const typing = 'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])';
export const isNativeUndoTarget = (target: EventTarget | null) => {
  const node = element(target);
  if (node?.closest(typing)) return true;
  const editable = node?.closest('[contenteditable]');
  return Boolean(editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false');
};
const adjustmentKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

/** Group complete gestures, including their final React commit. Native text
 * undo belongs to the field; scene undo is available through toolbar buttons. */
export function bindEditorHistory(root: HTMLElement, host: Window, get: () => Commands) {
  let pointer: number | null = null, key: string | null = null, frame: number | null = null;
  let editing: Element | null = null;
  let deferredStart = false, focusFinish = false;
  const gesturesBlocked = () => get().gesturesBlocked ?? get().blocked;
  const cancelFinish = () => { if (frame !== null) host.cancelAnimationFrame(frame); frame = null; focusFinish = false; };
  const finish = () => { cancelFinish(); get().endGesture(); };
  const finishSoon = (fromFocus = false) => {
    cancelFinish();
    focusFinish = fromFocus;
    frame = host.requestAnimationFrame(() => { frame = null; focusFinish = false; get().endGesture(); });
  };
  const start = () => { finish(); get().beginGesture(); };
  const startDeferred = () => { if (deferredStart) { deferredStart = false; start(); } };
  const pointerDown = (event: PointerEvent) => {
    if (gesturesBlocked() || (pointer !== null && pointer !== event.pointerId)) return;
    const target = element(event.target);
    if (frame !== null) finish();
    if (!target?.closest('canvas, input[type="range"], input[type="color"], .sl-map, [data-history-gesture]')) return;
    key = null;
    pointer = event.pointerId;
    // An exact field applies its draft on blur, after this pointerdown. Start
    // the next drag before its first change, once that blur has committed.
    if (editing && !editing.contains(target)) deferredStart = true;
    else start();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    startDeferred();
    pointer = null; finishSoon();
  };
  const pointerMove = (event: PointerEvent) => { if (pointer === event.pointerId) startDeferred(); };
  const input = () => { startDeferred(); };
  const click = () => {
    // A button click follows the field's blur; keep its preset/reset separate
    // even when both happen before the next animation frame.
    if (focusFinish) finish();
  };
  const focusIn = (event: FocusEvent) => {
    if (!gesturesBlocked() && isNativeUndoTarget(event.target) && editing !== element(event.target)) {
      editing = element(event.target); key = null; start();
    }
  };
  const focusOut = (event: FocusEvent) => {
    if (isNativeUndoTarget(event.target) && editing === element(event.target)) {
      editing = null;
      if (!deferredStart) finishSoon(true);
    }
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || isNativeUndoTarget(event.target)) return;
    const name = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (name === 'z' || (name === 'y' && !event.shiftKey))) {
      if (get().blocked) return;
      // Wait until an active drag finishes; its native pointerup owns placement.
      if (pointer !== null) return;
      event.preventDefault(); finish();
      if (name === 'y' || event.shiftKey) get().redo(); else get().undo();
      return;
    }
    if (gesturesBlocked() || pointer !== null || !root.contains(event.target as Node) || !adjustmentKeys.includes(event.key) ||
      !element(event.target)?.closest('input[type="range"], .sl-map [role="button"]')) return;
    if (key !== event.key) { key = event.key; start(); }
  };
  const keyUp = (event: KeyboardEvent) => { if (event.key === key) { key = null; finishSoon(); } };
  const blur = () => { pointer = null; key = null; editing = null; deferredStart = false; finishSoon(); };
  root.addEventListener('pointerdown', pointerDown, true);
  root.addEventListener('input', input, true);
  root.addEventListener('click', click, true);
  root.addEventListener('focusin', focusIn, true);
  root.addEventListener('focusout', focusOut);
  // Capture observes range keys before their handlers stop propagation.
  host.addEventListener('keydown', keyDown, true);
  host.addEventListener('keyup', keyUp);
  host.addEventListener('pointerup', pointerEnd);
  host.addEventListener('pointermove', pointerMove, true);
  host.addEventListener('pointercancel', pointerEnd);
  host.addEventListener('blur', blur);
  return () => {
    cancelFinish();
    root.removeEventListener('pointerdown', pointerDown, true);
    root.removeEventListener('input', input, true);
    root.removeEventListener('click', click, true);
    root.removeEventListener('focusin', focusIn, true);
    root.removeEventListener('focusout', focusOut);
    host.removeEventListener('keydown', keyDown, true);
    host.removeEventListener('keyup', keyUp);
    host.removeEventListener('pointerup', pointerEnd);
    host.removeEventListener('pointermove', pointerMove, true);
    host.removeEventListener('pointercancel', pointerEnd);
    host.removeEventListener('blur', blur);
  };
}
