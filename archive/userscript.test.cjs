'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ADDITIONAL_INFO_MAX_CHARACTERS = 50000;

function characterCount(content) {
  return Array.from(content).length;
}

function load(pathname = '/real/path', testMode = true, localStorage, extras) {
  class TestBlob {
    constructor(parts = [], opts = {}) {
      const chunks = [];
      for (const part of parts) {
        if (part == null) continue;
        if (part instanceof Uint8Array) chunks.push(Buffer.from(part));
        else if (Buffer.isBuffer(part)) chunks.push(part);
        else if (ArrayBuffer.isView(part)) chunks.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
        else if (part instanceof ArrayBuffer) chunks.push(Buffer.from(part));
        else chunks.push(Buffer.from(String(part)));
      }
      this._buf = Buffer.concat(chunks);
      this.size = this._buf.length;
      this.type = (opts && opts.type) || '';
    }
    slice(start = 0, end = this.size, type = this.type) {
      return new TestBlob([this._buf.subarray(start, end)], { type });
    }
  }
  const context = {
    console,
    location: { pathname, href: 'https://www.xiaohongshu.com' + pathname },
    __XHS_ENHANCED_TEST_MODE__: testMode,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Uint8Array,
    ArrayBuffer,
    Blob: TestBlob,
    URL,
    URLSearchParams
  };
  if (localStorage !== undefined) context.localStorage = localStorage;
  if (extras) Object.assign(context, extras);
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('xhs-enhanced.user.js', 'utf8'), context);
  return context;
}

test('route predicate is strict and test seam uses the same gate', () => {
  const c = load('/search_result');
  const api = c.__XHS_ENHANCED_TEST_API__;
  for (const path of ['/search_result', '/search_result?keyword=test', '/user/profile/abc', '/explore', '/explore/']) assert.equal(api.isTargetRoute(path), true);
  for (const path of ['/explore/abc', '/', '/user/profiles/abc']) assert.equal(api.isTargetRoute(path), false);
  assert.equal(api.getCurrentRoute(), '/search_result');
  api.setTestRoute('/user/profile/test');
  assert.equal(api.getCurrentRoute(), '/user/profile/test');
  assert.equal(api.isTargetRoute(api.getCurrentRoute()), true);
  api.clearTestRoute();
  assert.equal(api.getCurrentRoute(), '/search_result');
  assert.equal(load('/search_result', false).__XHS_ENHANCED_TEST_API__, undefined);
});

test('like parser accepts only explicit supported formats', () => {
  const p = load().__XHS_ENHANCED_TEST_API__.parseLikeCount;
  const good = new Map([['0',0],['100',100],['101',101],['1,234',1234],['1 234',1234],['1.2万',12000],['1万',10000],['1.2w',12000],['1.2W',12000],['1.2k',1200],['1.2K',1200]]);
  for (const [input, expected] of good) {
    const result = p(input);
    assert.equal(result.ok, true, input);
    assert.equal(result.value, expected, input);
    assert(Number.isFinite(result.value) && result.value >= 0);
  }
  for (const input of ['', '赞', '--', '-1', '1万+', '1.2.3k', '100+']) assert.equal(p(input).ok, false, input);
});

test('Greasy Fork additional-info HTML stays within the character limit', () => {
  const html = fs.readFileSync('greasyfork-additional-info.html', 'utf8');
  assert(characterCount(html) <= ADDITIONAL_INFO_MAX_CHARACTERS);
  assert.equal(characterCount('a'.repeat(ADDITIONAL_INFO_MAX_CHARACTERS)), ADDITIONAL_INFO_MAX_CHARACTERS);
  assert(characterCount('a'.repeat(ADDITIONAL_INFO_MAX_CHARACTERS + 1)) > ADDITIONAL_INFO_MAX_CHARACTERS);
});

test('popular threshold accepts canonical non-negative safe integers and safely reads storage', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  for (const value of ['0', '100', '9007199254740991']) {
    const parsed = api.parseThreshold(value);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, Number(value));
  }
  for (const value of ['', '01', '-1', '1.5', '1e3', '9007199254740992', null]) assert.equal(api.parseThreshold(value).ok, false, String(value));

  const stored = { getItem: key => key === 'xhs-enhanced:popular-threshold' ? '321' : null };
  assert.equal(api.readStoredThreshold(stored), 321);
  for (const value of [null, 'bad', '-1', '1.5', '9007199254740992']) assert.equal(api.readStoredThreshold({ getItem: () => value }), 100, String(value));
  assert.equal(api.readStoredThreshold({ getItem() { throw new Error('blocked'); } }), 100);
});

