// Settings storage.
// Non-secret keys (threshold / focus mode / library base url & username) live in
// the page's localStorage, matching the userscript behaviour. Library secrets
// (password, refresh token) live in chrome.storage.local, which page scripts
// cannot read; when chrome.storage is unavailable (unit tests, plain browser)
// they fall back to localStorage exactly like the userscript did without GM
// storage.
import { getChrome, getLocalStorage } from './env.js';
import { normalizeSpace } from './text.js';
import {
  DEFAULT_THRESHOLD,
  parseThreshold,
  normalizeBatchScope,
  normalizeBatchLayout
} from './pure.js';

export const LIBRARY_BASE_URL_KEY = 'xhs-enhanced:library-base-url';
export const LIBRARY_USERNAME_KEY = 'xhs-enhanced:library-username';
export const LIBRARY_ACCOUNT_ID_KEY = 'xhs-enhanced:library-account-id';
export const LIBRARY_PASSWORD_KEY = 'xhs-enhanced:library-password';
export const LIBRARY_REFRESH_KEY = 'xhs-enhanced:library-refresh-token';
export const THRESHOLD_KEY = 'xhs-enhanced:popular-threshold';
export const FOCUS_KEY = 'xhs-enhanced:focus-popular';
export const BATCH_SCOPE_KEY = 'xhs-enhanced:batch-scope';
export const BATCH_LAYOUT_KEY = 'xhs-enhanced:batch-layout';
export const LIBRARY_KEYS = Object.freeze([
  LIBRARY_BASE_URL_KEY,
  LIBRARY_USERNAME_KEY,
  LIBRARY_ACCOUNT_ID_KEY,
  LIBRARY_PASSWORD_KEY,
  LIBRARY_REFRESH_KEY
]);
// Keys the options page and the content scripts share; read once at startup
// and kept fresh via storage.onChanged. Deliberately separate from
// LIBRARY_KEYS: "清除内容库设置" must not wipe user preferences, and vice
// versa.
export const PREF_KEYS = Object.freeze([THRESHOLD_KEY, FOCUS_KEY, BATCH_SCOPE_KEY, BATCH_LAYOUT_KEY]);
export const STORAGE_KEYS = Object.freeze(LIBRARY_KEYS.concat(PREF_KEYS));

function chromeStorage() {
  const chrome = getChrome();
  try {
    if (chrome && chrome.storage && chrome.storage.local) return chrome.storage.local;
  } catch (_) {}
  return null;
}

// Synchronous cache of the library (content-library) settings. chrome.storage
// is async, so the content script warms this cache once at startup and every
// synchronous read below serves from it.
const libraryCache = {
  baseUrl: '',
  username: '',
  accountId: 0,
  password: '',
  refreshToken: ''
};
let libraryHydrated = false;
// Preferences shared with the options page (threshold, focus mode).
let thresholdCache = DEFAULT_THRESHOLD;
let focusCache = false;
let batchScopeCache = 'all';
let batchLayoutCache = 'flat';

function parseThresholdSafe(value) {
  if (value == null) return DEFAULT_THRESHOLD;
  const parsed = parseThreshold(String(value));
  return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
}

function readLocal(key) {
  const storage = getLocalStorage();
  if (!storage) return '';
  try {
    return String(storage.getItem(key) || '');
  } catch (_) {
    return '';
  }
}

function writeLocal(key, value) {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, String(value == null ? '' : value));
    return true;
  } catch (_) {
    return false;
  }
}

function removeLocal(key) {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (_) {}
}

function applyLibraryItems(items) {
  const source = items || {};
  libraryCache.baseUrl = String(source[LIBRARY_BASE_URL_KEY] || '');
  libraryCache.username = String(source[LIBRARY_USERNAME_KEY] || '');
  libraryCache.accountId = Number(source[LIBRARY_ACCOUNT_ID_KEY]) || 0;
  if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
  libraryCache.password = String(source[LIBRARY_PASSWORD_KEY] || '');
  libraryCache.refreshToken = String(source[LIBRARY_REFRESH_KEY] || '');
}

