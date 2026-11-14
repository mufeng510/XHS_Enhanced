// 商品高清图下载面板（goods-detail 页面专用）。
// 继承油猴脚本「小红书商品高清图片下载器」的功能并扩展：
//   扫描 = DOM(img/srcset/data-* / <source> / 行内背景) + 整页 HTML 文本 URL 提取，
//          过滤 JS/CSS/字体/头像/表情，并按「去参数化 host+path」去重保留高分辨率候选；
//   下载 = 单个 zip（stored + info.txt 商品信息），走后台特权通道取字节，
//          超 200MB 自动分卷；PNG 默认不重编码，原样落盘。
import { getRoot } from '../lib/env.js';
import { normalizeSpace } from '../lib/text.js';
import {
  isGoodsDetailRoute,
  getGoodsIdFromHref,
  extractUrlsFromText,
  looksLikeGoodsImageUrl,
  collectGoodsImageCandidates,
  toHDGoodsUrl,
  buildGoodsZipFileName,
  buildGoodsImageFileName,
  buildGoodsInfoText,
  getGoodsTitleFromDocument,
  extensionForMime,
  GOODS_FORMAT_MODES
} from '../lib/goods.js';
import { pickLargestFromSrcset, sniffImageMimeFromBytes } from '../lib/pure.js';
import { fetchBytes } from '../lib/remote.js';
import { buildZip, splitZipEntries, MAX_ZIP_BYTES } from '../lib/zip.js';
import { triggerCoverDownload } from '../lib/cover.js';

const ROOT = getRoot();

const PANEL_ID = 'xhs-enhanced-goods-panel';
const SCAN_BUTTON_ID = 'xhs-enhanced-goods-scan';
const DOWNLOAD_BUTTON_ID = 'xhs-enhanced-goods-download';
const COUNT_ID = 'xhs-enhanced-goods-count';
const STATUS_ID = 'xhs-enhanced-goods-status';
const FORMAT_ID = 'xhs-enhanced-goods-format';
const DECOR_ID = 'xhs-enhanced-goods-decorations';
const TITLE_TEXT = '📷 商品高清图下载';
const COUNT_EMPTY = '未扫描';
const COUNT_FOUND_PREFIX = '发现高清图片：';
const COUNT_NONE = '未发现小红书商品图片';

let panel = null;
let countNode = null;
let statusNode = null;
let scanButton = null;
let downloadButton = null;
let formatSelect = null;
let decorToggle = null;
let observer = null;
let rescanTimer = null;
let autoScanTimer = null;
let currentImages = [];
let includeDecorations = false;
let formatMode = 'png';
let inFlight = false;

function utf8Bytes(text) {
  const source = String(text == null ? '' : text);
  if (typeof TextEncoder !== 'undefined') {
    try { return new TextEncoder().encode(source); } catch (_) { /* fall through */ }
  }
  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
}

function setStatus(message) {
  if (statusNode && statusNode.isConnected) statusNode.textContent = message || '';
}

function updateCountLabel() {
  if (!countNode || !countNode.isConnected) return;
  countNode.textContent = currentImages.length
    ? COUNT_FOUND_PREFIX + currentImages.length + ' 张'
    : COUNT_NONE;
}

function setBusy(busy) {
  inFlight = busy;
  if (scanButton) scanButton.disabled = busy;
  if (downloadButton) downloadButton.disabled = busy;
  if (downloadButton) downloadButton.textContent = busy ? '下载中…' : '下载高清图';
}

