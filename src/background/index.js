// Background service worker (MV3). Two jobs:
//  1. Proxy privileged cross-origin fetches for the content script and options
//     page (content libraries reject page-origin CORS; CDN bytes need host
//     permissions). Binary payloads travel base64-encoded.
//  2. Nothing else. No remote state, no analytics, no bookkeeping.
import { FETCH_MESSAGE, COLLECT_NOTE_VIA_TAB_MESSAGE, COLLECT_NOTE_MESSAGE } from '../lib/remote.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MiB cap for cover downloads/copies
// Static allow-list: read-only image fetches from the XHS CDN family. Anything
// else — including any other origin, non-GET methods, or non-CDN paths — goes
// through the optional-permission gate, which requires a user gesture on the
// options page for the specific origin. The two *.xiaohongshu.com image hosts
// are XHS-owned goods/note image CDNs (already covered by the manifest's
// host_permissions); ci.xiaohongshu.com serves the no-watermark originals.
const STATIC_EXACT_HOSTS = new Set(['ci.xiaohongshu.com', 'img.xiaohongshu.com', 'qimg.xiaohongshu.com']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function isStaticCdn(url, method) {
  if (!SAFE_METHODS.has(method)) return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (STATIC_EXACT_HOSTS.has(hostOf(url))) return true;
  // Any https host under xhscdn.com (the image CDN family), GET/HEAD only.
  return /^https:\/\/(?:[a-z0-9-]+\.)+xhscdn\.com(?::\d+)?(?:\/|$)/i.test(url) || /^https:\/\/xhscdn\.com(?::\d+)?(?:\/|$)/i.test(url);
}

function originPattern(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin + '/*';
  } catch (_) {
    return '';
  }
}

async function isAllowed(url, method) {
  if (isStaticCdn(url, method)) return true;
  const pattern = originPattern(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (_) {
    return false;
  }
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function contentLengthOf(response) {
  try {
    const header = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null;
    const size = Number(header);
    return Number.isFinite(size) && size >= 0 ? size : -1;
  } catch (_) {
    return -1;
  }
}

async function handleFetch(request, sender) {
  // Defence in depth: this extension has no externally_connectable, but never
  // serve another extension or a web page.
  const runtimeId = chrome.runtime && chrome.runtime.id;
  if (runtimeId && sender && sender.id && sender.id !== runtimeId) {
    return { ok: false, status: 0, error: 'forbidden' };
  }
  const url = String(request.url || '');
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 0, error: 'network' };
  }
  const method = String(request.method || 'GET').toUpperCase();
  if (!(await isAllowed(url, method))) {
    return { ok: false, status: 0, error: 'permission' };
  }
  const headers = request.headers && typeof request.headers === 'object' ? request.headers : {};
  const timeout = Number(request.timeout) > 0 ? Math.min(Number(request.timeout), 60000) : 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const fetchInit = {
      method,
      headers,
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal
    };
    if (typeof request.data === 'string') fetchInit.body = request.data;
    const response = await fetch(url, fetchInit);
    const declaredLength = contentLengthOf(response);
    if (declaredLength > MAX_BODY_BYTES) {
      return { ok: false, status: response.status, error: 'too-large' };
    }
    if (request.responseType === 'arraybuffer') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) {
        return { ok: false, status: response.status, error: 'too-large' };
      }
      return {
        ok: response.ok,
        status: response.status,
        base64: base64FromBuffer(buffer),
        contentType: response.headers.get('content-type') || '',
        error: response.ok ? '' : 'http'
      };
    }
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: text.slice(0, MAX_BODY_BYTES),
      error: response.ok ? '' : 'http'
    };
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.code === 20);
    return { ok: false, status: 0, error: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// Hidden-tab fallback for the batch downloader: when a direct SW fetch of a
// note page does not yield usable data (login redirect, bot wall, mark-up
// drift), open the note in a background tab where the content script parses
// its own DOM and answers by message. The tab is always removed afterwards.
// chrome.tabs.create/remove need no "tabs" permission; no tab.url is read.
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function handleCollectNoteViaTab(request) {
  const link = String((request && request.link) || '');
  if (!/^https:\/\/(?:[a-z0-9-]+\.)+xiaohongshu\.com\//i.test(link)) {
    return { ok: false, error: 'forbidden' };
  }
  const tabsApi = chrome.tabs;
  if (!tabsApi || typeof tabsApi.create !== 'function' || typeof tabsApi.sendMessage !== 'function') {
    return { ok: false, error: 'unavailable' };
  }
  let tab;
  try {
    tab = await tabsApi.create({ url: link, active: false });
  } catch (_) {
    return { ok: false, error: 'tab-create-failed' };
  }
  const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
  if (tabId == null) {
    try { if (tabsApi.remove) await tabsApi.remove(tab.id); } catch (_) {}
    return { ok: false, error: 'tab-create-failed' };
  }
  try {
    const deadline = Date.now() + 25000;
    let lastError = 'timeout';
    // Poll: the content script registers its onMessage handler at
    // document_idle, so early attempts reject with "receiving end does not
    // exist" until the note page is ready — or the network stack hangs.
    while (Date.now() < deadline) {
      try {
        const response = await tabsApi.sendMessage(tabId, { type: COLLECT_NOTE_MESSAGE });
        if (response && response.ok && response.note && Array.isArray(response.note.imageList)) {
          return { ok: true, note: response.note, source: 'tab' };
        }
        lastError = (response && response.error) || 'no-state';
        if (response && response.error === 'no-state') break;
        // A truthy non-ok response without a known error: retry once in case
        // the hydration is still warming up, then give up.
        await sleep(700);
      } catch (_) {
        lastError = 'unreachable';
        await sleep(400);
      }
    }
    return { ok: false, error: lastError };
  } finally {
    try { await tabsApi.remove(tabId); } catch (_) {}
  }
}

// Left-click on the toolbar icon opens the options page. The action declares
// no default_popup, so chrome.action.onClicked fires instead. openOptionsPage
// is the standard MV3 path; tabs.create(options.html) is a defensive fallback
// on browsers where it is missing (no "tabs" permission is required either way).
function openOptionsPageFromBackground() {
  try {
    const runtime = chrome.runtime;
    if (runtime && typeof runtime.openOptionsPage === 'function') {
      runtime.openOptionsPage();
      return;
    }
  } catch (_) {
    // fall through to the tab fallback
  }
  try {
    if (chrome.tabs && typeof chrome.tabs.create === 'function' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    }
  } catch (_) {
    // last resort: nothing actionable left
  }
}

try {
  const action = chrome.action;
  if (action && action.onClicked && typeof action.onClicked.addListener === 'function') {
    action.onClicked.addListener(() => openOptionsPageFromBackground());
  }
} catch (_) {
  // non-Chrome family / test environments without the action API
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;
  if (message.type === FETCH_MESSAGE) {
    handleFetch(message, sender || {}).then(sendResponse, () => sendResponse({ ok: false, status: 0, error: 'network' }));
    return true; // async response
  }
  if (message.type === COLLECT_NOTE_VIA_TAB_MESSAGE) {
    // Same sender guard as the fetch path: this extension only, never other
    // extensions or web pages.
    const runtimeId = chrome.runtime && chrome.runtime.id;
    if (runtimeId && sender && sender.id && sender.id !== runtimeId) {
      sendResponse({ ok: false, error: 'forbidden' });
      return false;
    }
    handleCollectNoteViaTab(message).then(sendResponse, () => sendResponse({ ok: false, error: 'network' }));
    return true; // async response
  }
  return undefined;
});