// One-time migration: the userscript kept the non-secret library keys in the
// page's localStorage. Move them into chrome.storage.local so all extension
// settings live in one place, then drop the legacy copies. Secrets cannot be
// migrated (GM storage was unreachable), so they stay empty until re-entered.
function migrateLegacyLocalStorage() {
  const moved = [];
  for (const key of [LIBRARY_BASE_URL_KEY, LIBRARY_USERNAME_KEY, LIBRARY_ACCOUNT_ID_KEY]) {
    const legacy = readLocal(key);
    if (legacy) {
      moved.push([key, legacy]);
    }
  }
  return moved;
}

// Keep the cache live across contexts: the options page writes new settings
// while content scripts hold an old snapshot. Merge changed keys as they land.
function subscribeToChanges() {
  const chrome = getChrome();
  try {
    const onChanged = chrome && chrome.storage && chrome.storage.onChanged;
    if (!onChanged || typeof onChanged.addListener !== 'function') return;
    onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes) return;
      for (const key of STORAGE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        const value = changes[key] ? changes[key].newValue : undefined;
        if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value == null ? '' : String(value);
        else if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value == null ? '' : String(value);
        else if (key === LIBRARY_ACCOUNT_ID_KEY) {
          libraryCache.accountId = Number(value) || 0;
          if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
        }
        else if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = value == null ? '' : String(value);
        else if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = value == null ? '' : String(value);
        else if (key === THRESHOLD_KEY) thresholdCache = parseThresholdSafe(value);
        else if (key === FOCUS_KEY) focusCache = value === true || value === '1';
        else if (key === BATCH_SCOPE_KEY) batchScopeCache = normalizeBatchScope(value);
        else if (key === BATCH_LAYOUT_KEY) batchLayoutCache = normalizeBatchLayout(value);
      }
    });
  } catch (_) {}
}
subscribeToChanges();

async function hydrate() {
  const store = chromeStorage();
  if (!store) {
    // Plain-browser/test fallback: read everything from localStorage.
    applyLibraryItems({
      [LIBRARY_BASE_URL_KEY]: readLocal(LIBRARY_BASE_URL_KEY),
      [LIBRARY_USERNAME_KEY]: readLocal(LIBRARY_USERNAME_KEY),
      [LIBRARY_ACCOUNT_ID_KEY]: readLocal(LIBRARY_ACCOUNT_ID_KEY),
      [LIBRARY_PASSWORD_KEY]: readLocal(LIBRARY_PASSWORD_KEY),
      [LIBRARY_REFRESH_KEY]: readLocal(LIBRARY_REFRESH_KEY)
    });
    thresholdCache = parseThresholdSafe(readLocal(THRESHOLD_KEY));
    focusCache = readLocal(FOCUS_KEY) === '1';
    batchScopeCache = normalizeBatchScope(readLocal(BATCH_SCOPE_KEY));
    batchLayoutCache = normalizeBatchLayout(readLocal(BATCH_LAYOUT_KEY));
    libraryHydrated = true;
    return;
  }
  let items = {};
  try {
    items = (await store.get(STORAGE_KEYS.slice())) || {};
  } catch (_) {
    items = {};
  }
  applyLibraryItems(items);
  thresholdCache = parseThresholdSafe(items[THRESHOLD_KEY]);
  focusCache = items[FOCUS_KEY] === true || items[FOCUS_KEY] === '1';
  batchScopeCache = normalizeBatchScope(items[BATCH_SCOPE_KEY]);
  batchLayoutCache = normalizeBatchLayout(items[BATCH_LAYOUT_KEY]);
  const legacy = migrateLegacyLocalStorage();
  // Preference keys: the userscript kept them in page localStorage. The
  // options page is a different origin, so move them into chrome.storage.
  for (const key of PREF_KEYS) {
    if (items[key] == null && readLocal(key)) legacy.push([key, readLocal(key)]);
  }
  if (legacy.length) {
    const patch = {};
    for (const [key, value] of legacy) {
      if (!items[key]) {
        patch[key] = value;
        if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value;
        if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value;
        if (key === LIBRARY_ACCOUNT_ID_KEY) libraryCache.accountId = Number(value) || 0;
        if (key === THRESHOLD_KEY) thresholdCache = parseThresholdSafe(value);
        if (key === FOCUS_KEY) focusCache = value === '1';
        if (key === BATCH_SCOPE_KEY) batchScopeCache = normalizeBatchScope(value);
        if (key === BATCH_LAYOUT_KEY) batchLayoutCache = normalizeBatchLayout(value);
      }
    }
    if (Object.keys(patch).length) {
      let persisted = false;
      try {
        await store.set(patch);
        persisted = true;
      } catch (_) {}
      // Only drop the legacy copies once the extension store actually holds
      // them; otherwise keep localStorage as the fallback.
      if (persisted) {
        for (const [key] of legacy) removeLocal(key);
      }
    } else {
      for (const [key] of legacy) removeLocal(key);
    }
  }
  libraryHydrated = true;
}