// DOM-side candidates: rendered <img>/<source> nodes (currentSrc/src/data-*,
// srcset) plus inline background-image URLs. HTML-text scanning happens in
// computeImages() on top of this.
function collectDomCandidates(doc) {
  const out = [];
  if (!doc) return out;
  const imageNodes = Array.from(doc.querySelectorAll('img,source'));
  for (const node of imageNodes) {
    if (node.currentSrc) out.push(node.currentSrc);
    for (const attribute of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-originalsrc']) {
      const value = node.getAttribute && node.getAttribute(attribute);
      if (value) out.push(value);
    }
    const srcset = node.getAttribute
      ? (node.getAttribute('srcset') || node.getAttribute('data-srcset') || node.getAttribute('data-original-srcset') || '')
      : '';
    if (srcset) {
      const largest = pickLargestFromSrcset(srcset);
      if (largest) out.push(largest);
    }
  }
  const styledNodes = doc.querySelectorAll ? Array.from(doc.querySelectorAll('[style*="background"]')) : [];
  for (const node of styledNodes) {
    const style = node.getAttribute && node.getAttribute('style');
    if (!style) continue;
    const match = String(style).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    if (match && match[1]) out.push(match[1]);
  }
  return out;
}

function computeImages(doc, options) {
  const dom = collectDomCandidates(doc);
  const html = doc && doc.documentElement ? String(doc.documentElement.innerHTML || '') : '';
  const textUrls = extractUrlsFromText(html);
  return collectGoodsImageCandidates(dom, textUrls, options);
}

function rescan(silent) {
  const doc = ROOT.document;
  if (!doc) return 0;
  currentImages = computeImages(doc, { includeDecorations });
  updateCountLabel();
  if (!silent) setStatus(currentImages.length ? '扫描完成：' + currentImages.length + ' 张' : COUNT_NONE);
  return currentImages.length;
}

function extForImage(bytes, contentType, url) {
  const sniffed = bytes ? sniffImageMimeFromBytes(bytes) : '';
  if (sniffed) return extensionForMime(sniffed);
  const fromType = String(contentType || '').split(';')[0].trim();
  if (/image\//.test(fromType)) return extensionForMime(fromType);
  const match = String(url || '').match(/\.(png|jpe?g|webp|gif|avif|heic)(?:[!?#]|$)/i);
  if (match && match[1]) return match[1].toLowerCase().replace('jpeg', 'jpg');
  return formatMode === 'jpeg' ? 'jpg' : 'png';
}

function mapWithConcurrencyLocal(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const lanes = [];
  const results = new Array(list.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  for (let lane = 0; lane < width; lane += 1) {
    lanes.push((async () => {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await worker(list[index], index);
        } catch (_) {
          results[index] = null;
        }
      }
    })());
  }
  return Promise.all(lanes).then(() => results);
}

function onDownload() {
  if (inFlight) return;
  const doc = ROOT.document;
  const images = currentImages.length ? currentImages.slice() : computeImages(doc, { includeDecorations });
  if (!images.length) {
    setStatus(COUNT_NONE + '，请先扫描');
    return;
  }
  const goodsId = getGoodsIdFromHref(ROOT.location ? ROOT.location.pathname : '') || 'goods';
  const pageUrl = ROOT.location ? String(ROOT.location.href || '') : '';
  const title = getGoodsTitleFromDocument(doc);
  const scannedAt = new Date().toLocaleString();
  const total = images.length;
  let done = 0;
  let failed = 0;
  setBusy(true);
  setStatus('正在下载 0/' + total + '…');
  mapWithConcurrencyLocal(images, 3, (url, index) => {
    const hd = toHDGoodsUrl(url, formatMode);
    return fetchBytes(hd, { timeout: 30000 }).then(first => {
      let res = first;
      if (!res || !res.ok) {
        if (hd !== url) {
          return fetchBytes(url, { timeout: 30000 }).then(retry => {
            done += 1;
            res = retry;
            setStatus('正在下载 ' + done + '/' + total + '…');
            return packEntry(url, retry, index);
          });
        }
        done += 1;
        setStatus('正在下载 ' + done + '/' + total + '…');
        return packEntry(url, null, index);
      }
      done += 1;
      setStatus('正在下载 ' + done + '/' + total + '…');
      return packEntry(url, res, index);
    });
  }).then(packed => {
    const entries = [];
    for (const item of packed) {
      if (item && item.entry) entries.push(item.entry);
      else failed += 1;
    }
    if (!entries.length) {
      setBusy(false);
      setStatus('全部 ' + total + ' 张图片下载失败');
      return;
    }
    const info = buildGoodsInfoText({
      pageUrl, goodsId, title, scannedAt, count: entries.length, mode: formatMode
    });
    entries.unshift({ name: '00_商品信息.txt', bytes: utf8Bytes(info) });
    setStatus('正在打包 ' + entries.length + ' 个文件…');
    const now = new Date();
    try {
      const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes ? entry.bytes.length : 0), 0);
      const parts = totalBytes > MAX_ZIP_BYTES ? splitZipEntries(entries, MAX_ZIP_BYTES) : [entries];
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const zipBytes = buildZip(parts[partIndex], { now });
        const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
        triggerCoverDownload(zipBlob, buildGoodsZipFileName(now, entries.length - 1, goodsId, partIndex, parts.length));
      }
      setBusy(false);
      setStatus('已下载 ' + (entries.length - 1) + ' 张图片（' + (failed ? '失败 ' + failed + ' 张；' : '') + 'zip 已保存）');
    } catch (_) {
      setBusy(false);
      setStatus('打包下载失败');
    }
  }, () => {
    setBusy(false);
    setStatus('下载失败');
  });
}

