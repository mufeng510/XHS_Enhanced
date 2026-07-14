'use strict';
(function () {
  const root = document.documentElement;
  const results = document.getElementById('results');
  const sandboxHost = document.getElementById('sandbox-host');
  let sandbox = document.getElementById('sandbox');
  const api = globalThis.__XHS_ENHANCED_TEST_API__;
  const failures = [];
  let assertions = 0;
  let terminalWrites = 0;

  function record(name, ok, detail) {
    const item = document.createElement('li');
    item.textContent = `${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`;
    item.setAttribute('data-status', ok ? 'pass' : 'fail');
    results.appendChild(item);
  }
  function assert(condition, name, detail) {
    assertions += 1;
    if (!condition) { failures.push(`${name}${detail ? `: ${detail}` : ''}`); record(name, false, detail); throw new Error(name); }
    record(name, true, detail);
  }
  function delay(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function checkpoint() {
    await Promise.resolve();
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    await Promise.resolve();
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
  }
  function waitFrameLoad(frame) {
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = () => {
        if (frame.contentDocument && frame.contentDocument.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank') resolve();
        else if (Date.now() >= deadline) reject(new Error(`fixture timeout: ${frame.id}`));
        else setTimeout(poll, 20);
      };
      poll();
    });
  }
  async function useFixture(id, selector) {
    const frame = document.getElementById(id);
    await waitFrameLoad(frame);
    const source = frame.contentDocument.querySelector(selector);
    sandbox.replaceChildren(document.importNode(source, true));
    await checkpoint();
  }
  function card(name) { return sandbox.querySelector(`[data-case="${name}"]`); }
  function popular(node) { return node.classList.contains('xhs-enhanced-card--popular'); }

  addEventListener('error', event => failures.push(`window error: ${event.message}`));
  addEventListener('unhandledrejection', event => failures.push(`unhandled rejection: ${String(event.reason)}`));

  async function initialAndIdempotent() {
    api.setTestRoute('/search_result?keyword=test');
    await useFixture('search-source', '#search-fixture');
    api.scan(); api.scan(); api.scan();
    await checkpoint();
    assert(!popular(card('100')), 'strict boundary: 100 is not highlighted');
    assert(popular(card('101')), 'strict boundary: 101 card highlighted');
    assert(card('101').querySelector('[data-like-count]').classList.contains('xhs-enhanced-like--popular'), 'like node highlighted with card');
    for (const name of ['comma', 'wan', 'w', 'k']) assert(popular(card(name)), `supported count format: ${name}`);
    assert(!popular(card('bad')) && !popular(card('two-numbers')), 'malformed counts fail conservatively');
    assert(sandbox.querySelector('[data-case="no-link"]').getAttribute('data-xhs-enhanced-signature') === null, 'unreliable card ignored');
    assert(sandbox.querySelectorAll('.xhs-enhanced-publish-time').length === 0, 'no publication-time labels are generated');
    assert(document.querySelectorAll('#xhs-enhanced-style').length === 1, 'single global style');
  }

  async function profile() {
    api.setTestRoute('/user/profile/abc');
    await useFixture('profile-source', '#profile-fixture');
    api.scan(); await checkpoint();
    assert(!popular(card('profile-100')) && popular(card('profile-101')), 'profile threshold boundary');
    assert(popular(card('profile-fallback')), 'profile explicit count fallback');
    assert(card('profile-fallback').querySelectorAll('.xhs-enhanced-publish-time').length === 0, 'profile card has no generated time label');
    assert(!card('profile-100').querySelector('.author-stats').classList.contains('xhs-enhanced-like--popular'), 'author stats not treated as likes');
  }

  function makeCard(name, value, attribute = 'aria-label') {
    const node = document.createElement('article'); node.className = 'note-item'; node.dataset.noteCard = ''; node.dataset.case = name;
    const link = document.createElement('a'); link.href = `/explore/${name}`; link.textContent = name;
    const like = document.createElement('button'); like.setAttribute(attribute, attribute === 'aria-label' || attribute === 'title' ? `点赞 ${value}` : value); like.textContent = value;
    node.append(link, like); return node;
  }

  async function dynamicAndAttributes() {
    api.setTestRoute('/search_result');
    await useFixture('dynamic-source', '#dynamic-fixture');
    const target = sandbox.querySelector('#dynamic-fixture');
    const before = api.getCounters();
    const items = [];
    for (let i = 0; i < 20; i += 1) { const node = makeCard(`burst-${i}`, 99); items.push(node); target.appendChild(node); }
    for (let i = 0; i < 100; i += 1) items[i % items.length].querySelector('button').textContent = String(i);
    items[0].querySelector('button').setAttribute('aria-label', '点赞 101');
    await checkpoint();
    assert(popular(items[0]), 'dynamic insertion and final burst state processed');
    const after = api.getCounters();
    assert(after.batches - before.batches < 100, 'mutations are batch-coalesced', `${after.batches - before.batches} batches`);

    const like = items[0].querySelector('button');
    for (const value of ['99', '101', '100', '--']) {
      like.setAttribute('aria-label', `点赞 ${value}`); await checkpoint();
      assert(popular(items[0]) === (value === '101'), `aria-label attribute transition ${value}`);
    }
    like.removeAttribute('aria-label'); like.setAttribute('title', '点赞 101'); await checkpoint(); assert(popular(items[0]), 'title-only mutation observed');
    like.removeAttribute('title'); like.setAttribute('data-like-count', '100'); await checkpoint(); assert(!popular(items[0]), 'explicit count-only mutation observed');
    like.setAttribute('data-like-count', '101'); await checkpoint(); assert(popular(items[0]), 'explicit count adds highlight');
    const replacement = document.createElement('span'); replacement.className = 'like-count'; replacement.textContent = '100'; like.replaceWith(replacement); await checkpoint();
    assert(!popular(items[0]) && !like.classList.contains('xhs-enhanced-like--popular'), 'reused card cleans detached like state');
    const stable = api.getCounters().batches; await checkpoint(); await checkpoint();
    assert(api.getCounters().batches === stable, 'renderer becomes quiescent');
  }

  async function spaRootReplacement() {
    const oldRoot = sandbox;
    const replacementRoot = document.createElement('main');
    replacementRoot.id = 'sandbox';
    const replacementCard = makeCard('root-replacement', 101);
    replacementRoot.appendChild(replacementCard);

    api.setTestRoute('/user/profile/root-replacement', false);
    oldRoot.replaceWith(replacementRoot);
    sandbox = replacementRoot;
    await checkpoint();
    assert(!oldRoot.isConnected && sandboxHost.contains(sandbox), 'SPA replaces the actual observed content root');
    assert(popular(replacementCard), 'replacement-root card processed without test-route scheduling');

    const infiniteScrollCard = makeCard('after-root-replacement', 102);
    sandbox.appendChild(infiniteScrollCard);
    await checkpoint();
    assert(popular(infiniteScrollCard), 'new root remains observed for subsequent infinite-scroll cards');
    const stable = api.getCounters().batches; await checkpoint(); await checkpoint();
    assert(api.getCounters().batches === stable, 'root rebinding remains quiescent');
  }

  async function navigationAndNonInvasive() {
    const clickable = makeCard('clickable', 101); let clicks = 0; let scrolled = 0;
    clickable.querySelector('a').addEventListener('click', event => { clicks += 1; assert(!event.defaultPrevented, 'click default not prevented'); event.preventDefault(); });
    sandbox.replaceChildren(clickable); api.setTestRoute('/search_result'); await checkpoint();
    clickable.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    addEventListener('scroll', () => { scrolled += 1; }, { once:true }); dispatchEvent(new Event('scroll')); assert(clicks === 1 && scrolled === 1, 'click and scroll listeners remain functional');
    api.setTestRoute('/explore/abc'); await checkpoint();
    assert(!popular(clickable) && clickable.getAttribute('data-xhs-enhanced-signature') === null, 'leaving target route cleans enhancement state');
    const fresh = makeCard('non-target', 999); sandbox.replaceChildren(fresh); await checkpoint();
    assert(!popular(fresh), 'non-target route does not process new card');
    api.setTestRoute('/user/profile/abc'); await checkpoint(); assert(popular(fresh), 'returning to target route rescans');
    api.setTestRoute('/search_result'); dispatchEvent(new PopStateEvent('popstate')); await checkpoint(); assert(popular(fresh), 'popstate route path handled');
  }

  async function testModeOffAndLifecycle() {
    const frame = document.getElementById('off-source'); await waitFrameLoad(frame);
    const win = frame.contentWindow; const offCard = frame.contentDocument.querySelector('[data-note-card]');
    assert(win.__XHS_ENHANCED_TEST_API__ === undefined, 'test API absent when test mode is off');
    assert(!offCard.classList.contains('xhs-enhanced-card--popular'), 'forged route cannot bypass real file route');
    api.destroy(); await checkpoint();
    assert(!sandbox.querySelector('.xhs-enhanced-card--popular') && !document.getElementById('xhs-enhanced-style'), 'destroy cleans owned state');
    api.init(); api.setTestRoute('/search_result'); api.scan(); await checkpoint();
    assert(document.querySelectorAll('#xhs-enhanced-style').length === 1, 're-init creates one lifecycle');
  }

  function finish(status) {
    if (terminalWrites !== 0) return;
    terminalWrites += 1;
    root.setAttribute('data-test-terminal-writes', String(terminalWrites));
    root.setAttribute('data-test-summary', JSON.stringify({ assertions, failures }));
    root.setAttribute('data-test-result', status);
    document.title = `XHS-HARNESS|${status}|${terminalWrites}|${assertions}|${encodeURIComponent(failures[0] || '')}`;
  }

  const suiteTimeout = setTimeout(() => { failures.push('suite timeout'); finish('fail'); }, 8000);
  (async () => {
    try {
      assert(Boolean(api), 'test API installed');
      await initialAndIdempotent();
      await profile();
      await dynamicAndAttributes();
      await spaRootReplacement();
      await navigationAndNonInvasive();
      await testModeOffAndLifecycle();
      await checkpoint();
      if (failures.length) throw new Error(failures.join('; '));
      clearTimeout(suiteTimeout); finish('pass');
    } catch (error) {
      failures.push(error && error.stack ? error.stack : String(error));
      clearTimeout(suiteTimeout); finish('fail');
    }
  })();
}());
