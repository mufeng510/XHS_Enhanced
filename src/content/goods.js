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
  collectGoodsImageEntries,
  classifyGoodsSection,
  countGoodsSections,
  GOODS_SECTION_LABELS,
  toHDGoodsUrl,
  buildGoodsZipFileName,
  buildGoodsImageFileName,
  buildGoodsInfoText,
  getGoodsTitleFromDocument,
  extensionForMime,
  GOODS_FORMAT_MODES
} from '../lib/goods.js';
import { pickLargestFromSrcset, sniffImageMimeFromBytes } from '../lib/pure.js';
import {
  shouldCompressGoodsImage,
  JPEG_QUALITY_LADDER,
  GOODS_COMPRESS_MAX_BYTES,
  SCALE_DOWN_FACTOR,
  SCALE_DOWN_MIN,
  scaledDimensions,
  dedupeSkuEntries,
  buildGoodsSkuImageFileName,
  planDetailImageGroups
} from '../lib/goods.js';
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
const COMPRESS_ID = 'xhs-enhanced-goods-compress-main';
const SKU_ID = 'xhs-enhanced-goods-sku';
// 页面「选规格」接口返回的 SKU 预览图通过注入的 main-world 钩子捕获。
const SKU_HOOK_ATTR = 'data-xhs-enhanced-sku-hook';
const SKU_MSG = 'xhs-enhanced:sku-variant-data';
const TITLE_TEXT = '📷 商品高清图下载';
const COUNT_EMPTY = '未扫描';
const COUNT_NONE = '未发现小红书商品图片';
const COUNT_FOUND_PREFIX = '发现高清图片：';

let panel = null;
let countNode = null;
let statusNode = null;
let scanButton = null;
let downloadButton = null;
let formatSelect = null;
let decorToggle = null;
let compressToggle = null;
let skuToggle = null;
let pendingSkuResolve = null;
let skuMessageBound = false;
let observer = null;
let rescanTimer = null;
let autoScanTimer = null;
let currentImages = [];
let includeDecorations = false;
let formatMode = 'png';
let compressMainEnabled = true; // 主图压缩到 3MB 以内（默认开，可关）
let skuEnabled = true; // 下载时抓取 SKU 规格图（默认开，可关）
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

function formatSectionCounts(counts) {
  const parts = [];
  for (const section of ['main', 'detail', 'sku', 'other']) {
    const n = counts[section] || 0;
    if (n > 0) parts.push(GOODS_SECTION_LABELS[section] + ' ' + n);
  }
  return parts.join(' · ');
}

function updateCountLabel() {
  if (!countNode || !countNode.isConnected) return;
  countNode.textContent = currentImages.length
    ? COUNT_FOUND_PREFIX + formatSectionCounts(countGoodsSections(currentImages)) + ' 张'
    : COUNT_NONE;
}

function setBusy(busy) {
  inFlight = busy;
  if (scanButton) scanButton.disabled = busy;
  if (downloadButton) downloadButton.disabled = busy;
  if (downloadButton) downloadButton.textContent = busy ? '下载中…' : '下载高清图';
}

// DOM-side candidates: rendered <img>/<source> nodes (currentSrc/src/data-*,
// srcset) plus inline background-image URLs. Each candidate keeps its section
// (main/detail/other) based on the container it lives in.
function collectDomImageEntries(doc) {
  const out = [];
  if (!doc) return out;
  const imageNodes = Array.from(doc.querySelectorAll('img,source'));
  for (const node of imageNodes) {
    const section = classifyGoodsSection(node, doc);
    const push = url => { if (url) out.push({ url, section }); };

    if (node.currentSrc) push(node.currentSrc);
    for (const attribute of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-originalsrc']) {
      const value = node.getAttribute && node.getAttribute(attribute);
      if (value) push(value);
    }
    const srcset = node.getAttribute
      ? (node.getAttribute('srcset') || node.getAttribute('data-srcset') || node.getAttribute('data-original-srcset') || '')
      : '';
    if (srcset) {
      const largest = pickLargestFromSrcset(srcset);
      if (largest) push(largest);
    }
  }
  const styledNodes = doc.querySelectorAll ? Array.from(doc.querySelectorAll('[style*="background"]')) : [];
  for (const node of styledNodes) {
    const style = node.getAttribute && node.getAttribute('style');
    if (!style) continue;
    const match = String(style).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    if (match && match[1]) out.push({ url: match[1], section: classifyGoodsSection(node, doc) });
  }
  return out;
}