function packEntry(url, res, index) {
  const bytes = res && res.ok && res.bytes && res.bytes.length ? res.bytes : null;
  if (!bytes) return { entry: null };
  const ext = extForImage(bytes, res.contentType, url);
  return { entry: { name: buildGoodsImageFileName(index, ext), bytes } };
}

function onDecorationsToggle() {
  includeDecorations = Boolean(decorToggle && decorToggle.checked);
  rescan(true);
  setStatus(includeDecorations ? '已包含头像/表情等修饰图' : '已排除头像/表情等修饰图');
}

function onFormatChange() {
  formatMode = formatSelect ? formatSelect.value : 'png';
  if (formatMode !== 'png' && formatMode !== 'original' && formatMode !== 'jpeg') formatMode = 'png';
  setStatus('已切换格式：' + (formatSelect ? formatSelect.options[formatSelect.selectedIndex].textContent : formatMode));
}

function onManualScan() {
  setStatus('正在扫描…');
  rescan(false);
}

function buildPanel() {
  const doc = ROOT.document;
  const element = doc.createElement('div');
  element.id = PANEL_ID;
  element.setAttribute('role', 'complementary');
  element.setAttribute('aria-label', '小红书商品高清图片下载');

  const header = doc.createElement('div');
  header.className = 'xhs-enhanced-goods-title';
  header.textContent = TITLE_TEXT;
  element.appendChild(header);

  const buttonRow = doc.createElement('div');
  buttonRow.className = 'xhs-enhanced-goods-row';
  scanButton = doc.createElement('button');
  scanButton.type = 'button';
  scanButton.id = SCAN_BUTTON_ID;
  scanButton.className = 'xhs-enhanced-goods-secondary';
  scanButton.textContent = '扫描图片';
  scanButton.addEventListener('click', onManualScan);
  downloadButton = doc.createElement('button');
  downloadButton.type = 'button';
  downloadButton.id = DOWNLOAD_BUTTON_ID;
  downloadButton.className = 'xhs-enhanced-goods-primary';
  downloadButton.textContent = '下载高清图';
  downloadButton.addEventListener('click', onDownload);
  buttonRow.appendChild(scanButton);
  buttonRow.appendChild(downloadButton);
  element.appendChild(buttonRow);

  const formatLabel = doc.createElement('label');
  formatLabel.className = 'xhs-enhanced-goods-field';
  formatLabel.setAttribute('for', FORMAT_ID);
  formatLabel.appendChild(doc.createTextNode('高清格式'));
  formatSelect = doc.createElement('select');
  formatSelect.id = FORMAT_ID;
  for (const mode of GOODS_FORMAT_MODES) {
    const option = doc.createElement('option');
    option.value = mode.value;
    option.textContent = mode.label;
    if (mode.value === formatMode) option.selected = true;
    formatSelect.appendChild(option);
  }
  formatSelect.addEventListener('change', onFormatChange);
  formatLabel.appendChild(formatSelect);
  element.appendChild(formatLabel);

  const decorLabel = doc.createElement('label');
  decorLabel.className = 'xhs-enhanced-goods-check';
  decorToggle = doc.createElement('input');
  decorToggle.type = 'checkbox';
  decorToggle.id = DECOR_ID;
  decorToggle.addEventListener('change', onDecorationsToggle);
  decorLabel.appendChild(decorToggle);
  decorLabel.appendChild(doc.createTextNode('包含头像/表情等修饰图'));
  element.appendChild(decorLabel);

  countNode = doc.createElement('p');
  countNode.id = COUNT_ID;
  countNode.className = 'xhs-enhanced-goods-count';
  countNode.textContent = COUNT_EMPTY;
  element.appendChild(countNode);

  statusNode = doc.createElement('p');
  statusNode.id = STATUS_ID;
  statusNode.className = 'xhs-enhanced-goods-status';
  statusNode.setAttribute('role', 'status');
  statusNode.setAttribute('aria-live', 'polite');
  element.appendChild(statusNode);

  return element;
}

