// Cover pipeline: fetch bytes through the background worker, sniff mimes,
// transcode via canvas when required, and hand Blobs to the page (download /
// clipboard). Runs in the content (isolated) world; Blob objects created here
// are same-realm for canvas/URL/clipboard purposes.
import { getChrome } from './env.js';
import { normalizeSpace } from './text.js';
import { fetchBytes } from './remote.js';
import {
  toNoWatermarkCoverUrl,
  coverUrlCandidates,
  isForcedJpegCandidate,
  looksLikeImageBytes,
  sniffImageMimeFromBytes,
  guessImageMimeFromUrl,
  isJpegBlob,
  resolveCoverExtFromMime,
  resolveCoverExtFromUrl
} from './pure.js';

const coverBlobCache = new Map();
const COVER_CACHE_LIMIT = 80;

export { isJpegBlob };

export function cacheCoverBlob(url, blob) {
  const key = normalizeSpace(url);
  if (!key || !blob) return;
  if (coverBlobCache.size >= COVER_CACHE_LIMIT) {
    const first = coverBlobCache.keys().next().value;
    if (first !== undefined) coverBlobCache.delete(first);
  }
  coverBlobCache.set(key, blob);
}

export function getCachedCoverBlob(url) {
  const key = normalizeSpace(url);
  if (!key || !coverBlobCache.has(key)) return null;
  const hit = coverBlobCache.get(key);
  return hit && typeof hit.size === 'number' ? hit : null;
}

export function cacheCoverMiss(url) {
  const key = normalizeSpace(url);
  if (!key) return;
  if (coverBlobCache.size >= COVER_CACHE_LIMIT) {
    const first = coverBlobCache.keys().next().value;
    if (first !== undefined) coverBlobCache.delete(first);
  }
  coverBlobCache.set(key, false);
}

export function isCoverMiss(url) {
  const key = normalizeSpace(url);
  return key ? coverBlobCache.get(key) === false : false;
}

export function dataUrlToBlob(dataUrl, mimeType) {
  if (!dataUrl) return null;
  if (!/^data:/i.test(dataUrl)) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const typeMatch = header.match(/^data:([^;,]*)/i);
  const type = (typeMatch && typeMatch[1]) || mimeType || 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  const BlobCtor = globalThis.Blob;
  if (typeof BlobCtor !== 'function') return null;
  try {
    if (!isBase64) {
      const text = decodeURIComponent(body);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
      return new BlobCtor([bytes], { type: type || 'text/plain' });
    }
    if (typeof globalThis.atob !== 'function') return null;
    const binary = globalThis.atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    return new BlobCtor([bytes], { type: type || 'application/octet-stream' });
  } catch (_) {
    return null;
  }
}

