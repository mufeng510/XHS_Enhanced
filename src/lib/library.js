// Content-library (XHS_ALL_IN_ONE) API client. Shared by the content script
// (save buttons) and the extension options page (test connection / account
// picker). All requests travel through the background service worker because
// the deployed backend's CORS allow-list rejects page-origin requests.
import { fetchJson } from './remote.js';
import { readLibraryConfig, writeSecret, readRefreshToken, LIBRARY_REFRESH_KEY } from './settings.js';
import { parseTokenExp, buildCrawlPayload } from './pure.js';
import { normalizeSpace } from './text.js';

export const LIBRARY_CRAWL_PATH = '/api/xhs/crawl/note-urls';
export const LIBRARY_BATCH_LIMIT = 50;

// Access token kept in memory only; refresh token persists in chrome.storage.
const libraryTokenMemory = { accessToken: '', refreshToken: '', exp: 0 };

export function storeLibraryAccessToken(token) {
  libraryTokenMemory.accessToken = String(token || '');
  libraryTokenMemory.exp = parseTokenExp(libraryTokenMemory.accessToken);
}

export function clearLibraryTokens() {
  libraryTokenMemory.accessToken = '';
  libraryTokenMemory.refreshToken = '';
  libraryTokenMemory.exp = 0;
  writeSecret(LIBRARY_REFRESH_KEY, '');
}

export function libraryLogin(cfg) {
  return fetchJson({
    method: 'POST',
    url: cfg.baseUrl + '/api/auth/login',
    data: { username: cfg.username, password: cfg.password }
  }).then(res => {
    if (!res.ok || !res.json || !res.json.access_token) return false;
    storeLibraryAccessToken(res.json.access_token);
    if (res.json.refresh_token) {
      libraryTokenMemory.refreshToken = String(res.json.refresh_token);
      writeSecret(LIBRARY_REFRESH_KEY, libraryTokenMemory.refreshToken);
    }
    return true;
  });
}

export function libraryRefresh(cfg) {
  const refresh = libraryTokenMemory.refreshToken || readRefreshToken();
  if (!refresh) return Promise.resolve(false);
  return fetchJson({
    method: 'POST',
    url: cfg.baseUrl + '/api/auth/refresh',
    data: { refresh_token: refresh }
  }).then(res => {
    if (!res.ok || !res.json || !res.json.access_token) return false;
    storeLibraryAccessToken(res.json.access_token);
    return true;
  });
}

export function ensureLibraryToken(forceRenew) {
  const cfg = readLibraryConfig();
  if (!cfg.baseUrl || !cfg.username || !cfg.password) return Promise.resolve({ ok: false, error: 'config-missing' });
  const now = Math.floor(Date.now() / 1000);
  if (!forceRenew && libraryTokenMemory.accessToken && libraryTokenMemory.exp - 30 > now) {
    return Promise.resolve({ ok: true, token: libraryTokenMemory.accessToken });
  }
  return libraryRefresh(cfg)
    .then(refreshed => (refreshed ? true : libraryLogin(cfg)))
    .then(logged => (logged
      ? { ok: true, token: libraryTokenMemory.accessToken }
      : { ok: false, error: 'auth-failed' }));
}

export function checkLibraryHealth(baseUrl) {
  return fetchJson({ method: 'GET', url: baseUrl + '/api/health', timeout: 8000 });
}

export function fetchLibraryPcAccounts(token, baseUrl) {
  return fetchJson({
    method: 'GET',
    url: baseUrl + '/api/accounts?platform=xhs&page_size=100',
    headers: { Authorization: 'Bearer ' + token }
  }).then(res => {
    if (!res.ok || !res.json || !Array.isArray(res.json.items)) {
      return { ok: false, accounts: [], error: res.error || 'bad-response' };
    }
    const accounts = [];
    for (const item of res.json.items) {
      if (item && item.platform === 'xhs' && item.sub_type === 'pc' && Number(item.id) > 0) {
        accounts.push({ id: Number(item.id), nickname: String(item.nickname || ''), status: String(item.status || '') });
      }
    }
    return { ok: true, accounts, error: '' };
  });
}

export function postCrawlNoteUrls(token, cfg, urls) {
  return fetchJson({
    method: 'POST',
    url: cfg.baseUrl + LIBRARY_CRAWL_PATH,
    headers: { Authorization: 'Bearer ' + token },
    data: buildCrawlPayload(cfg.accountId, urls)
  });
}

export function saveNoteUrlsToLibrary(urls) {
  const cfg = readLibraryConfig();
  if (!cfg.baseUrl || !cfg.username || !cfg.password) {
    return Promise.resolve({ ok: false, status: 0, json: null, error: 'config-missing' });
  }
  if (!cfg.accountId) return Promise.resolve({ ok: false, status: 0, json: null, error: 'account-missing' });
  return ensureLibraryToken().then(auth => {
    if (!auth.ok) return { ok: false, status: 0, json: null, error: auth.error };
    return postCrawlNoteUrls(auth.token, cfg, urls).then(res => {
      if (res.status !== 401) return res;
      return ensureLibraryToken(true).then(renewed => {
        if (!renewed.ok) return { ok: false, status: 0, json: null, error: renewed.error };
        return postCrawlNoteUrls(renewed.token, cfg, urls);
      });
    });
  });
}

// Human-readable account label shared by content + options.
export function libraryAccountOptionLabel(account) {
  const nickname = normalizeSpace(account.nickname);
  const status = account.status && account.status !== 'ok' ? '（' + account.status + '）' : '';
  return '#' + account.id + (nickname ? ' ' + nickname : '') + status;
}