function computeImages(doc, options) {
  const dom = collectDomImageEntries(doc);
  const html = doc && doc.documentElement ? String(doc.documentElement.innerHTML || '') : '';
  const textUrls = extractUrlsFromText(html);
  return collectGoodsImageEntries(dom, textUrls, options);
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

// Decode an image blob with createImageBitmap, falling back to <img>+objectURL.
// Returns null when the bytes cannot be decoded (e.g. HEIC outside a HEIC-
// capable browser) — callers then keep the original bytes.
function createImageBitmapSafe(bytes) {
  const source = bytes && bytes.length ? new Blob([bytes]) : null;
  if (!source) return Promise.resolve(null);
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(source).then(bitmap => bitmap || null, () => null);
  }
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(source);
      const img = new Image();
      img.onload = () => { try { URL.revokeObjectURL(url); } catch (_) {} resolve(img); };
      img.onerror = () => { try { URL.revokeObjectURL(url); } catch (_) {} resolve(null); };
      img.src = url;
    } catch (_) {
      resolve(null);
    }
  });
}

function sourceDimensions(source) {
  const width = Number(source && (source.width || source.naturalWidth)) || 0;
  const height = Number(source && (source.height || source.naturalHeight)) || 0;
  return { width, height };
}

async function imageSize(bytes) {
  const source = await createImageBitmapSafe(bytes);
  if (!source) return {};
  const size = sourceDimensions(source);
  try { if (source.close) source.close(); } catch (_) {}
  return size;
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise(resolve => {
    try {
      if (typeof canvas.convertToBlob === 'function') {
        canvas.convertToBlob({ type: 'image/jpeg', quality }).then(b => resolve(b || null), () => resolve(null));
        return;
      }
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(b => resolve(b || null), 'image/jpeg', quality);
        return;
      }
      resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

// Re-encode to JPEG, lowering quality step by step, then shrinking dimensions
// progressively, until the blob fits GOODS_COMPRESS_MAX_BYTES (or we run out
// of room and keep the best effort).
async function compressGoodsImageToLimit(bytes) {
  const source = await createImageBitmapSafe(bytes);
  if (!source) return null;
  const { width, height } = sourceDimensions(source);
  if (!width || !height) {
    try { if (source.close) source.close(); } catch (_) {}
    return null;
  }
  let bestBlob = null;
  const attempt = async (w, h) => {
    let canvas;
    try {
      if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(w, h);
      else if (ROOT.document) { canvas = ROOT.document.createElement('canvas'); canvas.width = w; canvas.height = h; }
      else return null;
    } catch (_) { return null; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try { ctx.drawImage(source, 0, 0, w, h); } catch (_) { return null; }
    for (const quality of JPEG_QUALITY_LADDER) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= GOODS_COMPRESS_MAX_BYTES) return blob;
    }
    return null;
  };
  let blob = await attempt(width, height);
  if (!blob) {
    let factor = SCALE_DOWN_FACTOR;
    while (!blob && factor >= SCALE_DOWN_MIN) {
      const dims = scaledDimensions(width, height, factor);
      blob = await attempt(dims.width, dims.height);
      factor = Math.round((factor - 0.15) * 100) / 100;
    }
  }
  try { if (source.close) source.close(); } catch (_) {}
  return blob || bestBlob;
}

// ---- SKU 规格图 -----------------------------------------------------------
// 选规格面板每次打开都会请求 /toc/variant，响应里 template_data[] 同时带
// contentE1.variants[0].value（规格名）与 headerV4.previewImage（该规格预览图）。
// 页面自身带 x-s/x-t 签名，后台无法直接请求，所以在页面 main world 注入一个
// 轻量钩子捕获该响应，再用 postMessage 回传给 isolated world 的 content script。
function installSkuNetworkHook() {
  const doc = ROOT.document;
  if (!doc || !doc.documentElement || doc.documentElement.hasAttribute(SKU_HOOK_ATTR)) return;
  try {
    doc.documentElement.setAttribute(SKU_HOOK_ATTR, '1');
    const script = doc.createElement('script');
    script.textContent = `(function(){
  var MSG = ${JSON.stringify(SKU_MSG)};
  function send(body){ try { window.postMessage({__xhsEnhancedSku:true, body:body}, '*'); } catch(e){} }
  function watch(xhr){
    try {
      xhr.addEventListener('load', function(){
        try {
          var u = String(this.__xhsSkuUrl || this.responseURL || '');
          if (u.indexOf('/toc/variant') < 0) return;
          var b = this.responseText;
          if (b) send(b);
        } catch(e){}
      });
    } catch(e){}
  }
  var XhrCtor = window['XML' + 'HttpRequest'];
  var Open = XhrCtor.prototype.open;
  XhrCtor.prototype.open = function(method, url){
    try { if (String(url||'').indexOf('/toc/variant') >= 0) this.__xhsSkuUrl = String(url); } catch(e){}
    try { watch(this); } catch(e){}
    return Open.apply(this, arguments);
  };
  var NativeFetch = window.fetch;
  if (typeof NativeFetch === 'function') {
    window.fetch = function(input, init){
      var p = NativeFetch.apply(this, arguments);
      try {
        var u = String((input && input.url) || input || '');
        if (u.indexOf('/toc/variant') >= 0) {
          p.then(function(r){ return r.clone().text().then(send); }).catch(function(){});
        }
      } catch(e){}
      return p;
    };
  }
})();`;
    (doc.head || doc.documentElement).appendChild(script);
  } catch (_) {
    // Injection blocked (unusual CSP): SKU collection degrades to the current-preview fallback.
  }
}

function onSkuMessage(event) {
  const data = event && event.data;
  if (!data || data.__xhsEnhancedSku !== true || typeof data.body !== 'string') return;
  if (!pendingSkuResolve) return;
  const resolve = pendingSkuResolve;
  pendingSkuResolve = null;
  resolve(data.body);
}

function waitForSkuData(timeoutMs) {
  return new Promise(resolve => {
    const timer = ROOT.setTimeout(() => {
      if (pendingSkuResolve) {
        pendingSkuResolve = null;
        resolve('');
      }
    }, timeoutMs);
    pendingSkuResolve = body => {
      ROOT.clearTimeout(timer);
      resolve(body);
    };
  });
}

function parseSkuVariantResponse(body) {
  let data;
  try { data = JSON.parse(String(body || '')); } catch (_) { return []; }
  const templates = data && data.data && data.data.template_data;
  if (!Array.isArray(templates)) return [];
  const out = [];
  for (const item of templates) {
    const variants = item && item.contentE1 && item.contentE1.variants;
    const value = Array.isArray(variants) && variants[0] ? variants[0].value : null;
    const url = item && item.headerV4 && item.headerV4.previewImage;
    if (value && url) out.push({ url, section: 'sku', skuName: value });
  }
  return dedupeSkuEntries(out);
}

function closeSkuPanel(doc) {
  try {
    const zoom = doc.querySelector('img[data-action="zoom"]');
    if (!zoom) return;
    let root = zoom.parentElement;
    while (root && root !== doc.body && !/数量|加入购物车/.test(String(root.textContent || ''))) {
      root = root.parentElement;
    }
    const close = root && root.querySelector('svg[width="14"][height="14"]');
    if (close && close.parentElement) close.parentElement.click();
  } catch (_) {
    /* never let panel cleanup break the download */
  }
}

async function collectSkuVariants() {
  const doc = ROOT.document;
  if (!doc) return [];
  const anchor = doc.querySelector('p.selected-text');
  if (!anchor || typeof anchor.click !== 'function') return []; // 无 SKU 选择器
  const selectedName = normalizeSpace(anchor.textContent || '').slice(0, 60);
  // 若规格面板已经打开，先关掉再重新点开，确保页面会发一个新的签名请求供钩子捕获。
  closeSkuPanel(doc);
  const captured = waitForSkuData(4000);
  try { anchor.click(); } catch (_) { /* ignore */ }
  let body = '';
  try { body = await captured; } catch (_) { /* ignore */ }
  const entries = body ? parseSkuVariantResponse(body) : [];
  // 钩子因页面 SDK 覆盖 XHR/fetch、CSP 等原因没抓到（或只拿到当前规格）时，
  // 退回 DOM 逐个点击规格选项——已真实页面验证可拿到全部规格。
  if (entries.length < 2) {
    const domEntries = await collectSkuFromDom(doc, anchor, selectedName);
    if (domEntries.length > entries.length) {
      entries.length = 0;
      entries.push(...domEntries);
    }
  }
  closeSkuPanel(doc);
  return entries;
}

// 兜底方案：网络钩子没抓到时，直接逐个点击规格选项并读取预览图 src。
// 真实页面里「颜色分类」等类名是哈希值，不能依赖；这里只依赖稳定的结构：
// 面板里的 img[data-action="zoom"] 预览图 + 无子元素的文本 span（按钮/svg 排除），
// 点一下若预览图 URL 变了就说明这是个规格选项。
const SKU_STATIC_LABELS = new Set([
  '数量', '加入购物车', '立即购买', '颜色分类', '规格', '已选', '选择规格', '运费',
  '7天无理由退货', '极速退款', '晚发必赔'
]);

function skuPreviewSrc(doc) {
  const img = doc.querySelector('img[data-action="zoom"]');
  return img && img.src ? img.src : '';
}

function waitForSkuPreview(doc, prevSrc, timeoutMs) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const src = skuPreviewSrc(doc);
      if (src && src !== prevSrc) return resolve(src);
      if (Date.now() - start >= timeoutMs) return resolve('');
      ROOT.setTimeout(tick, 50);
    };
    tick();
  });
}

