// Privileged network channel. Page-side fetch() to the content-library server is
// blocked by that server's CORS allow-list, and cross-origin image bytes from
// catchable origins need elevated privileges — so all such requests go through
// the extension's background service worker, which holds host permissions.
// Binary responses come back base64 (structured clone cannot carry ArrayBuffer
// from the worker reliably across all Chromium versions).
import { getChrome } from './env.js';
import { normalizeSpace } from './text.js';

export const FETCH_MESSAGE = 'xhs-enhanced:fetch';
export const COLLECT_NOTE_VIA_TAB_MESSAGE = 'xhs-enhanced:collect-note-via-tab';
// SW -> hidden tab: parse your own inline __INITIAL_STATE__ and reply.
export const COLLECT_NOTE_MESSAGE = 'xhs-enhanced:collect-note';

async function sendToBackground(request) {
  const chrome = getChrome();
  if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return null; // No privileged channel (plain page / unit tests without a mock).
  }
  try {
    const response = await chrome.runtime.sendMessage(Object.assign({ type: FETCH_MESSAGE }, request));
    if (response && typeof response === 'object') return response;
    return { ok: false, status: 0, error: 'network' };
  } catch (_) {
    return { ok: false, status: 0, error: 'network' };
  }
}

function base64ToBytes(base64) {
  if (typeof globalThis.atob !== 'function') return null;
  let binary;
  try {
    binary = globalThis.atob(base64);
  } catch (_) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

export function hasPrivilegedChannel() {
  const chrome = getChrome();
  return Boolean(chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');
}

// Low-level: fetch arbitrary bytes. Resolves to { ok, status, bytes, contentType }
// or null when no privileged channel exists / the request failed at the
// transport layer. `error` mirrors the background worker's machine code:
// 'network' | 'timeout' | 'permission' | 'http'.
export async function fetchBytes(url, options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 20000;
  const response = await sendToBackground({
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    data: options.data,
    timeout,
    responseType: 'arraybuffer'
  });
  if (!response) return null;
  if (!response.ok) {
    return { ok: false, status: Number(response.status) || 0, bytes: null, error: response.error || 'network' };
  }
  const bytes = typeof response.base64 === 'string' ? base64ToBytes(response.base64) : null;
  if (!bytes) return { ok: false, status: Number(response.status) || 0, bytes: null, error: 'decode' };
  return { ok: true, status: Number(response.status) || 0, bytes, contentType: response.contentType || '' };
}

// HTML/text channel (note detail pages for the batch downloader). Mirrors
// fetchBytes but returns the response body as a string; the background caps
// bodies at MAX_BODY_BYTES regardless of the payload type.
export async function fetchText(url, options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 30000;
  const response = await sendToBackground({
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    data: options.data,
    timeout,
    responseType: 'text'
  });
  if (!response) return { ok: false, status: 0, text: '', error: 'network' };
  if (!response.ok) {
    return { ok: false, status: Number(response.status) || 0, text: '', error: response.error || 'network' };
  }
  return {
    ok: true,
    status: Number(response.status) || 200,
    text: typeof response.text === 'string' ? response.text : '',
    contentType: response.contentType || ''
  };
}

// JSON API channel for the content library. Resolves to
// { ok, status, json, error } — error is a human-readable snippet on HTTP or
// parse failures, or a machine code ('network', 'timeout', 'permission',
// 'unreachable') when the request never produced a JSON body.
// Accepts either fetchJson(url, options) or fetchJson(options-object).
export async function fetchJson(urlOrOptions, maybeOptions) {
  const options = typeof urlOrOptions === 'string' ? { ...(maybeOptions || {}), url: urlOrOptions } : (urlOrOptions || {});
  const url = options.url;
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 20000;
  const method = options.method || 'GET';
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  let data;
  if (options.data !== undefined) {
    data = JSON.stringify(options.data);
    headers['Content-Type'] = 'application/json';
  }
  const response = await sendToBackground({ url, method, headers, data, timeout, responseType: 'text' });
  if (!response) return { ok: false, status: 0, json: null, error: 'unreachable' };
  let json = null;
  try {
    json = response.text ? JSON.parse(response.text) : null;
  } catch (_) {}
  const status = Number(response.status) || 0;
  let error = '';
  if (!json) {
    error = response.error ? String(response.error) : (response.text ? normalizeSpace(response.text).slice(0, 200) : '');
  } else if (json.detail) {
    error = typeof json.detail === 'string' ? json.detail : normalizeSpace(JSON.stringify(json.detail));
  }
  if (!response.ok && !error) error = response.error || 'http';
  return { ok: Boolean(response.ok) && status >= 200 && status < 300, status, json, error };
}
