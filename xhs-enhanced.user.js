// ==UserScript==
// @name         小红书网页版增强
// @namespace    https://github.com/mufeng510/XHS_Enhanced
// @version      1.3.1
// @description  可配置热门阈值，高亮点赞数超过该阈值的笔记并快速跳转；用户主页每个笔记卡片支持复制链接（explore 格式含 xsec_token）与封面
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.xiaohongshu.com/user/profile/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/mufeng510/XHS_Enhanced
// @supportURL   https://github.com/mufeng510/XHS_Enhanced/issues
// @updateURL    https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
// @downloadURL  https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
// @license      MIT
// @author       mufeng510
// ==/UserScript==

(function () {
  'use strict';

  const ROOT = globalThis;
  const TEST_MODE = ROOT.__XHS_ENHANCED_TEST_MODE__ === true;
  const DEFAULT_THRESHOLD = 100;
  const THRESHOLD_STORAGE_KEY = 'xhs-enhanced:popular-threshold';
  const STYLE_ID = 'xhs-enhanced-style';
  const CARD_CLASS = 'xhs-enhanced-card--popular';
  const LIKE_CLASS = 'xhs-enhanced-like--popular';
  const SIGNATURE_ATTRIBUTE = 'data-xhs-enhanced-signature';
  const JUMP_BUTTON_ID = 'xhs-enhanced-jump-next';
  const JUMP_STATUS_ID = 'xhs-enhanced-jump-status';
  const THRESHOLD_CONTROL_ID = 'xhs-enhanced-threshold-control';
  const THRESHOLD_INPUT_ID = 'xhs-enhanced-threshold-input';
  const THRESHOLD_STATUS_ID = 'xhs-enhanced-threshold-status';
  const JUMP_BUTTON_TEXT = '下一条热门笔记';
  const LAST_NOTE_TEXT = '已经是最后一条热门笔记';
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
  const COVER_IMAGE_SELECTORS = 'img.cover,img[src*="sns-img"],img[src*="xhscdn"],picture img,article img,section.note-item img,.note-item img';
  const COPY_STATUS_ID = 'xhs-enhanced-copy-status';
  const SHARE_BASE = 'https://www.xiaohongshu.com/';
  const XSEC_TOKEN_QUERY = 'xsec_token';
  const XSEC_SOURCE_VALUE = 'pc_feed';
  const INITIAL_STATE_TOKEN_PATTERN = /"xsec_token"\s*:\s*"([^"]+)"/;

  const SELECTORS = Object.freeze({
    noteLinks: 'a[href*="/explore/"],a[href*="/discovery/item/"]',
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
  let jumpButton = null;
  let jumpStatus = null;
  let thresholdControl = null;
  let thresholdInput = null;
  let thresholdStatus = null;
  let threshold = DEFAULT_THRESHOLD;
  let jumpStatusTimer = null;
  let copyStatus = null;
  let copyStatusTimer = null;
  let fallbackXsecToken = '';
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
    const path = String(pathname || '').split('?')[0];
    return path === '/search_result' || path.startsWith('/user/profile/');
  }

  function isProfileRoute(pathname) {
    const path = String(pathname || '').split('?')[0];
    return path.startsWith('/user/profile/');
  }

  function getNoteIdFromHref(href) {
    const text = String(href == null ? '' : href);
    if (!text) return '';
    const match = text.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/);
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

  function getFallbackXsecToken() {
    if (fallbackTokenChecked) return fallbackXsecToken;
    fallbackTokenChecked = true;
    fallbackXsecToken = '';
    const doc = ROOT.document;
    if (!doc || !doc.querySelectorAll) return '';
    try {
      const scripts = doc.querySelectorAll('script:not([src])');
      let found = '';
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.indexOf('__INITIAL_STATE__') < 0 && content.indexOf('xsec_token') < 0) continue;
        const match = content.match(INITIAL_STATE_TOKEN_PATTERN);
        if (match && match[1]) { found = match[1]; break; }
      }
      fallbackXsecToken = found;
    } catch (_) {
      fallbackXsecToken = '';
    }
    return fallbackXsecToken;
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
    if (!token) token = getFallbackXsecToken();
    return buildShareLink(id, token);
  }

  function extractCoverUrl(card) {
    if (!card || !card.querySelector) return '';
    const img = card.querySelector(COVER_IMAGE_SELECTORS);
    if (!img) return '';
    const src = img.getAttribute('src') || img.currentSrc || '';
    return normalizeSpace(src);
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

  function copyText(text) {
    if (!ROOT.navigator || !ROOT.navigator.clipboard || typeof ROOT.navigator.clipboard.writeText !== 'function') {
      return Promise.resolve(false);
    }
    return ROOT.navigator.clipboard.writeText(text).then(() => true, () => false);
  }

  function copyImage(dataUrl, mimeType) {
    if (!ROOT.navigator || !ROOT.navigator.clipboard || typeof ROOT.navigator.ClipboardItem !== 'function') {
      return Promise.resolve(false);
    }
    try {
      const blob = dataUrlToBlob(dataUrl, mimeType);
      if (!blob) return Promise.resolve(false);
      const item = new ROOT.navigator.ClipboardItem({ [blob.type]: blob });
      return ROOT.navigator.clipboard.write([item]).then(() => true, () => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function dataUrlToBlob(dataUrl, mimeType) {
    if (!dataUrl) return null;
    if (!/^data:/.test(dataUrl)) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const typeMatch = header.match(/^data:([^;,]*)/);
    const type = (typeMatch && typeMatch[1]) || mimeType || 'application/octet-stream';
    try {
      const text = ROOT.atob ? ROOT.atob(body) : body;
      const length = text.length;
      const bytes = new Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
      return new ROOT.Blob(bytes, { type });
    } catch (_) {
      return null;
    }
  }

  function onCopyLink(card) {
    const link = extractNoteLink(card);
    if (!link) { showCopyStatus(COPY_LINK_FAIL); return; }
    copyText(link).then(ok => showCopyStatus(ok ? COPY_LINK_OK : COPY_LINK_FAIL));
  }

  function onCopyCover(card) {
    const src = extractCoverUrl(card);
    if (!src) { showCopyStatus(COPY_COVER_FAIL); return; }
    loadCoverDataUrl(src).then(({ ok, dataUrl, mimeType }) => {
      if (!ok || !dataUrl) { showCopyStatus(COPY_COVER_FAIL); return; }
      copyImage(dataUrl, mimeType).then(copied => showCopyStatus(copied ? COPY_COVER_OK : COPY_COVER_FAIL));
    });
  }

  function loadCoverDataUrl(src) {
    return new Promise(resolve => {
      try {
        if (typeof ROOT.Image !== 'function') { resolve({ ok: false }); return; }
        const img = new ROOT.Image();
        const mimeType = /^data:/.test(src) ? (src.match(/^data:([^;,]*)/) || [])[1] || 'image/png' : 'image/png';
        img.onload = () => {
          try {
            const canvas = ROOT.document.createElement('canvas');
            if (!canvas || typeof canvas.getContext !== 'function') { resolve({ ok: false }); return; }
            canvas.width = img.naturalWidth || img.width || 0;
            canvas.height = img.naturalHeight || img.height || 0;
            if (!canvas.width || !canvas.height) { resolve({ ok: false }); return; }
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL(mimeType);
            resolve({ ok: true, dataUrl, mimeType });
          } catch (_) { resolve({ ok: false }); }
        };
        img.onerror = () => resolve({ ok: false });
        img.crossOrigin = 'anonymous';
        img.src = src;
      } catch (_) { resolve({ ok: false }); }
    });
  }

  function ensureCardActions(card) {
    if (!card || !card.querySelector || !card.isConnected) return;
    if (!isProfileRoute(getCurrentRoute())) {
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
      container.append(linkButton, coverButton);
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
      #${JUMP_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${JUMP_BUTTON_ID}:hover{background:#e61e3c}#${JUMP_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${THRESHOLD_CONTROL_ID}{position:fixed;top:138px;right:24px;z-index:2147483646;display:flex;gap:6px;align-items:center;padding:8px;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.16);font:14px/1.4 system-ui,sans-serif}
      #${THRESHOLD_INPUT_ID}{width:72px;border:1px solid #aaa;border-radius:4px;padding:5px 6px;font:inherit}#${THRESHOLD_CONTROL_ID} button{border:0;border-radius:4px;padding:6px 9px;background:#ff2442;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
      #${THRESHOLD_STATUS_ID}{position:fixed;top:190px;right:24px;z-index:2147483646;max-width:260px;padding:7px 10px;border-radius:6px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
      #${JUMP_STATUS_ID}{position:fixed;top:228px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
      #${COPY_STATUS_ID}{position:fixed;top:276px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
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
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);

    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    ensureCardActions(card);
    counters.processed += 1;
  }

  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
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

  function clearJumpStatus() {
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = null;
    const node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document && ROOT.document.getElementById(JUMP_STATUS_ID);
    if (node) node.remove();
    jumpStatus = null;
  }

  function showJumpStatus() {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document.getElementById(JUMP_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = JUMP_STATUS_ID;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.textContent = LAST_NOTE_TEXT;
      ROOT.document.body.appendChild(node);
    }
    jumpStatus = node;
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

  function ensureJumpUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = JUMP_BUTTON_ID;
      button.type = 'button';
      button.textContent = JUMP_BUTTON_TEXT;
      button.setAttribute('aria-label', JUMP_BUTTON_TEXT);
      button.addEventListener('click', jumpToNextPopularCard);
      ROOT.document.body.appendChild(button);
    }
    jumpButton = button;
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
    const button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document && ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (button) {
      button.removeEventListener('click', jumpToNextPopularCard);
      button.remove();
    }
    jumpButton = null;
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
    const url = ROOT.location ? ROOT.location.href : getCurrentRoute();
    if (url !== lastUrl) {
      lastUrl = url;
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
          node.classList.remove(LIKE_CLASS, CARD_CLASS);
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
    fallbackXsecToken = '';
    fallbackTokenChecked = false;
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
  }

  function destroy() {
    if (!initialized) return;
    initialized = false;
    if (lifecycleToken) lifecycleToken.active = false;
    lifecycleToken = null;
    destroyed = true;
    scheduled = false;
    pending.clear();
    fallbackXsecToken = '';
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
    clearCopyStatus();
    cleanupAll();
    const style = ROOT.document && ROOT.document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  const pureApi = Object.freeze({
    parseLikeCount, parseThreshold, readStoredThreshold, isTargetRoute, isProfileRoute, getCurrentRoute, signatureFor, selectNextPopularCard,
    getNoteIdFromHref, buildShareLink, getXsecTokenFromHref, parseQueryValue,
    READ_ATTRIBUTES, SELECTORS
  });

  if (TEST_MODE) {
    ROOT.__XHS_ENHANCED_TEST_API__ = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) { routeProvider = () => String(pathname || ''); lastUrl = ''; if (scheduleChange) schedule(ROOT.document); },
      clearTestRoute() { routeProvider = null; lastUrl = ''; schedule(ROOT.document); },
      scan: () => scan(ROOT.document), flush, init, destroy, setThreshold: value => setThreshold(value), getThreshold: () => threshold,
      getCounters: () => Object.assign({}, counters, { bindings: eventBindings.length, ownedHistoryWrappers: Number(Boolean(ownedPushState)) + Number(Boolean(ownedReplaceState)), observerRootIsBody: observerRoot === ROOT.document.body })
    });
  }

  if (ROOT.document) init();
}());
