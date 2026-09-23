/** Editor snapshots are immutable plain objects/arrays. Keep their references so
 * a large uploaded image is shared between entries instead of copied/serialized. */
export function equalEditorSnapshot(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = Object.keys(a)
  const right = Object.keys(b)
  if (left.length !== right.length) return false
  return left.every(key => Object.prototype.hasOwnProperty.call(b, key) &&
    equalEditorSnapshot((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

export interface EditorHistoryState<T> {
  value: T
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
  gestureActive: boolean
}

export interface EditorHistoryOptions<T> {
  limit?: number
  equal?: (a: T, b: T) => boolean
}

export function createEditorHistory<T>(initial: T, options: EditorHistoryOptions<T> = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit!)) : 60
  const equal = options.equal ?? equalEditorSnapshot
  const past: T[] = []
  const future: T[] = []
  let present = initial
  let gesture: { start: T } | null = null
  const listeners = new Set<() => void>()
  const pending = () => gesture !== null && !equal(gesture.start, present)
  const makeState = (): EditorHistoryState<T> => ({
    value: present,
    canUndo: past.length > 0 || pending(),
    canRedo: future.length > 0 && !pending(),
    undoCount: Math.min(limit, past.length + (pending() ? 1 : 0)),
    redoCount: pending() ? 0 : future.length,
    gestureActive: gesture !== null,
  })
  let state = makeState()
  const publish = () => {
    state = makeState()
    listeners.forEach(listener => listener())
  }
  const pushPast = (value: T) => {
    past.push(value)
    if (past.length > limit) past.splice(0, past.length - limit)
  }
  const finish = () => {
    if (!gesture) return false
    if (!equal(gesture.start, present)) {
      pushPast(gesture.start)
      future.length = 0
    }
    gesture = null
    return true
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    observe(value: T) {
      if (equal(present, value)) return false
      if (!gesture) {
        pushPast(present)
        future.length = 0
      }
      present = value
      publish()
      return true
    },
    beginGesture() {
      if (gesture) return
      gesture = { start: present }
      publish()
    },
    endGesture() {
      if (finish()) publish()
    },
    flush() {
      if (finish()) publish()
    },
    undo() {
      const finished = finish()
      if (!past.length) {
        if (finished) publish()
        return false
      }
      future.push(present)
      present = past.pop()!
      publish()
      return true
    },
    redo() {
      const finished = finish()
      if (!future.length) {
        if (finished) publish()
        return false
      }
      pushPast(present)
      present = future.pop()!
      publish()
      return true
    },
    reset(value: T) {
      past.length = 0
      future.length = 0
      present = value
      gesture = null
      publish()
    },
  }
}

export type EditorHistory<T> = ReturnType<typeof createEditorHistory<T>>