// Resolved once at startup; the content script waits for this before init().
export const ready = hydrate().catch(() => {
  libraryHydrated = true;
});

function persistLibrary(patch) {
  const store = chromeStorage();
  const entries = Object.entries(patch);
  if (store) {
    try {
      const result = store.set(patch);
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }
  let ok = true;
  for (const [key, value] of entries) {
    if (!writeLocal(key, value == null ? '' : String(value))) ok = false;
  }
  return ok;
}

export function isLibraryHydrated() {
  return libraryHydrated;
}

export function readLibraryConfig(storage) {
  const localSource = storage === undefined ? (chromeStorage() ? null : getLocalStorage()) : storage;
  let baseUrl = libraryCache.baseUrl;
  let username = libraryCache.username;
  let accountId = libraryCache.accountId;
  if (localSource) {
    try { baseUrl = String(localSource.getItem(LIBRARY_BASE_URL_KEY) || ''); } catch (_) { baseUrl = ''; }
    try { username = String(localSource.getItem(LIBRARY_USERNAME_KEY) || '').trim(); } catch (_) { username = ''; }
    try { accountId = Number(localSource.getItem(LIBRARY_ACCOUNT_ID_KEY) || 0) || 0; } catch (_) { accountId = 0; }
  } else if (chromeStorage()) {
    // Serve the warmed cache; trim/validate exactly like the localStorage path.
    username = normalizeSpace(username);
  }
  const parsedBase = parseBaseUrlSafe(baseUrl);
  if (!Number.isSafeInteger(accountId) || accountId < 0) accountId = 0;
  return {
    baseUrl: parsedBase.ok ? parsedBase.value : '',
    username: normalizeSpace(username),
    accountId,
    password: libraryCache.password
  };
}

function parseBaseUrlSafe(value) {
  const text = normalizeSpace(value).replace(/\/+$/, '');
  if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: '' };
  return { ok: true, value: text };
}

export function writeLibrarySettings({ baseUrl, username, accountId, password }) {
  libraryCache.baseUrl = baseUrl || '';
  libraryCache.username = normalizeSpace(username || '');
  libraryCache.accountId = Number(accountId) || 0;
  if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
  libraryCache.password = String(password == null ? '' : password);
  return persistLibrary({
    [LIBRARY_BASE_URL_KEY]: libraryCache.baseUrl,
    [LIBRARY_USERNAME_KEY]: libraryCache.username,
    [LIBRARY_ACCOUNT_ID_KEY]: libraryCache.accountId ? String(libraryCache.accountId) : '',
    [LIBRARY_PASSWORD_KEY]: libraryCache.password
  });
}

export function writeSecret(key, value) {
  const text = String(value == null ? '' : value);
  if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = text;
  if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = text;
  return persistLibrary({ [key]: text });
}