test('valid threshold updates runtime state even when persistence fails', () => {
  const saved = [];
  const api = load('/search_result', true, { getItem: () => '250', setItem: (key, value) => saved.push([key, value]) }).__XHS_ENHANCED_TEST_API__;
  let result = api.setThreshold('300');
  assert.equal(result.ok, true); assert.equal(result.value, 300); assert.equal(result.persisted, true);
  assert.deepEqual(saved, [['xhs-enhanced:popular-threshold', '300']]);
  result = api.setThreshold('3.5');
  assert.equal(result.ok, false); assert.equal(result.value, 300); assert.equal(result.persisted, false);
  const failing = load('/search_result', true, { getItem: () => '100', setItem() { throw new Error('blocked'); } }).__XHS_ENHANCED_TEST_API__;
  result = failing.setThreshold('301');
  assert.equal(result.ok, true); assert.equal(result.value, 301); assert.equal(result.persisted, false);
  assert.equal(failing.getThreshold(), 301);
});

test('signature is deterministic and changes with each material input', () => {
  const s = load().__XHS_ENHANCED_TEST_API__.signatureFor;
  const base = s('/search_result', '101');
  assert.equal(s('/search_result', '101'), base);
  assert.notEqual(s('/user/profile/a', '101'), base);
  assert.notEqual(s('/search_result', '102'), base);
});

test('profile route predicate and note id extraction for copy features', () => {
  const api = load('/user/profile/abc').__XHS_ENHANCED_TEST_API__;
  assert.equal(api.isProfileRoute('/user/profile/abc'), true);
  assert.equal(api.isProfileRoute('/user/profile/abc?tab=notes'), true);
  assert.equal(api.isProfileRoute('/search_result'), false);
  assert.equal(api.isProfileRoute('/explore/abc'), false);
  const get = api.getNoteIdFromHref;
  assert.equal(get('/explore/abc123'), 'abc123');
  assert.equal(get('/discovery/item/abc123'), 'abc123');
  assert.equal(get('/search_result/abc123'), 'abc123');
  assert.equal(get('https://www.xiaohongshu.com/explore/abc123?xsec_token=t'), 'abc123');
  assert.equal(get('/not_a_note'), '');
  assert.equal(get(''), '');
  assert.equal(get(null), '');
});

test('share link uses explore format with xsec_token and xsec_source=pc_feed', () => {
  const api = load('/user/profile/abc').__XHS_ENHANCED_TEST_API__;
  assert.equal(api.buildShareLink('abc123', 'tok'), 'https://www.xiaohongshu.com/explore/abc123?xsec_token=tok&xsec_source=pc_feed');
  assert.equal(api.buildShareLink('abc123', ''), 'https://www.xiaohongshu.com/explore/abc123');
  assert.equal(api.buildShareLink('', 'tok'), '');
  assert.equal(api.getXsecTokenFromHref('/explore/abc?xsec_token=abcDef123&xsec_source=pc_feed'), 'abcDef123');
  assert.equal(api.getXsecTokenFromHref('https://www.xiaohongshu.com/explore/abc?xsec_token=abc%20Def'), 'abc Def');
  assert.equal(api.getXsecTokenFromHref('/discovery/item/abc'), '');
  assert.equal(api.parseQueryValue('?xsec_token=tok&xsec_source=pc_feed', 'xsec_token'), 'tok');
  assert.equal(api.parseQueryValue('', 'xsec_token'), '');
});

