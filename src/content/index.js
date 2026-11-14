// 小红书网页版增强 — content script (isolated world).
// Highlights hot notes, adds jump/copy/save UI. Library settings live on the
// extension options page; everything privileged goes through the background
// service worker. Mirrors the legacy userscript behaviour and test seams.
import { getRoot, isTestMode } from '../lib/env.js';
import { normalizeSpace } from '../lib/text.js';
import {
  parseLikeCount,
  parseThreshold,
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
  resolveCoverExtFromMime,
  resolveCoverExtFromUrl,
  normalizeBatchScope,
  normalizeBatchLayout,
  parseBaseUrl,
  parseTokenExp,
  buildCrawlPayload,
  parseInitialStateFromScriptText,
  extractNoteFromInitialStateHtml,
  slimNoteDetail,
  pickBestImageUrl
} from '../lib/pure.js';
import {
  ready,
  readStoredThreshold,
  readStoredFocusPopular,
  writeStoredFocusPopular,
  writeStoredThreshold,
  readLibraryConfig,
  readStoredBatchScope,
  writeStoredBatchScope,
  readStoredBatchLayout,
  writeStoredBatchLayout,
  THRESHOLD_KEY,
  FOCUS_KEY
} from '../lib/settings.js';
import { hasPrivilegedChannel, fetchBytes, fetchText, COLLECT_NOTE_VIA_TAB_MESSAGE, COLLECT_NOTE_MESSAGE } from '../lib/remote.js';
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
import { getChrome } from '../lib/env.js';
import {
  buildZip,
  splitZipEntries,
  buildBatchZipFileName,
  buildNoteFolderName,
  buildImageFileName,
  buildFlatEntryName,
  crc32,
  sanitizeFileName,
  MAX_ZIP_BYTES
} from '../lib/zip.js';
import { createSelectionStore, SELECTION_STORAGE_KEY } from '../lib/selection.js';

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
const SETTINGS_BUTTON_ID = 'xhs-enhanced-settings';
const SETTINGS_BUTTON_TEXT = '⚙ 设置';
const LIBRARY_SAVED_OK = '已保存到内容库';
const LIBRARY_SAVE_FAIL = '内容库保存失败';
const LIBRARY_NO_TOKEN = '未获取到 xsec_token，无法采集';
const LIBRARY_NO_CONFIG = '请先配置内容库（扩展选项页）';
const LIBRARY_NO_ACCOUNT = '内容库未发现可用的小红书 PC 端账号';
const LIBRARY_AUTH_FAIL = '内容库登录失败，请检查用户名与密码';
const LIBRARY_CONNECT_FAIL = '无法连接内容库服务';
const LIBRARY_CHANNEL_MISSING = '扩展无法访问内容库（请重新加载扩展后再试）';
const LIBRARY_PERMISSION_MISSING = '内容库服务器未授权：打开扩展选项页点“测试连接”并允许访问该地址';

const BATCH_BAR_ID = 'xhs-enhanced-batch-bar';
const BATCH_COUNT_ID = 'xhs-enhanced-batch-count';
const BATCH_SELECT_LOADED_ID = 'xhs-enhanced-batch-select-loaded';
const BATCH_CONTINUOUS_ID = 'xhs-enhanced-batch-continuous';
const BATCH_CLEAR_ID = 'xhs-enhanced-batch-clear';
const BATCH_DOWNLOAD_ID = 'xhs-enhanced-batch-download';
const CHECKBOX_CLASS = 'xhs-enhanced-checkbox';
const CHECKBOX_CHECKED_TEXT = '✓';
const BATCH_EMPTY_TEXT = '请先勾选笔记';
const BATCH_NO_COVER_TEXT = '没有可下载的封面';
const BATCH_CONTINUOUS_ON_TEXT = '已开启连续勾选：滚动加载的新笔记会自动勾选';
const BATCH_CONTINUOUS_OFF_TEXT = '已关闭连续勾选';
const BATCH_CLEARED_TEXT = '已清空勾选';
const BATCH_SELECT_ALL_ON_TEXT = count => '已勾选已加载的 ' + count + ' 篇笔记';
const BATCH_SELECT_ALL_OFF_TEXT = '已取消已加载笔记的勾选';
const BATCH_NO_LOADED_TEXT = '本页没有可勾选的笔记';
const BATCH_DOWNLOAD_START_TEXT = count => '正在准备 ' + count + ' 篇笔记…';
const BATCH_DOWNLOAD_FETCHING_TEXT = (done, total) => '正在下载 ' + done + '/' + total + ' 篇…';
const BATCH_DOWNLOAD_PACKING_TEXT = count => '正在打包 ' + count + ' 张图片…';
const BATCH_DOWNLOAD_INNER_FAIL_TEXT = count => '内图获取失败 ' + count + ' 篇（仅保留封面）';
const BATCH_DOWNLOAD_DONE_TEXT = summary => '已下载 ' + summary.saved + ' 张图片' + (summary.notes ? '（' + summary.notes + ' 篇）' : '') + (summary.innerFailedNotes ? '；内图获取失败 ' + summary.innerFailedNotes + ' 篇' : '') + (summary.failedImages ? '；' + summary.failedImages + ' 张下载失败' : '') + (summary.videoSkipped ? '；' + summary.videoSkipped + ' 篇视频无内图已跳过' : '');
const BATCH_DOWNLOAD_FAIL_TEXT = '全部图片下载失败';
const BATCH_DOWNLOAD_NOTHING_TEXT = '没有可下载的图片';
const BATCH_SCOPE_ID = 'xhs-enhanced-batch-scope';
const BATCH_SCOPE_COVER_ID = 'xhs-enhanced-batch-scope-cover';
const BATCH_SCOPE_INNER_ID = 'xhs-enhanced-batch-scope-inner';
const BATCH_SCOPE_ALL_ID = 'xhs-enhanced-batch-scope-all';
const BATCH_PROGRESS_ID = 'xhs-enhanced-batch-progress';
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
let jumpStatusTimer = null;
let focusToggle = null;
let copyStatus = null;
let copyStatusTimer = null;
let copyCoverInFlight = false;
let downloadCoverInFlight = false;
let saveInFlight = false;
let libraryPageButton = null;
let libraryBatchButton = null;
let batchBar = null;
let batchDownloadButton = null;
let batchSelectLoadedButton = null;
let batchContinuousButton = null;
let continuousSelect = false;
let batchDownloadInFlight = false;
let batchScopeCache = 'all';
let batchProgress = null;
const selection = createSelectionStore(getSessionStorageSafe());
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

