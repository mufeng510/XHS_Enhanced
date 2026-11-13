'use strict';
// Unit tests for the background service worker message handler. The bundle is
// evaluated in a vm with a mocked chrome API and a stubbed global fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBackground({ permissions = {}, fetchImpl } = {}) {
  const listeners = [];
  const chrome = {
    runtime: {
      id: 'test-extension-id',
      onMessage: {
        addListener(listener) { listeners.push(listener); }
      }
    },
    permissions: {
      async contains(query) {
        const origins = (query && query.origins) || [];
        return origins.every(origin => permissions[origin] === true);
      }
    }
  };
  const context = {
    console,
    chrome,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Uint8Array,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    TextDecoder
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), context);
  assert.equal(listeners.length, 1, 'background registers exactly one onMessage listener');
  return listeners[0];
}

function sendFetch(listener, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no response')), 2000);
    const handled = listener(Object.assign({ type: 'xhs-enhanced:fetch' }, message), {}, response => {
      clearTimeout(timer);
      resolve(response);
    });
    assert.equal(handled, true, 'listener must signal async handling');
  });
}

const CDN = 'https://ci.xiaohongshu.com/notes_pre_post/abc!nd_dft_wlteh_webp_3';
const SERVER = 'http://192.168.1.10:8000';

test('rejects non-http(s) urls without fetching', async () => {
  let fetched = false;
  const listener = loadBackground({
    fetchImpl() { fetched = true; throw new Error('must not fetch'); }
  });
  const res = await sendFetch(listener, { url: 'chrome://extensions', method: 'GET' });
  assert.equal(res.error, 'network');
  assert.equal(fetched, false);
});

test('static CDN hosts bypass the optional-permission gate', async () => {
  const calls = [];
  const listener = loadBackground({
    permissions: {},
    fetchImpl(url) {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => 'OK',
        headers: { get: () => 'text/plain' }
      });
    }
  });
  const res = await sendFetch(listener, { url: CDN, method: 'GET', responseType: 'text' });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'OK');
  assert.deepEqual(calls, [CDN]);
});

test('static host pattern does not admit lookalike domains', async () => {
  const calls = [];
  const listener = loadBackground({
    permissions: {},
    fetchImpl(url) { calls.push(url); return Promise.resolve({ ok: true, status: 200, text: async () => 'OK', headers: { get: () => '' } }); }
  });
  for (const bad of ['https://xhscdn.com.evil.com/x', 'https://notxhscdn.com/x', 'http://ci.xiaohongshu.com/x', 'https://ci.xiaohongshu.com.evil.net/x']) {
    const res = await sendFetch(listener, { url: bad, method: 'GET', responseType: 'text' });
    assert.equal(res.error, 'permission', bad);
  }
  assert.equal(calls.length, 0);
});

test('non-static hosts require a granted optional permission', async () => {
  const listener = loadBackground({
    permissions: { 'http://192.168.1.10:8000/*': false },
    fetchImpl() { throw new Error('must not fetch without permission'); }
  });
  const res = await sendFetch(listener, { url: SERVER + '/api/health', method: 'GET', responseType: 'text' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'permission');
});

test('granted optional permission lets the library server through', async () => {
  const listener = loadBackground({
    permissions: { 'http://192.168.1.10:8000/*': true },
    fetchImpl(url, init) {
      assert.equal(url, SERVER + '/api/health');
      assert.equal(init.credentials, 'include');
      assert.equal(init.method, 'GET');
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '{"status":"ok"}',
        headers: { get: () => 'application/json' }
      });
    }
  });
  const res = await sendFetch(listener, { url: SERVER + '/api/health', method: 'GET', responseType: 'text' });
  assert.equal(res.ok, true);
  assert.equal(res.text, '{"status":"ok"}');
});

test('arraybuffer responses are base64 encoded with the mime attached', async () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const listener = loadBackground({
    permissions: {},
    fetchImpl() {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(0),
        headers: { get: name => (name === 'content-type' ? 'image/jpeg' : '') }
      });
    }
  });
  const res = await sendFetch(listener, { url: CDN, method: 'GET', responseType: 'arraybuffer' });
  assert.equal(res.ok, true);
  assert.equal(res.contentType, 'image/jpeg');
  assert.deepEqual([...Buffer.from(res.base64, 'base64')], [...bytes]);
});