test('extractTokensFromState reads camelCase xsecToken from real profile note shape', () => {
  const api = load('/user/profile/abc').__XHS_ENHANCED_TEST_API__;
  // Mirrors real window.__INITIAL_STATE__ user.notes entries: noteCard.noteId + noteCard.xsecToken,
  // plus outer entry id + outer xsecToken. Snake_case xsec_token must NOT be required.
  const snippet = JSON.stringify({
    user: {
      notes: [[
        {
          id: '69952afa000000001b01e949',
          noteCard: {
            noteId: '69952afa000000001b01e949',
            xsecToken: 'ABD5crNnmvUBtW_SH9ZlB2G3TWHxQqPEKH4irmuIN4ZZs=',
            type: 'video'
          },
          index: 0,
          exposed: false,
          ssrRendered: true,
          xsecToken: 'ABD5crNnmvUBtW_SH9ZlB2G3TWHxQqPEKH4irmuIN4ZZs='
        },
        {
          id: '69971b1c000000001b01d76e',
          noteCard: {
            displayTitle: 'title',
            noteId: '69971b1c000000001b01d76e',
            xsecToken: 'ABbY2uTCgLbdfHqUw5lq-9g_N4jOS-9ZFuvTexDwEkBvI=',
            type: 'video'
          },
          index: 1,
          exposed: false,
          ssrRendered: true,
          xsecToken: 'ABbY2uTCgLbdfHqUw5lq-9g_N4jOS-9ZFuvTexDwEkBvI='
        }
      ]]
    }
  });
  const map = api.extractTokensFromState(snippet);
  assert.equal(map['69952afa000000001b01e949'], 'ABD5crNnmvUBtW_SH9ZlB2G3TWHxQqPEKH4irmuIN4ZZs=');
  assert.equal(map['69971b1c000000001b01d76e'], 'ABbY2uTCgLbdfHqUw5lq-9g_N4jOS-9ZFuvTexDwEkBvI=');
  assert.equal(Object.keys(api.extractTokensFromState('{"xsec_token":"snake"}')).length, 0);
  assert.equal(
    api.buildShareLink('69952afa000000001b01e949', map['69952afa000000001b01e949']),
    'https://www.xiaohongshu.com/explore/69952afa000000001b01e949?xsec_token=ABD5crNnmvUBtW_SH9ZlB2G3TWHxQqPEKH4irmuIN4ZZs%3D&xsec_source=pc_feed'
  );
});

test('next popular card selection skips viewport and chooses nearest without mutation', () => {
  const select = load().__XHS_ENHANCED_TEST_API__.selectNextPopularCard;
  function candidate(top, { connected = true, popular = true } = {}) {
    return {
      isConnected: connected,
      classList: { contains: name => popular && name === 'xhs-enhanced-card--popular' },
      getBoundingClientRect: () => ({ top, bottom: top + 200 })
    };
  }
  const boundary = candidate(800);
  assert.equal(select([candidate(100), candidate(750), boundary], 800), boundary);
  const far = candidate(1200), nearest = candidate(810), middle = candidate(900);
  const input = Object.freeze([far, nearest, middle]);
  assert.equal(select(input, 800), nearest);
  assert.deepEqual(input, [far, nearest, middle]);
  const tiedFirst = candidate(810), tiedSecond = candidate(810);
  assert.equal(select([tiedFirst, tiedSecond], 800), tiedFirst);
  assert.equal(select([candidate(-10), candidate(900, { connected: false }), candidate(900, { popular: false })], 800), null);
  assert.equal(select([], 800), null);
});

test('previous popular card selection mirrors next selection without mutation', () => {
  const select = load().__XHS_ENHANCED_TEST_API__.selectPreviousPopularCard;
  function candidate(bottom, { connected = true, popular = true } = {}) {
    return {
      isConnected: connected,
      classList: { contains: name => popular && name === 'xhs-enhanced-card--popular' },
      getBoundingClientRect: () => ({ top: bottom - 200, bottom })
    };
  }
  const boundary = candidate(0);
  assert.equal(select([candidate(-600), candidate(-40), boundary]), boundary);
  const far = candidate(-1200), nearest = candidate(-10), middle = candidate(-90);
  const input = Object.freeze([far, nearest, middle]);
  assert.equal(select(input), nearest);
  assert.deepEqual(input, [far, nearest, middle]);
  const tiedFirst = candidate(-10), tiedSecond = candidate(-10);
  assert.equal(select([tiedFirst, tiedSecond]), tiedFirst);
  assert.equal(select([candidate(50), candidate(-40, { connected: false }), candidate(-40, { popular: false })]), null);
  assert.equal(select([]), null);
  assert.equal(select(null), null);
});

test('focus-popular storage read is conservative', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  assert.equal(api.readStoredFocusPopular(null), false);
  assert.equal(api.readStoredFocusPopular({ getItem: () => '1' }), true);
  assert.equal(api.readStoredFocusPopular({ getItem: () => '0' }), false);
  assert.equal(api.readStoredFocusPopular({ getItem: () => 'yes' }), false);
  assert.equal(api.readStoredFocusPopular({ getItem: () => null }), false);
  assert.equal(api.readStoredFocusPopular({ getItem() { throw new Error('blocked'); } }), false);
});

