'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');

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
const readFixture = name => fs.readFileSync(`tests/fixtures/${name}`, 'utf8');

test('extracts title and imageList from an image-note page', () => {
  const html = readFixture('note-detail-image.html');
  const note = api.extractNoteFromInitialStateHtml(html);
  assert(note, 'note extracted');
  assert.equal(note.title, '图文笔记：三张内图');
  assert.equal(note.type, 'normal');
  assert.equal(note.imageList.length, 3);
  assert.equal(note.imageList[0].urlDefault.includes('!nd_dft_wlteh_webp_3'), true);
  assert.equal(note.imageList[1].urlDefault, '');
  assert.equal(note.imageList[1].urlPre.includes('nd_prv'), true);
  assert.equal(note.imageList[2].infoList.length, 0);
});

test('survives the real page variant carrying new Map literals', () => {
  const html = readFixture('note-detail-video.html');
  const note = api.extractNoteFromInitialStateHtml(html);
  assert(note, 'note extracted despite AiNoteDetailStore literal');
  assert.equal(note.type, 'video');
  assert.equal(note.imageList.length, 1);
  assert.equal(note.imageList[0].urlDefault.includes('202611132144'), true);
  assert.equal(note.imageList[0].infoList.length, 2);
});

test('returns null on a login-redirect payload without imageList data', () => {
  const html = readFixture('note-detail-login-redirect.html');
  const note = api.extractNoteFromInitialStateHtml(html);
  // The login wall carries an empty noteDetailMap: extraction must fail so
  // callers fall back to a hidden tab instead of silently saving nothing.
  assert.equal(note, null);
});

test('returns null when the marker is absent or the page is not html at all', () => {
  assert.equal(api.extractNoteFromInitialStateHtml(''), null);
  assert.equal(api.extractNoteFromInitialStateHtml('<html><body>nope</body></html>'), null);
  assert.equal(api.extractNoteFromInitialStateHtml('window.__INITIAL_STATE__=not json'), null);
});

test('pickBestImageUrl prefers urlDefault, then urlPre, then infoList scenes', () => {
  const [first, second, third] = (api.extractNoteFromInitialStateHtml(readFixture('note-detail-image.html')) || {}).imageList;
  assert.equal(api.pickBestImageUrl(first).includes('nd_dft'), true);
  assert.equal(api.pickBestImageUrl(second).includes('nd_prv'), true);
  assert.equal(api.pickBestImageUrl(third).includes('sns-webpic-qc'), true);
  assert.equal(api.pickBestImageUrl(null), '');
  assert.equal(api.pickBestImageUrl({ infoList: [{ imageScene: 'WB_DFT', url: 'https://cdn/x.jpg' }] }), 'https://cdn/x.jpg');
  assert.equal(api.pickBestImageUrl({ infoList: [{ imageScene: 'WB_PRV', url: 'https://cdn/p.jpg' }, { imageScene: 'WB_DFT', url: 'https://cdn/d.jpg' }] }), 'https://cdn/d.jpg');
  assert.equal(api.pickBestImageUrl({ urlDefault: '', urlPre: 'https://cdn/pre.jpg' }), 'https://cdn/pre.jpg');
});

test('slimNoteDetail narrows the payload to the downloader fields only', () => {
  const slim = api.slimNoteDetail({
    title: 't', type: 'normal', imageList: [{ fileId: 'x', url: '', urlDefault: 'u', urlPre: 'p', traceId: 'SECRET', width: '800', height: '600', stream: {}, infoList: [{ imageScene: 'WB_DFT', url: 'd', extra: 'drop' }] }]
  });
  assert.deepEqual(Object.keys(slim).sort(), ['imageList', 'title', 'type']);
  assert.deepEqual(Object.keys(slim.imageList[0]).sort(), ['height', 'infoList', 'urlDefault', 'urlPre', 'width']);
  assert.deepEqual(Object.keys(slim.imageList[0].infoList[0]).sort(), ['imageScene', 'url']);
  assert.equal(slim.imageList[0].width, 800);
  assert.equal(api.slimNoteDetail(null), null);
  assert.equal(api.slimNoteDetail({ title: 'only', type: 'video' }).imageList.length, 0);
});

test('parseInitialStateFromScriptText keeps the strict path working and tolerates undefined literals', () => {
  const strict = api.parseInitialStateFromScriptText('window.__INITIAL_STATE__={"note":{"title":"ok"}}');
  assert.equal(strict.note.title, 'ok');
  const withUndefined = api.parseInitialStateFromScriptText('window.__INITIAL_STATE__={"note":{"title":undefined,"count":1}}');
  assert.equal(withUndefined.note.title, null);
  assert.equal(withUndefined.note.count, 1);
  const withNewMap = api.parseInitialStateFromScriptText('window.__INITIAL_STATE__={"note":{"title":"ok"},"draft":new Map([])}');
  assert.equal(withNewMap.note.title, 'ok');
  assert.equal(withNewMap.draft, null);
});
