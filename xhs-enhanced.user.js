// ==UserScript==
// @name         小红书网页版增强
// @namespace    https://github.com/mufeng510/XHS_Enhanced
// @version      1.6.0
// @description  可配置热门阈值，高亮点赞数超过该阈值的笔记并支持上/下一条热门笔记快速跳转；"只显示热门"开关模糊虚化非热门笔记（保留占位）；笔记卡片支持复制链接（explore 格式含 xsec_token）与无水印封面；一键把笔记链接发送到自建 XHS_ALL_IN_ONE 内容库保存
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.xiaohongshu.com/user/profile/*
// @match        https://www.xiaohongshu.com/explore*
// @match        https://www.xiaohongshu.com/discovery/item/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      xhscdn.com
// @connect      *.xhscdn.com
// @connect      sns-webpic-qc.xhscdn.com
// @connect      sns-img-qc.xhscdn.com
// @connect      sns-avatar-qc.xhscdn.com
// @connect      xiaohongshu.com
// @connect      *.xiaohongshu.com
// @connect      ci.xiaohongshu.com
// @connect      *
// @run-at       document-idle
// @homepageURL  https://github.com/mufeng510/XHS_Enhanced
// @supportURL   https://github.com/mufeng510/XHS_Enhanced/issues
// @updateURL    https://github.com/mufeng510/XHS_Enhanced/raw/master/xhs-enhanced.user.js
// @downloadURL  https://github.com/mufeng510/XHS_Enhanced/raw/master/xhs-enhanced.user.js
// @license      MIT
// @author       mufeng510
// ==/UserScript==

(function () {
  'use strict';

  const ROOT = globalThis;
  // Tampermonkey sandboxes scripts that use @grant; page globals like __INITIAL_STATE__ live on unsafeWindow.
  const PAGE = (function resolvePageWindow() {
    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.document) return unsafeWindow; } catch (_) {}
    return ROOT;
  }());
  const TEST_MODE = ROOT.__XHS_ENHANCED_TEST_MODE__ === true || PAGE.__XHS_ENHANCED_TEST_MODE__ === true;
  const DEFAULT_THRESHOLD = 100;
  const THRESHOLD_STORAGE_KEY = 'xhs-enhanced:popular-threshold';
  const STYLE_ID = 'xhs-enhanced-style';
  const CARD_CLASS = 'xhs-enhanced-card--popular';
  const LIKE_CLASS = 'xhs-enhanced-like--popular';
  const SIGNATURE_ATTRIBUTE = 'data-xhs-enhanced-signature';
  const JUMP_NAV_ID = 'xhs-enhanced-jump-nav';
  const JUMP_BUTTON_ID = 'xhs-enhanced-jump-next';
  const JUMP_PREV_BUTTON_ID = 'xhs-enhanced-jump-prev';
  const JUMP_STATUS_ID = 'xhs-enhanced-jump-status';
  const THRESHOLD_CONTROL_ID = 'xhs-enhanced-threshold-control';
  const THRESHOLD_INPUT_ID = 'xhs-enhanced-threshold-input';
  const THRESHOLD_STATUS_ID = 'xhs-enhanced-threshold-status';
  const JUMP_BUTTON_TEXT = '下一条热门笔记';
  const JUMP_PREV_BUTTON_TEXT = '上一条热门笔记';
  const LAST_NOTE_TEXT = '已经是最后一条热门笔记';
  const FIRST_NOTE_TEXT = '已经是第一条热门笔记';
  const FOCUS_TOGGLE_ID = 'xhs-enhanced-focus-toggle';
  const FOCUS_TOGGLE_TEXT = '只显示热门';
  const FOCUS_STORAGE_KEY = 'xhs-enhanced:focus-popular';
  const DIMMED_CLASS = 'xhs-enhanced-card--dimmed';
  const CARD_ACTIONS_CLASS = 'xhs-enhanced-card-actions';
  const COPY_LINK_CLASS = 'xhs-enhanced-copy-link';
  const COPY_COVER_CLASS = 'xhs-enhanced-copy-cover';
  const CARD_ACTIONS_ATTRIBUTE = 'data-xhs-enhanced-actions';
  const COPY_LINK_TEXT = '复制链接';
  const COPY_COVER_TEXT = '复制封面';
  const COPY_LINK_OK = '已复制笔记链接';
  const COPY_LINK_FAIL = '链接复制失败';
  const COPY_COVER_OK = '已复制笔记封面';
  const COPY_COVER_FAIL = '封面复制失败';
  const COPY_COVER_AUTH_FAIL = '封面复制失败（需油猴授权）';
  const COVER_IMAGE_SELECTORS = 'img.cover,img[src*="sns-img"],img[src*="xhscdn"],picture img,article img,section.note-item img,.note-item img';
  const COPY_STATUS_ID = 'xhs-enhanced-copy-status';
  const SHARE_BASE = 'https://www.xiaohongshu.com/';
  const XSEC_TOKEN_QUERY = 'xsec_token';
  const XSEC_SOURCE_VALUE = 'pc_feed';
  const LIBRARY_BASE_URL_KEY = 'xhs-enhanced:library-base-url';
  const LIBRARY_USERNAME_KEY = 'xhs-enhanced:library-username';
  const LIBRARY_ACCOUNT_ID_KEY = 'xhs-enhanced:library-account-id';
  const LIBRARY_PASSWORD_KEY = 'xhs-enhanced:library-password';
  const LIBRARY_REFRESH_KEY = 'xhs-enhanced:library-refresh-token';
  const LIBRARY_CRAWL_PATH = '/api/xhs/crawl/note-urls';
  const LIBRARY_BATCH_LIMIT = 50;
  const DETAIL_ROUTE_PATTERN = /^\/(?:explore|discovery\/item|search_result)\/[A-Za-z0-9]+$|^\/user\/profile\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;
  const SAVE_LIBRARY_CLASS = 'xhs-enhanced-save-library';
  const SAVE_LIBRARY_TEXT = '保存入库';
  const SAVE_LIBRARY_DONE_TEXT = '已入库';
  const LIBRARY_PAGE_BUTTON_ID = 'xhs-enhanced-library-page';
  const LIBRARY_PAGE_BUTTON_TEXT = '保存到内容库';
  const LIBRARY_BATCH_BUTTON_ID = 'xhs-enhanced-library-batch';
  const LIBRARY_BATCH_BUTTON_TEXT = '本页全部入库';
  const LIBRARY_BATCH_EMPTY_TEXT = '本页没有可入库的笔记链接';
  const LIBRARY_TOGGLE_ID = 'xhs-enhanced-library-toggle';
  const LIBRARY_TOGGLE_TEXT = '内容库设置';
  const LIBRARY_PANEL_ID = 'xhs-enhanced-library-panel';
  const LIBRARY_STATUS_ID = 'xhs-enhanced-library-status';
  const LIBRARY_BASE_INPUT_ID = 'xhs-enhanced-library-base-input';
  const LIBRARY_USER_INPUT_ID = 'xhs-enhanced-library-user-input';
  const LIBRARY_PASSWORD_INPUT_ID = 'xhs-enhanced-library-password-input';
  const LIBRARY_ACCOUNT_SELECT_ID = 'xhs-enhanced-library-account-select';
  const LIBRARY_SAVE_SETTINGS_TEXT = '保存设置';
  const LIBRARY_TEST_TEXT = '测试连接';
  const LIBRARY_SAVED_OK = '已保存到内容库';
  const LIBRARY_SAVE_FAIL = '内容库保存失败';
  const LIBRARY_NO_TOKEN = '未获取到 xsec_token，无法采集';
  const LIBRARY_NO_CONFIG = '请先配置内容库（右下角“内容库设置”）';
  const LIBRARY_NO_ACCOUNT = '内容库未发现可用的小红书 PC 端账号';
  const LIBRARY_AUTH_FAIL = '内容库登录失败，请检查用户名与密码';
  const LIBRARY_CONNECT_FAIL = '无法连接内容库服务';
  const LIBRARY_GM_MISSING = '需油猴授权（GM_xmlhttpRequest）';
  const NOTE_ID_PATTERN = /\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9]+)/;
  // Real __INITIAL_STATE__ uses camelCase xsecToken; noteCard often has noteId next to xsecToken.
  const NOTE_ID_THEN_TOKEN_PATTERN = /"noteId"\s*:\s*"([0-9a-fA-F]+)"\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
  const TOKEN_THEN_NOTE_ID_PATTERN = /"xsecToken"\s*:\s*"([^"]+)"(?:(?!"xsecToken"\s*:)[\s\S]){0,1200}?"noteId"\s*:\s*"([0-9a-fA-F]+)"/g;
  const OUTER_ENTRY_TOKEN_PATTERN = /"id"\s*:\s*"([0-9a-fA-F]+)"(?:(?!"id"\s*:\s*")[\s\S]){0,4000}?"ssrRendered"\s*:\s*(?:true|false)\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
  const STATE_NOTES_PATTERN = /"notes"\s*:\s*\[/;

  const SELECTORS = Object.freeze({
    noteLinks: 'a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]',
    cardContainers: '[data-note-card],article.note-item,section.note-item,.note-item',
    likeNodes: '[data-like-count],[data-xhs-like-count],[aria-label*="点赞"],[title*="点赞"],.like-wrapper .count,.like-count',
    contentRoots: '[data-note-list],.feeds-page,.note-list,main'
  });
  const READ_ATTRIBUTES = Object.freeze([
    'aria-label', 'title', 'data-like-count', 'data-xhs-like-count'
  ]);

  let routeProvider = null;
  let observer = null;
  let structureObserver = null;
  let observerRoot = null;
  let scheduled = false;
  let destroyed = true;
  let initialized = false;
  let lifecycleToken = null;
  let lastUrl = '';
  let jumpNav = null;
  let jumpButton = null;
  let jumpPrevButton = null;
  let jumpStatus = null;
  let thresholdControl = null;
  let thresholdInput = null;
  let thresholdStatus = null;
  let threshold = DEFAULT_THRESHOLD;
  let jumpStatusTimer = null;
  let focusPopular = false;
  let focusToggle = null;
  let copyStatus = null;
  let copyStatusTimer = null;
  const coverBlobCache = new Map();
  const COVER_CACHE_LIMIT = 80;
  let copyCoverInFlight = false;
  let saveInFlight = false;
  let libraryToggle = null;
  let libraryPanel = null;
  let libraryPanelOpen = false;
  let libraryPageButton = null;
  let libraryBatchButton = null;
  const libraryTokenMemory = { accessToken: '', refreshToken: '', exp: 0 };
  let fallbackTokenMap = null;
  let fallbackTokenChecked = false;
  let originalPushState = null;
  let originalReplaceState = null;
  let ownedPushState = null;
  let ownedReplaceState = null;
  const pending = new Set();
  const counters = { batches: 0, processed: 0, fullScans: 0, routeSignals: 0 };
  const eventBindings = [];

  function normalizeSpace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function parseThreshold(value) {
    const text = String(value == null ? '' : value);
    if (!/^(?:0|[1-9]\d*)$/.test(text)) return { ok: false };
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false };
  }

  function readStoredThreshold(storage = getStorage()) {
    if (!storage) return DEFAULT_THRESHOLD;
    try {
      const parsed = parseThreshold(storage.getItem(THRESHOLD_STORAGE_KEY));
      return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
    } catch (_) {
      return DEFAULT_THRESHOLD;
    }
  }

  function getStorage() {
    try {
      return ROOT.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function setThreshold(value, storage = getStorage()) {
    const parsed = parseThreshold(value);
    if (!parsed.ok) return { ok: false, value: threshold, persisted: false };
    threshold = parsed.value;
    let persisted = false;
    if (storage) {
      try {
        storage.setItem(THRESHOLD_STORAGE_KEY, String(threshold));
        persisted = true;
      } catch (_) {
        // A valid setting still applies for this page when browser storage is unavailable.
      }
    }
    return { ok: true, value: threshold, persisted };
  }

  function readStoredFocusPopular(storage = getStorage()) {
    if (!storage) return false;
    try {
      return storage.getItem(FOCUS_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setFocusPopular(value, storage = getStorage()) {
    focusPopular = Boolean(value);
    let persisted = false;
    if (storage) {
      try {
        storage.setItem(FOCUS_STORAGE_KEY, focusPopular ? '1' : '0');
        persisted = true;
      } catch (_) {
        // The toggle still applies for this page when browser storage is unavailable.
      }
    }
    return persisted;
  }

  function applyFocusToggleState() {
    if (focusToggle) focusToggle.setAttribute('aria-pressed', focusPopular ? 'true' : 'false');
  }

  function onFocusToggleClick() {
    const persisted = setFocusPopular(!focusPopular);
    applyFocusToggleState();
    showCopyStatus(focusPopular
      ? (persisted ? '已开启：只显示热门笔记' : '已开启：只显示热门笔记（设置未能保存）')
      : '已关闭：显示全部笔记');
    scan(ROOT.document);
  }

  function getSecretStorage() {
    // GM_*Value storage lives outside the page-reachable localStorage, so secrets
    // (content-library password / refresh token) must not fall back to the page
    // while a script-manager store exists.
    try {
      if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
        return { get: key => GM_getValue(key, ''), set: (key, value) => GM_setValue(key, String(value)) };
      }
    } catch (_) {}
    try {
      if (ROOT.GM_getValue && ROOT.GM_setValue) {
        return { get: key => ROOT.GM_getValue(key, ''), set: (key, value) => ROOT.GM_setValue(key, String(value)) };
      }
    } catch (_) {}
    return null;
  }

  function readSecret(key) {
    const secretStorage = getSecretStorage();
    if (secretStorage) {
      try { return String(secretStorage.get(key) || ''); } catch (_) { return ''; }
    }
    const storage = getStorage();
    if (!storage) return '';
    try { return String(storage.getItem(key) || ''); } catch (_) { return ''; }
  }

  function writeSecret(key, value) {
    const text = String(value == null ? '' : value);
    const secretStorage = getSecretStorage();
    if (secretStorage) {
      try { secretStorage.set(key, text); return true; } catch (_) {}
    }
    const storage = getStorage();
    if (!storage) return false;
    try { storage.setItem(key, text); return true; } catch (_) { return false; }
  }

  function parseBaseUrl(value) {
    const text = normalizeSpace(value).replace(/\/+$/, '');
    if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: '' };
    return { ok: true, value: text };
  }

  function readLibraryConfig(storage = getStorage()) {
    let baseUrl = '';
    let username = '';
    let accountId = 0;
    try { baseUrl = String((storage && storage.getItem(LIBRARY_BASE_URL_KEY)) || ''); } catch (_) {}
    try { username = String((storage && storage.getItem(LIBRARY_USERNAME_KEY)) || '').trim(); } catch (_) {}
    try { accountId = Number((storage && storage.getItem(LIBRARY_ACCOUNT_ID_KEY)) || 0) || 0; } catch (_) {}
    const parsedBase = parseBaseUrl(baseUrl);
    return {
      baseUrl: parsedBase.ok ? parsedBase.value : '',
      username,
      accountId: Number.isSafeInteger(accountId) && accountId > 0 ? accountId : 0,
      password: readSecret(LIBRARY_PASSWORD_KEY)
    };
  }

  function parseTokenExp(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !parts[1] || typeof ROOT.atob !== 'function') return 0;
    try {
      let payload = String(parts[1]).replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4 !== 0) payload += '=';
      const match = ROOT.atob(payload).match(/"exp"\s*:\s*(\d+)/);
      return match ? Number(match[1]) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }

  function buildCrawlPayload(accountId, urls) {
    const list = (Array.isArray(urls) ? urls : []).filter(url => typeof url === 'string' && url);
    return { account_id: Number(accountId) || 0, urls: list, save_to_library: true, fetch_comments: false };
  }

  function parseLikeCount(input) {
    const original = normalizeSpace(input);
    if (!original) return { ok: false, reason: 'empty' };
    const groupedInteger = /^(?:\d+|\d{1,3}(?:[ ,，]\d{3})+)$/.test(original);
    const suffixedNumber = /^\d+(?:\.\d+)?[万萬wWkK]$/.test(original);
    if (!groupedInteger && !suffixedNumber) return { ok: false, reason: 'unsupported' };
    const compact = original.replace(/[\s,，]/g, '');
    const match = compact.match(/^(\d+(?:\.\d+)?)([万萬wWkK]?)$/);
    if (!match) return { ok: false, reason: 'unsupported' };
    const number = Number(match[1]);
    const multiplier = /[万萬]/.test(match[2]) ? 10000 : /[wW]/.test(match[2]) ? 10000 : /[kK]/.test(match[2]) ? 1000 : 1;
    const value = number * multiplier;
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: 'invalid' };
    return { ok: true, value, normalized: compact.toLowerCase() };
  }

  function isTargetRoute(pathname) {
    // Home feed (/explore), search result list and user profile pages carry note
    // cards; /explore/<id> etc. are note detail views and are excluded by the
    // exact match.
    const path = String(pathname || '').split('?')[0].replace(/\/+$/, '');
    return path === '/search_result' || path === '/explore' || path.startsWith('/user/profile/');
  }

  function isProfileRoute(pathname) {
    const path = String(pathname || '').split('?')[0];
    return path.startsWith('/user/profile/');
  }

  function isDetailRoute(pathname) {
    const path = String(pathname || '').split('?')[0];
    return DETAIL_ROUTE_PATTERN.test(path);
  }

  function getNoteIdFromHref(href) {
    const text = String(href == null ? '' : href);
    if (!text) return '';
    const match = text.match(NOTE_ID_PATTERN);
    return match ? match[1] : '';
  }

  function parseQueryValue(query, key) {
    if (!query || !key) return '';
    const text = String(query);
    const match = text.match(new RegExp('[?&]' + key + '=([^&\\s#]+)'));
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
  }

  function getXsecTokenFromHref(href) {
    const text = String(href == null ? '' : href);
    return parseQueryValue(text, XSEC_TOKEN_QUERY);
  }


  function collectTokensFromStateObject(value, map, depth, seen) {
    if (!value || depth > 12) return;
    if (typeof value !== 'object') return;
    if (seen) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) collectTokensFromStateObject(value[i], map, depth + 1, seen);
      return;
    }
    const id = typeof value.noteId === 'string' ? value.noteId
      : typeof value.id === 'string' ? value.id
        : '';
    const token = typeof value.xsecToken === 'string' ? value.xsecToken : '';
    if (id && token && !map[id]) map[id] = token;
    const keys = Object.keys(value);
    const preferred = [];
    const rest = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === 'notes' || key === 'note' || key === 'noteCard' || key === 'noteDetailMap' || key === 'user' || key === 'feed') preferred.push(key);
      else rest.push(key);
    }
    const ordered = preferred.length ? preferred.concat(rest) : keys;
    for (let i = 0; i < ordered.length; i += 1) collectTokensFromStateObject(value[ordered[i]], map, depth + 1, seen);
  }

  function findTokenForNoteIdInState(value, noteId, depth, seen) {
    if (!value || !noteId || depth > 12) return '';
    if (typeof value !== 'object') return '';
    if (seen) {
      if (seen.has(value)) return '';
      seen.add(value);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = findTokenForNoteIdInState(value[i], noteId, depth + 1, seen);
        if (found) return found;
      }
      return '';
    }
    const id = typeof value.noteId === 'string' ? value.noteId
      : typeof value.id === 'string' ? value.id
        : '';
    const token = typeof value.xsecToken === 'string' ? value.xsecToken : '';
    if (id === noteId && token) return token;
    const keys = Object.keys(value);
    const preferred = [];
    const rest = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === 'notes' || key === 'note' || key === 'noteCard' || key === 'noteDetailMap' || key === 'user' || key === 'feed' || key === noteId) preferred.push(key);
      else rest.push(key);
    }
    const ordered = preferred.length ? preferred.concat(rest) : keys;
    for (let i = 0; i < ordered.length; i += 1) {
      const found = findTokenForNoteIdInState(value[ordered[i]], noteId, depth + 1, seen);
      if (found) return found;
    }
    return '';
  }

  function extractTokensFromState(content) {
    const map = Object.create(null);
    const text = String(content == null ? '' : content);
    if (!text) return map;
    let match;
    NOTE_ID_THEN_TOKEN_PATTERN.lastIndex = 0;
    while ((match = NOTE_ID_THEN_TOKEN_PATTERN.exec(text)) !== null) {
      if (match[1] && match[2] && !map[match[1]]) map[match[1]] = match[2];
    }
    TOKEN_THEN_NOTE_ID_PATTERN.lastIndex = 0;
    while ((match = TOKEN_THEN_NOTE_ID_PATTERN.exec(text)) !== null) {
      if (match[2] && match[1] && !map[match[2]]) map[match[2]] = match[1];
    }
    OUTER_ENTRY_TOKEN_PATTERN.lastIndex = 0;
    while ((match = OUTER_ENTRY_TOKEN_PATTERN.exec(text)) !== null) {
      if (match[1] && match[2] && !map[match[1]]) map[match[1]] = match[2];
    }
    return map;
  }

  function extractTokenForNoteIdFromScriptText(noteId) {
    if (!noteId) return '';
    const doc = ROOT.document;
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

  function buildFallbackTokenMap() {
    const map = Object.create(null);
    try {
      const initialState = (PAGE && PAGE.__INITIAL_STATE__) || ROOT.__INITIAL_STATE__;
      if (initialState) {
        const seen = typeof ROOT.WeakSet === 'function' ? new ROOT.WeakSet() : null;
        collectTokensFromStateObject(initialState, map, 0, seen);
      }
    } catch (_) {}
    return map;
  }

  function clearFallbackTokenCache() {
    fallbackTokenMap = null;
    fallbackTokenChecked = false;
  }

  function getFallbackTokenForNoteId(noteId) {
    if (!noteId) return '';
    if (!fallbackTokenMap) fallbackTokenMap = Object.create(null);
    // Include negative cache so missing tokens do not rescan the huge state tree on every click.
    if (Object.prototype.hasOwnProperty.call(fallbackTokenMap, noteId)) return fallbackTokenMap[noteId] || '';

    let token = '';
    try {
      const initialState = (PAGE && PAGE.__INITIAL_STATE__) || ROOT.__INITIAL_STATE__;
      if (initialState) {
        const seen = typeof ROOT.WeakSet === 'function' ? new ROOT.WeakSet() : null;
        token = findTokenForNoteIdInState(initialState, noteId, 0, seen);
      }
    } catch (_) {}

    if (!token) token = extractTokenForNoteIdFromScriptText(noteId);

    // One-time bulk warm-up only. Never rebuild on every miss (that froze copy-link).
    if (!token && !fallbackTokenChecked) {
      fallbackTokenChecked = true;
      try {
        const bulk = buildFallbackTokenMap();
        const keys = Object.keys(bulk);
        for (let i = 0; i < keys.length; i += 1) {
          if (!Object.prototype.hasOwnProperty.call(fallbackTokenMap, keys[i])) fallbackTokenMap[keys[i]] = bulk[keys[i]];
        }
        if (bulk[noteId]) token = bulk[noteId];
      } catch (_) {}
    }

    fallbackTokenMap[noteId] = token || '';
    return token || '';
  }

  function buildShareLink(id, token) {
    if (!id) return '';
    const link = SHARE_BASE + 'explore/' + id;
    if (token) return link + '?' + XSEC_TOKEN_QUERY + '=' + encodeURIComponent(token) + '&xsec_source=' + XSEC_SOURCE_VALUE;
    return link;
  }

  function extractNoteLink(card) {
    if (!card || !card.querySelector) return '';
    const link = card.querySelector(SELECTORS.noteLinks);
    if (!link) return '';
    const href = link.getAttribute('href') || link.getAttribute('xhs:href') || '';
    const id = getNoteIdFromHref(href);
    if (!id) return '';
    let token = getXsecTokenFromHref(href);
    if (!token) token = getFallbackTokenForNoteId(id);
    return buildShareLink(id, token);
  }

  function toNoWatermarkCoverUrl(input) {
    const raw = normalizeSpace(input);
    if (!raw) return '';
    if (/^(?:data:|blob:)/i.test(raw)) return raw;
    try {
      const base = (PAGE.location && PAGE.location.href) || (ROOT.location && ROOT.location.href) || 'https://www.xiaohongshu.com/';
      const url = new URL(raw, base);
      // XHS processed variants put watermark/size transforms after '!' in the path.
      url.pathname = url.pathname.replace(/!.*$/, '');
      // imageView2-style process queries are often key-only path fragments; clear them aggressively.
      if (/imageview2|x-oss-process|watermark/i.test(url.search)) {
        url.search = '';
      } else {
        const dropKeys = [];
        url.searchParams.forEach((value, key) => {
          const k = String(key).toLowerCase();
          const v = String(value).toLowerCase();
          if (k.indexOf('imageview') >= 0 || v.indexOf('imageview') >= 0) dropKeys.push(key);
          if (k === 'x-oss-process' || k.indexOf('watermark') >= 0) dropKeys.push(key);
        });
        for (const key of dropKeys) url.searchParams.delete(key);
      }
      return url.toString();
    } catch (_) {
      return raw.replace(/![^/?#]*/g, '').replace(/[?&](?:imageView2|x-oss-process|watermark)[^#]*/ig, '');
    }
  }

  function pickLargestFromSrcset(srcset) {
    const text = normalizeSpace(srcset);
    if (!text) return '';
    let bestUrl = '';
    let bestScore = -1;
    for (const part of text.split(',')) {
      const bits = normalizeSpace(part).split(/\s+/);
      if (!bits.length || !bits[0]) continue;
      const url = bits[0];
      let score = 0;
      const desc = bits[1] || '';
      const w = desc.match(/(\d+)w/i);
      const x = desc.match(/([\d.]+)x/i);
      if (w) score = Number(w[1]) || 0;
      else if (x) score = Math.round((Number(x[1]) || 0) * 1000);
      else score = 1;
      if (score >= bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    }
    return bestUrl;
  }

  function readBackgroundImageUrl(node) {
    if (!node) return '';
    try {
      const inline = node.style && node.style.backgroundImage ? node.style.backgroundImage : '';
      const computed = (!inline && ROOT.getComputedStyle) ? ROOT.getComputedStyle(node).backgroundImage : inline;
      const text = inline || computed || '';
      const match = String(text).match(/url\((["']?)([^"')]+)\1\)/i);
      return match ? normalizeSpace(match[2]) : '';
    } catch (_) {
      return '';
    }
  }

  function pickCoverUrlFromImage(img) {
    if (!img) return '';
    const candidates = [
      img.currentSrc,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      pickLargestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset') || '')
    ];
    for (const candidate of candidates) {
      const value = normalizeSpace(candidate);
      if (value) return value;
    }
    return '';
  }

  function extractCoverUrl(card) {
    if (!card || !card.querySelector) return '';
    const images = card.querySelectorAll(COVER_IMAGE_SELECTORS);
    for (const img of images) {
      const raw = pickCoverUrlFromImage(img);
      if (!raw) continue;
      if (/avatar|icon|emoji|logo/i.test(raw) && images.length > 1) continue;
      return raw;
    }
    const mediaNodes = card.querySelectorAll('[style*="background"],.cover,.cover-container,.photo,.img,a');
    for (const node of mediaNodes) {
      const bg = readBackgroundImageUrl(node);
      if (bg && !/avatar|icon|emoji|logo/i.test(bg)) return bg;
    }
    return '';
  }

  function coverUrlCandidates(raw) {
    const original = normalizeSpace(raw);
    if (!original) return [];
    if (/^(?:data:|blob:)/i.test(original)) return [original];
    const normalized = toNoWatermarkCoverUrl(original);
    const out = [];
    const push = value => {
      const text = normalizeSpace(value);
      if (!text || out.indexOf(text) >= 0) return;
      out.push(text);
    };
    // Signed/displayed URL first, then de-processed, then one derivative max.
    push(original);
    push(normalized);
    if (normalized && !/!/.test(normalized.split("?")[0])) {
      push(normalized.replace(/([?].*)?$/, "!nd_dft_wlteh_webp_3$1"));
    }
    return out.slice(0, 3);
  }

  function coverRequestHeaders() {
    const referer = (PAGE.location && PAGE.location.href)
      ? PAGE.location.href
      : 'https://www.xiaohongshu.com/';
    const headers = {
      // Do not set Origin: CDN ACAO:* rejects credentialed/origin-styled requests and bare Origin can 403.
      Referer: referer,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };
    try {
      if (ROOT.navigator && ROOT.navigator.userAgent) headers['User-Agent'] = ROOT.navigator.userAgent;
    } catch (_) {}
    return headers;
  }

  function getGmRequest() {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
    if (typeof GM === 'object' && GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest;
    if (ROOT.GM_xmlhttpRequest && typeof ROOT.GM_xmlhttpRequest === 'function') return ROOT.GM_xmlhttpRequest;
    if (ROOT.GM && typeof ROOT.GM.xmlHttpRequest === 'function') return ROOT.GM.xmlHttpRequest;
    return null;
  }

  function clearCopyStatus() {
    if (copyStatusTimer !== null) ROOT.clearTimeout(copyStatusTimer);
    copyStatusTimer = null;
    const node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT.document && ROOT.document.getElementById(COPY_STATUS_ID);
    if (node) node.remove();
    copyStatus = null;
  }

  function showCopyStatus(message) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT.document.getElementById(COPY_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = COPY_STATUS_ID;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      ROOT.document.body.appendChild(node);
    }
    copyStatus = node;
    node.textContent = message;
    if (copyStatusTimer !== null) ROOT.clearTimeout(copyStatusTimer);
    copyStatusTimer = ROOT.setTimeout(() => { copyStatusTimer = null; clearCopyStatus(); }, 2200);
  }

  function getClipboardApi() {
    // With @grant, sandbox clipboard often cannot write images; prefer page realm.
    try {
      if (PAGE && PAGE.navigator && PAGE.navigator.clipboard) return PAGE.navigator.clipboard;
    } catch (_) {}
    try {
      if (ROOT.navigator && ROOT.navigator.clipboard) return ROOT.navigator.clipboard;
    } catch (_) {}
    return null;
  }

  function getClipboardItemCtor() {
    // Prefer navigator.ClipboardItem so tests/host pages can mock it; fall back to realm globals.
    try {
      if (PAGE && PAGE.navigator && typeof PAGE.navigator.ClipboardItem === "function") return PAGE.navigator.ClipboardItem;
    } catch (_) {}
    try {
      if (ROOT.navigator && typeof ROOT.navigator.ClipboardItem === "function") return ROOT.navigator.ClipboardItem;
    } catch (_) {}
    try {
      if (PAGE && typeof PAGE.ClipboardItem === "function") return PAGE.ClipboardItem;
    } catch (_) {}
    try {
      if (typeof ROOT.ClipboardItem === "function") return ROOT.ClipboardItem;
    } catch (_) {}
    return null;
  }

  function getPageBlobCtor() {
    try {
      if (PAGE && typeof PAGE.Blob === "function") return PAGE.Blob;
    } catch (_) {}
    return ROOT.Blob;
  }

  function transferBlobToPage(blob) {
    if (!blob) return Promise.resolve(null);
    const PageBlob = getPageBlobCtor();
    if (!PageBlob) return Promise.resolve(blob);
    try {
      // Same-realm fast path.
      if (blob instanceof PageBlob) return Promise.resolve(blob);
    } catch (_) {}
    if (typeof blob.arrayBuffer !== "function") {
      try { return Promise.resolve(new PageBlob([blob], { type: blob.type || "image/png" })); }
      catch (_) { return Promise.resolve(blob); }
    }
    return blob.arrayBuffer().then(buf => {
      try { return new PageBlob([buf], { type: blob.type || "image/png" }); }
      catch (_) { return blob; }
    }, () => blob);
  }

  function copyText(text) {
    const clipboard = getClipboardApi();
    if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(false);
    return clipboard.writeText(text).then(() => true, () => false);
  }

  function dataUrlToBlob(dataUrl, mimeType) {
    if (!dataUrl) return null;
    if (!/^data:/i.test(dataUrl)) return null;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const typeMatch = header.match(/^data:([^;,]*)/i);
    const type = (typeMatch && typeMatch[1]) || mimeType || "application/octet-stream";
    const isBase64 = /;base64/i.test(header);
    const BlobCtor = getPageBlobCtor() || ROOT.Blob;
    try {
      if (!isBase64) {
        const text = decodeURIComponent(body);
        const bytes = new ROOT.Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
        return new BlobCtor([bytes], { type: type || "text/plain" });
      }
      if (!ROOT.atob) return null;
      const binary = ROOT.atob(body);
      const bytes = new ROOT.Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
      return new BlobCtor([bytes], { type: type || "application/octet-stream" });
    } catch (_) {
      return null;
    }
  }

  function canvasToPngBlob(img) {
    try {
      const canvas = ROOT.document.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") return Promise.resolve(null);
      canvas.width = img.naturalWidth || img.width || 0;
      canvas.height = img.naturalHeight || img.height || 0;
      if (!canvas.width || !canvas.height) return Promise.resolve(null);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const BlobCtor = getPageBlobCtor() || ROOT.Blob;
      if (typeof canvas.toBlob === "function") {
        return new Promise(resolve => {
          try {
            canvas.toBlob(blob => {
              if (!blob) {
                try { resolve(dataUrlToBlob(canvas.toDataURL("image/png"), "image/png")); }
                catch (_) { resolve(null); }
                return;
              }
              transferBlobToPage(blob).then(resolve, () => resolve(blob));
            }, "image/png");
          } catch (_) {
            try { resolve(dataUrlToBlob(canvas.toDataURL("image/png"), "image/png")); }
            catch (e2) { resolve(null); }
          }
        });
      }
      return Promise.resolve(dataUrlToBlob(canvas.toDataURL("image/png"), "image/png"));
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function blobToPngBlob(blob) {
    if (!blob) return Promise.resolve(null);
    if (blob.type === "image/png") return transferBlobToPage(blob);
    // Prefer createImageBitmap; avoids blob: object-URL noise in DevTools.
    if (typeof ROOT.createImageBitmap === "function") {
      return ROOT.createImageBitmap(blob).then(bitmap => canvasToPngBlob(bitmap).then(png => {
        try { bitmap.close(); } catch (_) {}
        return png || transferBlobToPage(blob);
      }, () => {
        try { bitmap.close(); } catch (_) {}
        return transferBlobToPage(blob);
      }), () => transferBlobToPage(blob));
    }
    return transferBlobToPage(blob);
  }

  // IMPORTANT: call clipboard.write during the click gesture, with Promise values inside
  // ClipboardItem so Chromium keeps user-activation across the async GM image load.
  function copyImageBlob(blob) {
    return copyImageBlobPromise(Promise.resolve(blob));
  }

  function copyImageBlobPromise(blobPromise) {
    const clipboard = getClipboardApi();
    const ClipboardItemCtor = getClipboardItemCtor();
    if (!clipboard || typeof clipboard.write !== "function" || typeof ClipboardItemCtor !== "function") {
      return Promise.resolve(false);
    }
    const pngPromise = Promise.resolve(blobPromise).then(blob => {
      if (!blob) throw new Error("empty-cover-blob");
      return blobToPngBlob(blob).then(png => {
        const out = png || blob;
        if (!out) throw new Error("cover-transcode-failed");
        return transferBlobToPage(out).then(pageBlob => pageBlob || out);
      });
    }).then(blob => {
      if (!blob) throw new Error("empty-page-blob");
      // Chromium image clipboard is most reliable with image/png.
      if (blob.type === "image/png") return blob;
      return blob.slice ? blob.slice(0, blob.size, "image/png") : blob;
    });
    try {
      const item = new ClipboardItemCtor({ "image/png": pngPromise });
      return clipboard.write([item]).then(() => true, () => false);
    } catch (_) {
      // Fallback for environments requiring resolved blobs only.
      return pngPromise.then(blob => {
        try {
          const item = new ClipboardItemCtor({ "image/png": blob });
          return clipboard.write([item]).then(() => true, () => false);
        } catch (e2) {
          return false;
        }
      }, () => false);
    }
  }

  function guessImageMimeFromUrl(url) {
    const text = String(url || "").toLowerCase();
    if (text.indexOf(".png") >= 0) return "image/png";
    if (text.indexOf(".webp") >= 0 || text.indexOf("webp") >= 0) return "image/webp";
    if (text.indexOf(".gif") >= 0) return "image/gif";
    return "image/jpeg";
  }

  function looksLikeImageBytes(bytes) {
    if (!bytes || bytes.length < 4) return false;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
    return false;
  }

  function normalizeFetchedImageBlob(blob, url) {
    if (!blob || typeof blob.size !== "number" || blob.size < 32) return null;
    if (blob.type && /^image\//i.test(blob.type) && blob.type.indexOf("svg") < 0) return blob;
    const BlobCtor = getPageBlobCtor() || ROOT.Blob;
    try {
      return blob.slice ? blob.slice(0, blob.size, guessImageMimeFromUrl(url))
        : new BlobCtor([blob], { type: guessImageMimeFromUrl(url) });
    } catch (_) {
      return null;
    }
  }

  function cacheCoverBlob(url, blob) {
    const key = normalizeSpace(url);
    if (!key || !blob) return;
    if (coverBlobCache.size >= COVER_CACHE_LIMIT) {
      const first = coverBlobCache.keys().next().value;
      if (first !== undefined) coverBlobCache.delete(first);
    }
    coverBlobCache.set(key, blob);
  }

  function getCachedCoverBlob(url) {
    const key = normalizeSpace(url);
    if (!key || !coverBlobCache.has(key)) return null;
    const hit = coverBlobCache.get(key);
    return hit && typeof hit.size === "number" ? hit : null;
  }

  function cacheCoverMiss(url) {
    const key = normalizeSpace(url);
    if (key) coverBlobCache.set(key, false);
  }

  function isCoverMiss(url) {
    const key = normalizeSpace(url);
    return key ? coverBlobCache.get(key) === false : false;
  }

  // Never page-fetch remote CDN images.
  function fetchCoverBlob(url) {
    if (!url) return Promise.resolve(null);
    if (/^data:/i.test(url)) return Promise.resolve(dataUrlToBlob(url, "image/png"));
    if (/^blob:/i.test(url) && typeof ROOT.fetch === "function") {
      return ROOT.fetch(url).then(res => (res && res.ok ? res.blob() : null), () => null)
        .then(blob => normalizeFetchedImageBlob(blob, url));
    }
    return Promise.resolve(null);
  }

  function gmRequestOnce(url, responseType) {
    return new Promise(resolve => {
      const req = getGmRequest();
      if (!req) { resolve(null); return; }
      try {
        req({
          method: "GET",
          url,
          responseType,
          anonymous: false,
          timeout: 20000,
          headers: coverRequestHeaders(),
          onload(res) {
            try {
              if (!res || res.status < 200 || res.status >= 300 || res.response == null) { resolve(null); return; }
              resolve(res.response);
            } catch (_) { resolve(null); }
          },
          onerror() { resolve(null); },
          ontimeout() { resolve(null); }
        });
      } catch (_) { resolve(null); }
    });
  }

  // Generic GM channel for the content-library API: page fetch is blocked by the
  // deployed backend's CORS allow-list (localhost dev origins only).
  function gmJsonRequest(options) {
    return new Promise(resolve => {
      const req = getGmRequest();
      if (!req) { resolve({ ok: false, status: 0, json: null, error: 'gm-unavailable' }); return; }
      let data;
      const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
      if (options.data !== undefined) {
        data = JSON.stringify(options.data);
        headers['Content-Type'] = 'application/json';
      }
      try {
        req({
          method: options.method || 'GET',
          url: options.url,
          headers,
          data,
          timeout: options.timeout || 20000,
          onload(res) {
            let json = null;
            try { json = res && res.responseText ? JSON.parse(res.responseText) : null; } catch (_) {}
            const status = res ? Number(res.status) || 0 : 0;
            let error = '';
            if (!json) {
              error = res && res.responseText ? normalizeSpace(res.responseText).slice(0, 200) : '';
            } else if (json.detail) {
              error = typeof json.detail === 'string' ? json.detail : normalizeSpace(JSON.stringify(json.detail));
            }
            resolve({ ok: status >= 200 && status < 300, status, json, error });
          },
          onerror() { resolve({ ok: false, status: 0, json: null, error: 'network' }); },
          ontimeout() { resolve({ ok: false, status: 0, json: null, error: 'timeout' }); }
        });
      } catch (_) {
        resolve({ ok: false, status: 0, json: null, error: 'gm-error' });
      }
    });
  }

  function storeLibraryAccessToken(token) {
    libraryTokenMemory.accessToken = String(token || '');
    libraryTokenMemory.exp = parseTokenExp(libraryTokenMemory.accessToken);
  }

  function clearLibraryTokens() {
    libraryTokenMemory.accessToken = '';
    libraryTokenMemory.refreshToken = '';
    libraryTokenMemory.exp = 0;
    writeSecret(LIBRARY_REFRESH_KEY, '');
  }

  function libraryLogin(cfg) {
    return gmJsonRequest({
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

  function libraryRefresh(cfg) {
    const refresh = libraryTokenMemory.refreshToken || readSecret(LIBRARY_REFRESH_KEY);
    if (!refresh) return Promise.resolve(false);
    return gmJsonRequest({
      method: 'POST',
      url: cfg.baseUrl + '/api/auth/refresh',
      data: { refresh_token: refresh }
    }).then(res => {
      if (!res.ok || !res.json || !res.json.access_token) return false;
      storeLibraryAccessToken(res.json.access_token);
      return true;
    });
  }

  function ensureLibraryToken(forceRenew) {
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

  function checkLibraryHealth(baseUrl) {
    return gmJsonRequest({ method: 'GET', url: baseUrl + '/api/health', timeout: 8000 });
  }

  function fetchLibraryPcAccounts(token, baseUrl) {
    return gmJsonRequest({
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

  function postCrawlNoteUrls(token, cfg, urls) {
    return gmJsonRequest({
      method: 'POST',
      url: cfg.baseUrl + LIBRARY_CRAWL_PATH,
      headers: { Authorization: 'Bearer ' + token },
      data: buildCrawlPayload(cfg.accountId, urls)
    });
  }

  function saveNoteUrlsToLibrary(urls) {
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

  function gmFetchCoverBlob(url) {
    if (!url || /^(?:data:|blob:)/i.test(url) || !getGmRequest() || isCoverMiss(url)) return Promise.resolve(null);
    const cached = getCachedCoverBlob(url);
    if (cached) return Promise.resolve(cached);
    return gmRequestOnce(url, "blob").then(raw => {
      if (raw && typeof raw.size === "number") {
        const blob = normalizeFetchedImageBlob(raw, url);
        if (blob) { cacheCoverBlob(url, blob); return blob; }
      }
      return gmRequestOnce(url, "arraybuffer").then(buf => {
        if (!buf) { cacheCoverMiss(url); return null; }
        try {
          const view = buf instanceof ROOT.ArrayBuffer ? new ROOT.Uint8Array(buf) : new ROOT.Uint8Array(buf.buffer || buf);
          if (view.byteLength < 32 || !looksLikeImageBytes(view)) { cacheCoverMiss(url); return null; }
          const BlobCtor = getPageBlobCtor() || ROOT.Blob;
          const blob = new BlobCtor([view], { type: guessImageMimeFromUrl(url) });
          cacheCoverBlob(url, blob);
          return blob;
        } catch (_) { cacheCoverMiss(url); return null; }
      });
    });
  }

  function resolveCoverBlobFromCandidates(candidates) {
    let chain = Promise.resolve(null);
    for (const url of candidates) {
      chain = chain.then(prev => {
        if (prev) return prev;
        if (/^(?:data:|blob:)/i.test(url)) return fetchCoverBlob(url);
        return gmFetchCoverBlob(url);
      });
    }
    return chain;
  }

  function loadCoverPngBlob(src) {
    return resolveCoverBlobFromCandidates(coverUrlCandidates(src))
      .then(blob => (blob ? { ok: true, blob, mimeType: blob.type || "image/png" } : { ok: false }));
  }

  function onCopyLink(card) {
    const link = extractNoteLink(card);
    if (!link) { showCopyStatus(COPY_LINK_FAIL); return; }
    copyText(link).then(ok => showCopyStatus(ok ? COPY_LINK_OK : COPY_LINK_FAIL));
  }

  function onCopyCover(card) {
    if (copyCoverInFlight) return;
    const src = extractCoverUrl(card);
    if (!src) { showCopyStatus(COPY_COVER_FAIL); return; }
    copyCoverInFlight = true;
    // clipboard.write starts in this turn; Promise ClipboardItem keeps user-activation.
    const blobPromise = loadCoverPngBlob(src).then(result => {
      if (!result.ok || !result.blob) throw new Error("cover-load-failed");
      return result.blob;
    });
    copyImageBlobPromise(blobPromise).then(copied => {
      copyCoverInFlight = false;
      showCopyStatus(copied ? COPY_COVER_OK : (getGmRequest() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL));
    }, () => {
      copyCoverInFlight = false;
      showCopyStatus(getGmRequest() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL);
    });
  }

  function resolveSaveUrlFromCard(card) {
    const link = extractNoteLink(card);
    if (!link) return { ok: false, url: '', reason: 'no-link' };
    if (!getXsecTokenFromHref(link)) return { ok: false, url: '', reason: 'no-token' };
    return { ok: true, url: link, reason: '' };
  }

  function buildDetailNoteUrl() {
    try {
      const loc = ROOT.location;
      if (!loc || !loc.origin || loc.origin === 'null') return '';
      return loc.origin + loc.pathname + (loc.search || '');
    } catch (_) {
      return '';
    }
  }

  function onSaveToLibrary(card, button) {
    if (saveInFlight) return;
    const resolved = resolveSaveUrlFromCard(card);
    if (!resolved.ok) {
      showCopyStatus(resolved.reason === 'no-token' ? LIBRARY_NO_TOKEN : COPY_LINK_FAIL);
      return;
    }
    submitNoteUrlsToLibrary([resolved.url]).then(result => {
      if (!result.ok || !button || !button.isConnected) return;
      button.textContent = SAVE_LIBRARY_DONE_TEXT;
      button.disabled = true;
      ROOT.setTimeout(() => {
        button.textContent = SAVE_LIBRARY_TEXT;
        button.disabled = false;
      }, 2000);
    });
  }

  function onSaveCurrentDetail() {
    if (saveInFlight) return;
    const url = buildDetailNoteUrl();
    if (!url || !getXsecTokenFromHref(url)) { showCopyStatus(LIBRARY_NO_TOKEN); return; }
    submitNoteUrlsToLibrary([url]);
  }

  function submitNoteUrlsToLibrary(urls, options) {
    const silent = Boolean(options && options.silent);
    if (saveInFlight) return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) {
      if (!silent) { showCopyStatus(LIBRARY_NO_CONFIG); openLibraryPanel(); }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!cfg.accountId) {
      if (!silent) { showCopyStatus(LIBRARY_NO_ACCOUNT); openLibraryPanel(); }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!getGmRequest()) {
      if (!silent) showCopyStatus(LIBRARY_GM_MISSING);
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    saveInFlight = true;
    if (!silent) showCopyStatus('正在保存到内容库…');
    const finish = result => {
      saveInFlight = false;
      const errors = result.json && Array.isArray(result.json.errors) ? result.json.errors : [];
      const saved = result.json ? Number(result.json.saved_count) || 0 : 0;
      const failed = errors.length;
      if (result.ok) {
        if (failed > 0) {
          if (!silent) {
            const message = errors[0] && errors[0].error ? normalizeSpace(String(errors[0].error)) : '';
            showCopyStatus('采集失败：' + (message || '服务端采集失败'));
          }
        } else if (!silent) {
          showCopyStatus(saved > 0 ? LIBRARY_SAVED_OK : LIBRARY_SAVE_FAIL);
        }
        return { ok: saved > 0 && failed === 0, saved, failed };
      }
      if (!silent) {
        if (result.error === 'config-missing') { showCopyStatus(LIBRARY_NO_CONFIG); openLibraryPanel(); }
        else if (result.error === 'account-missing') { showCopyStatus(LIBRARY_NO_ACCOUNT); openLibraryPanel(); }
        else if (result.error === 'auth-failed') showCopyStatus(LIBRARY_AUTH_FAIL);
        else if (result.error === 'gm-unavailable') showCopyStatus(LIBRARY_GM_MISSING);
        else if (result.error) showCopyStatus('保存失败：' + normalizeSpace(result.error));
        else showCopyStatus(LIBRARY_CONNECT_FAIL);
      }
      return { ok: false, saved, failed };
    };
    return saveNoteUrlsToLibrary(urls).then(finish);
  }

  function onSaveAllVisible() {
    if (saveInFlight) return;
    const seen = new Set();
    const urls = [];
    for (const card of discoverCards(ROOT.document)) {
      const resolved = resolveSaveUrlFromCard(card);
      if (resolved.ok && !seen.has(resolved.url)) {
        seen.add(resolved.url);
        urls.push(resolved.url);
      }
    }
    if (!urls.length) { showCopyStatus(LIBRARY_BATCH_EMPTY_TEXT); return; }
    const batches = [];
    for (let i = 0; i < urls.length; i += LIBRARY_BATCH_LIMIT) batches.push(urls.slice(i, i + LIBRARY_BATCH_LIMIT));
    let index = 0;
    const totals = { saved: 0, failed: 0 };
    if (libraryBatchButton) libraryBatchButton.disabled = true;
    const next = () => {
      if (libraryBatchButton) libraryBatchButton.disabled = index < batches.length;
      if (index >= batches.length) {
        showCopyStatus('本页入库完成：成功 ' + totals.saved + ' 条' + (totals.failed > 0 ? '，失败 ' + totals.failed + ' 条' : ''));
        return;
      }
      const batch = batches[index];
      index += 1;
      showCopyStatus('正在入库 ' + index + '/' + batches.length + ' 批…');
      submitNoteUrlsToLibrary(batch, { silent: true }).then(result => {
        totals.saved += result.saved;
        totals.failed += result.failed;
        if (!result.ok && result.saved === 0 && result.failed === 0) totals.failed += batch.length;
        next();
      });
    };
    next();
  }

  function ensureCardActions(card) {
    if (!card || !card.querySelector || !card.isConnected) return;
    if (!isTargetRoute(getCurrentRoute())) {
      removeCardActions(card);
      return;
    }
    let container = card.querySelector('.' + CARD_ACTIONS_CLASS);
    if (!container) {
      container = ROOT.document.createElement('div');
      container.className = CARD_ACTIONS_CLASS;
      const linkButton = ROOT.document.createElement('button');
      linkButton.type = 'button';
      linkButton.className = COPY_LINK_CLASS;
      linkButton.textContent = COPY_LINK_TEXT;
      linkButton.setAttribute('aria-label', COPY_LINK_TEXT);
      linkButton.addEventListener('click', () => onCopyLink(card));
      const coverButton = ROOT.document.createElement('button');
      coverButton.type = 'button';
      coverButton.className = COPY_COVER_CLASS;
      coverButton.textContent = COPY_COVER_TEXT;
      coverButton.setAttribute('aria-label', COPY_COVER_TEXT);
      coverButton.addEventListener('click', () => onCopyCover(card));
      const saveButton = ROOT.document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = SAVE_LIBRARY_CLASS;
      saveButton.textContent = SAVE_LIBRARY_TEXT;
      saveButton.setAttribute('aria-label', SAVE_LIBRARY_TEXT);
      saveButton.addEventListener('click', () => onSaveToLibrary(card, saveButton));
      container.append(linkButton, coverButton, saveButton);
      card.appendChild(container);
    }
    card.setAttribute(CARD_ACTIONS_ATTRIBUTE, getCurrentRoute());
  }

  function removeCardActions(card) {
    if (!card || !card.querySelectorAll) return;
    const container = card.querySelector('.' + CARD_ACTIONS_CLASS);
    if (container) container.remove();
    card.removeAttribute(CARD_ACTIONS_ATTRIBUTE);
  }

  function getCurrentRoute() {
    if (TEST_MODE && routeProvider) return String(routeProvider() || '');
    return ROOT.location ? ROOT.location.pathname : '';
  }

  function getAttributeSource(node, names) {
    for (const name of names) {
      const value = node.getAttribute(name);
      if (normalizeSpace(value)) return value;
    }
    return '';
  }

  function extractLike(card) {
    const nodes = Array.from(card.querySelectorAll(SELECTORS.likeNodes));
    for (const node of nodes) {
      const explicit = getAttributeSource(node, ['data-like-count', 'data-xhs-like-count']);
      const labelled = getAttributeSource(node, ['aria-label', 'title']).replace(/^.*?点赞[：:\s]*/u, '');
      const candidates = [explicit, labelled, node.textContent];
      for (const candidate of candidates) {
        const parsed = parseLikeCount(candidate);
        if (parsed.ok) return { node, parsed, raw: normalizeSpace(candidate) };
      }
    }
    return null;
  }

  function isReliableCard(card) {
    if (!card || !card.querySelector) return false;
    const links = card.querySelectorAll(SELECTORS.noteLinks);
    return links.length === 1 && Boolean(card.querySelector(SELECTORS.likeNodes));
  }

  function findCard(node) {
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return null;
    const card = element.closest(SELECTORS.cardContainers);
    return isReliableCard(card) ? card : null;
  }

  function discoverCards(root) {
    if (!root || !root.querySelectorAll) return [];
    const cards = new Set();
    if (root.matches && root.matches(SELECTORS.cardContainers) && isReliableCard(root)) cards.add(root);
    for (const link of root.querySelectorAll(SELECTORS.noteLinks)) {
      const card = findCard(link);
      if (card) cards.add(card);
    }
    return Array.from(cards);
  }

  function discoverLinkCards(root) {
    if (!root || !root.querySelectorAll) return [];
    const cards = new Set();
    for (const link of root.querySelectorAll(SELECTORS.noteLinks)) {
      const element = link.nodeType === 1 ? link : link.parentElement;
      if (!element) continue;
      const card = element.closest(SELECTORS.cardContainers);
      if (card && card.isConnected && card.querySelectorAll(SELECTORS.noteLinks).length === 1) cards.add(card);
    }
    return Array.from(cards);
  }

  function applyProfileActions() {
    if (!ROOT.document || !isProfileRoute(getCurrentRoute())) return;
    for (const card of discoverLinkCards(ROOT.document)) ensureCardActions(card);
  }

  function signatureFor(route, likeRaw) {
    return `${route}\u001f${likeRaw || ''}`;
  }

  function ensureStyle() {
    if (!ROOT.document || ROOT.document.getElementById(STYLE_ID)) return;
    const style = ROOT.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS}{outline:2px solid #ff2442!important;background:rgba(255,36,66,.07)!important;box-shadow:0 2px 10px rgba(255,36,66,.14)!important}
      .${LIKE_CLASS}{color:#ff2442!important;font-weight:700!important}
      #${JUMP_NAV_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;display:flex;gap:8px}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID}{border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${JUMP_PREV_BUTTON_ID}:hover,#${JUMP_BUTTON_ID}:hover{background:#e61e3c}
      #${JUMP_PREV_BUTTON_ID}:focus-visible,#${JUMP_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${FOCUS_TOGGLE_ID}{border:0;border-radius:999px;padding:10px 16px;background:rgba(30,30,30,.9);color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${FOCUS_TOGGLE_ID}:hover{background:rgba(15,15,15,1)}
      #${FOCUS_TOGGLE_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]{background:#ff2442}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]:hover{background:#e61e3c}
      .${DIMMED_CLASS}{filter:blur(8px) grayscale(.35);opacity:.55;transition:filter .18s ease,opacity .18s ease}
      .${DIMMED_CLASS}:hover{filter:none;opacity:1}
      #${THRESHOLD_CONTROL_ID}{position:fixed;top:138px;right:24px;z-index:2147483646;display:flex;gap:6px;align-items:center;padding:8px;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.16);font:14px/1.4 system-ui,sans-serif}
      #${THRESHOLD_INPUT_ID}{width:72px;border:1px solid #aaa;border-radius:4px;padding:5px 6px;font:inherit}#${THRESHOLD_CONTROL_ID} button{border:0;border-radius:4px;padding:6px 9px;background:#ff2442;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
      #${THRESHOLD_STATUS_ID}{position:fixed;top:190px;right:24px;z-index:2147483646;max-width:260px;padding:7px 10px;border-radius:6px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
      #${JUMP_STATUS_ID}{position:fixed;top:228px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
      #${COPY_STATUS_ID}{position:fixed;top:276px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
      #${LIBRARY_PAGE_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_PAGE_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_PAGE_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${LIBRARY_BATCH_BUTTON_ID}{position:fixed;top:316px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_BATCH_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_BATCH_BUTTON_ID}:disabled{opacity:.6;cursor:default}
      #${LIBRARY_TOGGLE_ID}{position:fixed;bottom:24px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:rgba(30,30,30,.9);color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_TOGGLE_ID}:hover{background:rgba(15,15,15,1)}
      #${LIBRARY_PANEL_ID}{position:fixed;top:88px;right:24px;z-index:2147483647;width:300px;display:none;padding:12px 14px;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);font:13px/1.5 system-ui,sans-serif;text-align:left}
      #${LIBRARY_PANEL_ID}.xhs-enhanced-library-panel--open{display:block}
      #${LIBRARY_PANEL_ID} label{display:block;margin:8px 0 3px;color:#555;font-size:12px}
      #${LIBRARY_PANEL_ID} input,#${LIBRARY_PANEL_ID} select{width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:5px;padding:6px 7px;font:13px/1.4 system-ui,sans-serif}
      .xhs-enhanced-library-panel-title{font-weight:700;font-size:14px;color:#222}
      .xhs-enhanced-library-panel-actions{display:flex;gap:8px;margin-top:10px}
      .xhs-enhanced-library-panel-actions button{flex:1;border:0;border-radius:6px;padding:7px 0;background:#ff2442;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
      .xhs-enhanced-library-panel-actions button:hover{background:#e61e3c}
      #${LIBRARY_STATUS_ID}{margin-top:8px;color:#333;font-size:12px;word-break:break-all}
      .${CARD_ACTIONS_CLASS}{position:absolute;top:6px;left:6px;z-index:2147483640;display:flex;gap:4px;opacity:0;transition:opacity .15s ease;pointer-events:none}
      .xhs-enhanced-card--popular .${CARD_ACTIONS_CLASS},.note-item:hover .${CARD_ACTIONS_CLASS},section.note-item:hover .${CARD_ACTIONS_CLASS},article.note-item:hover .${CARD_ACTIONS_CLASS}{opacity:1;pointer-events:auto}
      [data-note-card],article.note-item,section.note-item,.note-item{position:relative}
      .${CARD_ACTIONS_CLASS} button{border:0;border-radius:6px;padding:5px 9px;background:rgba(255,36,66,.92);color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}
      .${CARD_ACTIONS_CLASS} button:hover{background:#e61e3c}
      .${COPY_COVER_CLASS}{background:rgba(30,30,30,.82)!important}
    `;
    (ROOT.document.head || ROOT.document.documentElement).appendChild(style);
  }

  function renderCard(card) {
    if (!card || !card.isConnected) return;
    const like = extractLike(card);
    const route = getCurrentRoute();
    const signature = signatureFor(route, like ? like.raw : '');
    const popular = Boolean(like && like.parsed.value > threshold);

    card.classList.toggle(CARD_CLASS, popular);
    card.classList.toggle(DIMMED_CLASS, focusPopular && !popular);
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);

    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    ensureCardActions(card);
    counters.processed += 1;
  }

  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
    card.classList.remove(DIMMED_CLASS);
    card.removeAttribute(SIGNATURE_ATTRIBUTE);
    removeCardActions(card);
    for (const node of card.querySelectorAll(`.${LIKE_CLASS}`)) node.classList.remove(LIKE_CLASS);
  }

  function cleanupAll() {
    if (!ROOT.document) return;
    for (const card of ROOT.document.querySelectorAll(`.${CARD_CLASS},[${SIGNATURE_ATTRIBUTE}]`)) cleanupCard(card);
    for (const container of ROOT.document.querySelectorAll('.' + CARD_ACTIONS_CLASS)) container.remove();
  }

  function selectNextPopularCard(cards, viewportHeight) {
    let selected = null;
    let selectedTop = Infinity;
    for (const card of cards || []) {
      if (!card || !card.isConnected || !card.classList || !card.classList.contains(CARD_CLASS) || typeof card.getBoundingClientRect !== 'function') continue;
      const rect = card.getBoundingClientRect();
      const top = Number(rect && rect.top);
      if (!Number.isFinite(top) || top < viewportHeight || top >= selectedTop) continue;
      selected = card;
      selectedTop = top;
    }
    return selected;
  }

  // Mirror of selectNextPopularCard: the nearest popular card fully above the
  // viewport (largest bottom that is still <= 0).
  function selectPreviousPopularCard(cards) {
    let selected = null;
    let selectedBottom = -Infinity;
    for (const card of cards || []) {
      if (!card || !card.isConnected || !card.classList || !card.classList.contains(CARD_CLASS) || typeof card.getBoundingClientRect !== 'function') continue;
      const rect = card.getBoundingClientRect();
      const bottom = Number(rect && rect.bottom);
      if (!Number.isFinite(bottom) || bottom > 0 || bottom <= selectedBottom) continue;
      selected = card;
      selectedBottom = bottom;
    }
    return selected;
  }

  function clearJumpStatus() {
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = null;
    const node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document && ROOT.document.getElementById(JUMP_STATUS_ID);
    if (node) node.remove();
    jumpStatus = null;
  }

  function showJumpStatus(message = LAST_NOTE_TEXT) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document.getElementById(JUMP_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = JUMP_STATUS_ID;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.textContent = message;
      ROOT.document.body.appendChild(node);
    }
    jumpStatus = node;
    node.textContent = message;
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = ROOT.setTimeout(() => { jumpStatusTimer = null; clearJumpStatus(); }, 3000);
  }

  function jumpToNextPopularCard() {
    if (!ROOT.document) return;
    const viewportHeight = ROOT.innerHeight || ROOT.document.documentElement.clientHeight || 0;
    const target = selectNextPopularCard(ROOT.document.querySelectorAll(`.${CARD_CLASS}`), viewportHeight);
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const documentElement = ROOT.document.documentElement;
    const body = ROOT.document.body;
    const bottom = Math.max(documentElement ? documentElement.scrollHeight : 0, body ? body.scrollHeight : 0);
    if (typeof ROOT.scrollTo === 'function') ROOT.scrollTo({ top: bottom, behavior: 'smooth' });
    showJumpStatus();
  }

  function jumpToPreviousPopularCard() {
    if (!ROOT.document) return;
    const target = selectPreviousPopularCard(ROOT.document.querySelectorAll(`.${CARD_CLASS}`));
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (typeof ROOT.scrollTo === 'function') ROOT.scrollTo({ top: 0, behavior: 'smooth' });
    showJumpStatus(FIRST_NOTE_TEXT);
  }

  function ensureJumpUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT.document.getElementById(JUMP_NAV_ID);
    if (!nav) {
      nav = ROOT.document.createElement('div');
      nav.id = JUMP_NAV_ID;
      ROOT.document.body.appendChild(nav);
    }
    jumpNav = nav;
    let prev = jumpPrevButton && jumpPrevButton.isConnected ? jumpPrevButton : ROOT.document.getElementById(JUMP_PREV_BUTTON_ID);
    if (!prev) {
      prev = ROOT.document.createElement('button');
      prev.id = JUMP_PREV_BUTTON_ID;
      prev.type = 'button';
      prev.textContent = JUMP_PREV_BUTTON_TEXT;
      prev.setAttribute('aria-label', JUMP_PREV_BUTTON_TEXT);
      prev.addEventListener('click', jumpToPreviousPopularCard);
    }
    jumpPrevButton = prev;
    let button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = JUMP_BUTTON_ID;
      button.type = 'button';
      button.textContent = JUMP_BUTTON_TEXT;
      button.setAttribute('aria-label', JUMP_BUTTON_TEXT);
      button.addEventListener('click', jumpToNextPopularCard);
    }
    jumpButton = button;
    let toggle = focusToggle && focusToggle.isConnected ? focusToggle : ROOT.document.getElementById(FOCUS_TOGGLE_ID);
    if (!toggle) {
      toggle = ROOT.document.createElement('button');
      toggle.id = FOCUS_TOGGLE_ID;
      toggle.type = 'button';
      toggle.textContent = FOCUS_TOGGLE_TEXT;
      toggle.setAttribute('aria-label', FOCUS_TOGGLE_TEXT);
      toggle.setAttribute('aria-pressed', focusPopular ? 'true' : 'false');
      toggle.addEventListener('click', onFocusToggleClick);
    }
    focusToggle = toggle;
    // Move buttons left over from an older script version into the nav row, but
    // only when needed: unconditional append would re-trigger the observer forever.
    if (prev.parentElement !== nav) nav.appendChild(prev);
    if (button.parentElement !== nav) nav.appendChild(button);
    if (toggle.parentElement !== nav) nav.appendChild(toggle);
  }

  function showThresholdStatus(message) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = thresholdStatus && thresholdStatus.isConnected ? thresholdStatus : ROOT.document.getElementById(THRESHOLD_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = THRESHOLD_STATUS_ID;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      ROOT.document.body.appendChild(node);
    }
    node.textContent = message;
    thresholdStatus = node;
  }

  function applyThresholdInput() {
    if (!thresholdInput) return;
    const result = setThreshold(thresholdInput.value);
    thresholdInput.value = String(threshold);
    if (!result.ok) {
      showThresholdStatus(`请输入非负整数，当前阈值为 ${threshold}`);
      return;
    }
    showThresholdStatus(result.persisted ? `热门阈值已设为 ${threshold}` : `热门阈值已设为 ${threshold}，但未能保存`);
    scan(ROOT.document);
  }

  function ensureThresholdUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let control = thresholdControl && thresholdControl.isConnected ? thresholdControl : ROOT.document.getElementById(THRESHOLD_CONTROL_ID);
    let created = false;
    if (!control) {
      created = true;
      control = ROOT.document.createElement('div');
      control.id = THRESHOLD_CONTROL_ID;
      control.setAttribute('role', 'group');
      control.setAttribute('aria-label', '热门阈值设置');
      const label = ROOT.document.createElement('label');
      label.htmlFor = THRESHOLD_INPUT_ID;
      label.textContent = '热门阈值';
      const input = ROOT.document.createElement('input');
      input.id = THRESHOLD_INPUT_ID;
      input.type = 'text';
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', '热门阈值');
      const button = ROOT.document.createElement('button');
      button.type = 'button';
      button.textContent = '应用';
      button.addEventListener('click', applyThresholdInput);
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.returnValue = false;
          applyThresholdInput();
        }
      });
      control.append(label, input, button);
      ROOT.document.body.appendChild(control);
    }
    thresholdControl = control;
    thresholdInput = control.querySelector(`#${THRESHOLD_INPUT_ID}`);
    if (created && thresholdInput) thresholdInput.value = String(threshold);
  }

  function removeThresholdUi() {
    const control = thresholdControl && thresholdControl.isConnected ? thresholdControl : ROOT.document && ROOT.document.getElementById(THRESHOLD_CONTROL_ID);
    if (control) control.remove();
    thresholdControl = null;
    thresholdInput = null;
    const status = thresholdStatus && thresholdStatus.isConnected ? thresholdStatus : ROOT.document && ROOT.document.getElementById(THRESHOLD_STATUS_ID);
    if (status) status.remove();
    thresholdStatus = null;
  }

  function removeJumpUi() {
    clearJumpStatus();
    const nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT.document && ROOT.document.getElementById(JUMP_NAV_ID);
    if (nav) nav.remove();
    // Also drop stray buttons that an older script version may have left on body.
    for (const id of [JUMP_PREV_BUTTON_ID, JUMP_BUTTON_ID, FOCUS_TOGGLE_ID]) {
      const stray = ROOT.document && ROOT.document.getElementById(id);
      if (stray) stray.remove();
    }
    jumpNav = null;
    jumpButton = null;
    jumpPrevButton = null;
    focusToggle = null;
  }

  function libraryAccountOptionLabel(account) {
    const nickname = normalizeSpace(account.nickname);
    const status = account.status && account.status !== 'ok' ? '（' + account.status + '）' : '';
    return '#' + account.id + (nickname ? ' ' + nickname : '') + status;
  }

  function persistLibraryAccountFromSelect(select) {
    const value = Number(select && select.value) || 0;
    if (!value) return;
    const storage = getStorage();
    if (!storage) return;
    try { storage.setItem(LIBRARY_ACCOUNT_ID_KEY, String(value)); } catch (_) {}
  }

  function populateLibraryAccountSelect(accounts) {
    if (!libraryPanel) return;
    const select = libraryPanel.querySelector('#' + LIBRARY_ACCOUNT_SELECT_ID);
    if (!select) return;
    select.textContent = '';
    for (const account of accounts) {
      const option = ROOT.document.createElement('option');
      option.value = String(account.id);
      option.textContent = libraryAccountOptionLabel(account);
      select.appendChild(option);
    }
    if (!accounts.length) {
      const option = ROOT.document.createElement('option');
      option.value = '';
      option.textContent = '未发现 PC 端账号，请先在平台绑定';
      select.appendChild(option);
    }
    const current = String(readLibraryConfig().accountId || '');
    const values = Array.from(select.options).map(option => option.value);
    if (current && values.indexOf(current) >= 0) select.value = current;
    else if (accounts.length === 1) select.value = String(accounts[0].id);
    persistLibraryAccountFromSelect(select);
  }

  function showLibraryStatus(message) {
    if (!libraryPanel || !libraryPanel.isConnected) return;
    const status = libraryPanel.querySelector('#' + LIBRARY_STATUS_ID);
    if (status) status.textContent = message;
  }

  function fillLibraryPanelInputs(panel) {
    const cfg = readLibraryConfig();
    const base = panel.querySelector('#' + LIBRARY_BASE_INPUT_ID);
    const user = panel.querySelector('#' + LIBRARY_USER_INPUT_ID);
    const password = panel.querySelector('#' + LIBRARY_PASSWORD_INPUT_ID);
    if (base) base.value = cfg.baseUrl;
    if (user) user.value = cfg.username;
    if (password) password.value = cfg.password;
  }

  function ensureLibraryPanel() {
    if (!ROOT.document || !ROOT.document.body) return;
    let panel = libraryPanel && libraryPanel.isConnected ? libraryPanel : ROOT.document.getElementById(LIBRARY_PANEL_ID);
    if (!panel) {
      panel = ROOT.document.createElement('div');
      panel.id = LIBRARY_PANEL_ID;
      const title = ROOT.document.createElement('div');
      title.className = 'xhs-enhanced-library-panel-title';
      title.textContent = LIBRARY_TOGGLE_TEXT;
      panel.appendChild(title);
      const fields = [
        [LIBRARY_BASE_INPUT_ID, '服务器地址', 'text', 'http://192.168.1.10:8000'],
        [LIBRARY_USER_INPUT_ID, '用户名', 'text', ''],
        [LIBRARY_PASSWORD_INPUT_ID, '密码', 'password', '']
      ];
      for (const field of fields) {
        const [id, label, type, placeholder] = field;
        const labelNode = ROOT.document.createElement('label');
        labelNode.htmlFor = id;
        labelNode.textContent = label;
        const input = ROOT.document.createElement('input');
        input.id = id;
        input.type = type;
        input.placeholder = placeholder;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', label);
        panel.append(labelNode, input);
      }
      const accountLabel = ROOT.document.createElement('label');
      accountLabel.htmlFor = LIBRARY_ACCOUNT_SELECT_ID;
      accountLabel.textContent = '小红书账号（PC 端）';
      const select = ROOT.document.createElement('select');
      select.id = LIBRARY_ACCOUNT_SELECT_ID;
      select.setAttribute('aria-label', '小红书账号');
      const emptyOption = ROOT.document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '点击“测试连接”自动获取';
      select.appendChild(emptyOption);
      select.addEventListener('change', () => persistLibraryAccountFromSelect(select));
      const actions = ROOT.document.createElement('div');
      actions.className = 'xhs-enhanced-library-panel-actions';
      const saveButton = ROOT.document.createElement('button');
      saveButton.type = 'button';
      saveButton.textContent = LIBRARY_SAVE_SETTINGS_TEXT;
      saveButton.addEventListener('click', applyLibrarySettings);
      const testButton = ROOT.document.createElement('button');
      testButton.type = 'button';
      testButton.textContent = LIBRARY_TEST_TEXT;
      testButton.addEventListener('click', testLibraryConnection);
      actions.append(saveButton, testButton);
      const status = ROOT.document.createElement('div');
      status.id = LIBRARY_STATUS_ID;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      panel.append(accountLabel, select, actions, status);
      ROOT.document.body.appendChild(panel);
    }
    libraryPanel = panel;
    fillLibraryPanelInputs(panel);
  }

  function openLibraryPanel() {
    ensureLibraryPanel();
    libraryPanelOpen = true;
    if (libraryPanel) libraryPanel.classList.add('xhs-enhanced-library-panel--open');
  }

  function closeLibraryPanel() {
    libraryPanelOpen = false;
    if (libraryPanel) libraryPanel.classList.remove('xhs-enhanced-library-panel--open');
  }

  function toggleLibraryPanel() {
    if (libraryPanelOpen) closeLibraryPanel();
    else openLibraryPanel();
  }

  function applyLibrarySettings() {
    if (!libraryPanel || !libraryPanel.isConnected) return;
    const base = libraryPanel.querySelector('#' + LIBRARY_BASE_INPUT_ID);
    const user = libraryPanel.querySelector('#' + LIBRARY_USER_INPUT_ID);
    const password = libraryPanel.querySelector('#' + LIBRARY_PASSWORD_INPUT_ID);
    const select = libraryPanel.querySelector('#' + LIBRARY_ACCOUNT_SELECT_ID);
    const parsed = parseBaseUrl(base ? base.value : '');
    if (!parsed.ok) {
      showLibraryStatus('服务器地址需以 http:// 或 https:// 开头');
      return;
    }
    const storage = getStorage();
    let persisted = false;
    if (storage) {
      try {
        storage.setItem(LIBRARY_BASE_URL_KEY, parsed.value);
        storage.setItem(LIBRARY_USERNAME_KEY, normalizeSpace(user ? user.value : ''));
        if (select && select.value) storage.setItem(LIBRARY_ACCOUNT_ID_KEY, select.value);
        persisted = true;
      } catch (_) {
        persisted = false;
      }
    }
    writeSecret(LIBRARY_PASSWORD_KEY, password ? password.value : '');
    clearLibraryTokens();
    showLibraryStatus(persisted ? '设置已保存' : '设置已应用，但未能持久化');
  }

  function testLibraryConnection() {
    if (!libraryPanel || !libraryPanel.isConnected) return;
    applyLibrarySettings();
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl) { showLibraryStatus('请先填写服务器地址'); return; }
    if (!cfg.username || !cfg.password) { showLibraryStatus('请先填写用户名与密码'); return; }
    if (!getGmRequest()) { showLibraryStatus(LIBRARY_GM_MISSING); return; }
    showLibraryStatus('正在连接内容库…');
    checkLibraryHealth(cfg.baseUrl).then(health => {
      if (!health.ok) { showLibraryStatus(LIBRARY_CONNECT_FAIL); return; }
      ensureLibraryToken(true).then(auth => {
        if (!auth.ok) { showLibraryStatus(LIBRARY_AUTH_FAIL); return; }
        fetchLibraryPcAccounts(auth.token, cfg.baseUrl).then(result => {
          if (!result.ok) { showLibraryStatus('登录成功，但获取账号列表失败'); return; }
          if (!result.accounts.length) { showLibraryStatus(LIBRARY_NO_ACCOUNT); return; }
          populateLibraryAccountSelect(result.accounts);
          const selected = readLibraryConfig().accountId;
          const picked = result.accounts.find(account => account.id === selected) || result.accounts[0];
          if (selected) showLibraryStatus('连接成功，当前账号：' + libraryAccountOptionLabel(picked));
          else showLibraryStatus('连接成功，发现 ' + result.accounts.length + ' 个账号，请选择后点击保存设置');
        });
      });
    });
  }

  function ensureLibraryToggle() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryToggle && libraryToggle.isConnected ? libraryToggle : ROOT.document.getElementById(LIBRARY_TOGGLE_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = LIBRARY_TOGGLE_ID;
      button.type = 'button';
      button.textContent = LIBRARY_TOGGLE_TEXT;
      button.setAttribute('aria-label', LIBRARY_TOGGLE_TEXT);
      button.addEventListener('click', toggleLibraryPanel);
      ROOT.document.body.appendChild(button);
    }
    libraryToggle = button;
  }

  function removeLibraryToggle() {
    const button = libraryToggle && libraryToggle.isConnected ? libraryToggle : ROOT.document && ROOT.document.getElementById(LIBRARY_TOGGLE_ID);
    if (button) button.remove();
    libraryToggle = null;
  }

  function ensureLibraryPageButton() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = LIBRARY_PAGE_BUTTON_ID;
      button.type = 'button';
      button.textContent = LIBRARY_PAGE_BUTTON_TEXT;
      button.setAttribute('aria-label', LIBRARY_PAGE_BUTTON_TEXT);
      button.addEventListener('click', onSaveCurrentDetail);
      ROOT.document.body.appendChild(button);
    }
    libraryPageButton = button;
  }

  function removeLibraryPageButton() {
    const button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT.document && ROOT.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (button) button.remove();
    libraryPageButton = null;
  }

  function ensureLibraryBatchButton() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = LIBRARY_BATCH_BUTTON_ID;
      button.type = 'button';
      button.textContent = LIBRARY_BATCH_BUTTON_TEXT;
      button.setAttribute('aria-label', LIBRARY_BATCH_BUTTON_TEXT);
      button.addEventListener('click', onSaveAllVisible);
      ROOT.document.body.appendChild(button);
    }
    libraryBatchButton = button;
  }

  function removeLibraryBatchButton() {
    const button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT.document && ROOT.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (button) button.remove();
    libraryBatchButton = null;
  }

  function removeLibraryUi() {
    removeLibraryToggle();
    removeLibraryPageButton();
    removeLibraryBatchButton();
    closeLibraryPanel();
    const panel = libraryPanel && libraryPanel.isConnected ? libraryPanel : ROOT.document && ROOT.document.getElementById(LIBRARY_PANEL_ID);
    if (panel) panel.remove();
    libraryPanel = null;
  }

  function syncLibraryUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    const route = getCurrentRoute();
    if (isDetailRoute(route)) {
      // Note detail views (also the nested search/profile modal URLs) get the
      // floating save button instead of the card-level tools.
      ensureLibraryToggle();
      ensureLibraryPageButton();
      removeLibraryBatchButton();
      return;
    }
    if (isTargetRoute(route)) {
      ensureLibraryToggle();
      ensureLibraryBatchButton();
      removeLibraryPageButton();
      return;
    }
    removeLibraryUi();
  }

  function syncJumpUi() {
    if (isTargetRoute(getCurrentRoute())) {
      ensureJumpUi();
      ensureThresholdUi();
    } else {
      removeJumpUi();
      removeThresholdUi();
    }
  }

  function flush() {
    scheduled = false;
    if (destroyed || !ROOT.document) return;
    counters.batches += 1;
    syncJumpUi();
    syncLibraryUi();
    const url = ROOT.location ? ROOT.location.href : getCurrentRoute();
    if (url !== lastUrl) {
      lastUrl = url;
      clearFallbackTokenCache();
      if (!isTargetRoute(getCurrentRoute())) cleanupAll();
      else for (const card of discoverCards(ROOT.document)) pending.add(card);
    }
    if (!isTargetRoute(getCurrentRoute())) {
      pending.clear();
      cleanupAll();
      return;
    }
    const batch = Array.from(pending);
    pending.clear();
    for (const candidate of batch) {
      const card = findCard(candidate) || (isReliableCard(candidate) ? candidate : null);
      if (card) renderCard(card);
    }
    applyProfileActions();
  }

  function schedule(root) {
    if (destroyed) return;
    if (root) {
      const card = findCard(root);
      if (card) pending.add(card);
      else for (const found of discoverCards(root)) pending.add(found);
    }
    if (scheduled) return;
    scheduled = true;
    const token = lifecycleToken;
    const run = () => {
      if (!token || !token.active || lifecycleToken !== token) return;
      flush();
    };
    if (typeof ROOT.requestAnimationFrame === 'function') ROOT.requestAnimationFrame(run);
    else Promise.resolve().then(run);
  }

  function scan(root) {
    if (!ROOT.document || !isTargetRoute(getCurrentRoute())) return;
    counters.fullScans += 1;
    for (const card of discoverCards(root || ROOT.document)) pending.add(card);
    schedule();
  }

  function mutationCallback(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' || mutation.type === 'characterData') schedule(mutation.target);
      else {
        schedule(mutation.target);
        for (const node of mutation.addedNodes) schedule(node);
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== 1) continue;
          node.classList.remove(LIKE_CLASS, CARD_CLASS, DIMMED_CLASS);
          node.removeAttribute(SIGNATURE_ATTRIBUTE);
          for (const stale of node.querySelectorAll(`.${LIKE_CLASS}`)) stale.classList.remove(LIKE_CLASS);
        }
      }
    }
  }

  function bind(target, type, handler) {
    target.addEventListener(type, handler);
    eventBindings.push([target, type, handler]);
  }

  function selectObserverRoot() {
    return ROOT.document.querySelector(SELECTORS.contentRoots) || ROOT.document.body;
  }

  function bindObserverRoot(nextRoot) {
    if (nextRoot === observerRoot && observer) return false;
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = nextRoot || null;
    if (!observerRoot || typeof ROOT.MutationObserver !== 'function') return false;
    observer = new ROOT.MutationObserver(mutationCallback);
    observer.observe(observerRoot, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: READ_ATTRIBUTES.slice() });
    return true;
  }

  function structureMutationCallback() {
    const nextRoot = selectObserverRoot();
    if (nextRoot === observerRoot && observerRoot && observerRoot.isConnected) return;
    if (bindObserverRoot(nextRoot)) scan(nextRoot);
  }

  function signalRoute() {
    if (destroyed) return;
    counters.routeSignals += 1;
    lastUrl = '';
    clearFallbackTokenCache();
    scan(ROOT.document);
    schedule();
  }

  function installHistorySignals() {
    if (!ROOT.history) return;
    originalPushState = ROOT.history.pushState;
    originalReplaceState = ROOT.history.replaceState;
    const upstreamPushState = originalPushState;
    const upstreamReplaceState = originalReplaceState;
    const token = lifecycleToken;
    ownedPushState = function (...args) {
      const result = upstreamPushState.apply(this, args);
      if (token && token.active && lifecycleToken === token) signalRoute();
      return result;
    };
    ownedReplaceState = function (...args) {
      const result = upstreamReplaceState.apply(this, args);
      if (token && token.active && lifecycleToken === token) signalRoute();
      return result;
    };
    ROOT.history.pushState = ownedPushState;
    ROOT.history.replaceState = ownedReplaceState;
  }

  function restoreHistorySignals() {
    if (ROOT.history) {
      if (ROOT.history.pushState === ownedPushState) ROOT.history.pushState = originalPushState;
      if (ROOT.history.replaceState === ownedReplaceState) ROOT.history.replaceState = originalReplaceState;
    }
    originalPushState = null;
    originalReplaceState = null;
    ownedPushState = null;
    ownedReplaceState = null;
  }

  function init() {
    if (!ROOT.document || initialized) return;
    initialized = true;
    lifecycleToken = { active: true };
    destroyed = false;
    threshold = readStoredThreshold();
    focusPopular = readStoredFocusPopular();
    ensureStyle();
    bindObserverRoot(selectObserverRoot());
    if (ROOT.document.documentElement && typeof ROOT.MutationObserver === 'function') {
      structureObserver = new ROOT.MutationObserver(structureMutationCallback);
      structureObserver.observe(ROOT.document.documentElement, { childList: true, subtree: true });
    }
    bind(ROOT, 'popstate', signalRoute);
    bind(ROOT, 'hashchange', signalRoute);
    bind(ROOT.document, 'visibilitychange', signalRoute);
    installHistorySignals();
    lastUrl = '';
    scan(ROOT.document);
    syncJumpUi();
    syncLibraryUi();
  }

  function destroy() {
    if (!initialized) return;
    initialized = false;
    if (lifecycleToken) lifecycleToken.active = false;
    lifecycleToken = null;
    destroyed = true;
    scheduled = false;
    pending.clear();
    fallbackTokenMap = null;
    fallbackTokenChecked = false;
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
    restoreHistorySignals();
    removeJumpUi();
    removeThresholdUi();
    removeLibraryUi();
    saveInFlight = false;
    clearCopyStatus();
    cleanupAll();
    const style = ROOT.document && ROOT.document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  const pureApi = Object.freeze({
    parseLikeCount, parseThreshold, readStoredThreshold, readStoredFocusPopular, isTargetRoute, isProfileRoute, isDetailRoute, getCurrentRoute, signatureFor, selectNextPopularCard, selectPreviousPopularCard,
    getNoteIdFromHref, buildShareLink, getXsecTokenFromHref, parseQueryValue, extractTokensFromState, findTokenForNoteIdInState, getFallbackTokenForNoteId, clearFallbackTokenCache,
    toNoWatermarkCoverUrl, extractCoverUrl, dataUrlToBlob, coverUrlCandidates, coverRequestHeaders, pickLargestFromSrcset,
    parseBaseUrl, readLibraryConfig, parseTokenExp, buildCrawlPayload, buildDetailNoteUrl, resolveSaveUrlFromCard,
    READ_ATTRIBUTES, SELECTORS
  });

  if (TEST_MODE) {
    const testApi = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) { routeProvider = () => String(pathname || ''); lastUrl = ''; if (scheduleChange) schedule(ROOT.document); },
      clearTestRoute() { routeProvider = null; lastUrl = ''; schedule(ROOT.document); },
      scan: () => scan(ROOT.document), flush, init, destroy, setThreshold: value => setThreshold(value), getThreshold: () => threshold,
      setFocusPopular: (value, storage) => setFocusPopular(value, storage), getFocusPopular: () => focusPopular,
      getCounters: () => Object.assign({}, counters, { bindings: eventBindings.length, ownedHistoryWrappers: Number(Boolean(ownedPushState)) + Number(Boolean(ownedReplaceState)), observerRootIsBody: observerRoot === ROOT.document.body })
    });
    ROOT.__XHS_ENHANCED_TEST_API__ = testApi;
    try { if (PAGE && PAGE !== ROOT) PAGE.__XHS_ENHANCED_TEST_API__ = testApi; } catch (_) {}
  }

  if (ROOT.document) init();
}());