export function normalizeFetchedImageBlob(blob, url) {
  if (!blob || typeof blob.size !== 'number' || blob.size < 32) return null;
  if (blob.type && /^image\//i.test(blob.type) && blob.type.indexOf('svg') < 0) return blob;
  const BlobCtor = globalThis.Blob;
  if (typeof BlobCtor !== 'function') return null;
  try {
    return blob.slice ? blob.slice(0, blob.size, guessImageMimeFromUrl(url))
      : new BlobCtor([blob], { type: guessImageMimeFromUrl(url) });
  } catch (_) {
    return null;
  }
}

// Never page-fetch remote CDN images.
export function fetchCoverBlob(url) {
  if (!url) return Promise.resolve(null);
  if (/^data:/i.test(url)) return Promise.resolve(dataUrlToBlob(url, 'image/png'));
  if (/^blob:/i.test(url) && typeof globalThis.fetch === 'function') {
    return globalThis.fetch(url).then(res => (res && res.ok ? res.blob() : null), () => null)
      .then(blob => (blob ? normalizeFetchedImageBlob(blob, url) : null));
  }
  return Promise.resolve(null);
}

export function remoteFetchCoverBlob(url) {
  if (!url || /^(?:data:|blob:)/i.test(url) || !hasRemoteChannel() || isCoverMiss(url)) return Promise.resolve(null);
  const cached = getCachedCoverBlob(url);
  if (cached) return Promise.resolve(cached);
  return fetchBytes(url, { timeout: 20000 }).then(result => {
    if (!result || !result.ok || !result.bytes) { cacheCoverMiss(url); return null; }
    const bytes = result.bytes;
    if (bytes.byteLength < 32 || !looksLikeImageBytes(bytes)) { cacheCoverMiss(url); return null; }
    const sniffed = result.contentType && /^image\//i.test(result.contentType) && result.contentType.indexOf('svg') < 0
      ? result.contentType.split(';')[0].trim()
      : (sniffImageMimeFromBytes(bytes) || guessImageMimeFromUrl(url));
    const BlobCtor = globalThis.Blob;
    if (typeof BlobCtor !== 'function') { cacheCoverMiss(url); return null; }
    const blob = new BlobCtor([bytes], { type: sniffed });
    cacheCoverBlob(url, blob);
    return blob;
  }, () => { cacheCoverMiss(url); return null; });
}

function hasRemoteChannel() {
  const chrome = getChrome();
  return Boolean(chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');
}

// Candidates are tried in priority order and the walk stops as soon as the bytes in
// hand are jpeg -- that is the whole point of the chain, so continuing would only
// re-download multi-MB masters for nothing. Below jpeg we keep the first success as
// the best-so-far and keep looking, because a master that came back as webp/heic/png
// must not beat the forced-jpeg candidate, and a failed candidate must not discard it.
export function resolveCoverBlobFromCandidates(candidates) {
  let chain = Promise.resolve(null);
  for (const url of candidates) {
    chain = chain.then(prev => {
      if (prev && (isJpegBlob(prev.blob) || isForcedJpegCandidate(prev.url))) return prev;
      const loader = /^(?:data:|blob:)/i.test(url) ? fetchCoverBlob(url) : remoteFetchCoverBlob(url);
      return loader.then(blob => {
        if (!blob) return prev;
        if (isForcedJpegCandidate(url) || isJpegBlob(blob)) return { url, blob };
        return prev || { url, blob };
      }, () => prev);
    });
  }
  return chain;
}

export function loadCoverPngBlob(src) {
  return resolveCoverBlobFromCandidates(coverUrlCandidates(src))
    .then(hit => (hit && hit.blob ? { ok: true, blob: hit.blob, url: hit.url || '' } : { ok: false }));
}

function canvasToBlob(img, mimeType, quality) {
  const documentRef = globalThis.document;
  if (!documentRef || !documentRef.createElement) return Promise.resolve(null);
  const type = mimeType || 'image/png';
  try {
    const canvas = documentRef.createElement('canvas');
    if (!canvas || typeof canvas.getContext !== 'function') return Promise.resolve(null);
    canvas.width = img.naturalWidth || img.width || 0;
    canvas.height = img.naturalHeight || img.height || 0;
    if (!canvas.width || !canvas.height) return Promise.resolve(null);
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    // JPEG has no alpha channel; without this the flattened alpha turns black.
    if (type === 'image/jpeg' || type === 'image/jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    const viaDataUrl = () => {
      try { return dataUrlToBlob(canvas.toDataURL(type, quality), type); } catch (_) { return null; }
    };
    if (typeof canvas.toBlob === 'function') {
      return new Promise(resolve => {
        try {
          canvas.toBlob(blob => {
            if (!blob) { resolve(viaDataUrl()); return; }
            resolve(blob);
          }, type, quality);
        } catch (_) {
          resolve(viaDataUrl());
        }
      });
    }
    return Promise.resolve(viaDataUrl());
  } catch (_) {
    return Promise.resolve(null);
  }
}

export function canvasToPngBlob(img) {
  return canvasToBlob(img, 'image/png');
}

// Last-resort local re-encode for masters the CDN stored as webp/avif. Returns null
// when the platform cannot decode the source -- notably heic, which Chromium refuses
// to decode -- so the caller can keep the original bytes instead of failing.
export function blobToJpegBlob(blob, quality) {
  if (!blob || isJpegBlob(blob)) return Promise.resolve(null);
  if (typeof globalThis.createImageBitmap !== 'function') return Promise.resolve(null);
  const q = typeof quality === 'number' ? quality : 0.92;
  return globalThis.createImageBitmap(blob).then(bitmap => canvasToBlob(bitmap, 'image/jpeg', q).then(out => {
    try { bitmap.close(); } catch (_) {}
    return out || null;
  }), () => null);
}

export function ensureJpegCoverBlob(blob) {
  if (!blob || isJpegBlob(blob)) return Promise.resolve(blob);
  return blobToJpegBlob(blob).then(jpeg => jpeg || blob);
}

export function blobToPngBlob(blob) {
  if (!blob) return Promise.resolve(null);
  if (blob.type === 'image/png') return Promise.resolve(blob);
  if (typeof globalThis.createImageBitmap === 'function') {
    return globalThis.createImageBitmap(blob).then(bitmap => canvasToPngBlob(bitmap).then(png => {
      try { bitmap.close(); } catch (_) {}
      return png || blob;
    }, () => {
      try { bitmap.close(); } catch (_) {}
      return blob;
    }), () => blob);
  }
  return Promise.resolve(blob);
}

export function resolveCoverExtForTest(mimeType, sourceUrl) {
  return resolveCoverExtFromMime(mimeType) || resolveCoverExtFromUrl(sourceUrl) || 'jpg';
}

// IMPORTANT: call clipboard.write during the click gesture, with Promise values inside
// ClipboardItem so Chromium keeps user-activation across the async image load.
export function getClipboard() {
  try {
    if (globalThis.navigator && globalThis.navigator.clipboard) return globalThis.navigator.clipboard;
  } catch (_) {}
  return null;
}

export function getClipboardItemCtor() {
  try {
    if (globalThis.navigator && typeof globalThis.navigator.ClipboardItem === 'function') return globalThis.navigator.ClipboardItem;
  } catch (_) {}
  try {
    if (typeof globalThis.ClipboardItem === 'function') return globalThis.ClipboardItem;
  } catch (_) {}
  return null;
}

export function copyText(text) {
  const clipboard = getClipboard();
  if (!clipboard || typeof clipboard.writeText !== 'function') return Promise.resolve(false);
  return clipboard.writeText(text).then(() => true, () => false);
}

export function copyImageBlob(blobPromise) {
  const clipboard = getClipboard();
  const ClipboardItemCtor = getClipboardItemCtor();
  if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
    return Promise.resolve(false);
  }
  const pngPromise = Promise.resolve(blobPromise).then(blob => {
    if (!blob) throw new Error('empty-cover-blob');
    return blobToPngBlob(blob).then(png => {
      const out = png || blob;
      if (!out) throw new Error('cover-transcode-failed');
      return out;
    });
  }).then(blob => {
    // Chromium image clipboard is most reliable with image/png.
    if (blob.type === 'image/png') return blob;
    return blob.slice ? blob.slice(0, blob.size, 'image/png') : blob;
  });
  try {
    const item = new ClipboardItemCtor({ 'image/png': pngPromise });
    return clipboard.write([item]).then(() => true, () => false);
  } catch (_) {
    // Fallback for environments requiring resolved blobs only.
    return pngPromise.then(blob => {
      try {
        const item = new ClipboardItemCtor({ 'image/png': blob });
        return clipboard.write([item]).then(() => true, () => false);
      } catch (_) {
        return false;
      }
    }, () => false);
  }
}

export function triggerCoverDownload(blob, filename) {
  const documentRef = globalThis.document;
  if (!blob || !documentRef || typeof globalThis.URL?.createObjectURL !== 'function') return false;
  let objectUrl = '';
  try {
    objectUrl = globalThis.URL.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename || 'xhs-cover.jpg';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    (documentRef.body || documentRef.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (_) {
    return false;
  } finally {
    // Revoke late so the browser has time to start reading the blob URL.
    globalThis.setTimeout(() => { try { globalThis.URL.revokeObjectURL(objectUrl); } catch (_) {} }, 4000);
  }
}

export { toNoWatermarkCoverUrl };
