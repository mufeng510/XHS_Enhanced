'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(pathname = '/real/path', testMode = true) {
  const context = { console, location: { pathname }, __XHS_ENHANCED_TEST_MODE__: testMode };
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

test('signature is deterministic and changes with each material input', () => {
  const s = load().__XHS_ENHANCED_TEST_API__.signatureFor;
  const base = s('/search_result', '101');
  assert.equal(s('/search_result', '101'), base);
  assert.notEqual(s('/user/profile/a', '101'), base);
  assert.notEqual(s('/search_result', '102'), base);
});