async function collectSkuFromDom(doc, anchor, selectedName) {
  const out = [];
  let preview = skuPreviewSrc(doc);
  if (!preview) {
    try { anchor.click(); } catch (_) { /* ignore */ }
    preview = await waitForSkuPreview(doc, '', 2000);
  }
  if (!preview) return out;
  if (selectedName) out.push({ url: preview, section: 'sku', skuName: selectedName });
  let root = doc.querySelector('img[data-action="zoom"]');
  if (!root) return dedupeSkuEntries(out);
  root = root.parentElement;
  while (root && root !== doc.body && !/数量|加入购物车/.test(String(root.textContent || ''))) {
    root = root.parentElement;
  }
  if (!root || root === doc.body) return dedupeSkuEntries(out);
  const chips = Array.from(root.querySelectorAll('*')).filter(el => {
    if (el.children.length || el.closest('svg') || el.closest('button')) return false;
    const text = normalizeSpace(el.textContent || '');
    return text && text.length <= 40 && !/^[\d.]+$/.test(text) && !SKU_STATIC_LABELS.has(text);
  });
  for (const chip of chips) {
    const name = normalizeSpace(chip.textContent || '').slice(0, 60);
    if (!name) continue;
    const before = skuPreviewSrc(doc);
    try { chip.click(); } catch (_) { continue; }
    const after = await waitForSkuPreview(doc, before, 800);
    if (after) out.push({ url: after, section: 'sku', skuName: name });
  }
  // 还原用户原来选中的规格，避免下载后页面停在最后一个规格上。
  if (selectedName) {
    const original = chips.find(el => normalizeSpace(el.textContent || '') === selectedName);
    if (original) { try { original.click(); } catch (_) { /* ignore */ } }
  }
  return dedupeSkuEntries(out);
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
  const base = currentImages.length ? currentImages.slice() : computeImages(doc, { includeDecorations });
  const finish = images => {
    if (!images.length) {
      setBusy(false);
      setStatus(COUNT_NONE + '，请先扫描');
      return;
    }
    startPacking(images, doc);
  };
  if (!skuEnabled) {
    finish(base);
    return;
  }
  // SKU 图不是常驻 DOM：打开规格面板触发页面自己的签名接口，捕获预览图后再打包。
  setBusy(true);
  setStatus('正在读取 SKU 规格图…');
  collectSkuVariants().then(skuEntries => {
    const images = base.concat(skuEntries);
    if (skuEntries.length) setStatus('已读取 ' + skuEntries.length + ' 个 SKU 规格，开始下载…');
    finish(images);
  }).catch(() => finish(base));
}

