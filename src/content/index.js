// 小红书网页版增强 — content script (isolated world).
// Highlights hot notes, adds jump/copy/save UI. Library settings live on the
// extension options page; everything privileged goes through the background
// service worker. Mirrors the legacy userscript behaviour and test seams.
import { getRoot, isTestMode } from '../lib/env.js';
import { normalizeSpace } from '../lib/text.js';
import {
  DEFAULT_THRESHOLD,
  THRESHOLD_STORAGE_KEY,
  FOCUS_STORAGE_KEY,
  parseThreshold,
  parseLikeCount,
  isTargetRoute,
  isProfileRoute,
  isDetailRoute,
  getNoteIdFromHref,
  parseQueryValue,
  getXsecTokenFromHref,
  findTokenForNoteIdInState,
  buildShareLink,
  signatureFor,
  toNoWatermarkCoverUrl,
  toCdnObjectPath,
  coverUrlCandidates,
  isForcedJpegCandidate,
  pickLargestFromSrcset,
  buildCoverFileName,
  sniffImageMimeFromBytes,
  looksLikeImageBytes,
  isJpegBlob,
  parseBaseUrl,
  parseTokenExp,
  buildCrawlPayload,
  parseInitialStateFromScriptText
} from '../lib/pure.js';
import {
  ready,
  readStoredThreshold,
  readStoredFocusPopular,
  readLibraryConfig
} from '../lib/settings.js';
import { hasPrivilegedChannel } from '../lib/remote.js';
import {
  saveNoteUrlsToLibrary,
  LIBRARY_BATCH_LIMIT
} from '../lib/library.js';
import { createInitialStateResolver } from '../lib/initial-state.js';
import {
  dataUrlToBlob,
  loadCoverPngBlob,
  resolveCoverBlobFromCandidates,
  ensureJpegCoverBlob,
  copyImageBlob,
  copyText,
  triggerCoverDownload
} from '../lib/cover.js';

const ROOT = getRoot();
const TEST_MODE = isTestMode();

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
const DIMMED_CLASS = 'xhs-enhanced-card--dimmed';
const CARD_ACTIONS_CLASS = 'xhs-enhanced-card-actions';
const COPY_LINK_CLASS = 'xhs-enhanced-copy-link';
const COPY_COVER_CLASS = 'xhs-enhanced-copy-cover';
const DOWNLOAD_COVER_CLASS = 'xhs-enhanced-download-cover';
const COPY_LINK_TEXT = '复制链接';
const COPY_COVER_TEXT = '复制封面';
const DOWNLOAD_COVER_TEXT = '下载封面';
const COPY_LINK_OK = '已复制笔记链接';
const COPY_LINK_FAIL = '链接复制失败';
const COPY_COVER_OK = '已复制笔记封面';
const COPY_COVER_FAIL = '封面复制失败';
const COPY_COVER_AUTH_FAIL = '封面复制失败（扩展无特权通道）';
const DOWNLOAD_COVER_OK = '已下载笔记封面';
const DOWNLOAD_COVER_FAIL = '封面下载失败';
const DOWNLOAD_COVER_AUTH_FAIL = '封面下载失败（扩展无特权通道）';
const DOWNLOAD_COVER_MISSING = '未找到笔记封面';
const COVER_IMAGE_SELECTORS = 'img.cover,img[src*="sns-img"],img[src*="xhscdn"],picture img,article img,section.note-item img,.note-item img';
const COPY_STATUS_ID = 'xhs-enhanced-copy-status';
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
const LIBRARY_SAVED_OK = '已保存到内容库';
const LIBRARY_SAVE_FAIL = '内容库保存失败';
const LIBRARY_NO_TOKEN = '未获取到 xsec_token，无法采集';
const LIBRARY_NO_CONFIG = '请先配置内容库（扩展选项页）';
const LIBRARY_NO_ACCOUNT = '内容库未发现可用的小红书 PC 端账号';
const LIBRARY_AUTH_FAIL = '内容库登录失败，请检查用户名与密码';
const LIBRARY_CONNECT_FAIL = '无法连接内容库服务';
const LIBRARY_CHANNEL_MISSING = '扩展无法访问内容库（请重新加载扩展后再试）';
const LIBRARY_PERMISSION_MISSING = '内容库服务器未授权：打开扩展选项页点“测试连接”并允许访问该地址';

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
let copyCoverInFlight = false;
let downloadCoverInFlight = false;
let saveInFlight = false;
let libraryToggle = null;
let libraryPageButton = null;
let libraryBatchButton = null;
let fallbackTokenResolver = null;
const pending = new Set();
const counters = { batches: 0, processed: 0, fullScans: 0, routeSignals: 0 };
const eventBindings = [];

