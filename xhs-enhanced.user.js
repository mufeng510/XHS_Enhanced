// ==UserScript==
// @name         小红书网页版增强
// @namespace    https://github.com/mufeng510/XHS_Enhanced
// @version      1.3.6
// @description  可配置热门阈值，高亮点赞数超过该阈值的笔记并快速跳转；用户主页每个笔记卡片支持复制链接（explore 格式含 xsec_token）与无水印封面
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.xiaohongshu.com/user/profile/*
// @grant        GM_xmlhttpRequest
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
// @updateURL    https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
// @downloadURL  https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
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
  const NOTE_ID_PATTERN = /\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/;
  // Real __INITIAL_STATE__ uses camelCase xsecToken; noteCard often has noteId next to xsecToken.
  const NOTE_ID_THEN_TOKEN_PATTERN = /"noteId"\s*:\s*"([0-9a-fA-F]+)"\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
  const TOKEN_THEN_NOTE_ID_PATTERN = /"xsecToken"\s*:\s*"([^"]+)"(?:(?!"xsecToken"\s*:)[\s\S]){0,1200}?"noteId"\s*:\s*"([0-9a-fA-F]+)"/g;
  const OUTER_ENTRY_TOKEN_PATTERN = /"id"\s*:\s*"([0-9a-fA-F]+)"(?:(?!"id"\s*:\s*")[\s\S]){0,4000}?"ssrRendered"\s*:\s*(?:true|false)\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
  const STATE_NOTES_PATTERN = /"notes"\s*:\s*\[/;

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
  const coverBlobCache = new Map();
  const COVER_CACHE_LIMIT = 80;
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

  function collectTokensFromStateObject(value, map, depth) {
    if (!value || depth > 14) return;
    if (Array.isArray(value)) {
      for (const item of value) collectTokensFromStateObject(item, map, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const id = typeof value.id === 'string' ? value.id
      : typeof value.noteId === 'string' ? value.noteId
        : '';
    const token = typeof value.xsecToken === 'string' ? value.xsecToken : '';
    if (id && token && !map[id]) map[id] = token;
    for (const key of Object.keys(value)) collectTokensFromStateObject(value[key], map, depth + 1);
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

  function buildFallbackTokenMap() {
    const map = Object.create(null);
    try {
      const initialState = (PAGE && PAGE.__INITIAL_STATE__) || ROOT.__INITIAL_STATE__;
      if (initialState) collectTokensFromStateObject(initialState, map, 0);
    } catch (_) {
      // fall through to script text
    }
    if (Object.keys(map).length) return map;
    const doc = ROOT.document;
    if (!doc || !doc.querySelectorAll) return map;
    try {
      const scripts = doc.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.indexOf('__INITIAL_STATE__') < 0) continue;
        if (!STATE_NOTES_PATTERN.test(content) && content.indexOf('xsecToken') < 0) continue;
        const found = extractTokensFromState(content);
        for (const key of Object.keys(found)) {
          if (!map[key]) map[key] = found[key];
        }
        if (Object.keys(map).length) break;
      }
    } catch (_) {
      // ignore: callers fall back to a token-less link
    }
    return map;
  }

  function getFallbackTokenForNoteId(noteId) {
    if (!noteId) return '';
    if (fallbackTokenMap && fallbackTokenMap[noteId]) return fallbackTokenMap[noteId];
    // Rebuild on miss so infinite-scroll notes that arrive after the first parse still resolve.
    fallbackTokenMap = buildFallbackTokenMap();
    fallbackTokenChecked = true;
    return fallbackTokenMap[noteId] || '';
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
      if (!text) return;
      if (out.indexOf(text) >= 0) return;
      out.push(text);
    };
    // Prefer no-watermark first, then the exact displayed URL (often still hotlink-signed).
    push(normalized);
    push(original);
    // Some CDN object keys only serve processed derivatives; rebuild common web variants.
    if (normalized && normalized === original && !/!/.test(normalized.split('?')[0])) {
      push(normalized.replace(/([?].*)?$/, '!nd_dft_wlteh_webp_3$1'));
      push(normalized.replace(/([?].*)?$/, '!nd_prv_wlteh_webp_3$1'));
    }
    return out;
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
    // Prefer createImageBitmap to avoid extra blob: network noise from <img src=blob:>.
    if (typeof ROOT.createImageBitmap === "function") {
      return ROOT.createImageBitmap(blob).then(bitmap => {
        try {
          const canvas = ROOT.document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          if (!canvas.width || !canvas.height) {
            try { bitmap.close(); } catch (_) {}
            return transferBlobToPage(blob);
          }
          const ctx = canvas.getContext("2d");
          ctx.drawImage(bitmap, 0, 0);
          try { bitmap.close(); } catch (_) {}
          if (typeof canvas.toBlob === "function") {
            return new Promise(resolve => {
              canvas.toBlob(out => {
                if (!out) { resolve(transferBlobToPage(blob)); return; }
                transferBlobToPage(out).then(resolve, () => resolve(out));
              }, "image/png");
            });
          }
          return Promise.resolve(dataUrlToBlob(canvas.toDataURL("image/png"), "image/png"));
        } catch (_) {
          try { bitmap.close(); } catch (e2) {}
          return transferBlobToPage(blob);
        }
      }, () => transferBlobToPage(blob));
    }
    return new Promise(resolve => {
      try {
        if (!ROOT.URL || typeof ROOT.URL.createObjectURL !== "function" || typeof ROOT.Image !== "function") {
          resolve(transferBlobToPage(blob));
          return;
        }
        const objectUrl = ROOT.URL.createObjectURL(blob);
        const img = new ROOT.Image();
        img.onload = () => {
          canvasToPngBlob(img).then(png => {
            try { ROOT.URL.revokeObjectURL(objectUrl); } catch (_) {}
            if (png) resolve(png);
            else transferBlobToPage(blob).then(resolve, () => resolve(blob));
          });
        };
        img.onerror = () => {
          try { ROOT.URL.revokeObjectURL(objectUrl); } catch (_) {}
          transferBlobToPage(blob).then(resolve, () => resolve(blob));
        };
        img.src = objectUrl;
      } catch (_) {
        transferBlobToPage(blob).then(resolve, () => resolve(blob));
      }
    });
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

  function copyImage(dataUrl, mimeType) {
    const blob = dataUrlToBlob(dataUrl, mimeType || "image/png");
    if (!blob) return Promise.resolve(false);
    return copyImageBlob(blob);
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
    if (!key) return null;
    const hit = coverBlobCache.get(key);
    return hit && typeof hit.size === "number" ? hit : null;
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

  function gmFetchCoverBlob(url) {
    if (!url || /^(?:data:|blob:)/i.test(url)) return Promise.resolve(null);
    if (!getGmRequest()) return Promise.resolve(null);
    return gmRequestOnce(url, "blob").then(raw => {
      if (raw && (typeof raw.size === "number")) {
        const blob = normalizeFetchedImageBlob(raw, url);
        if (blob) return blob;
      }
      return gmRequestOnce(url, "arraybuffer").then(buf => {
        if (!buf) return null;
        try {
          const view = buf instanceof ROOT.ArrayBuffer ? new ROOT.Uint8Array(buf) : new ROOT.Uint8Array(buf.buffer || buf);
          if (view.byteLength < 32) return null;
          if (!looksLikeImageBytes(view)) return null;
          const BlobCtor = getPageBlobCtor() || ROOT.Blob;
          return new BlobCtor([view], { type: guessImageMimeFromUrl(url) });
        } catch (_) { return null; }
      });
    });
  }

  function loadCoverViaImage(url) {
    return new Promise(resolve => {
      try {
        if (typeof ROOT.Image !== "function") { resolve(null); return; }
        if (/^data:/i.test(url)) { resolve(dataUrlToBlob(url, "image/png")); return; }
        if (!/^blob:/i.test(url)) { resolve(null); return; }
        const img = new ROOT.Image();
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        img.onload = () => { canvasToPngBlob(img).then(finish); };
        img.onerror = () => finish(null);
        img.src = url;
      } catch (_) { resolve(null); }
    });
  }

  function loadCoverFromCardImage(card) {
    if (!card || !card.querySelector) return Promise.resolve(null);
    try {
      const images = card.querySelectorAll(COVER_IMAGE_SELECTORS);
      for (const img of images) {
        if (!img || !(img.naturalWidth || img.width) || !(img.naturalHeight || img.height)) continue;
        return canvasToPngBlob(img).then(blob => blob || null, () => null);
      }
    } catch (_) {}
    return Promise.resolve(null);
  }

  function resolveCoverBlobFromCandidates(candidates) {
    let chain = Promise.resolve(null);
    for (const url of candidates) {
      chain = chain.then(prev => {
        if (prev) return prev;
        const cached = getCachedCoverBlob(url);
        if (cached) return cached;
        return gmFetchCoverBlob(url).then(viaGm => {
          if (!viaGm) return null;
          cacheCoverBlob(url, viaGm);
          return viaGm;
        }).then(png => {
          if (png) return png;
          return fetchCoverBlob(url).then(viaFetch => {
            if (!viaFetch) return null;
            cacheCoverBlob(url, viaFetch);
            return viaFetch;
          });
        }).then(png => {
          if (png) return png;
          return loadCoverViaImage(url);
        });
      });
    }
    return chain;
  }

  // Soft prefetch only the first visible candidate; no blob: transcode during prefetch.
  function prefetchCardCover(card) {
    try {
      if (!getGmRequest()) return;
      const src = extractCoverUrl(card);
      if (!src || /^(?:data:|blob:)/i.test(src)) return;
      const primary = coverUrlCandidates(src)[0];
      if (!primary || getCachedCoverBlob(primary) || coverBlobCache.has(primary + "#pending")) return;
      coverBlobCache.set(primary + "#pending", true);
      gmFetchCoverBlob(primary).then(blob => {
        coverBlobCache.delete(primary + "#pending");
        if (blob) cacheCoverBlob(primary, blob);
      }, () => { coverBlobCache.delete(primary + "#pending"); });
    } catch (_) {}
  }

  function loadCoverPngBlob(src, card) {
    const candidates = coverUrlCandidates(src);
    return loadCoverFromCardImage(card).then(fromDom => {
      if (fromDom) return fromDom;
      return resolveCoverBlobFromCandidates(candidates);
    }).then(blob => (blob ? { ok: true, blob, mimeType: blob.type || "image/png" } : { ok: false }));
  }

  function loadCoverDataUrl(src) {
    return loadCoverPngBlob(src).then(result => {
      if (!result.ok || !result.blob) return { ok: false };
      return new Promise(resolve => {
        try {
          if (typeof ROOT.FileReader !== "function") { resolve({ ok: false }); return; }
          const reader = new ROOT.FileReader();
          reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result || ""), mimeType: "image/png" });
          reader.onerror = () => resolve({ ok: false });
          reader.readAsDataURL(result.blob);
        } catch (_) { resolve({ ok: false }); }
      });
    });
  }

  function onCopyLink(card) {
    const link = extractNoteLink(card);
    if (!link) { showCopyStatus(COPY_LINK_FAIL); return; }
    copyText(link).then(ok => showCopyStatus(ok ? COPY_LINK_OK : COPY_LINK_FAIL));
  }

  function onCopyCover(card) {
    const src = extractCoverUrl(card);
    if (!src) { showCopyStatus(COPY_COVER_FAIL); return; }
    // Start clipboard write in the same turn as the click (Promise ClipboardItem),
    // so the async GM download still counts as user-activated.
    const blobPromise = loadCoverPngBlob(src, card).then(result => {
      if (!result.ok || !result.blob) throw new Error("cover-load-failed");
      return result.blob;
    });
    copyImageBlobPromise(blobPromise).then(copied => {
      if (copied) showCopyStatus(COPY_COVER_OK);
      else showCopyStatus(getGmRequest() ? COPY_COVER_FAIL : (COPY_COVER_FAIL + "???????"));
    }, () => showCopyStatus(COPY_COVER_FAIL));
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
    prefetchCardCover(card);
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
    fallbackTokenMap = null;
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
    clearCopyStatus();
    cleanupAll();
    const style = ROOT.document && ROOT.document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  const pureApi = Object.freeze({
    parseLikeCount, parseThreshold, readStoredThreshold, isTargetRoute, isProfileRoute, getCurrentRoute, signatureFor, selectNextPopularCard,
    getNoteIdFromHref, buildShareLink, getXsecTokenFromHref, parseQueryValue, extractTokensFromState,
    toNoWatermarkCoverUrl, extractCoverUrl, dataUrlToBlob, coverUrlCandidates, coverRequestHeaders, getGmRequest, pickLargestFromSrcset,
    READ_ATTRIBUTES, SELECTORS
  });

  if (TEST_MODE) {
    const testApi = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) { routeProvider = () => String(pathname || ''); lastUrl = ''; if (scheduleChange) schedule(ROOT.document); },
      clearTestRoute() { routeProvider = null; lastUrl = ''; schedule(ROOT.document); },
      scan: () => scan(ROOT.document), flush, init, destroy, setThreshold: value => setThreshold(value), getThreshold: () => threshold,
      getCounters: () => Object.assign({}, counters, { bindings: eventBindings.length, ownedHistoryWrappers: Number(Boolean(ownedPushState)) + Number(Boolean(ownedReplaceState)), observerRootIsBody: observerRoot === ROOT.document.body })
    });
    ROOT.__XHS_ENHANCED_TEST_API__ = testApi;
    try { if (PAGE && PAGE !== ROOT) PAGE.__XHS_ENHANCED_TEST_API__ = testApi; } catch (_) {}
  }

  if (ROOT.document) init();
}());
