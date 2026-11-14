'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');

// Loads the built content bundle the same way extension.test.cjs does, so the
// zip helpers under test are the exact bytes shipped in the extension.
function load(pathname = '/search_result', extras) {
  const context = {
    console,
    location: { pathname, href: 'https://www.xiaohongshu.com' + pathname },
    __XHS_ENHANCED_TEST_MODE__: true,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams
  };
  if (extras) Object.assign(context, extras);
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('extension/content.js', 'utf8'), context);
  return context.__XHS_ENHANCED_TEST_API__;
}

const api = load();
const encoder = new TextEncoder();

function bytes(text) {
  return encoder.encode(text);
}

test('crc32 matches the standard check vector', () => {
  assert.equal(api.crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(api.crc32(new Uint8Array(0)), 0);
});

test('sanitizeFileName strips hostile characters and preserves CJK', () => {
  assert.equal(api.sanitizeFileName('天呐！陈都灵'), '天呐！陈都灵');
  assert.equal(api.sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(api.sanitizeFileName('  .hello world.  '), 'hello world');
  assert.equal(api.sanitizeFileName('CON'), '_CON');
  assert.equal(api.sanitizeFileName('aux.txt'), '_aux.txt');
  assert.equal(api.sanitizeFileName(''), 'untitled');
  assert.equal(api.sanitizeFileName('...'), 'untitled');
  assert.equal(api.sanitizeFileName(null, 'fallback'), 'fallback');
  assert.equal(Array.from(api.sanitizeFileName('长'.repeat(80))).length, 40);
  assert.equal(api.sanitizeFileName('trailing...'), 'trailing');
});

test('buildZip produces a structurally valid EOCD and local headers', () => {
  const zip = api.buildZip([
    { name: '001_note1_标题/01_封面.jpg', bytes: bytes('fake-jpeg-bytes') },
    { name: '002_note2/01_封面.png', bytes: bytes('fake-png-bytes') }
  ], { now: new Date(2026, 10, 13, 14, 5) });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory is the last 22 bytes.
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  const entryCount = view.getUint16(eocd + 10, true);
  assert.equal(entryCount, 2);
  const centralBytes = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(centralOffset + centralBytes, eocd);
  // First local header.
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // General purpose flag carries UTF-8 names; stored method; CRC matches payload.
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint32(14, true), api.crc32(bytes('fake-jpeg-bytes')));
  assert.equal(view.getUint32(18, true), bytes('fake-jpeg-bytes').length);
});

test('buildZip local offsets let a minimal reader walk entries in order', () => {
  const entries = [
    { name: 'a.txt', bytes: bytes('alpha') },
    { name: '中文名/b.txt', bytes: bytes('bravo') }
  ];
  const zip = api.buildZip(entries, { now: new Date(2026, 0, 1, 0, 0) });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Walk local headers back-to-back until the central directory signature.
  let offset = 0;
  const names = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = Buffer.from(zip.buffer, zip.byteOffset + offset + 30, nameLen).toString('utf8');
    names.push(name);
    offset += 30 + nameLen + extraLen + size;
  }
  assert.deepEqual(names, ['a.txt', '中文名/b.txt']);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
});

test('splitZipEntries groups by bytes and never drops entries', () => {
  const mk = size => ({ name: 'n' + size, bytes: new Uint8Array(size) });
  const parts = api.splitZipEntries([mk(60), mk(60), mk(30), mk(10)], 100);
  assert.equal(parts.length, 2);
  assert.equal(parts.map(part => part.map(entry => entry.bytes.length).join(',')).join('|'), '60|60,30,10');
  const single = api.splitZipEntries([mk(500)], 100);
  assert.equal(single.length, 1);
  assert.equal(single[0][0].bytes.length, 500);
});