function getResolver() {
  if (!fallbackTokenResolver) {
    fallbackTokenResolver = createInitialStateResolver(() => (ROOT.document || null));
  }
  return fallbackTokenResolver;
}

function getStateObject() {
  return getResolver().getStateObject();
}

function getFallbackTokenForNoteId(noteId) {
  return getResolver().getFallbackTokenForNoteId(noteId);
}

function clearFallbackTokenCache() {
  if (fallbackTokenResolver) fallbackTokenResolver.clearFallbackTokenCache();
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
      // A valid setting still applies for this page when storage is unavailable.
    }
  }
  return { ok: true, value: threshold, persisted };
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

  function resolveCardNoteLink(card) {
    if (!card || !card.querySelectorAll) return '';
    let tokenHref = '';
    let fallbackHref = '';
    for (const link of Array.from(card.querySelectorAll(SELECTORS.noteLinks))) {
      const href = link.getAttribute('href') || link.getAttribute('xhs:href') || '';
      const id = getNoteIdFromHref(href);
      if (!id) continue;
      if (!tokenHref && getXsecTokenFromHref(href)) tokenHref = href;
      else if (!fallbackHref) fallbackHref = href;
    }
    const href = tokenHref || fallbackHref;
    const id = getNoteIdFromHref(href);
    if (!id) return '';
    let token = getXsecTokenFromHref(href);
    if (!token) token = getFallbackTokenForNoteId(id);
    return buildShareLink(id, token);
  }

  function extractNoteLink(card) {
    return resolveCardNoteLink(card);
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
      if (!result.ok || !result.blob) throw new Error('cover-load-failed');
      return result.blob;
    });
    copyImageBlob(blobPromise).then(copied => {
      copyCoverInFlight = false;
      showCopyStatus(copied ? COPY_COVER_OK : (hasPrivilegedChannel() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL));
    }, () => {
      copyCoverInFlight = false;
      showCopyStatus(hasPrivilegedChannel() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL);
    });
  }

  function onDownloadCover(card) {
    if (downloadCoverInFlight) return;
    const src = extractCoverUrl(card);
    if (!src) { showCopyStatus(DOWNLOAD_COVER_MISSING); return; }
    downloadCoverInFlight = true;
    loadCoverPngBlob(src)
      .then(result => {
        if (!result.ok || !result.blob) throw new Error('cover-load-failed');
        return result.blob;
      })
      .then(blob => ensureJpegCoverBlob(blob))
      .then(blob => {
        downloadCoverInFlight = false;
        const ok = triggerCoverDownload(blob, buildCoverFileName(cardNoteTargetId(card), src, blob ? blob.type : ''));
        showCopyStatus(ok ? DOWNLOAD_COVER_OK : (hasPrivilegedChannel() ? DOWNLOAD_COVER_FAIL : DOWNLOAD_COVER_AUTH_FAIL));
      }, () => {
        downloadCoverInFlight = false;
        showCopyStatus(hasPrivilegedChannel() ? DOWNLOAD_COVER_FAIL : DOWNLOAD_COVER_AUTH_FAIL);
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

  function openLibrarySettings() {
    const chrome = ROOT.chrome;
    try {
      if (chrome && chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        chrome.runtime.openOptionsPage();
        return true;
      }
    } catch (_) {}
    showCopyStatus('请在扩展详情页打开"选项"配置内容库');
    return false;
  }

  function submitNoteUrlsToLibrary(urls, options) {
    const silent = Boolean(options && options.silent);
    if (saveInFlight) return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) {
      if (!silent) {
        showCopyStatus(LIBRARY_NO_CONFIG);
        openLibrarySettings();
      }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!cfg.accountId) {
      if (!silent) {
        showCopyStatus(LIBRARY_NO_ACCOUNT);
        openLibrarySettings();
      }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!hasPrivilegedChannel()) {
      if (!silent) showCopyStatus(LIBRARY_CHANNEL_MISSING);
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
        if (result.error === 'config-missing') { showCopyStatus(LIBRARY_NO_CONFIG); openLibrarySettings(); }
        else if (result.error === 'account-missing') { showCopyStatus(LIBRARY_NO_ACCOUNT); openLibrarySettings(); }
        else if (result.error === 'auth-failed') showCopyStatus(LIBRARY_AUTH_FAIL);
        else if (result.error === 'permission') showCopyStatus(LIBRARY_PERMISSION_MISSING);
        else if (result.error === 'unreachable' || result.error === 'network' || result.error === 'timeout') showCopyStatus(LIBRARY_CONNECT_FAIL);
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
      const downloadButton = ROOT.document.createElement('button');
      downloadButton.type = 'button';
      downloadButton.className = DOWNLOAD_COVER_CLASS;
      downloadButton.textContent = DOWNLOAD_COVER_TEXT;
      downloadButton.setAttribute('aria-label', DOWNLOAD_COVER_TEXT);
      downloadButton.addEventListener('click', () => onDownloadCover(card));
      const saveButton = ROOT.document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = SAVE_LIBRARY_CLASS;
      saveButton.textContent = SAVE_LIBRARY_TEXT;
      saveButton.setAttribute('aria-label', SAVE_LIBRARY_TEXT);
      saveButton.addEventListener('click', () => onSaveToLibrary(card, saveButton));
      container.append(linkButton, coverButton, downloadButton, saveButton);
      card.appendChild(container);
    }
  }

  function removeCardActions(card) {
    if (!card || !card.querySelectorAll) return;
    const container = card.querySelector('.' + CARD_ACTIONS_CLASS);
    if (container) container.remove();
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

  function cardNoteTargetId(card) {
    if (!card || !card.querySelectorAll) return '';
    let targetId = '';
    for (const link of Array.from(card.querySelectorAll(SELECTORS.noteLinks))) {
      const href = link.getAttribute('href') || link.getAttribute('xhs:href') || '';
      const id = getNoteIdFromHref(href);
      if (!id) continue;
      if (targetId && targetId !== id) return '';
      targetId = id;
    }
    return targetId;
  }

  function isReliableCard(card) {
    if (!card || !card.querySelector) return false;
    return Boolean(cardNoteTargetId(card)) && Boolean(card.querySelector(SELECTORS.likeNodes));
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
      if (card && card.isConnected && cardNoteTargetId(card)) cards.add(card);
    }
    return Array.from(cards);
  }

  function applyCardActionsFallback() {
    if (!ROOT.document || !isTargetRoute(getCurrentRoute())) return;
    for (const card of discoverLinkCards(ROOT.document)) ensureCardActions(card);
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
      .${CARD_ACTIONS_CLASS}{position:absolute;top:6px;left:6px;z-index:2147483640;display:flex;gap:4px;opacity:0;transition:opacity .15s ease;pointer-events:none}
      .xhs-enhanced-card--popular .${CARD_ACTIONS_CLASS},.note-item:hover .${CARD_ACTIONS_CLASS},section.note-item:hover .${CARD_ACTIONS_CLASS},article.note-item:hover .${CARD_ACTIONS_CLASS}{opacity:1;pointer-events:auto}
      [data-note-card],article.note-item,section.note-item,.note-item{position:relative}
      .${CARD_ACTIONS_CLASS} button{border:0;border-radius:6px;padding:5px 9px;background:rgba(255,36,66,.92);color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}
      .${CARD_ACTIONS_CLASS} button:hover{background:#e61e3c}
      .${COPY_COVER_CLASS}{background:rgba(30,30,30,.82)!important}
      .${DOWNLOAD_COVER_CLASS}{background:rgba(37,99,235,.92)!important}
      .${DOWNLOAD_COVER_CLASS}:hover{background:rgba(29,78,216,1)!important}
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
    // Move buttons left over from an older version into the nav row, but
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
    // Also drop stray buttons that an older version may have left on body.
    for (const id of [JUMP_PREV_BUTTON_ID, JUMP_BUTTON_ID, FOCUS_TOGGLE_ID]) {
      const stray = ROOT.document && ROOT.document.getElementById(id);
      if (stray) stray.remove();
    }
    jumpNav = null;
    jumpButton = null;
    jumpPrevButton = null;
    focusToggle = null;
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
      button.addEventListener('click', openLibrarySettings);
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
  }

  function syncLibraryUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    const route = getCurrentRoute();
    if (isDetailRoute(route)) {
      // Note detail views (also the nested search/profile modal URLs) get the
      // floating save button instead of the batch tools.
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
      counters.routeSignals += 1;
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
    applyCardActionsFallback();
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
    // Explicit route-ish signals. The href comparison inside flush() performs
    // the actual URL-change detection (and token-cache reset) on any flush.
    if (destroyed) return;
    scan(ROOT.document);
    schedule();
  }

  // SPA route changes are detected by the href comparison in flush() (any
  // mutation or event that schedules a flush sees the new location.href);
  // popstate/hashchange/visibilitychange cover explicit signals. The isolated
  // content world cannot observe the page's pushState calls, so no wrapper is
  // installed here (the Tampermonkey build had the same constraint).

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
    clearFallbackTokenCache();
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
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
    parseLikeCount, parseThreshold, readStoredThreshold, readStoredFocusPopular,
    isTargetRoute, isProfileRoute, isDetailRoute, getCurrentRoute, signatureFor,
    selectNextPopularCard, selectPreviousPopularCard,
    getNoteIdFromHref, buildShareLink, getXsecTokenFromHref, parseQueryValue,
    findTokenForNoteIdInState, getFallbackTokenForNoteId, clearFallbackTokenCache,
    toNoWatermarkCoverUrl, extractCoverUrl, dataUrlToBlob, coverUrlCandidates,
    pickLargestFromSrcset, buildCoverFileName,
    toCdnObjectPath, isForcedJpegCandidate, sniffImageMimeFromBytes, looksLikeImageBytes,
    isJpegBlob, resolveCoverBlobFromCandidates,
    parseBaseUrl, readLibraryConfig, parseTokenExp, buildCrawlPayload,
    parseInitialStateFromScriptText,
    buildDetailNoteUrl, resolveSaveUrlFromCard, cardNoteTargetId, resolveCardNoteLink,
    READ_ATTRIBUTES, SELECTORS
  });

  if (TEST_MODE) {
    const testApi = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) {
        routeProvider = () => String(pathname || '');
        lastUrl = '';
        if (scheduleChange) schedule(ROOT.document);
      },
      clearTestRoute() { routeProvider = null; lastUrl = ''; schedule(ROOT.document); },
      setTestInitialState(value) { getResolver().setTestInitialState(value); },
      scan: () => scan(ROOT.document),
      flush, init, destroy,
      setThreshold: value => setThreshold(value),
      getThreshold: () => threshold,
      setFocusPopular: (value, storage) => setFocusPopular(value, storage),
      getFocusPopular: () => focusPopular,
      getCounters: () => Object.assign({}, counters, {
        bindings: eventBindings.length,
        observerRootIsBody: observerRoot === ROOT.document.body
      })
    });
    ROOT.__XHS_ENHANCED_TEST_API__ = testApi;
  }

  // Wait for chrome.storage hydration before the first scan: the library
  // settings cache must be warm so synchronous reads see persisted values.
  if (ROOT.document) {
    ready.then(() => { init(); });
  }
