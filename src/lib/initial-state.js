// Resolves a note's xsecToken from the serialized page state. The extension runs
// in an isolated world and cannot see window.__INITIAL_STATE__, so the object is
// recovered from the inline <script> payloads in the DOM (parsed, never eval'd).
// When the bulk walk finds nothing, we fall back to the regexes on script text.
import { isTestMode, getRoot } from './env.js';
import {
  collectTokensFromStateObject,
  findTokenForNoteIdInState,
  parseInitialStateFromScriptText
} from './pure.js';

export function createInitialStateResolver(documentRef) {
  let injected = null; // test seam: setTestInitialState()
  let hasInjected = false;
  let initialStateCache; // undefined = not read yet; null = unavailable
  let fallbackTokenMap = null;
  let fallbackTokenChecked = false;

  function getStateObject() {
    if (isTestMode() && hasInjected) return injected;
    if (initialStateCache !== undefined) return initialStateCache;
    initialStateCache = readInitialStateFromDocument(documentRef());
    return initialStateCache;
  }

  function clearInitialStateCache() {
    initialStateCache = undefined;
  }

  function clearFallbackTokenCache() {
    fallbackTokenMap = null;
    fallbackTokenChecked = false;
    clearInitialStateCache();
  }

  function extractTokenForNoteIdFromScriptText(noteId) {
    if (!noteId) return '';
    const doc = documentRef();
    if (!doc || !doc.querySelectorAll) return '';
    try {
      const scripts = doc.querySelectorAll('script:not([src])');
      const safeId = String(noteId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const near = new RegExp(
        '"noteId"\\s*:\\s*"' + safeId + '"[\\s\\S]{0,240}?"xsecToken"\\s*:\\s*"([^"]+)"|' +
        '"xsecToken"\\s*:\\s*"([^"]+)"[\\s\\S]{0,240}?"noteId"\\s*:\\s*"' + safeId + '"|' +
        '"id"\\s*:\\s*"' + safeId + '"[\\s\\S]{0,400}?"xsecToken"\\s*:\\s*"([^"]+)"'
      );
      for (let i = 0; i < scripts.length; i += 1) {
        const content = scripts[i].textContent || '';
        if (content.indexOf(noteId) < 0) continue;
        if (content.indexOf('xsecToken') < 0 && content.indexOf('__INITIAL_STATE__') < 0) continue;
        const match = near.exec(content);
        if (match) return match[1] || match[2] || match[3] || '';
      }
    } catch (_) {}
    return '';
  }

  // Bulk warm-up only: seed the map once so per-note lookups stay O(1).
  function buildFallbackTokenMap() {
    const map = Object.create(null);
    const state = getStateObject();
    if (state) {
      const seen = typeof getRoot().WeakSet === 'function' ? new (getRoot().WeakSet)() : null;
      try {
        collectTokensFromStateObject(state, map, 0, seen);
      } catch (_) {}
    }
    return map;
  }

  function getFallbackTokenForNoteId(noteId) {
    if (!noteId) return '';
    if (!fallbackTokenMap) fallbackTokenMap = Object.create(null);
    // Include negative cache so missing tokens do not rescan the huge state tree on every click.
    if (Object.prototype.hasOwnProperty.call(fallbackTokenMap, noteId)) return fallbackTokenMap[noteId] || '';

    let token = '';
    const state = getStateObject();
    if (state) {
      const seen = typeof getRoot().WeakSet === 'function' ? new (getRoot().WeakSet)() : null;
      try {
        token = findTokenForNoteIdInState(state, noteId, 0, seen);
      } catch (_) {
        token = '';
      }
    }

    if (!token) token = extractTokenForNoteIdFromScriptText(noteId);

    if (!token && !fallbackTokenChecked) {
      fallbackTokenChecked = true;
      const bulk = buildFallbackTokenMap();
      const keys = Object.keys(bulk);
      for (let i = 0; i < keys.length; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(fallbackTokenMap, keys[i])) fallbackTokenMap[keys[i]] = bulk[keys[i]];
      }
      if (bulk[noteId]) token = bulk[noteId];
    }

    fallbackTokenMap[noteId] = token || '';
    return token || '';
  }

  return {
    getFallbackTokenForNoteId,
    clearFallbackTokenCache,
    clearInitialStateCache,
    getStateObject,
    setTestInitialState(value) {
      injected = value || null;
      hasInjected = value != null;
      clearFallbackTokenCache();
    }
  };
}

export function readInitialStateFromDocument(doc) {
  if (!doc || !doc.querySelectorAll) return null;
  try {
    const scripts = doc.querySelectorAll('script:not([src])');
    for (let i = 0; i < scripts.length; i += 1) {
      const text = scripts[i].textContent || '';
      if (text.indexOf('__INITIAL_STATE__') < 0) continue;
      const parsed = parseInitialStateFromScriptText(text);
      if (parsed) return parsed;
    }
  } catch (_) {}
  return null;
}