test('http error status surfaces ok:false with status preserved', async () => {
  const listener = loadBackground({
    permissions: {},
    fetchImpl() {
      return Promise.resolve({
        ok: false,
        status: 403,
        text: async () => 'denied',
        headers: { get: () => 'text/plain' }
      });
    }
  });
  const res = await sendFetch(listener, { url: CDN, method: 'GET', responseType: 'text' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.error, 'http');
});

test('aborted requests surface as timeout, network failures as network', async () => {
  const timeoutError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const abortListener = loadBackground({
    permissions: {},
    fetchImpl() { return Promise.reject(timeoutError); }
  });
  const timeoutRes = await sendFetch(abortListener, { url: CDN, method: 'GET', responseType: 'text', timeout: 50 });
  assert.equal(timeoutRes.error, 'timeout');

  const networkListener = loadBackground({
    permissions: {},
    fetchImpl() { return Promise.reject(new TypeError('failed to fetch')); }
  });
  const networkRes = await sendFetch(networkListener, { url: CDN, method: 'GET', responseType: 'text' });
  assert.equal(networkRes.error, 'network');
});

test('posts carry a string body and credentials are always included', async () => {
  const listener = loadBackground({
    permissions: { 'http://192.168.1.10:8000/*': true },
    fetchImpl(_url, init) {
      assert.equal(init.method, 'POST');
      assert.equal(init.body, '{"username":"u","password":"p"}');
      assert.equal(init.credentials, 'include');
      return Promise.resolve({ ok: true, status: 200, text: async () => '{"access_token":"t"}', headers: { get: () => 'application/json' } });
    }
  });
  const res = await sendFetch(listener, {
    url: SERVER + '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: '{"username":"u","password":"p"}',
    responseType: 'text'
  });
  assert.equal(res.ok, true);
});

test('static CDN hosts only pass GET/HEAD; POST is gated by permissions', async () => {
  const listener = loadBackground({
    permissions: {},
    fetchImpl() { return Promise.resolve({ ok: true, status: 200, text: async () => 'OK', headers: { get: () => '' } }); }
  });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await sendFetch(listener, { url: CDN, method, responseType: 'text' });
    assert.equal(res.error, 'permission', method);
  }
  const head = await sendFetch(listener, { url: CDN, method: 'HEAD', responseType: 'text' });
  assert.equal(head.ok, true);
});

test('a ci.xiaohongshu.com lookalike does not slip past the static gate', async () => {
  const listener = loadBackground({
    permissions: {},
    fetchImpl() { return Promise.resolve({ ok: true, status: 200, text: async () => 'OK', headers: { get: () => '' } }); }
  });
  for (const bad of ['https://ci.xiaohongshu.com.evil.net/x', 'https://ci-xiaohongshu.com/x', 'https://xci.xiaohongshu.com/x']) {
    const res = await sendFetch(listener, { url: bad, method: 'GET', responseType: 'text' });
    assert.equal(res.error, 'permission', bad);
  }
});

test('a response declaring a huge content-length is rejected before reading the body', async () => {
  const listener = loadBackground({
    permissions: {},
    fetchImpl() {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: name => (name === 'content-length' ? String(64 * 1024 * 1024) : 'image/jpeg') },
        text: async () => { throw new Error('body must not be read'); },
        arrayBuffer: async () => { throw new Error('buffer must not be read'); }
      });
    }
  });
  const res = await sendFetch(listener, { url: CDN, method: 'GET', responseType: 'arraybuffer' });
  assert.equal(res.error, 'too-large');
});

test('messages from another extension are refused when the sender id differs', async () => {
  const listener = loadBackground({
    permissions: {},
    fetchImpl() { throw new Error('must not fetch'); }
  });
  const res = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no response')), 2000);
    listener({ type: 'xhs-enhanced:fetch', url: CDN, method: 'GET' }, { id: 'some-other-extension' }, response => {
      clearTimeout(timer);
      resolve(response);
    });
  });
  assert.equal(res.error, 'forbidden');
});
