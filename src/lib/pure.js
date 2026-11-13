// Pure, DOM-free logic: parsing, route predicates, token extraction, cover URL
// helpers. Everything here is unit-tested in node without a browser.
import { normalizeSpace } from './text.js';

export const DEFAULT_THRESHOLD = 100;
export const THRESHOLD_STORAGE_KEY = 'xhs-enhanced:popular-threshold';
export const FOCUS_STORAGE_KEY = 'xhs-enhanced:focus-popular';

export const SHARE_BASE = 'https://www.xiaohongshu.com/';
export const XSEC_TOKEN_QUERY = 'xsec_token';
export const XSEC_SOURCE_VALUE = 'pc_feed';

export const NOTE_ID_PATTERN = /\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9]+)/;
// Real __INITIAL_STATE__ uses camelCase xsecToken; noteCard often has noteId next to xsecToken.
const NOTE_ID_THEN_TOKEN_PATTERN = /"noteId"\s*:\s*"([0-9a-fA-F]+)"\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
const TOKEN_THEN_NOTE_ID_PATTERN = /"xsecToken"\s*:\s*"([^"]+)"(?:(?!"xsecToken"\s*:)[\s\S]){0,1200}?"noteId"\s*:\s*"([0-9a-fA-F]+)"/g;
const OUTER_ENTRY_TOKEN_PATTERN = /"id"\s*:\s*"([0-9a-fA-F]+)"(?:(?!"id"\s*:\s*")[\s\S]){0,4000}?"ssrRendered"\s*:\s*(?:true|false)\s*,\s*"xsecToken"\s*:\s*"([^"]+)"/g;
export const DETAIL_ROUTE_PATTERN = /^\/(?:explore|discovery\/item|search_result)\/[A-Za-z0-9]+$|^\/user\/profile\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

export function parseThreshold(value) {
  const text = String(value == null ? '' : value);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return { ok: false };
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false };
}

export function parseLikeCount(input) {
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

export function isTargetRoute(pathname) {
  // Home feed (/explore), search result list and user profile pages carry note
  // cards; /explore/<id> etc. are note detail views and are excluded by the
  // exact match.
  const path = String(pathname || '').split('?')[0].replace(/\/+$/, '');
  return path === '/search_result' || path === '/explore' || path.startsWith('/user/profile/');
}

export function isProfileRoute(pathname) {
  const path = String(pathname || '').split('?')[0];
  return path.startsWith('/user/profile/');
}

export function isDetailRoute(pathname) {
  const path = String(pathname || '').split('?')[0];
  return DETAIL_ROUTE_PATTERN.test(path);
}

export function getNoteIdFromHref(href) {
  const text = String(href == null ? '' : href);
  if (!text) return '';
  const match = text.match(NOTE_ID_PATTERN);
  return match ? match[1] : '';
}

export function parseQueryValue(query, key) {
  if (!query || !key) return '';
  const text = String(query);
  const match = text.match(new RegExp('[?&]' + key + '=([^&\\s#]+)'));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch (_) {
    // Malformed percent-encoding in a page href must not crash the click path.
    return '';
  }
}

export function getXsecTokenFromHref(href) {
  const text = String(href == null ? '' : href);
  return parseQueryValue(text, XSEC_TOKEN_QUERY);
}

export function collectTokensFromStateObject(value, map, depth, seen) {
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

export function findTokenForNoteIdInState(value, noteId, depth, seen) {
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

// Scan inline <script> text for the serialized __INITIAL_STATE__ object and
// parse it. Returns null when no usable script exists (callers then fall back
// to the script-text regexes). `undefined` literals are valid in the XHS
// serialization but not in JSON, so they degrade to null before parsing —
// first strict JSON.parse, then the undefined→null rewrite as a fallback.
export function parseInitialStateFromScriptText(text) {
  const source = String(text == null ? '' : text);
  if (!source || source.indexOf('__INITIAL_STATE__') < 0) return null;
  const anchor = source.indexOf('__INITIAL_STATE__');
  const eq = source.indexOf('=', anchor);
  if (eq < 0) return null;
  let start = eq + 1;
  while (start < source.length && source[start] !== '{' && source[start] !== '[') {
    // Skip whitespace and newlines; bail on anything else before the payload.
    if (!/[\s]/.test(source[start])) {
      if (/[a-zA-Z_$]/.test(source[start])) return null;
    }
    start += 1;
  }
  if (start >= source.length) return null;
  const end = scanBalancedObject(source, start);
  if (end < 0) return null;
  const jsonText = source.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    try {
      return JSON.parse(jsonText.replace(/\bundefined\b/g, 'null'));
    } catch (__) {
      return null;
    }
  }
}

function scanBalancedObject(source, start) {
  const stack = [source[start]];
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (ch === '}' && open !== '{') return -1;
      if (ch === ']' && open !== '[') return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}


export function buildShareLink(id, token) {
  if (!id) return '';
  const link = SHARE_BASE + 'explore/' + id;
  if (token) return link + '?' + XSEC_TOKEN_QUERY + '=' + encodeURIComponent(token) + '&xsec_source=' + XSEC_SOURCE_VALUE;
  return link;
}

export function signatureFor(route, likeRaw) {
  return `${route}${likeRaw || ''}`;
}

export function toNoWatermarkCoverUrl(input, base) {
  const raw = normalizeSpace(input);
  if (!raw) return '';
  if (/^(?:data:|blob:)/i.test(raw)) return raw;
  try {
    const pageBase = base || (globalThis.location && globalThis.location.href) || SHARE_BASE;
    const url = new URL(raw, pageBase);
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

export function pickLargestFromSrcset(srcset) {
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

// The sns-webpic host only ever hands out CDN-processed derivatives; the master
// object lives on ci.xiaohongshu.com under the same object key. Drop the
// /{12-digit timestamp}/{32-hex token}/ signed prefix and keep the remainder --
// the scene segment (notes_pre_post, note_pre_post_uhdr, spectrum, or nothing) is
// part of the key, so probing ci with the bare trace id 404s.
export function toCdnObjectPath(input, base) {
  const raw = normalizeSpace(input);
  if (!raw || /^(?:data:|blob:)/i.test(raw)) return '';
  let path = '';
  try {
    const pageBase = base || (globalThis.location && globalThis.location.href) || SHARE_BASE;
    path = new URL(raw, pageBase).pathname;
  } catch (_) {
    path = raw.split('#')[0].split('?')[0];
  }
  path = String(path).replace(/!.*$/, '').replace(/^\/+/, '');
  if (!path) return '';
  const signed = path.match(/^\d{12}\/[0-9a-f]+\/(.+)$/i);
  const body = signed ? signed[1] : path;
  const traceId = body.split('/').pop();
  return /^[0-9a-z_]{8,}$/i.test(traceId) ? body : '';
}

export function coverUrlCandidates(raw) {
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
  const objectPath = toCdnObjectPath(original);
  if (objectPath) {
    // Master object first, with no '!suffix': the suffix is a forced format
    // instruction that also applies on ci, so '!nd_dft_wlteh_webp_3' would hand
    // back a webp transcode even from the otherwise untouched object.
    push('https://ci.xiaohongshu.com/' + objectPath);
    // Masters are stored as jpeg, webp or heic depending on what the uploader
    // sent, so the first hit is not guaranteed to be jpeg. This server-side
    // transcode is the reliable fallback -- Chromium cannot decode heic, so a
    // local canvas pass would fail on exactly these.
    push('https://ci.xiaohongshu.com/' + objectPath + '?imageView2/format/jpeg');
    push('https://sns-img-hw.xhscdn.com/' + objectPath);
  }
  push(normalized);
  push(original);
  if (normalized && !/!/.test(normalized.split("?")[0])) {
    push(normalized.replace(/([?].*)?$/, "!nd_dft_wlteh_webp_3$1"));
  }
  return out.slice(0, 6);
}

export function isForcedJpegCandidate(url) {
  return /[?&]imageView2\/format\/jpe?g(?:$|[/?&])/i.test(String(url || ''));
}


export function resolveCoverExtFromMime(mimeType) {
  const mime = normalizeSpace(String(mimeType == null ? '' : mimeType).split(';')[0]).toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/avif') return 'avif';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  if (mime === 'image/gif') return 'gif';
  return '';
}

export function resolveCoverExtFromUrl(sourceUrl) {
  let path = '';
  try {
    const base = (globalThis.location && globalThis.location.href) || SHARE_BASE;
    path = new URL(String(sourceUrl == null ? '' : sourceUrl), base).pathname;
  } catch (_) {
    path = String(sourceUrl == null ? '' : sourceUrl).split('#')[0].split('?')[0];
  }
  // XHS processed variants append '!nd_*' after the real extension.
  path = String(path).replace(/!.*$/, '');
  const match = path.match(/\.(jpe?g|png|webp|avif|heic|heif|gif)$/i);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  return ext === 'jpe' || ext === 'jpeg' ? 'jpg' : ext;
}

export function buildCoverFileName(noteId, sourceUrl, mimeType) {
  const sanitizedId = String(noteId == null ? '' : noteId).replace(/[^A-Za-z0-9_-]/g, '');
  const baseName = sanitizedId ? 'xhs-note-' + sanitizedId : 'xhs-cover';
  const ext = resolveCoverExtFromMime(mimeType) || resolveCoverExtFromUrl(sourceUrl) || 'jpg';
  return baseName + '.' + ext;
}

export function guessImageMimeFromUrl(url) {
  const text = String(url || '').toLowerCase();
  if (text.indexOf('.png') >= 0) return 'image/png';
  if (text.indexOf('.webp') >= 0 || text.indexOf('webp') >= 0) return 'image/webp';
  if (text.indexOf('.gif') >= 0) return 'image/gif';
  return 'image/jpeg';
}

export function sniffImageMimeFromBytes(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  // RIFF....WEBP -- the payload sits at offset 8, so length 12 is the floor.
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    // ISO BMFF: the major brand after 'ftyp' decides heic vs avif vs neither.
    const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0).toLowerCase();
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|heif)$/.test(brand)) return 'image/heic';
    if (/^(avif|avis)$/.test(brand)) return 'image/avif';
    return '';
  }
  return '';
}

export function looksLikeImageBytes(bytes) {
  return sniffImageMimeFromBytes(bytes) !== '';
}

export function isJpegBlob(blob) {
  const type = normalizeSpace(blob && blob.type).toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg';
}

export function parseBaseUrl(value) {
  const text = normalizeSpace(value).replace(/\/+$/, '');
  if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: '' };
  return { ok: true, value: text };
}

export function parseTokenExp(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1] || typeof globalThis.atob !== 'function') return 0;
  try {
    let payload = String(parts[1]).replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    const match = globalThis.atob(payload).match(/"exp"\s*:\s*(\d+)/);
    return match ? Number(match[1]) || 0 : 0;
  } catch (_) {
    return 0;
  }
}

export function buildCrawlPayload(accountId, urls) {
  const list = (Array.isArray(urls) ? urls : []).filter(url => typeof url === 'string' && url);
  return { account_id: Number(accountId) || 0, urls: list, save_to_library: true, fetch_comments: false };
}