function startPacking(images, doc) {
  const goodsId = getGoodsIdFromHref(ROOT.location ? ROOT.location.pathname : '') || 'goods';
  const pageUrl = ROOT.location ? String(ROOT.location.href || '') : '';
  const title = getGoodsTitleFromDocument(doc);
  const scannedAt = new Date().toLocaleString();
  const total = images.length;
  let done = 0;
  let failed = 0;
  setBusy(true);
  setStatus('正在下载 0/' + total + '…');
  mapWithConcurrencyLocal(images, 3, (item, index) => {
    const url = item.url || item;
    const section = item.section || 'other';
    const skuName = item.skuName || '';
    const hd = toHDGoodsUrl(url, formatMode);
    return fetchBytes(hd, { timeout: 30000 }).then(first => {
      let res = first;
      if (!res || !res.ok) {
        if (hd !== url) {
          return fetchBytes(url, { timeout: 30000 }).then(retry => {
            done += 1;
            setStatus('正在下载 ' + done + '/' + total + '…');
            return packEntry(url, retry, section, skuName);
          });
        }
        done += 1;
        setStatus('正在下载 ' + done + '/' + total + '…');
        return packEntry(url, null, section, skuName);
      }
      done += 1;
      setStatus('正在下载 ' + done + '/' + total + '…');
      return packEntry(url, res, section, skuName);
    });
  }).then(async packed => {
    const fetched = [];
    for (const item of packed) {
      if (item && item.entry) fetched.push(item.entry);
      else failed += 1;
    }
    if (!fetched.length) {
      setBusy(false);
      setStatus('全部 ' + total + ' 张图片下载失败');
      return;
    }
    // 详情图被切成 W×1500 + W×短图 两张时，先拼回整图再命名打包。
    let stitchedCount = 0;
    const assembled = [];
    for (const group of planDetailImageGroups(fetched)) {
      if (group.length === 1) {
        assembled.push(fetched[group[0]]);
        continue;
      }
      const merged = await stitchDetailGroup(group.map(index => fetched[index]));
      if (merged) {
        assembled.push(merged);
        stitchedCount += 1;
      } else {
        for (const index of group) assembled.push(fetched[index]); // 拼接失败保留原切片
      }
    }
    const finalEntries = assembled;
    // Per-section numbering: 主图_01.., 详情图_01.., SKU_<规格名>_01.., 其它_01..
    const sectionSeq = { main: 0, detail: 0, sku: 0, other: 0 };
    const skuSeqByName = new Map();
    const skuManifest = [];
    const entries = finalEntries.map(entry => {
      const section = entry.section === 'main' || entry.section === 'detail' || entry.section === 'sku'
        ? entry.section : 'other';
      if (section === 'sku') {
        const skuName = entry.skuName || '规格';
        const seq = skuSeqByName.get(skuName) || 0;
        skuSeqByName.set(skuName, seq + 1);
        const name = buildGoodsSkuImageFileName(skuName, seq, entry.ext);
        skuManifest.push({ name: skuName, file: name });
        return { name, bytes: entry.bytes };
      }
      const seq = sectionSeq[section] || 0;
      sectionSeq[section] = seq + 1;
      return { name: buildGoodsImageFileName(seq, entry.ext, section), bytes: entry.bytes };
    });
    const sectionCounts = countGoodsSections(finalEntries);
    const compressStats = section => ({
      enabled: compressMainEnabled,
      compressed: finalEntries.filter(entry => entry.section === section && entry.compressed).length,
      failed: finalEntries.filter(entry => entry.section === section && entry.compressFailed).length,
      oversize: finalEntries.filter(entry => entry.section === section && entry.oversize).length
    });
    const mainStats = compressStats('main');
    const skuStats = compressStats('sku');
    const info = buildGoodsInfoText({
      pageUrl, goodsId, title, scannedAt, count: entries.length, mode: formatMode,
      sections: sectionCounts, skus: skuManifest, stitched: stitchedCount,
      compressMain: mainStats, compressSku: skuStats
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
      const details = [];
      if (failed) details.push('失败 ' + failed + ' 张');
      const skuCount = finalEntries.filter(entry => entry.section === 'sku').length;
      if (skuCount > 0) details.push('SKU 图 ' + skuCount + ' 张');
      if (stitchedCount > 0) details.push('详情图拼接 ' + stitchedCount + ' 组');
      if (mainStats.compressed > 0) details.push('主图已压缩 ' + mainStats.compressed + ' 张');
      if (skuStats.compressed > 0) details.push('SKU 图已压缩 ' + skuStats.compressed + ' 张');
      if (mainStats.oversize > 0) details.push('主图 ' + mainStats.oversize + ' 张仍超过 3MB');
      if (skuStats.oversize > 0) details.push('SKU 图 ' + skuStats.oversize + ' 张仍超过 3MB');
      setStatus('已下载 ' + (entries.length - 1) + ' 张图片' + (details.length ? '（' + details.join('；') + '）' : '') + '（zip 已保存）');
    } catch (_) {
      setBusy(false);
      setStatus('打包下载失败');
    }
  }, () => {
    setBusy(false);
    setStatus('下载失败');
  });
}

// 把一组上下切片（W×1500 + W×<1500）还原成一张长图：按原始尺寸从上到下绘制。
// 任一步失败则返回 null，调用方保留原始切片，不影响其余图片。
async function stitchDetailGroup(entries) {
  const sources = [];
  try {
    for (const entry of entries) {
      const source = await createImageBitmapSafe(entry && entry.bytes);
      if (!source) return null;
      sources.push(source);
    }
    const sizes = sources.map(sourceDimensions);
    const width = sizes[0].width;
    const height = sizes.reduce((sum, size) => sum + size.height, 0);
    if (!width || !height) return null;
    let canvas;
    try {
      if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
      else if (ROOT.document) {
        canvas = ROOT.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
      } else return null;
    } catch (_) { return null; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let y = 0;
    for (const source of sources) {
      ctx.drawImage(source, 0, y);
      y += sourceDimensions(source).height;
    }
    const blob = await canvasToJpegBlob(canvas, 0.92);
    if (!blob) return null;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) return null;
    return { name: '', bytes, ext: 'jpg', section: 'detail', width, height, stitched: true };
  } catch (_) {
    return null;
  } finally {
    for (const source of sources) {
      try { if (source.close) source.close(); } catch (_) { /* ignore */ }
    }
  }
}

// Pack one fetched image into a zip entry payload (name assigned later, per section).
// Main images larger than 3MB are re-encoded (lower JPEG quality, then smaller
// dimensions) when the panel's 主图压缩 switch is on.
async function packEntry(url, res, section, skuName) {
  const bytes = res && res.ok && res.bytes && res.bytes.length ? res.bytes : null;
  if (!bytes) return { entry: null };
  const ext = extForImage(bytes, res.contentType, url);
  const common = { name: '', ext, section, skuName: skuName || '' };
  if (section === 'detail') {
    const size = await imageSize(bytes);
    if (size.width && size.height) {
      common.width = size.width;
      common.height = size.height;
    }
  }
  if (shouldCompressGoodsImage(section, bytes.length, compressMainEnabled)) {
    const blob = await compressGoodsImageToLimit(bytes);
    if (blob) {
      const buffer = await blob.arrayBuffer();
      const compressed = new Uint8Array(buffer);
      if (compressed.length && compressed.length <= GOODS_COMPRESS_MAX_BYTES) {
        return { entry: { ...common, bytes: compressed, ext: 'jpg', compressed: true, oversize: false } };
      }
      if (compressed.length && compressed.length < bytes.length) {
        return { entry: { ...common, bytes: compressed, ext: 'jpg', compressed: true, oversize: true } };
      }
    }
    // Decode/re-encode failed or produced a larger file: keep the original
    // bytes and mark it so the summary can report it.
    return {
      entry: { ...common, bytes, compressed: false, oversize: true, compressFailed: true }
    };
  }
  return { entry: { ...common, bytes } };
}

function onDecorationsToggle() {
  includeDecorations = Boolean(decorToggle && decorToggle.checked);
  rescan(true);
  setStatus(includeDecorations ? '已包含头像/表情等修饰图' : '已排除头像/表情等修饰图');
}

function onCompressToggle() {
  compressMainEnabled = Boolean(compressToggle && compressToggle.checked);
  setStatus(compressMainEnabled ? '主图将压缩到 3MB 以内' : '主图不压缩（保留原始字节）');
}

function onSkuToggle() {
  skuEnabled = Boolean(skuToggle && skuToggle.checked);
  setStatus(skuEnabled ? '将抓取 SKU 规格图（下载时展开规格面板）' : '不抓取 SKU 规格图');
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

  const compressLabel = doc.createElement('label');
  compressLabel.className = 'xhs-enhanced-goods-check';
  compressToggle = doc.createElement('input');
  compressToggle.type = 'checkbox';
  compressToggle.id = COMPRESS_ID;
  compressToggle.checked = compressMainEnabled;
  compressToggle.addEventListener('change', onCompressToggle);
  compressLabel.appendChild(compressToggle);
  compressLabel.appendChild(doc.createTextNode('主图 / SKU 图压缩到 3MB 以内'));
  element.appendChild(compressLabel);

  const skuLabel = doc.createElement('label');
  skuLabel.className = 'xhs-enhanced-goods-check';
  skuToggle = doc.createElement('input');
  skuToggle.type = 'checkbox';
  skuToggle.id = SKU_ID;
  skuToggle.checked = skuEnabled;
  skuToggle.addEventListener('change', onSkuToggle);
  skuLabel.appendChild(skuToggle);
  skuLabel.appendChild(doc.createTextNode('包含 SKU 规格图（每个规格单独一张）'));
  element.appendChild(skuLabel);

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
  installSkuNetworkHook();
  if (!skuMessageBound && typeof ROOT.addEventListener === 'function') {
    ROOT.addEventListener('message', onSkuMessage);
    skuMessageBound = true;
  }
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
  compressToggle = null;
  skuToggle = null;
  pendingSkuResolve = null;
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
