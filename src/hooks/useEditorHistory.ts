import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createEditorHistory, equalEditorSnapshot } from '../services/editorHistory'

interface EditorHistoryProps<T> {
  value: T
  /** Restore all captured fields in the same React event/update. */
  onRestore: (value: T) => void
  scopeId: string | number | null | undefined
  enabled?: boolean
  limit?: number
}

/** Observe immutable scene state; camera/view/UI state should not be included.
 * Start/end a gesture around a slider or drag to make its full movement one undo. */
export function useEditorHistory<T>({ value, onRestore, scopeId, enabled = true, limit = 60 }: EditorHistoryProps<T>) {
  const stored = useRef<{
    history: ReturnType<typeof createEditorHistory<T>>
    scopeId: typeof scopeId
    enabled: boolean
    restoring: { from: T; to: T } | null
  } | null>(null)
  if (!stored.current) stored.current = { history: createEditorHistory(value, { limit }), scopeId, enabled, restoring: null }
  const store = stored.current
  const latest = useRef({ value, onRestore, scopeId, enabled })
  latest.current = { value, onRestore, scopeId, enabled }
  const state = useSyncExternalStore(store.history.subscribe, store.history.getState, store.history.getState)

  const synchronize = useCallback(() => {
    const current = latest.current
    if (store.scopeId !== current.scopeId || store.enabled !== current.enabled || !current.enabled) {
      store.scopeId = current.scopeId
      store.enabled = current.enabled
      store.restoring = null
      // Avoid publishing an equal reset on every disabled render.
      const before = store.history.getState()
      if (before.canUndo || before.canRedo || before.gestureActive || !equalEditorSnapshot(before.value, current.value)) {
        store.history.reset(current.value)
      }
      return
    }
    if (store.restoring) {
      if (equalEditorSnapshot(current.value, store.restoring.to)) store.restoring = null
      // Two undo clicks may arrive before React commits the first restore.
      else if (equalEditorSnapshot(current.value, store.restoring.from)) return
      else store.restoring = null
    }
    store.history.observe(current.value)
  }, [store])

  useLayoutEffect(() => { synchronize() }, [value, scopeId, enabled, synchronize])

  const restore = useCallback((direction: 'undo' | 'redo') => {
    synchronize()
    if (!latest.current.enabled || !store.history[direction]()) return
    const target = store.history.getState().value
    store.restoring = { from: latest.current.value, to: target }
    latest.current.onRestore(target)
  }, [store, synchronize])
  const undo = useCallback(() => restore('undo'), [restore])
  const redo = useCallback(() => restore('redo'), [restore])
  const beginGesture = useCallback(() => {
    synchronize()
    if (latest.current.enabled) store.history.beginGesture()
  }, [store, synchronize])
  const endGesture = useCallback(() => {
    synchronize()
    store.history.endGesture()
  }, [store, synchronize])
  const reset = useCallback(() => {
    store.restoring = null
    store.scopeId = latest.current.scopeId
    store.enabled = latest.current.enabled
    store.history.reset(latest.current.value)
  }, [store])

  return { canUndo: enabled && state.canUndo, canRedo: enabled && state.canRedo,
    undo, redo, beginGesture, endGesture, flush: endGesture, reset }
}