test('buildBatchZipFileName and note folder naming are filesystem-safe', () => {
  const name = api.buildBatchZipFileName(new Date(2026, 10, 13, 14, 5), 12);
  assert.equal(name, 'XHS笔记_20261113_1405_12篇.zip');
  assert.equal(api.buildBatchZipFileName(new Date(2026, 10, 13, 14, 5), 120, 1, 3), 'XHS笔记_20261113_1405_120篇_part2.zip');
  const folder = api.buildNoteFolderName(0, '6a83c2ed/0000:x', '天呐！陈都灵在大学时期就有这种经历了吗');
  assert.match(folder, /^001_6a83c2ed 0000 x_天呐/);
  assert.equal(api.buildNoteFolderName(2, '', ''), '003_note');
  assert.equal(api.buildImageFileName(0, 'JPG', true), '01_封面.jpg');
  assert.equal(api.buildImageFileName(3, 'png', false), '04.png');
});

test('selection store toggles, persists and rehydrates with validation', async () => {
  const writes = [];
  const stored = { list: [] };
  const storage = {
    async get() { return { 'xhs-enhanced:batch-selected': stored.list }; },
    async set(patch) { writes.push(patch); stored.list = patch['xhs-enhanced:batch-selected']; }
  };
  const store = api.createSelectionStore(storage);
  assert.equal(store.toggle({ id: 'a', link: 'l', coverUrl: 'c', title: 't', ts: 1 }), true);
  assert.equal(store.toggle({ id: 'b', link: '', coverUrl: '', title: '', ts: 2 }), true);
  assert.equal(store.size, 2);
  assert.equal(store.toggle({ id: 'a' }), false);
  assert.equal(store.size, 1);
  await store.flush();
  assert.equal(writes.length >= 1, true);
  assert.equal(stored.list.map(item => item.id).join(','), 'b');
  // Rehydrate a fresh store from the persisted payload; corrupt entries are dropped.
  stored.list = [{ id: 'x', link: 'l', coverUrl: 'c', title: 't', ts: 3 }, { nope: true }, { id: '' }, null];
  const restored = api.createSelectionStore(storage);
  const size = await restored.hydrate();
  assert.equal(size, 1);
  assert.equal(restored.ids().join(','), 'x');
  assert.equal(restored.size, 1);
  restored.clear();
  assert.equal(restored.size, 0);
});

test('selection store tolerates missing storage and corrupt payloads', async () => {
  const inMemory = api.createSelectionStore(null);
  inMemory.add({ id: 'solo', ts: 1 });
  assert.equal(await inMemory.hydrate(), 1);
  assert.equal(inMemory.ids().join(','), 'solo');
  const corrupt = api.createSelectionStore({
    async get() { throw new Error('quota'); },
    async set() { throw new Error('quota'); }
  });
  assert.equal(await corrupt.hydrate(), 0);
  assert.equal(corrupt.add({ id: 'ok', ts: 1 }), true);
});

test('normalizeBatchLayout accepts only notes|flat and degrades to notes', () => {
  assert.equal(api.normalizeBatchLayout('flat'), 'flat');
  assert.equal(api.normalizeBatchLayout('FLAT'), 'flat');
  assert.equal(api.normalizeBatchLayout('notes'), 'notes');
  assert.equal(api.normalizeBatchLayout(''), 'notes');
  assert.equal(api.normalizeBatchLayout('nonsense'), 'notes');
  assert.equal(api.normalizeBatchLayout(undefined), 'notes');
  assert.equal(api.normalizeBatchLayout(null), 'notes');
});

test('buildFlatEntryName keeps seq prefix, note id and zero folders', () => {
  assert.equal(api.buildFlatEntryName(0, 's1', '01_封面.jpg'), '001_s1_01_封面.jpg');
  assert.equal(api.buildFlatEntryName(10, 'abc/def:ghi', '02.jpg'), '011_abc def ghi_02.jpg');
  assert.equal(api.buildFlatEntryName(0, '', ''), '001_note_image.jpg');
  const bag = new Set();
  for (let i = 0; i < 300; i += 1) bag.add(api.buildFlatEntryName(i, 'id-' + i, '01_封面.jpg'));
  assert.equal(bag.size, 300, 'flat names stay unique across notes and images');
});