function scheduleRescan() {
  if (rescanTimer !== null) ROOT.clearTimeout(rescanTimer);
  rescanTimer = ROOT.setTimeout(() => {
    rescanTimer = null;
    rescan(true);
  }, 1200);
}

function bindObserver() {
  if (!ROOT.document || typeof ROOT.MutationObserver !== 'function') return;
  const target = ROOT.document.documentElement;
  if (!target) return;
  if (observer) return;
  observer = new ROOT.MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation && mutation.type === 'attributes' && mutation.attributeName !== 'src' && mutation.attributeName !== 'srcset') continue;
      scheduleRescan();
      break;
    }
  });
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
}

export function ensureGoodsPanel() {
  if (!ROOT.document || !ROOT.document.body) return false;
  if (panel && panel.isConnected) return true;
  removeGoodsPanel();
  panel = buildPanel();
  ROOT.document.body.appendChild(panel);
  bindObserver();
  // CSR hydration: scan once shortly after load; the observer covers later
  // lazy-loaded gallery rows.
  autoScanTimer = ROOT.setTimeout(() => {
    autoScanTimer = null;
    rescan(true);
  }, 800);
  return true;
}

export function removeGoodsPanel() {
  if (observer) {
    try { observer.disconnect(); } catch (_) {}
    observer = null;
  }
  if (rescanTimer !== null) { ROOT.clearTimeout(rescanTimer); rescanTimer = null; }
  if (autoScanTimer !== null) { ROOT.clearTimeout(autoScanTimer); autoScanTimer = null; }
  const node = panel && panel.isConnected ? panel : (ROOT.document && ROOT.document.getElementById ? ROOT.document.getElementById(PANEL_ID) : null);
  if (node) node.remove();
  panel = null;
  countNode = null;
  statusNode = null;
  scanButton = null;
  downloadButton = null;
  formatSelect = null;
  decorToggle = null;
  currentImages = [];
  inFlight = false;
}

// Called from the content script flush. Creates the panel on goods-detail
// routes, removes it elsewhere (SPA navigation back to the feed).
export function syncGoodsPanel(route) {
  const pathname = String(route || '');
  if (isGoodsDetailRoute(pathname)) return ensureGoodsPanel();
  removeGoodsPanel();
  return false;
}

// Test seam: current computed image list.
export function getGoodsImagesSnapshot() {
  return currentImages.slice();
}