test('no-watermark cover URL strips XHS processing suffixes and process queries', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const raw = 'https://sns-webpic-qc.xhscdn.com/20240101/demo/foo.webp!nd_dft_wlteh_webp_3';
  assert.equal(api.toNoWatermarkCoverUrl(raw), 'https://sns-webpic-qc.xhscdn.com/20240101/demo/foo.webp');
  assert.equal(
    api.toNoWatermarkCoverUrl('https://sns-img-qc.xhscdn.com/a.jpg!nd_prv_wlteh_webp_3?imageView2/2/w/1080/format/jpg'),
    'https://sns-img-qc.xhscdn.com/a.jpg'
  );
  assert.equal(api.toNoWatermarkCoverUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  const candidates = api.coverUrlCandidates(raw);
  assert.equal(candidates[0], 'https://sns-webpic-qc.xhscdn.com/20240101/demo/foo.webp');
  assert.equal(candidates[1], raw);
  assert.ok(candidates.length >= 2 && candidates.length <= 3);
  assert.equal(api.pickLargestFromSrcset('a.jpg 100w, b.jpg 800w, c.jpg 400w'), 'b.jpg');
});

test('dataUrlToBlob encodes binary PNG bytes instead of digit text', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blob = api.dataUrlToBlob(dataUrl, 'image/png');
  assert.ok(blob);
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size >= 68 && blob.size <= 72, 'png byte length should stay near decoded size, got ' + blob.size);
});

test('extractCoverUrl reads first real cover candidate from card images', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const cover = {
    currentSrc: '',
    getAttribute(name) {
      if (name === 'src') return 'https://sns-webpic-qc.xhscdn.com/note/cover.webp!nd_dft_wlteh_webp_3';
      return null;
    }
  };
  const icon = {
    currentSrc: '',
    getAttribute(name) {
      if (name === 'src') return 'https://sns-avatar-qc.xhscdn.com/avatar/icon.png';
      return null;
    }
  };
  const card = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (String(selector).indexOf('img') >= 0) return [icon, cover];
      return [];
    }
  };
  assert.equal(api.extractCoverUrl(card), 'https://sns-webpic-qc.xhscdn.com/note/cover.webp!nd_dft_wlteh_webp_3');
  assert.equal(api.extractCoverUrl({ querySelectorAll: () => [] }), '');
});

test('coverRequestHeaders returns xiaohongshu referer', () => {
  const api = load('/user/profile/abc').__XHS_ENHANCED_TEST_API__;
  const headers = api.coverRequestHeaders();
  assert.equal(headers.Referer, 'https://www.xiaohongshu.com/user/profile/abc');
  assert.ok(headers.Accept && headers.Accept.indexOf('image/') >= 0);
});

// Object paths below were verified against ci.xiaohongshu.com; the expected format is
// recorded in each test because the master is whatever the uploader uploaded.
test('toCdnObjectPath keeps the scene segment of every signed cover url shape', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  // -> 200 image/jpeg 641 KB
  assert.equal(
    api.toCdnObjectPath('https://sns-webpic-qc.xhscdn.com/202601131644/e30d294b3ad5957a22d12421fac6da64/notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0!nd_dft_wlteh_webp_3'),
    'notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0'
  );
  // Older posts carry no scene segment -> 200 image/webp 177 KB
  assert.equal(
    api.toCdnObjectPath('https://sns-webpic-qc.xhscdn.com/202403262133/dc00a48e53c948cab26b392ecd22bf60/1000g0082ek68fgsh80005nngdu5g83b7bua2kb8!nc_n_webp_mw_1'),
    '1000g0082ek68fgsh80005nngdu5g83b7bua2kb8'
  );
  // HDR masters live under their own scene -> 200 image/heic 2867 KB
  assert.equal(
    api.toCdnObjectPath('https://sns-webpic-qc.xhscdn.com/202608071123/a9c1e390ff7f07b61ce850daf65b7a40/note_pre_post_uhdr/1040g3r03220lne1mmu1049s0ismhjq9d8um703o'),
    'note_pre_post_uhdr/1040g3r03220lne1mmu1049s0ismhjq9d8um703o'
  );
  // A process query must not leak into the object key.
  assert.equal(
    api.toCdnObjectPath('https://sns-webpic-qc.xhscdn.com/202601131644/e30d294b3ad5957a22d12421fac6da64/notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0?imageView2/2/w/format/png'),
    'notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0'
  );
  // Non-object urls must not produce a probe url.
  assert.equal(api.toCdnObjectPath('data:image/png;base64,abc'), '');
  assert.equal(api.toCdnObjectPath(''), '');
  assert.equal(api.toCdnObjectPath('https://cdn.example.com/'), '');
});