export function readRefreshToken() {
  return libraryCache.refreshToken || '';
}

export async function clearLibrarySettings() {
  libraryCache.baseUrl = '';
  libraryCache.username = '';
  libraryCache.accountId = 0;
  libraryCache.password = '';
  libraryCache.refreshToken = '';
  const store = chromeStorage();
  if (store) {
    try {
      await store.remove(LIBRARY_KEYS.slice());
      return true;
    } catch (_) {
      return false;
    }
  }
  for (const key of LIBRARY_KEYS) removeLocal(key);
  return true;
}

// --- Threshold / focus mode -------------------------------------------------
// Stored in chrome.storage.local so the options page (different origin) can
// read and write them; hydrated at startup, kept fresh via storage.onChanged,
// and simply falling back to localStorage when chrome.storage is unavailable
// (plain-browser / unit-test contexts).

export function readStoredThreshold(storage) {
  if (storage !== undefined) {
    // Explicit localStorage-like injection (unit tests / plain-browser fallback).
    if (!storage) return DEFAULT_THRESHOLD;
    try {
      const parsed = parseThreshold(storage.getItem(THRESHOLD_KEY));
      return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
    } catch (_) {
      return DEFAULT_THRESHOLD;
    }
  }
  return thresholdCache;
}

export function readStoredFocusPopular(storage) {
  if (storage !== undefined) {
    if (!storage) return false;
    try {
      return storage.getItem(FOCUS_KEY) === '1';
    } catch (_) {
      return false;
    }
  }
  return focusCache;
}

// Persist a threshold. Returns { ok, value, persisted }. The caller keeps
// rendering from readStoredThreshold().
export function writeStoredThreshold(value) {
  const parsed = parseThreshold(value);
  if (!parsed.ok) return { ok: false, value: thresholdCache, persisted: false };
  thresholdCache = parsed.value;
  return { ok: true, value: thresholdCache, persisted: persistLibrary({ [THRESHOLD_KEY]: String(thresholdCache) }) };
}

export function writeStoredFocusPopular(value) {
  focusCache = Boolean(value);
  return { ok: true, value: focusCache, persisted: persistLibrary({ [FOCUS_KEY]: focusCache ? '1' : '0' }) };
}

// --- Batch download scope ----------------------------------------------------
// Kept beside the threshold/focus prefs: same hydration/migration path. The
// options page does not surface it (scope is chosen in the batch bar itself),
// so it is hydrated the same way but has no dedicated writer UI elsewhere.
export function readStoredBatchScope(storage) {
  if (storage !== undefined) {
    if (!storage) return 'all';
    try {
      return normalizeBatchScope(storage.getItem(BATCH_SCOPE_KEY));
    } catch (_) {
      return 'all';
    }
  }
  return batchScopeCache;
}

// Persist a scope. Returns { ok, value, persisted }.
export function writeStoredBatchScope(value) {
  batchScopeCache = normalizeBatchScope(value);
  return { ok: true, value: batchScopeCache, persisted: persistLibrary({ [BATCH_SCOPE_KEY]: batchScopeCache }) };
}

// --- Batch download layout ---------------------------------------------------
// Same hydration path as the batch scope. Read by the batch downloader at
// packaging time; written on the options page (批量下载组织方式).
export function readStoredBatchLayout(storage) {
  if (storage !== undefined) {
    if (!storage) return 'flat';
    try {
      return normalizeBatchLayout(storage.getItem(BATCH_LAYOUT_KEY));
    } catch (_) {
      return 'flat';
    }
  }
  return batchLayoutCache;
}

// Persist a layout. Returns { ok, value, persisted }.
export function writeStoredBatchLayout(value) {
  batchLayoutCache = normalizeBatchLayout(value);
  return { ok: true, value: batchLayoutCache, persisted: persistLibrary({ [BATCH_LAYOUT_KEY]: batchLayoutCache }) };
}
