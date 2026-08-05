'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ADDITIONAL_INFO_MAX_CHARACTERS = 50000;

function characterCount(content) {
  return Array.from(content).length;
}

function load(pathname = '/real/path', testMode = true, localStorage) {
  const context = { console, location: { pathname }, __XHS_ENHANCED_TEST_MODE__: testMode };
  if (localStorage !== undefined) context.localStorage = localStorage;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('xhs-enhanced.user.js', 'utf8'), context);
  return context;
}

test('route predicate is strict and test seam uses the same gate', () => {
  const c = load('/search_result');
  const api = c.__XHS_ENHANCED_TEST_API__;
  for (const path of ['/search_result', '/search_result?keyword=test', '/user/profile/abc']) assert.equal(api.isTargetRoute(path), true);
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