test('coverUrlCandidates probes the ci master before any webpic derivative', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const rendered = 'https://sns-webpic-qc.xhscdn.com/202601131644/e30d294b3ad5957a22d12421fac6da64/notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0!nd_dft_wlteh_webp_3';
  const list = api.coverUrlCandidates(rendered);
  const key = 'notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0';
  // Master first, free of the '!suffix' that would force a webp transcode.
  assert.equal(list[0], 'https://ci.xiaohongshu.com/' + key);
  assert.equal(list[0].indexOf('!'), -1, 'master url must stay free of processing suffixes');
  // Server-side jpeg transcode, then the xhscdn mirror of the same object.
  assert.equal(list[1], 'https://ci.xiaohongshu.com/' + key + '?imageView2/format/jpeg');
  assert.equal(api.isForcedJpegCandidate(list[1]), true);
  assert.equal(list[2], 'https://sns-img-hw.xhscdn.com/' + key);
  // The webpic chain survives as the tail so a ci outage degrades instead of failing.
  assert.ok(list.indexOf(rendered) >= 3);
  assert.ok(list.some(u => u.indexOf('!nd_dft_wlteh_webp_3') >= 0));
  assert.equal(list.some(u => u.indexOf('!nd_prv_wlteh_webp_3') >= 0), false);
  assert.ok(list.length <= 6);
});

test('coverUrlCandidates falls back to the webpic chain for non-CDN urls', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  // Not a signed /{ts}/{token}/ cover url, so there is no ci object to probe.
  const rendered = 'https://sns-webpic-qc.xhscdn.com/20240101/demo/note.jpg!nd_dft_wlteh_webp_3';
  const list = api.coverUrlCandidates(rendered);
  assert.equal(api.toCdnObjectPath(rendered), '');
  assert.equal(list.some(u => u.indexOf('ci.xiaohongshu.com') >= 0), false);
  assert.equal(list[0], 'https://sns-webpic-qc.xhscdn.com/20240101/demo/note.jpg');
  assert.equal(list.indexOf(rendered) >= 1, true);
  assert.ok(list.slice(1).some(u => u.indexOf('!nd_dft_wlteh_webp_3') >= 0));
});

test('isForcedJpegCandidate only matches the server-side jpeg transcode', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  assert.equal(api.isForcedJpegCandidate('https://ci.xiaohongshu.com/notes_pre_post/abc?imageView2/format/jpeg'), true);
  assert.equal(api.isForcedJpegCandidate('https://ci.xiaohongshu.com/notes_pre_post/abc?imageView2/format/jpg'), true);
  assert.equal(api.isForcedJpegCandidate('https://ci.xiaohongshu.com/notes_pre_post/abc'), false);
  assert.equal(api.isForcedJpegCandidate('https://ci.xiaohongshu.com/notes_pre_post/abc!nd_dft_wlteh_webp_3'), false);
  assert.equal(api.isForcedJpegCandidate(''), false);
  assert.equal(api.isForcedJpegCandidate(null), false);
});

