// Selection store for the batch-download feature. Keeps the checked notes in a
// Map keyed by note id so selections survive card DOM churn (waterfall feeds
// recycle/remove nodes constantly), and persists a snapshot list into
// chrome.storage.session so a page reload does not lose them. Session scope
// is deliberate: selections are per browsing session, never synced.
export const SELECTION_STORAGE_KEY = 'xhs-enhanced:batch-selected';

function validateSnapshot(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  if (!id) return null;
  return {
    id,
    link: String(entry.link || ''),
    coverUrl: String(entry.coverUrl || ''),
    title: String(entry.title || ''),
    ts: Number(entry.ts) || Date.now()
  };
}

// storage: a chrome.storage.session-like async {get,set} object, or null to
// run purely in memory (unit tests, or environments without storage.session).
export function createSelectionStore(storage) {
  const map = new Map();
  let hydrated = false;
  let hydratePromise = null;
  let persistTimer = null;

  async function hydrate() {
    if (hydrated) return map.size;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        if (storage && typeof storage.get === 'function') {
          const items = await storage.get(SELECTION_STORAGE_KEY);
          const list = items && items[SELECTION_STORAGE_KEY];
          if (Array.isArray(list)) {
            for (const raw of list) {
              const value = validateSnapshot(raw);
              if (value && !map.has(value.id)) map.set(value.id, value);
            }
          }
        }
      } catch (_) {
        // Corrupt payload: keep whatever is in memory, start empty otherwise.
      }
      hydrated = true;
      return map.size;
    })();
    return hydratePromise;
  }

  function payload() {
    return { [SELECTION_STORAGE_KEY]: Array.from(map.values()) };
  }

  function persistNow() {
    if (!storage || typeof storage.set !== 'function') return Promise.resolve(false);
    try {
      return Promise.resolve(storage.set(payload())).then(() => true, () => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function clearPending() {
    if (persistTimer !== null && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(persistTimer);
    }
    persistTimer = null;
  }

  function schedulePersist() {
    if (!storage) return;
    clearPending();
    if (typeof globalThis.setTimeout !== 'function') {
      persistNow();
      return;
    }
    // Debounce bursts (e.g. select-all) into one storage write.
    persistTimer = globalThis.setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, 300);
  }

  return Object.freeze({
    get size() { return map.size; },
    hydrate,
    flush: persistNow,
    has(id) {
      return map.has(String(id || ''));
    },
    get(id) {
      return map.get(String(id || '')) || null;
    },
    values() {
      return Array.from(map.values());
    },
    ids() {
      return Array.from(map.keys());
    },
    add(item) {
      const value = validateSnapshot(item);
      if (!value) return false;
      const isNew = !map.has(value.id);
      map.set(value.id, value);
      schedulePersist();
      return isNew;
    },
    remove(id) {
      const had = map.delete(String(id || ''));
      if (had) schedulePersist();
      return had;
    },
    toggle(item) {
      const value = validateSnapshot(item);
      if (!value) return null;
      if (map.has(value.id)) {
        map.delete(value.id);
        schedulePersist();
        return false;
      }
      map.set(value.id, value);
      schedulePersist();
      return true;
    },
    clear() {
      if (!map.size) return false;
      map.clear();
      clearPending();
      persistNow();
      return true;
    }
  });
}