function onFocusToggleClick() {
  const enabled = !readStoredFocusPopular();
  const { persisted } = writeStoredFocusPopular(enabled);
  if (focusToggle) focusToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  showCopyStatus((enabled ? '已开启：只显示热门笔记' : '已关闭：显示全部笔记') + (persisted ? '' : '（设置未能保存）'));
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

  // Re-render immediately when the options page (or another open tab) writes
  // the shared preference keys — no waiting for the next mutation/scan cycle.
  function subscribePreferenceChanges() {
    const chromeObj = ROOT.chrome;
    try {
      const store = chromeObj && chromeObj.storage;
      const onChanged = store && store.onChanged;
      if (!onChanged || typeof onChanged.addListener !== 'function') return;
      preferenceChangeHandler = (changes, areaName) => {
        if (areaName !== 'local' || !changes) return;
        if (!Object.prototype.hasOwnProperty.call(changes, THRESHOLD_KEY)
          && !Object.prototype.hasOwnProperty.call(changes, FOCUS_KEY)) return;
        scan(ROOT.document);
      };
      onChanged.addListener(preferenceChangeHandler);
    } catch (_) {}
  }

  function unsubscribePreferenceChanges() {
    const chromeObj = ROOT.chrome;
    try {
      const onChanged = chromeObj && chromeObj.storage && chromeObj.storage.onChanged;
      if (onChanged && typeof onChanged.removeListener === 'function' && preferenceChangeHandler) {
        onChanged.removeListener(preferenceChangeHandler);
      }
    } catch (_) {}
    preferenceChangeHandler = null;
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

  function removeCardCheckbox(card) {
    if (!card || !card.querySelector) return;
    const box = card.querySelector('.' + CHECKBOX_CLASS);
    if (box) box.remove();
  }

  function ensureCardCheckbox(card) {
    if (!card || !card.querySelector || !card.isConnected) return null;
    if (!isTargetRoute(getCurrentRoute())) { removeCardCheckbox(card); return null; }
    // The feed waterfall recycles bare divs as card hosts; make sure the
    // overlay anchor has an offset context without touching Vue's layout.
    try {
      const position = ROOT.getComputedStyle ? ROOT.getComputedStyle(card).position : '';
      if (position === 'static' || !position) card.style.position = 'relative';
    } catch (_) {}
    let box = card.querySelector('.' + CHECKBOX_CLASS);
    if (!box) {
      box = ROOT.document.createElement('button');
      box.type = 'button';
      box.className = CHECKBOX_CLASS;
      box.textContent = CHECKBOX_CHECKED_TEXT;
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', 'false');
      box.setAttribute('aria-label', '选择这篇笔记');
      box.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleCardSelection(card);
      });
      card.appendChild(box);
    }
    return box;
  }

  function syncCardCheckbox(card) {
    if (!card || !card.querySelector) return;
    const box = card.querySelector('.' + CHECKBOX_CLASS);
    if (!box) return;
    const id = cardNoteTargetId(card);
    const checked = Boolean(id && selection.has(id));
    box.setAttribute('aria-checked', checked ? 'true' : 'false');
    box.classList.toggle('xhs-enhanced-checkbox--checked', checked);
  }

  function syncAllCheckboxes(root) {
    const scope = root || ROOT.document;
    if (!scope || !scope.querySelectorAll) return;
    for (const card of discoverCards(scope)) syncCardCheckbox(card);
  }

  function renderCardChrome(card) {
    if (!card) return;
    ensureCardCheckbox(card);
    if (continuousSelect) {
      const id = cardNoteTargetId(card);
      if (id && !selection.has(id)) {
        const snapshot = snapshotFromCard(card);
        if (snapshot) selection.add(snapshot);
      }
    }
    syncCardCheckbox(card);
  }

  let batchCountCache = '';
  let selectLoadedCache = null;
  let batchDownloadCache = null;

  function updateBatchBarCount() {
    if (!batchBar || !batchBar.isConnected) return;
    const countNode = batchBar.querySelector('#' + BATCH_COUNT_ID);
    const text = '已选 ' + selection.size + ' 篇';
    if (countNode && batchCountCache !== text) {
      batchCountCache = text;
      countNode.textContent = text;
    }
    if (batchSelectLoadedButton) {
      const cards = isTargetRoute(getCurrentRoute()) ? discoverCards(ROOT.document) : [];
      let loaded = 0;
      let selectedLoaded = 0;
      for (const card of cards) {
        const id = cardNoteTargetId(card);
        if (!id) continue;
        loaded += 1;
        if (selection.has(id)) selectedLoaded += 1;
      }
      const allLoadedSelected = loaded > 0 && selectedLoaded === loaded;
      if (selectLoadedCache !== allLoadedSelected) {
        selectLoadedCache = allLoadedSelected;
        batchSelectLoadedButton.setAttribute('aria-pressed', allLoadedSelected ? 'true' : 'false');
      }
    }
  }

  function updateBatchDownloadButton() {
    if (!batchDownloadButton) return;
    const text = batchDownloadInFlight ? '下载中…' : '下载已选';
    if (batchDownloadCache === text && batchDownloadButton.disabled === batchDownloadInFlight) return;
    batchDownloadCache = text;
    batchDownloadButton.disabled = batchDownloadInFlight;
    batchDownloadButton.textContent = text;
  }

  function toggleCardSelection(card) {
    const snapshot = snapshotFromCard(card);
    if (!snapshot) { showCopyStatus('未找到笔记 ID，无法勾选'); return; }
    selection.toggle(snapshot);
    syncCardCheckbox(card);
    updateBatchBarCount();
  }

  function onSelectLoadedClick() {
    const cards = discoverCards(ROOT.document);
    const loaded = [];
    for (const card of cards) {
      const id = cardNoteTargetId(card);
      if (id) loaded.push({ card, id });
    }
    if (!loaded.length) { showCopyStatus(BATCH_NO_LOADED_TEXT); return; }
    const allSelected = loaded.every(({ id }) => selection.has(id));
    for (const { card, id } of loaded) {
      if (allSelected) {
        selection.remove(id);
      } else if (!selection.has(id)) {
        const snapshot = snapshotFromCard(card);
        if (snapshot) selection.add(snapshot);
      }
    }
    syncAllCheckboxes(ROOT.document);
    updateBatchBarCount();
    showCopyStatus(allSelected ? BATCH_SELECT_ALL_OFF_TEXT : BATCH_SELECT_ALL_ON_TEXT(loaded.length));
  }

  function onContinuousToggleClick() {
    continuousSelect = !continuousSelect;
    if (batchContinuousButton) batchContinuousButton.setAttribute('aria-pressed', continuousSelect ? 'true' : 'false');
    showCopyStatus(continuousSelect ? BATCH_CONTINUOUS_ON_TEXT : BATCH_CONTINUOUS_OFF_TEXT);
    if (continuousSelect) scan(ROOT.document);
  }

  function onBatchClearClick() {
    selection.clear();
    syncAllCheckboxes(ROOT.document);
    updateBatchBarCount();
    showCopyStatus(BATCH_CLEARED_TEXT);
  }

  const SCOPE_LABELS = { cover: '只封面', inner: '只内图', all: '全部图片' };

  function updateBatchScopeButtons() {
    if (!batchBar) return;
    for (const [scope, id] of [['cover', BATCH_SCOPE_COVER_ID], ['inner', BATCH_SCOPE_INNER_ID], ['all', BATCH_SCOPE_ALL_ID]]) {
      const button = ROOT.document.getElementById(id);
      if (!button) continue;
      const pressed = batchScopeCache === scope;
      if (button.getAttribute('aria-pressed') !== (pressed ? 'true' : 'false')) {
        button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      }
    }
  }

  function onBatchScopeClick(scope) {
    const result = writeStoredBatchScope(scope);
    batchScopeCache = result.value;
    updateBatchScopeButtons();
    showCopyStatus('下载范围：' + (SCOPE_LABELS[batchScopeCache] || batchScopeCache));
  }

  let batchProgressNode = null;
  function showBatchProgress(message) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = batchProgressNode && batchProgressNode.isConnected
      ? batchProgressNode
      : ROOT.document.getElementById(BATCH_PROGRESS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = BATCH_PROGRESS_ID;
      node.setAttribute('role', 'status');
      ROOT.document.body.appendChild(node);
    }
    if (node.textContent !== message) node.textContent = message;
    batchProgressNode = node;
  }

  function clearBatchProgress() {
    const node = batchProgressNode && batchProgressNode.isConnected
      ? batchProgressNode
      : ROOT.document && ROOT.document.getElementById(BATCH_PROGRESS_ID);
    if (node) node.remove();
    batchProgressNode = null;
  }

  function onBatchDownload() {
    if (batchDownloadInFlight) return;
    const items = selection.values();
    if (!items.length) { showCopyStatus(BATCH_EMPTY_TEXT); return; }
    const scope = batchScopeCache;
    if (scope !== 'inner' && !items.some(item => item.coverUrl) && !items.some(item => item.link)) {
      showCopyStatus(BATCH_NO_COVER_TEXT);
      return;
    }
    batchDownloadInFlight = true;
    updateBatchDownloadButton();
    showCopyStatus(BATCH_DOWNLOAD_START_TEXT(items.length));
    showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(0, items.length));
    let fetched = 0;
    mapWithConcurrency(items, 2, (item, index) => downloadNoteImages(scope, item).then(result => {
      fetched += 1;
      showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(fetched, items.length));
      return result;
    }, () => {
      fetched += 1;
      showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(fetched, items.length));
      return { item, ok: false, reason: 'error', entries: [], failedImages: 0, skippedVideo: false, innerFailed: false, detailSource: '' };
    })).then(jobs => {
      const entries = [];
      let sequence = 0;
      let notesSaved = 0;
      let failedImages = 0;
      let failedNotes = 0;
      let videoSkipped = 0;
      let innerFailedNotes = 0;
      const layout = readStoredBatchLayout();
      for (const job of jobs || []) {
        failedImages += job && typeof job.failedImages === 'number' ? job.failedImages : 0;
        if (job && job.skippedVideo) videoSkipped += 1;
        if (job && job.innerFailed) innerFailedNotes += 1;
        if (!job || !Array.isArray(job.entries) || !job.entries.length) {
          if (scope === 'inner' || (job && job.ok === false)) failedNotes += 1;
          continue;
        }
        for (const entry of job.entries) {
          const name = layout === 'flat'
            ? buildFlatEntryName(sequence, job.item.id, entry.name)
            : buildNoteFolderName(sequence, job.item.id, job.item.title) + '/' + entry.name;
          entries.push({ name, bytes: entry.bytes });
        }
        sequence += 1;
        notesSaved += 1;
      }
      if (!entries.length) {
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus(scope === 'inner' && videoSkipped === items.length
          ? '视频笔记不含内图，没有可下载的图片'
          : BATCH_DOWNLOAD_NOTHING_TEXT);
        return;
      }
      showBatchProgress(BATCH_DOWNLOAD_PACKING_TEXT(entries.length));
      const now = new Date();
      try {
        const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes ? entry.bytes.length : 0), 0);
        const parts = totalBytes > MAX_ZIP_BYTES ? splitZipEntries(entries, MAX_ZIP_BYTES) : [entries];
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const zipBytes = buildZip(parts[partIndex], { now });
          const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
          triggerCoverDownload(zipBlob, buildBatchZipFileName(now, entries.length, partIndex, parts.length));
        }
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus(BATCH_DOWNLOAD_DONE_TEXT({
          saved: entries.length,
          notes: notesSaved,
          failedImages,
          videoSkipped,
          innerFailedNotes: scope === 'all' ? innerFailedNotes : 0
        }));
      } catch (_) {
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus('打包下载失败');
      }
    }, () => {
      batchDownloadInFlight = false;
      updateBatchDownloadButton();
      clearBatchProgress();
      showCopyStatus(BATCH_DOWNLOAD_FAIL_TEXT);
    });
  }

  function removeBatchBar() {
    const bar = batchBar && batchBar.isConnected ? batchBar : ROOT.document && ROOT.document.getElementById(BATCH_BAR_ID);
    if (bar) bar.remove();
    batchBar = null;
    batchDownloadButton = null;
    batchSelectLoadedButton = null;
    batchContinuousButton = null;
    batchCountCache = '';
    selectLoadedCache = null;
    batchDownloadCache = null;
  }

  function ensureBatchBar() {
    if (!ROOT.document || !ROOT.document.body) return;
    let bar = batchBar && batchBar.isConnected ? batchBar : ROOT.document.getElementById(BATCH_BAR_ID);
    if (!bar) {
      bar = ROOT.document.createElement('div');
      bar.id = BATCH_BAR_ID;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '批量下载已选笔记的封面');
      const countNode = ROOT.document.createElement('span');
      countNode.id = BATCH_COUNT_ID;
      countNode.textContent = '已选 ' + selection.size + ' 篇';
      const selectLoaded = ROOT.document.createElement('button');
      selectLoaded.id = BATCH_SELECT_LOADED_ID;
      selectLoaded.type = 'button';
      selectLoaded.textContent = '全选已加载';
      selectLoaded.setAttribute('aria-pressed', 'false');
      selectLoaded.addEventListener('click', onSelectLoadedClick);
      const continuous = ROOT.document.createElement('button');
      continuous.id = BATCH_CONTINUOUS_ID;
      continuous.type = 'button';
      continuous.textContent = '连续勾选';
      continuous.setAttribute('aria-pressed', 'false');
      continuous.setAttribute('title', '开启后滚动加载的新笔记会自动勾选');
      continuous.addEventListener('click', onContinuousToggleClick);
      const clear = ROOT.document.createElement('button');
      clear.id = BATCH_CLEAR_ID;
      clear.type = 'button';
      clear.textContent = '清空';
      clear.addEventListener('click', onBatchClearClick);
      const scopeGroup = ROOT.document.createElement('div');
      scopeGroup.id = BATCH_SCOPE_ID;
      scopeGroup.setAttribute('role', 'group');
      scopeGroup.setAttribute('aria-label', '下载范围');
      for (const [scope, id, label] of [['cover', BATCH_SCOPE_COVER_ID, '封面'], ['inner', BATCH_SCOPE_INNER_ID, '内图'], ['all', BATCH_SCOPE_ALL_ID, '全部']]) {
        const scopeButton = ROOT.document.createElement('button');
        scopeButton.id = id;
        scopeButton.type = 'button';
        scopeButton.textContent = label;
        scopeButton.setAttribute('data-scope', scope);
        scopeButton.setAttribute('aria-pressed', batchScopeCache === scope ? 'true' : 'false');
        scopeButton.addEventListener('click', () => onBatchScopeClick(scope));
        scopeGroup.appendChild(scopeButton);
      }
      const download = ROOT.document.createElement('button');
      download.id = BATCH_DOWNLOAD_ID;
      download.type = 'button';
      download.textContent = '下载已选';
      download.addEventListener('click', onBatchDownload);
      bar.append(countNode, selectLoaded, continuous, clear, scopeGroup, download);
      ROOT.document.body.appendChild(bar);
      batchDownloadButton = download;
      batchSelectLoadedButton = selectLoaded;
      batchContinuousButton = continuous;
    } else {
      batchDownloadButton = bar.querySelector('#' + BATCH_DOWNLOAD_ID);
      batchSelectLoadedButton = bar.querySelector('#' + BATCH_SELECT_LOADED_ID);
      batchContinuousButton = bar.querySelector('#' + BATCH_CONTINUOUS_ID);
    }
    batchBar = bar;
    updateBatchScopeButtons();
    updateBatchBarCount();
    updateBatchDownloadButton();
  }

  function syncBatchBar() {
    if (!ROOT.document || !ROOT.document.body) return;
    if (isTargetRoute(getCurrentRoute())) {
      ensureBatchBar();
    } else {
      removeBatchBar();
    }
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

  function getSessionStorageSafe() {
    try {
      const chrome = getChrome();
      if (chrome && chrome.storage && chrome.storage.session) return chrome.storage.session;
    } catch (_) {}
    return null;
  }

  function extractCardTitle(card) {
    if (!card || !card.querySelector) return '';
    const node = card.querySelector('.title span, .title, [class*="title"]');
    const text = node ? normalizeSpace(node.textContent || '') : '';
    return text.slice(0, 60);
  }

  function snapshotFromCard(card) {
    const id = cardNoteTargetId(card);
    if (!id) return null;
    return {
      id,
      link: resolveCardNoteLink(card),
      coverUrl: extractCoverUrl(card),
      title: extractCardTitle(card),
      ts: Date.now()
    };
  }

  function mapWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const results = new Array(list.length);
    let cursor = 0;
    const lanes = [];
    for (let lane = 0; lane < Math.max(1, Math.min(limit, list.length)); lane += 1) {
      lanes.push((async () => {
        while (cursor < list.length) {
          const index = cursor;
          cursor += 1;
          try {
            results[index] = await worker(list[index], index);
          } catch (_) {
            results[index] = { ok: false, reason: 'error', item: list[index] };
          }
        }
      })());
    }
    return Promise.all(lanes).then(() => results);
  }

  function isCaptureMode() {
    try {
      const search = ROOT.location && ROOT.location.search;
      return typeof search === 'string' && search.indexOf('xhs_enh_capture=1') >= 0;
    } catch (_) {
      return false;
    }
  }

  // Capture-mode responder used by the hidden-tab fallback: parse this
  // page's own inline __INITIAL_STATE__ and answer the background's
  // question. Registers at document_idle, responds synchronously.
  function initCaptureMode() {
    initialized = true;
    const chrome = getChrome();
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') return;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== COLLECT_NOTE_MESSAGE) return undefined;
      const note = collectSlimNoteFromDocument();
      sendResponse(note ? { ok: true, note } : { ok: false, error: 'no-state' });
      return undefined;
    });
  }

  function collectSlimNoteFromDocument() {
    if (!ROOT.document) return null;
    for (const script of Array.from(ROOT.document.querySelectorAll('script'))) {
      const text = script.textContent || '';
      if (text.indexOf('__INITIAL_STATE__=') < 0) continue;
      const state = parseInitialStateFromScriptText(text);
      const noteMap = state && state.note && state.note.noteDetailMap;
      const first = noteMap && Object.values(noteMap)[0];
      const slim = slimNoteDetail(first && first.note);
      if (slim) return slim;
    }
    return null;
  }

  // Direct SW fetch of the note page (带 cookie). Returns a slim note or
  // { ok:false, reason } for the hidden-tab fallback to kick in.
  async function fetchNoteDetailFromPage(link) {
    const res = await fetchText(link, { timeout: 30000 });
    if (res && res.ok && typeof res.text === 'string' && res.text) {
      const note = extractNoteFromInitialStateHtml(res.text);
      if (note) return { ok: true, note, source: 'fetch' };
      return { ok: false, reason: 'parse' };
    }
    return { ok: false, reason: res && res.status ? 'http-' + res.status : ((res && res.error) || 'network') };
  }

  // 全链路：先 SW 直拉（快、轻），失败再隐藏标签页复核。
  async function collectNoteDetail(link) {
    if (!link) return { ok: false, reason: 'no-link' };
    const direct = await fetchNoteDetailFromPage(link);
    if (direct.ok) return direct;
    const chrome = getChrome();
    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return { ok: false, reason: direct.reason || 'no-channel' };
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: COLLECT_NOTE_VIA_TAB_MESSAGE, link });
      if (resp && resp.ok && resp.note && Array.isArray(resp.note.imageList)) {
        return { ok: true, note: resp.note, source: 'tab' };
      }
      return { ok: false, reason: (resp && resp.error) || direct.reason || 'tab-failed' };
    } catch (_) {
      return { ok: false, reason: (direct && direct.reason) || 'tab-failed' };
    }
  }

  function loadImageEntry(url) {
    if (!url) return Promise.resolve(null);
    return loadCoverPngBlob(url).then(result => {
      const blob = result && result.ok ? result.blob : null;
      if (!blob) return null;
      return ensureJpegCoverBlob(blob).then(finalBlob => {
        const ext = resolveCoverExtFromMime(finalBlob.type) || resolveCoverExtFromUrl(url) || 'jpg';
        return finalBlob.arrayBuffer().then(buffer => ({ bytes: new Uint8Array(buffer), ext }), () => null);
      }, () => null);
    }, () => null);
  }

  // One note -> zip entries (not yet folder-prefixed or sequenced).
  async function downloadNoteImages(scope, item) {
    const result = {
      item,
      ok: true,
      failedImages: 0,
      skippedVideo: false,
      innerFailed: false,
      detailSource: '',
      entries: []
    };
    let note = null;
    if (scope !== 'cover') {
      const detail = await collectNoteDetail(item.link);
      if (detail.ok) {
        note = detail.note;
        result.detailSource = detail.source;
      } else if (scope === 'inner') {
        result.ok = false;
        result.error = detail.reason || 'detail-failed';
        return result;
      } else {
        result.innerFailed = true; // keep the card cover below as partial salvage
      }
    }
    const images = note && Array.isArray(note.imageList) ? note.imageList : [];
    const isVideo = Boolean(note && note.type === 'video');
    if (scope !== 'inner') {
      const coverImage = images[0] || null;
      const coverUrl = coverImage ? pickBestImageUrl(coverImage) : (item.coverUrl || '');
      const entry = await loadImageEntry(coverUrl);
      if (entry) result.entries.push({ name: buildImageFileName(0, entry.ext, true), bytes: entry.bytes });
      else result.failedImages += 1;
    }
    if (scope !== 'cover' && note) {
      const innerImages = isVideo ? [] : images.slice(1);
      if (isVideo && scope === 'inner') result.skippedVideo = true;
      for (let index = 0; index < innerImages.length; index += 1) {
        const url = pickBestImageUrl(innerImages[index]);
        const entry = await loadImageEntry(url);
        if (!entry) { result.failedImages += 1; continue; }
        const order = scope === 'inner' ? index : index + 1;
        result.entries.push({ name: buildImageFileName(order, entry.ext, false), bytes: entry.bytes });
      }
    }
    return result;
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
    for (const card of discoverLinkCards(ROOT.document)) {
      ensureCardActions(card);
      renderCardChrome(card);
    }
  }

  function ensureStyle() {
    if (!ROOT.document || ROOT.document.getElementById(STYLE_ID)) return;
    const style = ROOT.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS}{outline:2px solid #ff2442!important;background:rgba(255,36,66,.07)!important;box-shadow:0 2px 10px rgba(255,36,66,.14)!important}
      .${LIKE_CLASS}{color:#ff2442!important;font-weight:700!important}
      #${JUMP_NAV_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;display:flex;gap:8px;align-items:center}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID},#${FOCUS_TOGGLE_ID}{border:0;border-radius:999px;padding:9px 15px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.22);cursor:pointer;transition:background .15s ease,color .15s ease,opacity .15s ease}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID}{background:#ff2442;color:#fff}
      #${JUMP_PREV_BUTTON_ID}:hover,#${JUMP_BUTTON_ID}:hover{background:#e61e3c}
      #${JUMP_PREV_BUTTON_ID}:focus-visible,#${JUMP_BUTTON_ID}:focus-visible,#${FOCUS_TOGGLE_ID}:focus-visible,#${LIBRARY_PAGE_BUTTON_ID}:focus-visible,#${LIBRARY_BATCH_BUTTON_ID}:focus-visible,#${SETTINGS_BUTTON_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${FOCUS_TOGGLE_ID}{background:rgba(30,30,30,.88);color:#fff}
      #${FOCUS_TOGGLE_ID}:hover{background:rgba(15,15,15,.98)}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]{background:#ff2442;color:#fff}
      .${DIMMED_CLASS}{filter:blur(8px) grayscale(.35);opacity:.55;transition:filter .18s ease,opacity .18s ease}
      .${DIMMED_CLASS}:hover{filter:none;opacity:1}
      #${JUMP_STATUS_ID}{position:fixed;top:136px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
      #${COPY_STATUS_ID}{position:fixed;top:182px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
      #${LIBRARY_PAGE_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 18px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      #${LIBRARY_PAGE_BUTTON_ID}:hover{background:#e61e3c}
      #${LIBRARY_BATCH_BUTTON_ID}{position:fixed;top:316px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 18px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      #${LIBRARY_BATCH_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_BATCH_BUTTON_ID}:disabled{opacity:.55;cursor:default}
      #${SETTINGS_BUTTON_ID}{position:fixed;bottom:24px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:9px 16px;background:rgba(30,30,30,.88);color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer}
      #${SETTINGS_BUTTON_ID}:hover{background:rgba(15,15,15,.98)}
      .${CARD_ACTIONS_CLASS}{position:absolute;top:6px;left:6px;z-index:2147483640;display:flex;gap:4px;opacity:0;transition:opacity .15s ease;pointer-events:none}
      .xhs-enhanced-card--popular .${CARD_ACTIONS_CLASS},.note-item:hover .${CARD_ACTIONS_CLASS},section.note-item:hover .${CARD_ACTIONS_CLASS},article.note-item:hover .${CARD_ACTIONS_CLASS}{opacity:1;pointer-events:auto}
      [data-note-card],article.note-item,section.note-item,.note-item{position:relative}
      .${CARD_ACTIONS_CLASS} button{border:0;border-radius:6px;padding:5px 8px;background:rgba(255,36,66,.92);color:#fff;font:600 11px/1.35 system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}
      .${CARD_ACTIONS_CLASS} button:hover{background:#e61e3c}
      .${COPY_COVER_CLASS}{background:rgba(30,30,30,.82)!important}
      .${DOWNLOAD_COVER_CLASS}{background:rgba(37,99,235,.92)!important}
      .${DOWNLOAD_COVER_CLASS}:hover{background:rgba(29,78,216,1)!important}
      .${CHECKBOX_CLASS}{position:absolute;top:6px;right:6px;z-index:2147483645;width:24px;height:24px;border-radius:7px;border:2px solid rgba(255,255,255,.9);background:rgba(0,0,0,.38);color:transparent;font:700 15px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.4);transition:background .15s ease,border-color .15s ease,color .15s ease}
      .${CHECKBOX_CLASS}:hover{background:rgba(0,0,0,.6)}
      .${CHECKBOX_CLASS}--checked,.${CHECKBOX_CLASS}[aria-checked="true"]{background:#ff2442;border-color:#ff2442;color:#fff}
      .${CHECKBOX_CLASS}:focus-visible,#${BATCH_SELECT_LOADED_ID}:focus-visible,#${BATCH_CONTINUOUS_ID}:focus-visible,#${BATCH_CLEAR_ID}:focus-visible,#${BATCH_DOWNLOAD_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${BATCH_BAR_ID}{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:min(680px,calc(100vw - 32px));padding:8px 10px;border-radius:14px;background:rgba(30,30,30,.93);box-shadow:0 6px 24px rgba(0,0,0,.4);font:13px/1.4 system-ui,sans-serif;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
      #${BATCH_COUNT_ID}{color:#fff;font-weight:700;white-space:nowrap;padding:0 4px}
      #${BATCH_BAR_ID} button{border:0;border-radius:999px;padding:8px 14px;font:600 13px/1.4 system-ui,sans-serif;white-space:nowrap;cursor:pointer;background:rgba(255,255,255,.14);color:#fff;transition:background .15s ease,opacity .15s ease}
      #${BATCH_BAR_ID} button:hover{background:rgba(255,255,255,.24)}
      #${BATCH_SELECT_LOADED_ID}[aria-pressed="true"],#${BATCH_CONTINUOUS_ID}[aria-pressed="true"]{background:#ff2442;color:#fff}
      #${BATCH_DOWNLOAD_ID}{background:#ff2442;color:#fff;font-weight:700}
      #${BATCH_DOWNLOAD_ID}:hover{background:#e61e3c}
      #${BATCH_DOWNLOAD_ID}:disabled{opacity:.55;cursor:default}
      #${BATCH_SCOPE_ID}{display:flex;gap:2px;padding:2px;border-radius:999px;background:rgba(255,255,255,.12)}
      #${BATCH_SCOPE_ID} button{border:0;border-radius:999px;padding:6px 11px;background:transparent;color:rgba(255,255,255,.72);font:600 12px/1.4 system-ui,sans-serif;cursor:pointer}
      #${BATCH_SCOPE_ID} button:hover{background:rgba(255,255,255,.18);color:#fff}
      #${BATCH_SCOPE_ID} button[aria-pressed="true"]{background:#ff2442;color:#fff}
      #${BATCH_SCOPE_ID} button:focus-visible,#${BATCH_PROGRESS_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${BATCH_PROGRESS_ID}{position:fixed;top:226px;right:24px;z-index:2147483646;max-width:300px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.93);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
    `;
    (ROOT.document.head || ROOT.document.documentElement).appendChild(style);
  }

  function renderCard(card) {
    if (!card || !card.isConnected) return;
    const like = extractLike(card);
    const route = getCurrentRoute();
    const signature = signatureFor(route, like ? like.raw : '');
    const popular = Boolean(like && like.parsed.value > readStoredThreshold());

    card.classList.toggle(CARD_CLASS, popular);
    card.classList.toggle(DIMMED_CLASS, readStoredFocusPopular() && !popular);
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);

    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    ensureCardActions(card);
    renderCardChrome(card);
    counters.processed += 1;
  }

  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
    card.classList.remove(DIMMED_CLASS);
    card.removeAttribute(SIGNATURE_ATTRIBUTE);
    removeCardActions(card);
    removeCardCheckbox(card);
    for (const node of card.querySelectorAll(`.${LIKE_CLASS}`)) node.classList.remove(LIKE_CLASS);
  }

  function cleanupAll() {
    if (!ROOT.document) return;
    for (const card of ROOT.document.querySelectorAll(`.${CARD_CLASS},[${SIGNATURE_ATTRIBUTE}]`)) cleanupCard(card);
    for (const container of ROOT.document.querySelectorAll('.' + CARD_ACTIONS_CLASS)) container.remove();
    for (const checkbox of ROOT.document.querySelectorAll('.' + CHECKBOX_CLASS)) checkbox.remove();
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
      toggle.setAttribute('aria-pressed', readStoredFocusPopular() ? 'true' : 'false');
      toggle.addEventListener('click', onFocusToggleClick);
    }
    focusToggle = toggle;
    // Move buttons left over from an older version into the nav row, but
    // only when needed: unconditional append would re-trigger the observer forever.
    if (prev.parentElement !== nav) nav.appendChild(prev);
    if (button.parentElement !== nav) nav.appendChild(button);
    if (toggle.parentElement !== nav) nav.appendChild(toggle);
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

  let settingsButton = null;
let preferenceChangeHandler = null;

  function ensureSettingsButton() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = settingsButton && settingsButton.isConnected ? settingsButton : ROOT.document.getElementById(SETTINGS_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = SETTINGS_BUTTON_ID;
      button.type = 'button';
      button.textContent = SETTINGS_BUTTON_TEXT;
      button.setAttribute('aria-label', '打开扩展选项页（热门阈值、内容库设置）');
      button.setAttribute('title', '扩展选项：热门阈值 / 内容库设置');
      button.addEventListener('click', openLibrarySettings);
      ROOT.document.body.appendChild(button);
    }
    settingsButton = button;
  }

  function removeSettingsButton() {
    const button = settingsButton && settingsButton.isConnected ? settingsButton : ROOT.document && ROOT.document.getElementById(SETTINGS_BUTTON_ID);
    if (button) button.remove();
    settingsButton = null;
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
    removeSettingsButton();
    removeLibraryPageButton();
    removeLibraryBatchButton();
  }

  function syncLibraryUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    const route = getCurrentRoute();
    if (isDetailRoute(route)) {
      // Note detail views (also the nested search/profile modal URLs) get the
      // floating save button instead of the batch tools.
      ensureSettingsButton();
      ensureLibraryPageButton();
      removeLibraryBatchButton();
      return;
    }
    if (isTargetRoute(route)) {
      ensureSettingsButton();
      ensureLibraryBatchButton();
      removeLibraryPageButton();
      return;
    }
    removeLibraryUi();
  }

  function syncJumpUi() {
    if (isTargetRoute(getCurrentRoute())) {
      ensureJumpUi();
    } else {
      removeJumpUi();
    }
  }

  function flush() {
    scheduled = false;
    if (destroyed || !ROOT.document) return;
    counters.batches += 1;
    syncJumpUi();
    syncLibraryUi();
    syncBatchBar();
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
    updateBatchBarCount();
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
    if (typeof ROOT.requestAnimationFrame === 'function') {
      ROOT.requestAnimationFrame(run);
      // Headless and hidden tabs may throttle or pause rAF entirely; fall back
      // to a timer so the scan still completes there. Visible tabs keep the
      // rAF-only path. `scheduled` and the lifecycle token make run() idempotent.
      if (ROOT.document && ROOT.document.visibilityState === 'hidden' && typeof ROOT.setTimeout === 'function') {
        ROOT.setTimeout(run, 150);
      }
    } else {
      Promise.resolve().then(run);
    }
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
    if (isCaptureMode()) {
      initCaptureMode();
      return;
    }
    lifecycleToken = { active: true };
    destroyed = false;
    batchScopeCache = readStoredBatchScope();
    ensureStyle();
    bindObserverRoot(selectObserverRoot());
    subscribePreferenceChanges();
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
    syncBatchBar();
    selection.hydrate().then(() => {
      syncAllCheckboxes(ROOT.document);
      updateBatchBarCount();
    }, () => {});
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
    unsubscribePreferenceChanges();
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
    removeJumpUi();
    removeLibraryUi();
    removeBatchBar();
    clearBatchProgress();
    batchDownloadInFlight = false;
    continuousSelect = false;
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
    extractNoteFromInitialStateHtml, slimNoteDetail, pickBestImageUrl,
    buildDetailNoteUrl, resolveSaveUrlFromCard, cardNoteTargetId, resolveCardNoteLink,
    extractCardTitle, snapshotFromCard, onBatchDownload, mapWithConcurrency,
    buildZip, splitZipEntries, buildBatchZipFileName, buildNoteFolderName, buildImageFileName,
    buildFlatEntryName,
    crc32, sanitizeFileName, createSelectionStore, SELECTION_STORAGE_KEY, normalizeBatchScope, normalizeBatchLayout,
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
      clearTestSelection() {
        continuousSelect = false;
        batchDownloadInFlight = false;
        if (batchContinuousButton) batchContinuousButton.setAttribute('aria-pressed', 'false');
        selection.clear();
        syncAllCheckboxes(ROOT.document);
        updateBatchBarCount();
        updateBatchDownloadButton();
      },
      getBatchSelectionSnapshot: () => selection.values(),
      getBatchScopeSnapshot: () => batchScopeCache,
      setBatchScope: scope => { batchScopeCache = writeStoredBatchScope(scope).value; updateBatchScopeButtons(); return batchScopeCache; },
      setBatchLayout: layout => writeStoredBatchLayout(layout).value,
      getBatchLayoutSnapshot: () => readStoredBatchLayout(),
      setThreshold: value => writeStoredThreshold(value),
      getThreshold: () => readStoredThreshold(),
      setFocusPopular: (value, _storage) => writeStoredFocusPopular(value).persisted,
      getFocusPopular: () => readStoredFocusPopular(),
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