test('sniffImageMimeFromBytes identifies masters that carry no file extension', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const bytes = arr => api.sniffImageMimeFromBytes(new Uint8Array(arr));
  assert.equal(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'image/jpeg');
  assert.equal(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
  assert.equal(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif');
  assert.equal(
    bytes([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    'image/webp'
  );
  assert.equal(
    bytes([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    'image/heic'
  );
  assert.equal(bytes([0, 0, 0, 0]), '');
  assert.equal(api.sniffImageMimeFromBytes(new Uint8Array([])), '');
  // A bare RIFF prefix is not enough to claim webp; the payload tag is at offset 8.
  assert.equal(bytes([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00]), '');
  assert.equal(api.looksLikeImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(api.looksLikeImageBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03])), false);
});

test('resolveCoverBlobFromCandidates stops at the first jpeg instead of draining the chain', async () => {
  // url suffix -> mime the CDN answers with, so a master can be made webp/heic/png.
  const MIME_BY_MARK = { plain: 'image/jpeg', webpmaster: 'image/webp', heicmaster: 'image/heic' };
  function harness() {
    const calls = [];
    const BlobCtorRef = {};
    const extras = {
      GM_xmlhttpRequest(opts) {
        calls.push(opts.url);
        // Model the real host: '?imageView2/format/jpeg' always answers jpeg, whatever
        // the master is stored as.
        const forcedJpeg = /[?&]imageView2\/format\/jpe?g(?:$|[/?&])/i.test(opts.url);
        const mark = (opts.url.match(/mark-([a-z]+)/) || [])[1] || 'plain';
        const mime = forcedJpeg ? 'image/jpeg' : (MIME_BY_MARK[mark] || 'image/jpeg');
        const body = new Uint8Array(64).fill(mark.charCodeAt(0));
        opts.onload({ status: 200, response: new BlobCtorRef.ctor([body], { type: mime }) });
      }
    };
    const ctx = load('/search_result', true, undefined, extras);
    BlobCtorRef.ctor = ctx.Blob;
    return { api: ctx.__XHS_ENHANCED_TEST_API__, calls };
  }

  const KEY = 'notes_pre_post/1040g3k031qtmfr5pno004a62p2ihj0itmhtlqk0';
  const CI = 'https://ci.xiaohongshu.com/';
  // Shaped like coverUrlCandidates() output: master, then the forced-jpeg re-encode.
  const chainFor = masterMark => [
    CI + 'mark-' + masterMark + '/' + KEY,
    CI + 'mark-' + masterMark + '/' + KEY + '?imageView2/format/jpeg'
  ];

  // 1. Master is already jpeg: exactly one request, no re-encode, no mirror probe.
  let h = harness();
  let chain = chainFor('plain');
  let hit = await h.api.resolveCoverBlobFromCandidates(chain);
  assert.equal(hit.blob.type, 'image/jpeg');
  assert.equal(h.calls.length, 1, 'jpeg master must short-circuit, got: ' + JSON.stringify(h.calls));
  assert.equal(h.calls[0], chain[0]);

  // 2. Master is webp: must fall through to the forced-jpeg candidate and take it.
  h = harness();
  chain = chainFor('webpmaster');
  hit = await h.api.resolveCoverBlobFromCandidates(chain);
  assert.equal(h.calls.length, 2, 'webp master must be retried as jpeg, got: ' + JSON.stringify(h.calls));
  assert.ok(h.calls[1].indexOf('?imageView2/format/jpeg') >= 0);
  assert.equal(hit.blob.type, 'image/jpeg');

  // 3. Every candidate is a non-jpeg master: keep the first success as the best-so-far
  //    rather than losing it, and never exceed the candidate count.
  h = harness();
  const allWebp = [CI + 'mark-webpmaster/a', CI + 'mark-heicmaster/b', CI + 'mark-webpmaster/c'];
  hit = await h.api.resolveCoverBlobFromCandidates(allWebp);
  assert.equal(h.calls.length, 3);
  assert.equal(hit.url, allWebp[0], 'first non-jpeg success must be preserved');
  assert.equal(hit.blob.type, 'image/webp');
});

test('isJpegBlob and buildCoverFileName never mislabel a heic master as jpg', () => {
  const api = load('/search_result').__XHS_ENHANCED_TEST_API__;
  assert.equal(api.isJpegBlob({ type: 'image/jpeg' }), true);
  assert.equal(api.isJpegBlob({ type: 'image/jpg' }), true);
  assert.equal(api.isJpegBlob({ type: 'image/webp' }), false);
  assert.equal(api.isJpegBlob({ type: 'image/heic' }), false);
  assert.equal(api.isJpegBlob(null), false);
  assert.equal(api.buildCoverFileName('n1', 'https://ci.xiaohongshu.com/note_pre_post_uhdr/abc', 'image/heic'), 'xhs-note-n1.heic');
  assert.equal(api.buildCoverFileName('n1', 'https://ci.xiaohongshu.com/notes_pre_post/abc', 'image/jpeg'), 'xhs-note-n1.jpg');
});


test('buildCoverFileName prefers the mime type, strips CDN suffixes and sanitizes the note id', () => {
  const api = load('/search_result').__XHS_ENHANCED_TEST_API__;
  assert.equal(api.buildCoverFileName('abc123', 'https://sns-webpic-qc.xhscdn.com/a.webp', 'image/webp'), 'xhs-note-abc123.webp');
  assert.equal(api.buildCoverFileName('', 'https://x.com/a.png', 'image/jpeg'), 'xhs-cover.jpg');
  assert.equal(api.buildCoverFileName('a/b', 'https://x.com/a.png!nd_dft', ''), 'xhs-note-ab.png');
  assert.equal(api.buildCoverFileName('n1', 'https://x.com/a.png!nd_dft_wlteh_webp_3?imageView2/2', ''), 'xhs-note-n1.png');
  assert.equal(api.buildCoverFileName('n1', '', ''), 'xhs-note-n1.jpg');
  assert.equal(api.buildCoverFileName('n1', 'https://x.com/a.jpeg', ''), 'xhs-note-n1.jpg');
  assert.equal(api.buildCoverFileName(null, null, null), 'xhs-cover.jpg');
});

test('cardNoteTargetId groups anchors by note id so real search cards stay reliable', () => {
  const api = load('/search_result').__XHS_ENHANCED_TEST_API__;
  function mockCard(hrefs) {
    return {
      querySelectorAll() { return hrefs.map(href => ({ getAttribute: name => (name === 'href' ? href : null) })); }
    };
  }
  assert.equal(api.cardNoteTargetId(mockCard(['/search_result/s1?xsec_token=t'])), 's1');
  // Real Xiaohongshu search cards carry a .cover and a .title anchor to the SAME note.
  assert.equal(api.cardNoteTargetId(mockCard(['/search_result/s1?xsec_token=tA', '/search_result/s1?xsec_token=tB'])), 's1');
  assert.equal(api.cardNoteTargetId(mockCard(['/explore/x1', '/discovery/item/x2'])), '');
  assert.equal(api.cardNoteTargetId(mockCard([])), '');
  assert.equal(api.cardNoteTargetId(null), '');
  assert.equal(api.cardNoteTargetId(mockCard(['/not_a_note', '/search_result?keyword=test'])), '');
});

test('resolveCardNoteLink prefers the anchor carrying xsec_token', () => {
  const api = load('/search_result').__XHS_ENHANCED_TEST_API__;
  function mockCard(hrefs) {
    return {
      querySelectorAll() { return hrefs.map(href => ({ getAttribute: name => (name === 'href' ? href : null) })); }
    };
  }
  assert.equal(
    api.resolveCardNoteLink(mockCard(['/search_result/s9', '/search_result/s9?xsec_token=tok9'])),
    'https://www.xiaohongshu.com/explore/s9?xsec_token=tok9&xsec_source=pc_feed'
  );
  assert.equal(
    api.resolveCardNoteLink(mockCard(['/search_result/s10', '/search_result/s10'])),
    'https://www.xiaohongshu.com/explore/s10'
  );
  assert.equal(api.resolveCardNoteLink(mockCard([])), '');
  assert.equal(api.resolveCardNoteLink(null), '');
});

test('findTokenForNoteIdInState early-exits for one note without full walk side effects', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const state = {
    user: {
      notes: [[{
        id: 'noteA',
        noteCard: { noteId: 'noteA', xsecToken: 'tokA' },
        xsecToken: 'tokA'
      }, {
        id: 'noteB',
        noteCard: { noteId: 'noteB', xsecToken: 'tokB' },
        xsecToken: 'tokB'
      }]]
    },
    huge: new Array(200).fill(0).map((_, i) => ({ id: 'x' + i, nest: { n: i } }))
  };
  assert.equal(api.findTokenForNoteIdInState(state, 'noteB', 0, null), 'tokB');
  assert.equal(api.findTokenForNoteIdInState(state, 'missing', 0, null), '');
});

test('getFallbackTokenForNoteId caches negative results and stays stable', () => {
  const ctx = load('/user/profile/abc');
  const api = ctx.__XHS_ENHANCED_TEST_API__;
  ctx.__INITIAL_STATE__ = {
    user: { notes: [[{ id: 'n1', noteCard: { noteId: 'n1', xsecToken: 'T1' }, xsecToken: 'T1' }]] }
  };
  assert.equal(api.getFallbackTokenForNoteId('n1'), 'T1');
  assert.equal(api.getFallbackTokenForNoteId('n1'), 'T1');
  assert.equal(api.getFallbackTokenForNoteId('nope'), '');
  assert.equal(api.getFallbackTokenForNoteId('nope'), '');
  api.clearFallbackTokenCache();
  assert.equal(api.getFallbackTokenForNoteId('n1'), 'T1');
});

test('parseBaseUrl normalizes trailing slashes and rejects non-http schemes', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const good = api.parseBaseUrl(' http://127.0.0.1:8000/ ');
  assert.equal(good.ok, true);
  assert.equal(good.value, 'http://127.0.0.1:8000');
  const good2 = api.parseBaseUrl('https://xhs.example.com/api//');
  assert.equal(good2.ok, true);
  assert.equal(good2.value, 'https://xhs.example.com/api');
  for (const value of ['', '   ', 'ftp://x', '127.0.0.1:8000', 'http://', 'javascript:x']) {
    assert.equal(api.parseBaseUrl(value).ok, false, String(value));
  }
});

test('detail route predicate accepts note detail paths only', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  for (const path of ['/explore/abc123', '/discovery/item/abc123', '/explore/69952afa000000001b01e949', '/search_result/abc123', '/user/profile/u1/69952afa000000001b01e949']) {
    assert.equal(api.isDetailRoute(path), true, path);
  }
  for (const path of ['/explore', '/explore/', '/search_result', '/user/profile/abc', '/explore/abc/extra', '/', '/user/profile/u1/abc/extra']) {
    assert.equal(api.isDetailRoute(path), false, path);
  }
  assert.equal(api.isTargetRoute('/explore/abc'), false, 'detail routes stay outside scan/target routes');
});

