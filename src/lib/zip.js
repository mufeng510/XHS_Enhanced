// ZIP builder (stored entries, no compression). Stored is deliberate: images are
// already compressed, so deflate would burn CPU on both ends for ~0 gain, and
// this keeps the encoder small and CRC-verifiable. UTF-8 file names are written
// with general-purpose flag bit 11 set. No ZIP64: callers must keep each part
// under MAX_ZIP_BYTES (see splitZipEntries).

export const MAX_ZIP_BYTES = 200 * 1024 * 1024; // 200 MiB per volume
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  const buf = bytes || new Uint8Array(0);
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Names that survive Windows/macOS/zip GUIs: control chars and the hostile
// set become spaces, leading/trailing dots and spaces are dropped, Windows
// reserved device names are prefixed, and the result is truncated to
// maxLength Unicode code points. CJK is preserved.
export function sanitizeFileName(value, fallback = 'untitled', maxLength = 40) {
  const text = String(value == null ? '' : value);
  // eslint-disable-next-line no-control-regex
  const cleaned = text
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/g, '')
    .replace(/[\s.]+$/g, '')
    .trim();
  let name = cleaned;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = '_' + name;
  const chars = Array.from(name);
  if (chars.length > maxLength) name = chars.slice(0, maxLength).join('');
  name = name.replace(/[\s.]+$/g, '');
  return name || fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function asValidDate(value) {
  const time = value && typeof value.getTime === 'function' ? value.getTime() : NaN;
  return Number.isFinite(time) ? new Date(time) : new Date();
}

export function buildBatchZipFileName(now, count, partIndex = 0, partTotal = 1) {
  const date = asValidDate(now);
  const stamp = String(date.getFullYear())
    + pad2(date.getMonth() + 1)
    + pad2(date.getDate())
    + '_'
    + pad2(date.getHours())
    + pad2(date.getMinutes());
  const base = `XHS笔记_${stamp}_${Number(count) || 0}篇`;
  return partTotal > 1 ? `${base}_part${partIndex + 1}.zip` : `${base}.zip`;
}

export function buildNoteFolderName(index, noteId, title) {
  const seq = String((Number(index) || 0) + 1).padStart(3, '0');
  const id = sanitizeFileName(noteId, 'note');
  const suffix = sanitizeFileName(title, '', 30);
  return suffix ? `${seq}_${id}_${suffix}` : `${seq}_${id}`;
}

// Flat layout: pack every image under one prefix instead of one folder per
// note. The seq prefix keeps extraction order; noteId keeps names unique.
export function buildFlatEntryName(index, noteId, fileName) {
  const seq = String((Number(index) || 0) + 1).padStart(3, '0');
  const id = sanitizeFileName(noteId, 'note');
  const file = sanitizeFileName(String(fileName || 'image.jpg').replace(/^\/+/, ''), 'image.jpg', 120);
  return `${seq}_${id}_${file}`;
}

// order 0 renders as "01_封面", order >= 1 as "02", "03"... — covers stay
// first inside each note folder per the design doc.
export function buildImageFileName(order, ext, isCover = false) {
  const seq = pad2((Number(order) || 0) + 1);
  const safeExt = sanitizeFileName(String(ext || 'jpg').replace(/^\.+/, ''), 'jpg', 8).toLowerCase();
  return `${seq}${isCover ? '_封面' : ''}.${safeExt}`;
}

// Partition entries into parts no bigger than maxBytes. An entry larger than
// maxBytes gets its own part (never dropped, never split).
export function splitZipEntries(entries, maxBytes = MAX_ZIP_BYTES) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_ZIP_BYTES;
  const list = Array.isArray(entries) ? entries : [];
  const parts = [];
  let current = [];
  let currentBytes = 0;
  for (const entry of list) {
    const size = entry && entry.bytes ? entry.bytes.length : 0;
    if (current.length && currentBytes + size > limit) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += size;
  }
  if (current.length) parts.push(current);
  return parts;
}

function dosDateTime(date) {
  const d = asValidDate(date);
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >>> 1) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, day };
}

function encodeName(name) {
  const value = String(name == null ? '' : name).replace(/\\/g, '/');
  return new TextEncoder().encode(value);
}

// entries: [{ name, bytes: Uint8Array }]. Throws when the payload would
// exceed 4 GiB (no ZIP64); callers must pre-split with splitZipEntries.
export function buildZip(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const { time, day } = dosDateTime(options.now);
  const prepared = list.map(entry => {
    const nameBytes = encodeName(entry && entry.name);
    const data = entry && entry.bytes instanceof Uint8Array ? entry.bytes
      : entry && entry.bytes ? new Uint8Array(entry.bytes) : new Uint8Array(0);
    return { nameBytes, data, crc: crc32(data), size: data.length };
  });
  let offset = 0;
  let centralBytes = 0;
  for (const item of prepared) {
    item.localOffset = offset;
    offset += 30 + item.nameBytes.length + item.size;
    if (offset > 0xffffffff) throw new RangeError('zip-too-large');
    centralBytes += 46 + item.nameBytes.length;
  }
  const eocdBytes = 22;
  const total = offset + centralBytes + eocdBytes;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let cursor = 0;
  for (const item of prepared) {
    view.setUint32(cursor, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(cursor + 4, VERSION_NEEDED, true);
    view.setUint16(cursor + 6, FLAG_UTF8, true);
    view.setUint16(cursor + 8, METHOD_STORED, true);
    view.setUint16(cursor + 10, time, true);
    view.setUint16(cursor + 12, day, true);
    view.setUint32(cursor + 14, item.crc, true);
    view.setUint32(cursor + 18, item.size, true);
    view.setUint32(cursor + 22, item.size, true);
    view.setUint16(cursor + 26, item.nameBytes.length, true);
    view.setUint16(cursor + 28, 0, true);
    cursor += 30;
    out.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
    out.set(item.data, cursor);
    cursor += item.size;
  }
  const centralStart = cursor;
  for (const item of prepared) {
    view.setUint32(cursor, CENTRAL_SIGNATURE, true);
    view.setUint16(cursor + 4, VERSION_NEEDED, true); // version made by
    view.setUint16(cursor + 6, VERSION_NEEDED, true); // version needed
    view.setUint16(cursor + 8, FLAG_UTF8, true);
    view.setUint16(cursor + 10, METHOD_STORED, true);
    view.setUint16(cursor + 12, time, true);
    view.setUint16(cursor + 14, day, true);
    view.setUint32(cursor + 16, item.crc, true);
    view.setUint32(cursor + 20, item.size, true);
    view.setUint32(cursor + 24, item.size, true);
    view.setUint16(cursor + 28, item.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true); // extra length
    view.setUint16(cursor + 32, 0, true); // comment length
    view.setUint16(cursor + 34, 0, true); // disk number
    view.setUint16(cursor + 36, 0, true); // internal attrs
    view.setUint32(cursor + 38, 0, true); // external attrs
    view.setUint32(cursor + 42, item.localOffset, true);
    cursor += 46;
    out.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
  }
  view.setUint32(cursor, EOCD_SIGNATURE, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, prepared.length, true);
  view.setUint16(cursor + 10, prepared.length, true);
  view.setUint32(cursor + 12, centralBytes, true);
  view.setUint32(cursor + 16, centralStart, true);
  view.setUint16(cursor + 20, 0, true);
  return out;
}
