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
  THRESHOLD_STORAGE_KEY,
  FOCUS_STORAGE_KEY,
  parseThreshold
} from './pure.js';

export const LIBRARY_BASE_URL_KEY = 'xhs-enhanced:library-base-url';
export const LIBRARY_USERNAME_KEY = 'xhs-enhanced:library-username';
export const LIBRARY_ACCOUNT_ID_KEY = 'xhs-enhanced:library-account-id';
export const LIBRARY_PASSWORD_KEY = 'xhs-enhanced:library-password';
export const LIBRARY_REFRESH_KEY = 'xhs-enhanced:library-refresh-token';
export const LIBRARY_KEYS = Object.freeze([
  LIBRARY_BASE_URL_KEY,
  LIBRARY_USERNAME_KEY,
  LIBRARY_ACCOUNT_ID_KEY,
  LIBRARY_PASSWORD_KEY,
  LIBRARY_REFRESH_KEY
]);

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
      for (const key of LIBRARY_KEYS) {
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
    libraryHydrated = true;
    return;
  }
  let items = {};
  try {
    items = (await store.get(LIBRARY_KEYS.slice())) || {};
  } catch (_) {
    items = {};
  }
  applyLibraryItems(items);
  const legacy = migrateLegacyLocalStorage();
  if (legacy.length) {
    const patch = {};
    for (const [key, value] of legacy) {
      if (!items[key]) {
        patch[key] = value;
        if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value;
        if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value;
        if (key === LIBRARY_ACCOUNT_ID_KEY) libraryCache.accountId = Number(value) || 0;
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

// --- Threshold / focus mode (page-local, same as the userscript) ------------

export function readStoredThreshold(storage) {
  const source = storage === undefined ? getLocalStorage() : storage;
  if (!source) return DEFAULT_THRESHOLD;
  try {
    const parsed = parseThreshold(source.getItem(THRESHOLD_STORAGE_KEY));
    return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
  } catch (_) {
    return DEFAULT_THRESHOLD;
  }
}

export function readStoredFocusPopular(storage) {
  const source = storage === undefined ? getLocalStorage() : storage;
  if (!source) return false;
  try {
    return source.getItem(FOCUS_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}