test('crawl payload matches the content-library batch API contract', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const payload = api.buildCrawlPayload(7, ['u1', 'u2']);
  assert.equal(payload.account_id, 7);
  assert.equal(payload.urls.join('|'), 'u1|u2');
  assert.equal(payload.save_to_library, true);
  assert.equal(payload.fetch_comments, false);
  const coerced = api.buildCrawlPayload('9', ['u1']);
  assert.equal(coerced.account_id, 9);
  assert.equal(coerced.urls.join('|'), 'u1');
  const filtered = api.buildCrawlPayload(1, ['u1', 2, null, '']);
  assert.equal(filtered.urls.join('|'), 'u1');
  const nonArray = api.buildCrawlPayload(1, 'u1');
  assert.equal(nonArray.urls.length, 0);
});

test('parseTokenExp decodes the unverified JWT payload exp', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const exp = 1900000000;
  const header = Buffer.from('{"alg":"HS256"}').toString('base64');
  const payload = Buffer.from(JSON.stringify({ user_id: 1, token_type: 'access', exp })).toString('base64');
  assert.equal(api.parseTokenExp(`${header}.${payload}.sig`), exp);
  const urlSafe = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  assert.equal(api.parseTokenExp(`h.${urlSafe}.sig`), exp);
  for (const token of ['', 'garbage', 'a.b.c', `${header}.${Buffer.from('not json').toString('base64')}.sig`]) {
    assert.equal(api.parseTokenExp(token), 0, token);
  }
});

test('readLibraryConfig reads keys safely and normalizes base url', () => {
  const api = load().__XHS_ENHANCED_TEST_API__;
  const stored = {
    getItem(key) {
      if (key === 'xhs-enhanced:library-base-url') return ' http://127.0.0.1:8000/// ';
      if (key === 'xhs-enhanced:library-username') return ' tester ';
      if (key === 'xhs-enhanced:library-account-id') return '7';
      return null;
    }
  };
  const cfg = api.readLibraryConfig(stored);
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:8000');
  assert.equal(cfg.username, 'tester');
  assert.equal(cfg.accountId, 7);
  assert.equal(cfg.password, '');
  for (const storage of [null, { getItem() { throw new Error('blocked'); } }, { getItem: () => 'junk' }]) {
    const fallback = api.readLibraryConfig(storage);
    assert.equal(fallback.baseUrl, '');
    assert.equal(fallback.accountId, 0);
  }
  assert.equal(api.readLibraryConfig({ getItem: key => key === 'xhs-enhanced:library-base-url' ? 'ftp://bad' : null }).baseUrl, '');
  assert.equal(api.readLibraryConfig({ getItem: key => key === 'xhs-enhanced:library-account-id' ? '-3' : null }).accountId, 0);
});
