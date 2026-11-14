// 小红书商品高清图下载 — 纯函数库（goods-detail 页面）。
// 继承自油猴脚本「小红书商品高清图片下载器」的思路：扫描页面里的小红书
// CDN 图片并转成高清地址下载；与油猴版本相比的扩展：
//   1. 额外识别 srcset / data-* / <source> / 行内 background-image；
//   2. HTML 文本扫描排除 JS/CSS/字体等静态资源与头像/表情等修饰图；
//   3. 按“去掉 query 与 !后缀 的 host+path”去重，保留分辨率更高的候选；
//   4. 下载产物为单个 zip（含 info.txt 商品信息），而不是逐张触发下载；
//   5. 高清格式可选：高清 PNG（默认）/ 原始格式 / JPEG q90。
import { normalizeSpace } from './text.js';

export const GOODS_ROUTE_RE = /^\/goods-detail\/[^/?#]+/;

// XHS image CDN families we accept for downloads. Anything else (fe-static
// app assets, arbitrary origins) is rejected.
const IMAGE_CDN_HOST_RE = /(^|\.)xhscdn\.com$/i;
const IMAGE_CDN_EXACT_HOSTS = new Set(['ci.xiaohongshu.com', 'img.xiaohongshu.com', 'qimg.xiaohongshu.com']);
// App bundle / font / data assets on the same CDNs — never download these.
const STATIC_ASSET_PATH_RE = /\.(?:m?js|css|mjs|map|json|woff2?|ttf|otf|svg|html|txt)(\?|$|!)/i;
const STATIC_ASSET_HOST_RE = /(^|\.)(?:fe-static|formula-static)\.xhscdn\.com$/i;
// Decorative images that ride along on XHS pages: avatars, emoji, logos,
// 1px tracking pixels. Filtered out unless the user opts in.
const DECORATION_RE = /(avatar|emoji|favicon|logo|spacer|placeholder|1x1)/i;
// Trailing punctuation commonly caught by a loose URL regex in JSON/HTML.
const TRAILING_JUNK_RE = /(?:[.,;:!?>)]+|&[a-z#0-9]+;)$/i;
const URL_TEXT_RE = /https?:\/\/[^\s"'<>()\\]+/g;

export function isGoodsDetailRoute(href) {
  const text = String(href || '');
  if (!text) return false;
  let pathname = text;
  try {
    pathname = new URL(text, 'https://www.xiaohongshu.com').pathname;
  } catch (_) {
    const cut = text.search(/[?#]/);
    if (cut >= 0) pathname = text.slice(0, cut);
  }
  return GOODS_ROUTE_RE.test(pathname);
}

export function getGoodsIdFromHref(href) {
  const text = String(href || '');
  let pathname = text;
  try {
    pathname = new URL(text, 'https://www.xiaohongshu.com').pathname;
  } catch (_) {
    const cut = text.search(/[?#]/);
    if (cut >= 0) pathname = text.slice(0, cut);
  }
  const match = pathname.match(/^\/goods-detail\/([0-9a-zA-Z_-]{6,})/);
  return match ? match[1] : '';
}

export function isXhsImageCdnUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return IMAGE_CDN_HOST_RE.test(host) || IMAGE_CDN_EXACT_HOSTS.has(host);
  } catch (_) {
    return false;
  }
}

// Raw-text (HTML / JS chunk) URL extraction with conservative trimming.
// Handles the common `\u002F` escaping used inside inline JSON payloads.
export function extractUrlsFromText(text) {
  const source = String(text || '').replace(/\\u002[fF]/g, '/');
  const out = [];
  const matches = source.match(URL_TEXT_RE) || [];
  for (const raw of matches) {
    const trimmed = raw.replace(TRAILING_JUNK_RE, '');
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      out.push(u.href);
    } catch (_) {
      // not a URL — skip
    }
  }
  return out;
}

// True when the URL is an image served by an XHS CDN host and is not an app
// asset nor a decorative image. `includeDecorations` keeps decorative images
// but still rejects JS/CSS/fonts and non-CDN origins.
export function looksLikeGoodsImageUrl(url, options) {
  if (!isXhsImageCdnUrl(url)) return false;
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  const host = u.hostname.toLowerCase();
  if (STATIC_ASSET_HOST_RE.test(host)) return false;
  const path = u.pathname;
  if (STATIC_ASSET_PATH_RE.test(path)) return false;
  const includeDecorations = Boolean(options && options.includeDecorations);
  if (!includeDecorations && DECORATION_RE.test(host + path)) return false;
  return true;
}

// Canonical key: strips the query string and a trailing `!...` edit suffix,
// so the same underlying image at different widths/formats collapses.
export function canonicalGoodsImageKey(url) {
  try {
    const u = new URL(String(url || ''));
    const path = u.pathname.replace(/![^/]*$/, '');
    return (u.hostname.toLowerCase() + path).toLowerCase();
  } catch (_) {
    return String(url || '');
  }
}

// Rough quality rank for choosing the best representative of one canonical
// image: an imageView2 width param decides (higher = better); no width param
// means the untransformed master file, which outranks any width-limited
// derivative of itself. 1x1 tracking pixels rank lowest.
export function rankGoodsImageCandidate(url) {
  const text = String(url || '');
  const widthMatch = text.match(/\/w\/(\d{2,5})/);
  if (!widthMatch) return 4096;
  return Math.min(Number(widthMatch[1]) || 0, 4096);
}

// Dedupe by canonical key keeping the highest-ranked candidate. First-seen
// order is preserved for stable output.
export function dedupeGoodsImages(urls) {
  const bestByKey = new Map();
  const order = [];
  for (const raw of urls || []) {
    const url = String(raw || '').trim();
    if (!url || !isXhsImageCdnUrl(url)) continue;
    const key = canonicalGoodsImageKey(url);
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, url);
      order.push(key);
      continue;
    }
    if (rankGoodsImageCandidate(url) > rankGoodsImageCandidate(prev)) {
      bestByKey.set(key, url);
    }
  }
  return order.map(key => bestByKey.get(key));
}

// Full pipeline: extract → filter → dedupe. Input is a mixed bag of DOM
// candidates and text-scanned URLs.
export function collectGoodsImageCandidates(domCandidates, textCandidates, options) {
  const merged = [];
  const seenAcrossLists = new Set();
  for (const url of domCandidates || []) {
    const clean = String(url || '').trim();
    if (!clean) continue;
    const key = 'dom:' + canonicalGoodsImageKey(clean);
    if (seenAcrossLists.has(key)) continue;
    seenAcrossLists.add(key);
    merged.push(clean);
  }
  for (const url of textCandidates || []) {
    const clean = String(url || '').trim();
    if (!clean) continue;
    merged.push(clean);
  }
  const filtered = merged.filter(url => looksLikeGoodsImageUrl(url, options));
  return dedupeGoodsImages(filtered);
}

export const GOODS_FORMAT_MODES = Object.freeze([
  { value: 'png', label: '高清 PNG' },
  { value: 'original', label: '原始格式' },
  { value: 'jpeg', label: 'JPEG q90' }
]);

export const GOODS_FORMAT_LABELS = Object.freeze({ png: '高清 PNG（imageView2/2/format/png）', original: '原始格式（不改写参数）', jpeg: 'JPEG q90（imageView2/2/format/jpeg/q/90）' });

// Userscript semantics: rewrite the image's query to force a full-size
// re-encode. `original` drops the query entirely (best-effort master file).
export function toHDGoodsUrl(url, mode) {
  const search = mode === 'original' ? '' : (mode === 'jpeg' ? '?imageView2/2/format/jpeg/q/90' : '?imageView2/2/format/png');
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return String(url || '');
    u.search = search;
    return u.href;
  } catch (_) {
    return String(url || '');
  }
}

export function extensionForMime(mime, fallback = 'png') {
  const text = String(mime || '').toLowerCase();
  if (/jpeg|jpg/.test(text)) return 'jpg';
  if (/png/.test(text)) return 'png';
  if (/webp/.test(text)) return 'webp';
  if (/gif/.test(text)) return 'gif';
  if (/avif/.test(text)) return 'avif';
  if (/heic/.test(text)) return 'heic';
  const safe = normalizeSpace(fallback).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return safe || 'png';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// `小红书商品高清图_<goodsId>_YYYYMMDD_HHmm_<N>张.zip`；分卷时追加 `_partK`。
export function buildGoodsZipFileName(now, count, goodsId, partIndex = 0, partTotal = 1) {
  // Duck-typed date check: callers may pass a Date from another realm (vm).
  const date = (now && typeof now.getTime === 'function' && !Number.isNaN(now.getTime())) ? now : new Date();
  const stamp = String(date.getFullYear())
    + pad2(date.getMonth() + 1)
    + pad2(date.getDate())
    + '_'
    + pad2(date.getHours())
    + pad2(date.getMinutes());
  const safeId = String(normalizeSpace(goodsId || '') || 'unknown').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 32) || 'unknown';
  const base = `小红书商品高清图_${safeId}_${stamp}_${Number(count) || 0}张`;
  return partTotal > 1 ? `${base}_part${partIndex + 1}.zip` : `${base}.zip`;
}

export function buildGoodsImageFileName(index, ext) {
  const seq = String((Number(index) || 0) + 1).padStart(2, '0');
  const safeExt = String(ext || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  return `${seq}.${safeExt}`;
}

// info.txt 随压缩包一起导出的商品元信息。
export function buildGoodsInfoText(meta) {
  const m = meta || {};
  const lines = [
    '小红书商品高清图',
    '商品链接：' + (m.pageUrl || ''),
    '商品 ID：' + (m.goodsId || ''),
    '商品标题：' + (m.title || ''),
    '扫描时间：' + (m.scannedAt || ''),
    '图片数量：' + (Number(m.count) || 0),
    '高清格式：' + (GOODS_FORMAT_LABELS[m.mode] || m.mode || ''),
    '来源：小红书商品详情页（由“小红书网页版增强”扩展批量导出）'
  ];
  return lines.join('\n') + '\n';
}

export function getGoodsTitleFromDocument(documentRef) {
  try {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const raw = doc && doc.title ? String(doc.title) : '';
    const cleaned = normalizeSpace(raw.replace(/\s*[-–_|]\s*小红书\s*$/, '').replace(/^(小红书\s*[-–_|]\s*)/, ''));
    return cleaned;
  } catch (_) {
    return '';
  }
}
