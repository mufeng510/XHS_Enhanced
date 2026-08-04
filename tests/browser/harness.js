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
  function jumpButton() { return document.getElementById('xhs-enhanced-jump-next'); }
  function statusNode() { return document.getElementById('xhs-enhanced-jump-status'); }
  function thresholdControl() { return document.getElementById('xhs-enhanced-threshold-control'); }
  function thresholdInput() { return document.getElementById('xhs-enhanced-threshold-input'); }
  function thresholdStatus() { return document.getElementById('xhs-enhanced-threshold-status'); }
  function setRect(node, top, bottom = top + 200) { node.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top }); }

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
    for (const name of ['profile-100', 'profile-101', 'profile-fallback']) {
      const node = card(name);
      const container = node.querySelector('.xhs-enhanced-card-actions');
      assert(Boolean(container), `profile card has copy actions container: ${name}`);
      assert(container.querySelector('.xhs-enhanced-copy-link').textContent === '复制链接', `profile card copy-link button label: ${name}`);
      assert(container.querySelector('.xhs-enhanced-copy-cover').textContent === '复制封面', `profile card copy-cover button label: ${name}`);
    }
    const searchCard = card('profile-100');
    api.setTestRoute('/search_result'); await checkpoint();
    assert(!searchCard.querySelector('.xhs-enhanced-card-actions'), 'leaving profile route removes copy actions from existing cards');
    api.setTestRoute('/user/profile/abc'); await checkpoint();
    assert(Boolean(searchCard.querySelector('.xhs-enhanced-card-actions')), 'returning to profile route restores copy actions');
  }

  async function configurableThreshold() {
    api.setTestRoute('/search_result');
    await useFixture('search-source', '#search-fixture');
    api.scan(); await checkpoint();
    assert(thresholdControl() && thresholdControl().getAttribute('role') === 'group' && thresholdInput(), 'threshold control is present and labelled');
    assert(document.querySelectorAll('#xhs-enhanced-threshold-control').length === 1, 'threshold control is unique');
    thresholdInput().value = '222';
    card('101').querySelector('[data-like-count]').setAttribute('data-like-count', '102'); await checkpoint();
    assert(thresholdInput().value === '222', 'unsubmitted threshold input survives feed mutations');

    thresholdInput().value = '200';
    thresholdControl().querySelector('button').click(); await checkpoint();
    assert(api.getThreshold() === 200 && !popular(card('101')), 'configured threshold applies immediately with strict boundary');
    assert(localStorage.getItem('xhs-enhanced:popular-threshold') === '200', 'configured threshold persists locally');

    api.destroy(); api.init(); await checkpoint();
    assert(api.getThreshold() === 200 && thresholdInput().value === '200', 'stored threshold is restored before rescanning');

    thresholdInput().value = '-1';
    thresholdControl().querySelector('button').click(); await checkpoint();
    assert(api.getThreshold() === 200 && thresholdInput().value === '200' && thresholdStatus().textContent.includes('请输入非负整数'), 'invalid threshold preserves the active value');
    thresholdInput().value = '100';
    thresholdInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await checkpoint();
    assert(api.getThreshold() === 100 && popular(card('101')), 'keyboard apply restores strict 100/101 boundary');

    api.setTestRoute('/explore/threshold'); await checkpoint();
    assert(!thresholdControl() && !thresholdStatus(), 'threshold UI is removed outside supported routes');
    api.setTestRoute('/search_result'); await checkpoint();
    assert(document.querySelectorAll('#xhs-enhanced-threshold-control').length === 1, 'threshold UI is restored without duplication');
  }

  function makeCard(name, value, attribute = 'aria-label') {
    const node = document.createElement('article'); node.className = 'note-item'; node.dataset.noteCard = ''; node.dataset.case = name;
    const link = document.createElement('a'); link.href = `/explore/${name}`; link.textContent = name;
    const like = document.createElement('button'); like.setAttribute(attribute, attribute === 'aria-label' || attribute === 'title' ? `点赞 ${value}` : value); like.textContent = value;
    node.append(link, like); return node;
  }

  async function jumpNavigation() {
    api.setTestRoute('/search_result');
    const above = makeCard('jump-above', 101);
    const visible = makeCard('jump-visible', 101);
    const partial = makeCard('jump-partial', 101);
    const far = makeCard('jump-far', 101);
    const nearest = makeCard('jump-nearest', 101);
    const ordinary = makeCard('jump-ordinary', 100);
    sandbox.replaceChildren(above, visible, partial, far, nearest, ordinary);
    const viewport = globalThis.innerHeight || document.documentElement.clientHeight;
    setRect(above, -200, -20); setRect(visible, 100, 300); setRect(partial, viewport - 50, viewport + 150);
    setRect(far, viewport + 400); setRect(nearest, viewport + 10); setRect(ordinary, viewport + 5);
    const calls = new Map();
    for (const node of [above, visible, partial, far, nearest, ordinary]) node.scrollIntoView = options => calls.set(node, (calls.get(node) || []).concat([options]));
    const originalScrollTo = globalThis.scrollTo;
    const scrollCalls = [];
    globalThis.scrollTo = options => scrollCalls.push(options);
    try {
      api.scan(); await checkpoint();
      assert(jumpButton() && jumpButton().type === 'button' && jumpButton().textContent === '下一条热门笔记', 'jump button is present and accessible on target route');
      assert(document.querySelectorAll('#xhs-enhanced-jump-next').length === 1, 'jump button is unique');
      jumpButton().click();
      assert((calls.get(nearest) || []).length === 1 && calls.get(nearest)[0].behavior === 'smooth' && calls.get(nearest)[0].block === 'center', 'jump selects nearest popular card below viewport');
      assert(!calls.has(above) && !calls.has(visible) && !calls.has(partial) && !calls.has(ordinary), 'jump skips intersecting and non-popular cards');

      setRect(nearest, 100, 300); setRect(far, viewport + 10);
      jumpButton().click();
      assert((calls.get(far) || []).length === 1, 'second jump advances after geometry changes');

      setRect(far, 100, 300);
      jumpButton().click();
      assert(scrollCalls.length === 1 && scrollCalls[0].behavior === 'smooth', 'last popular note scrolls to document bottom');
      assert(statusNode() && statusNode().textContent === '已经是最后一条热门笔记' && statusNode().getAttribute('role') === 'status' && statusNode().getAttribute('aria-live') === 'polite', 'last-note status is live and non-blocking');
      jumpButton().click();
      assert(document.querySelectorAll('#xhs-enhanced-jump-status').length === 1, 'repeated last-note clicks reuse one status');

      const dynamic = makeCard('jump-dynamic', 101); setRect(dynamic, viewport + 10); dynamic.scrollIntoView = options => calls.set(dynamic, [options]); sandbox.appendChild(dynamic);
      await checkpoint(); jumpButton().click();
      assert((calls.get(dynamic) || []).length === 1 && !statusNode(), 'dynamic popular card becomes next target and clears status');

      api.setTestRoute('/explore/abc'); await checkpoint();
      assert(!jumpButton() && !statusNode(), 'leaving supported route removes jump UI');
      api.setTestRoute('/user/profile/jump'); await checkpoint();
      assert(document.querySelectorAll('#xhs-enhanced-jump-next').length === 1, 'returning to supported route restores one jump button');
    } finally {
      globalThis.scrollTo = originalScrollTo;
    }
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
    const generationOne = history.pushState;
    const thirdPartyPushState = function (...args) { return generationOne.apply(this, args); };
    history.pushState = thirdPartyPushState;
    const originalRaf = globalThis.requestAnimationFrame;
    const queuedRafs = [];
    globalThis.requestAnimationFrame = callback => { queuedRafs.push(callback); return queuedRafs.length; };
    api.scan();
    api.destroy();
    assert(!sandbox.querySelector('.xhs-enhanced-card--popular') && !document.getElementById('xhs-enhanced-style') && !jumpButton() && !statusNode(), 'destroy cleans owned state and jump UI');
    assert(history.pushState === thirdPartyPushState && history.replaceState === globalThis.__XHS_ORIGINAL_HISTORY__.replaceState, 'destroy preserves a third-party History wrapper and restores identity-safe methods');
    api.init();
    const beforeStaleRaf = api.getCounters().batches;
    queuedRafs[0]();
    assert(api.getCounters().batches === beforeStaleRaf, 'stale animation-frame callback cannot flush a new lifecycle');
    queuedRafs[1]();
    assert(api.getCounters().batches === beforeStaleRaf + 1, 'current animation-frame callback flushes exactly once');
    globalThis.requestAnimationFrame = originalRaf;
    api.setTestRoute('/search_result'); api.scan(); await checkpoint();
    const generationTwo = history.pushState;
    const beforeGenerationCall = api.getCounters().routeSignals;
    history.pushState({}, '', '/search_result?generation=2'); await checkpoint();
    assert(generationTwo !== generationOne && api.getCounters().routeSignals === beforeGenerationCall + 1, 'only current History generation signals through preserved third-party chain');
    api.destroy();
    assert(history.pushState === thirdPartyPushState, 'destroying current generation restores preserved third-party wrapper');
    const beforeInactiveCall = api.getCounters().routeSignals;
    history.pushState({}, '', '/search_result?inactive-generation=1');
    assert(api.getCounters().routeSignals === beforeInactiveCall, 'inactive prior History generation remains permanent pass-through');
    api.init(); api.setTestRoute('/search_result'); api.scan(); await checkpoint();
    const pushWrapper = history.pushState; api.init();
    assert(document.querySelectorAll('#xhs-enhanced-style').length === 1 && document.querySelectorAll('#xhs-enhanced-jump-next').length === 1 && history.pushState === pushWrapper, 're-init creates one idempotent lifecycle');
    history.replaceState({}, '', '/search_result'); await checkpoint();
  }

  async function productionHistorySignals() {
    api.clearTestRoute(); await checkpoint();
    assert(location.pathname === '/search_result', 'browser harness starts on real supported pathname');
    const beforePush = api.getCounters().routeSignals;
    history.pushState({}, '', '/explore/architect-route-test'); await checkpoint();
    assert(api.getCounters().routeSignals === beforePush + 1 && !jumpButton(), 'pushState produces one route signal and removes UI');
    const beforeReplace = api.getCounters().routeSignals;
    history.replaceState({}, '', '/user/profile/architect-route-test'); await checkpoint();
    assert(api.getCounters().routeSignals === beforeReplace + 1 && document.querySelectorAll('#xhs-enhanced-jump-next').length === 1, 'replaceState produces one route signal and restores UI');
    const beforeFailure = api.getCounters().routeSignals;
    let threw = false;
    try { history.pushState({}, '', 'https://example.com/forbidden'); } catch { threw = true; }
    assert(threw && api.getCounters().routeSignals === beforeFailure, 'failed History call preserves exception and emits no signal');
    history.replaceState({}, '', '/search_result'); await checkpoint();
  }

  async function bodyObserverQuiescence() {
    api.setTestRoute('/search_result');
    const fallbackRoot = document.createElement('div'); fallbackRoot.id = 'sandbox';
    sandbox.replaceWith(fallbackRoot); sandbox = fallbackRoot;
    await checkpoint();
    assert(api.getCounters().observerRootIsBody, 'observer falls back to body when no content root matches');
    jumpButton().click(); await checkpoint();
    assert(statusNode(), 'body observer permits last-note status UI');
    await delay(3100); await checkpoint();
    const stable = api.getCounters().batches; await checkpoint(); await checkpoint();
    assert(api.getCounters().batches === stable, 'owned jump UI mutations become quiescent under body observer');
    const dynamic = makeCard('body-fallback-dynamic', 101); fallbackRoot.appendChild(dynamic); await checkpoint();
    assert(popular(dynamic), 'body fallback observer still processes dynamic cards');
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
      await configurableThreshold();
      await dynamicAndAttributes();
      await jumpNavigation();
      await spaRootReplacement();
      await navigationAndNonInvasive();
      await bodyObserverQuiescence();
      await productionHistorySignals();
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
