/** Save complete, immutable scene snapshots without losing edits on failure. */
export interface SceneSaveState {
  status: 'saved' | 'pending' | 'saving' | 'error';
  /** Includes the snapshot currently being written. */
  pendingCount: number;
  error: string | null;
}

export interface SceneSaveQueue<T extends { id: string }> {
  /** Stage immediately on an edit. The caller may debounce flush(). */
  stage: (snapshot: T) => void;
  /** Persist all dirty scenes, including edits received during an active save.
   * Rejects on failure, retaining dirty snapshots for a fresh explicit retry. */
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  hasPending: () => boolean;
  peek: (sceneId: string) => T | undefined;
  getState: () => SceneSaveState;
  subscribe: (listener: (state: SceneSaveState) => void) => () => void;
}

export function createSceneSaveQueue<T extends { id: string }>(
  write: (snapshot: T) => Promise<void>,
): SceneSaveQueue<T> {
  // Local storage rewrites the scene collection, so different scenes must
  // serialize too. Updating one id retains its insertion order in this map.
  const dirty = new Map<string, { snapshot: T }>();
  const listeners = new Set<(state: SceneSaveState) => void>();
  let active: Promise<void> | null = null;
  let lastError: string | null = null;

  const getState = (): SceneSaveState => ({
    status: active ? 'saving' : lastError ? 'error' : dirty.size ? 'pending' : 'saved',
    pendingCount: dirty.size,
    error: lastError,
  });
  const publish = () => {
    const state = getState();
    for (const listener of listeners) listener(state);
  };

  const flush = (): Promise<void> => {
    if (active) return active;
    if (!dirty.size) return Promise.resolve();

    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const completion = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    active = completion;
    lastError = null;
    publish();

    void (async () => {
      try {
        while (dirty.size) {
          const [id, entry] = dirty.entries().next().value!;
          await write(entry.snapshot);
          // An edit can replace this entry while its older snapshot is saving.
          // A successful older write must never mark that newer edit as saved.
          if (dirty.get(id) === entry) dirty.delete(id);
          publish();
        }
        // Clear the active promise before resolving it: a later flush must
        // inspect current dirty state, not reuse a settled or rejected save.
        active = null;
        publish();
        resolve();
      } catch (error) {
        active = null;
        lastError = error instanceof Error ? error.message : String(error || 'Could not save the scene.');
        publish();
        reject(error);
      }
    })();

    return completion;
  };

  return {
    stage(snapshot) {
      dirty.set(snapshot.id, { snapshot });
      publish();
    },
    flush,
    retry: flush,
    hasPending: () => dirty.size > 0,
    peek: (sceneId) => dirty.get(sceneId)?.snapshot,
    getState,
    subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => { listeners.delete(listener); };
    },
  };
}
