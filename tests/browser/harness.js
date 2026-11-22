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
  function dimmed(node) { return node.classList.contains('xhs-enhanced-card--dimmed'); }
  function jumpButton() { return document.getElementById('xhs-enhanced-jump-next'); }
  function prevButton() { return document.getElementById('xhs-enhanced-jump-prev'); }
  function jumpNav() { return document.getElementById('xhs-enhanced-jump-nav'); }
  function focusToggleNode() { return document.getElementById('xhs-enhanced-focus-toggle'); }
  function statusNode() { return document.getElementById('xhs-enhanced-jump-status'); }
  function settingsButton() { return document.getElementById('xhs-enhanced-settings'); }
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
    // Real search cards expose TWO anchors to the same note (.cover + .title); they must still get actions.
    const dual = card('search-dual-anchor');
    const dualActions = dual && dual.querySelector('.xhs-enhanced-card-actions');
    assert(Boolean(dualActions), 'search card with two note anchors receives a card-actions container');
    assert(dualActions.querySelectorAll('.xhs-enhanced-copy-link').length === 1, 'search dual-anchor card has exactly one copy-link button');
    assert(dualActions.querySelectorAll('.xhs-enhanced-copy-cover').length === 1, 'search dual-anchor card has exactly one copy-cover button');
    assert(dualActions.querySelectorAll('.xhs-enhanced-download-cover').length === 1, 'search dual-anchor card has exactly one download-cover button');
    assert(dualActions.querySelectorAll('.xhs-enhanced-save-library').length === 1, 'search dual-anchor card has exactly one save-library button');
    assert(dualActions.querySelector('.xhs-enhanced-download-cover').textContent === '下载封面', 'search dual-anchor card download-cover button label');
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
      assert(container.querySelector('.xhs-enhanced-download-cover').textContent === '下载封面', `profile card download-cover button label: ${name}`);
      assert(container.querySelector('.xhs-enhanced-save-library').textContent === '保存入库', `profile card save-library button label: ${name}`);
    }
    const searchCard = card('profile-100');
    const originalWriteText = navigator.clipboard && navigator.clipboard.writeText;
    const originalWrite = navigator.clipboard && navigator.clipboard.write;
    const originalClipboardItem = navigator.ClipboardItem;
    const copied = [];
    const copiedImages = [];
    class FakeClipboardItem {
      constructor(items) { this.items = items; }
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText = v => { copied.push(String(v)); return Promise.resolve(); };
      navigator.ClipboardItem = FakeClipboardItem;
      try { globalThis.ClipboardItem = FakeClipboardItem; } catch (_) {}
      navigator.clipboard.write = async items => { copiedImages.push(items); return undefined; };
    }
    // Real XHS profile pages serialize camelCase xsecToken into the inline
    // __INITIAL_STATE__ script payload; the content script parses it from the DOM.
    const injectState = state => {
      const script = document.createElement('script');
      script.textContent = 'window.__INITIAL_STATE__=' + JSON.stringify(state) + ';';
      sandbox.appendChild(script);
      return script;
    };
    const stateScript = injectState({
      user: {
        notes: [[{
          id: 'p1',
          noteCard: { noteId: 'p1', xsecToken: 'stateTokenP1=', type: 'video' },
          index: 0,
          exposed: false,
          ssrRendered: true,
          xsecToken: 'stateTokenP1='
        }, {
          id: 'p3',
          noteCard: { noteId: 'p3', xsecToken: 'stateTokenP3=', type: 'normal' },
          index: 1,
          exposed: false,
          ssrRendered: true,
          xsecToken: 'stateTokenP3='
        }]]
      }
    });
    try {
      card('profile-101').querySelector('.xhs-enhanced-copy-link').click(); await checkpoint();
      assert(copied[copied.length - 1] === 'https://www.xiaohongshu.com/explore/p2?xsec_token=hrefTokenP2&xsec_source=pc_feed', 'copy link prefers xsec_token from card href when present');
      card('profile-100').querySelector('.xhs-enhanced-copy-link').click(); await checkpoint();
      assert(copied[copied.length - 1] === 'https://www.xiaohongshu.com/explore/p1?xsec_token=stateTokenP1%3D&xsec_source=pc_feed', 'copy link uses per-note xsecToken from __INITIAL_STATE__ when href has no token');
      card('profile-fallback').querySelector('.xhs-enhanced-copy-link').click(); await checkpoint();
      assert(copied[copied.length - 1] === 'https://www.xiaohongshu.com/explore/p3?xsec_token=stateTokenP3%3D&xsec_source=pc_feed', 'copy link resolves distinct per-note tokens from state');
      card('profile-100').querySelector('.xhs-enhanced-copy-cover').click();
      await checkpoint();
      await checkpoint();
      await checkpoint();
      assert(copiedImages.length >= 1, 'copy-cover writes image to clipboard');
      const first = copiedImages[0][0];
      assert(first && first.items && first.items['image/png'], 'copy-cover clipboard payload is image/png');
      const payload = first.items['image/png'];
      const resolved = payload && typeof payload.then === 'function' ? await payload : payload;
      assert(resolved && typeof resolved.size === 'number' && resolved.size > 0, 'copy-cover clipboard image blob resolved');
      const status = document.getElementById('xhs-enhanced-copy-status');
      assert(status && status.textContent === '已复制笔记封面', 'copy-cover success toast');
    } finally {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = originalWriteText;
        if (originalWrite) navigator.clipboard.write = originalWrite;
      }
      if (originalClipboardItem) navigator.ClipboardItem = originalClipboardItem;
      if (stateScript && stateScript.remove) stateScript.remove();
    }
    api.setTestRoute('/search_result'); await checkpoint();
    assert(Boolean(searchCard.querySelector('.xhs-enhanced-save-library')), 'search route keeps card actions with save-to-library button');
    api.setTestRoute('/explore/route-clean'); await checkpoint();
    assert(!searchCard.querySelector('.xhs-enhanced-card-actions'), 'leaving target route removes copy actions from existing cards');
    api.setTestRoute('/user/profile/abc'); await checkpoint();
    assert(Boolean(searchCard.querySelector('.xhs-enhanced-card-actions')), 'returning to profile route restores copy actions');
  }

  async function popularThresholdConfiguration() {
    api.setTestRoute('/search_result');
    await useFixture('search-source', '#search-fixture');
    api.scan(); await checkpoint();
    assert(!document.getElementById('xhs-enhanced-threshold-control'), 'no floating threshold control remains (moves to the options page)');
    assert(popular(card('101')), 'default threshold 100 highlights 101');
    // The options page persists through the same chrome.storage.local channel;
    // the content script's test seam goes through the same write path.
    api.setThreshold('200');
    await checkpoint();
    assert(api.getThreshold() === 200 && !popular(card('101')), 'written threshold re-renders open tabs immediately with strict boundary');
    api.destroy(); api.init(); await checkpoint();
    assert(api.getThreshold() === 200, 'stored threshold is restored before rescanning');
    api.setThreshold('100');
    await checkpoint();
    assert(api.getThreshold() === 100 && popular(card('101')), 'reset back to 100 restores the strict boundary');
    api.setThreshold('100');
  }

  async function librarySync() {
    api.setTestRoute('/user/profile/abc');
    // The chrome.storage.local mock was seeded in harness.html with the four
    // library keys; __XHSE_LAST_CALLS__ captures every background request.
    const calls = () => globalThis.__XHSE_LAST_CALLS__ || [];
    const crawlOf = () => calls().find(options => options.url === 'http://127.0.0.1:8000/api/xhs/crawl/note-urls');
    globalThis.__XHSE_LAST_CALLS__ = [];
    globalThis.__XHSE_CRAWL_STATUS__ = 200;
    globalThis.__XHSE_CRAWL_BODY__ = { saved_count: 1, result_count: 1, errors: [], items: [] };
    try {
      await useFixture('profile-source', '#profile-fixture');
      api.scan(); await checkpoint();
      // profile-100 resolves its token from the inline __INITIAL_STATE__ payload (its href has none).
      const stateScript = document.createElement('script');
      stateScript.textContent = 'window.__INITIAL_STATE__=' + JSON.stringify({
        user: {
          notes: [[{
            id: 'p1',
            noteCard: { noteId: 'p1', xsecToken: 'stateTokenP1=', type: 'video' },
            index: 0, exposed: false, ssrRendered: true, xsecToken: 'stateTokenP1='
          }]]
        }
      }) + ';';
      stateScript.id = 'xhs-initial-state-test-payload';
      sandbox.appendChild(stateScript);
      globalThis.__XHSE_STATE_SCRIPT__ = stateScript;
      const saveButton = card('profile-101').querySelector('.xhs-enhanced-save-library');
      assert(saveButton && saveButton.textContent === '保存入库', 'profile card exposes save-to-library button');
      saveButton.click();
      await checkpoint(); await checkpoint();
      const loginCall = calls().find(options => options.url.endsWith('/api/auth/login'));
      assert(Boolean(loginCall) && JSON.parse(loginCall.data).username === 'tester', 'save flow logs in with stored credentials');
      const crawlCall = crawlOf();
      assert(Boolean(crawlCall), 'save flow posts to the crawl endpoint');
      assert(crawlCall.headers.Authorization === 'Bearer at', 'crawl request carries bearer token');
      const crawlBody = JSON.parse(crawlCall.data);
      assert(crawlBody.account_id === 7 && crawlBody.save_to_library === true && crawlBody.fetch_comments === false, 'crawl payload matches the API contract');
      assert(crawlBody.urls.length === 1 && crawlBody.urls[0] === 'https://www.xiaohongshu.com/explore/p2?xsec_token=hrefTokenP2&xsec_source=pc_feed', 'crawl payload carries the built share link');
      const toast = document.getElementById('xhs-enhanced-copy-status');
      assert(toast && toast.textContent === '已保存到内容库', 'save success toast');
      assert(card('profile-101').querySelector('.xhs-enhanced-save-library').textContent === '已入库', 'save button flips to done state');

      globalThis.__XHSE_CRAWL_STATUS__ = 200;
      globalThis.__XHSE_CRAWL_BODY__ = { saved_count: 0, result_count: 0, errors: [{ url: 'u', error: 'XHS note detail crawl failed' }] };
      globalThis.__XHSE_LAST_CALLS__ = [];
      card('profile-100').querySelector('.xhs-enhanced-save-library').click();
      await checkpoint(); await checkpoint();
      assert(document.getElementById('xhs-enhanced-copy-status').textContent.indexOf('采集失败') === 0, 'crawl failure toast shows server error');

      // Use the REAL location for the detail-page flow (clearTestRoute restores location routing).
      api.clearTestRoute(); await checkpoint();
      navigate('/explore/detail1?xsec_token=tok&xsec_source=pc_search'); await checkpoint();
      const pageButton = document.getElementById('xhs-enhanced-library-page');
      assert(pageButton && pageButton.textContent === '保存到内容库', 'detail route shows floating save button');
      globalThis.__XHSE_CRAWL_STATUS__ = 200;
      globalThis.__XHSE_CRAWL_BODY__ = { saved_count: 1, result_count: 1, errors: [] };
      globalThis.__XHSE_LAST_CALLS__ = [];
      pageButton.click();
      await checkpoint(); await checkpoint();
      const detailCall = crawlOf();
      const detailBody = JSON.parse(detailCall.data);
      assert(detailBody.urls.length === 1 && detailBody.urls[0] === location.origin + location.pathname + location.search, 'detail save submits the current page url');

      navigate('/search_result'); await checkpoint();
      assert(document.getElementById('xhs-enhanced-library-batch'), 'batch save button present on target route');
      assert(!document.getElementById('xhs-enhanced-library-page'), 'detail save button removed on target route');

      const batchA = makeCard('batcha0000000000000000a1', 101); batchA.querySelector('a').href = '/explore/batcha0000000000000000a1?xsec_token=ta&xsec_source=pc_feed';
      const batchB = makeCard('batchb0000000000000000b2', 101); batchB.querySelector('a').href = '/search_result/batchb0000000000000000b2?xsec_token=tb&xsec_source=pc_search';
      sandbox.replaceChildren(batchA, batchB);
      await checkpoint();
      globalThis.__XHSE_LAST_CALLS__ = [];
      document.getElementById('xhs-enhanced-library-batch').click();
      await checkpoint(); await checkpoint();
      const batchBody = JSON.parse(crawlOf().data);
      const expectedBatch = 'https://www.xiaohongshu.com/explore/batcha0000000000000000a1?xsec_token=ta&xsec_source=pc_feed|https://www.xiaohongshu.com/explore/batchb0000000000000000b2?xsec_token=tb&xsec_source=pc_feed';
      assert(batchBody.urls.join('|') === expectedBatch, 'batch collects deduped share links from visible cards', batchBody.urls.join('|'));
      assert(document.getElementById('xhs-enhanced-copy-status').textContent.indexOf('本页入库完成') === 0, 'batch summary toast');

      // Home feed route gets the same card-level tools.
      api.setTestRoute('/explore'); await checkpoint();
      assert(document.getElementById('xhs-enhanced-library-batch'), 'batch save button present on home feed route');
      assert(card('batcha0000000000000000a1').querySelector('.xhs-enhanced-save-library'), 'home feed route keeps card save actions');

      // Search detail modal URL shows the floating save button.
      api.clearTestRoute(); await checkpoint();
      navigate('/search_result/det1?xsec_token=tok&xsec_source=pc_search'); await checkpoint();
      assert(document.getElementById('xhs-enhanced-library-page'), 'search detail modal shows floating save button');

      const toggle = settingsButton();
      assert(toggle && toggle.textContent === '⚙ 设置', 'settings button present in place of the old library-toggle');
      const optionsBefore = globalThis.__XHSE_OPEN_OPTIONS__ || 0;
      toggle.click(); await checkpoint();
      assert((globalThis.__XHSE_OPEN_OPTIONS__ || 0) === optionsBefore + 1, 'library settings button opens the extension options page');
    } finally {
      delete globalThis.__XHSE_CRAWL_STATUS__;
      delete globalThis.__XHSE_CRAWL_BODY__;
      if (globalThis.__XHSE_STATE_SCRIPT__ && globalThis.__XHSE_STATE_SCRIPT__.remove) { globalThis.__XHSE_STATE_SCRIPT__.remove(); delete globalThis.__XHSE_STATE_SCRIPT__; }
      // The content library refresh token persists in chrome.storage (mocked); drop it like the old harness did.
      for (const key of Object.keys(globalThis.__XHS_CHROME_STORE__ || {})) {
        if (key === 'xhs-enhanced:library-refresh-token') delete globalThis.__XHS_CHROME_STORE__[key];
      }
      navigate('/search_result');
      await checkpoint();
    }
  }

  function navigate(url) {
    // The content script runs in an isolated world and cannot observe the
    // page's pushState calls. Real XHS SPA navigation always mutates the DOM
    // INSIDE the observed content root (the sandbox here); we mirror that
    // with a throwaway marker so the observer schedules a flush.
    history.pushState({}, '', url);
    const marker = document.createElement('span');
    marker.setAttribute('data-xhs-route-marker', '');
    sandbox.appendChild(marker);
    marker.remove();
  }

  function makeCard(name, value, attribute = 'aria-label') {
    const node = document.createElement('article'); node.className = 'note-item'; node.dataset.noteCard = ''; node.dataset.case = name;
    const link = document.createElement('a'); link.href = `/explore/${name}`; link.textContent = name;
    const like = document.createElement('button'); like.setAttribute(attribute, attribute === 'aria-label' || attribute === 'title' ? `点赞 ${value}` : value); like.textContent = value;
    node.append(link, like); return node;
  }

  async function batchSelectionAndDownload() {
    api.clearTestSelection();
    api.setTestRoute('/search_result?keyword=test');
    await useFixture('search-source', '#search-fixture');
    api.scan(); await checkpoint();
    // Link-bearing cards get checkboxes; the no-link card does not.
    const reliableCases = ['99', '100', '101', 'comma', 'wan', 'w', 'k', 'bad', 'two-numbers', 'search-dual-anchor'];
    for (const name of reliableCases) {
      assert(card(name).querySelector('.xhs-enhanced-checkbox'), `checkbox injected: ${name}`);
    }
    assert(!card('no-link').querySelector('.xhs-enhanced-checkbox'), 'card without note id gets no checkbox');
    const countNode = document.getElementById('xhs-enhanced-batch-count');
    assert(countNode, 'batch bar rendered');
    assert(countNode.textContent.includes('0'), 'bar starts at zero');
    // Toggle two cards on, then off again via the same boxes.
    card('99').querySelector('.xhs-enhanced-checkbox').click();
    card('100').querySelector('.xhs-enhanced-checkbox').click();
    await checkpoint();
    assert(card('99').querySelector('.xhs-enhanced-checkbox').getAttribute('aria-checked') === 'true', 'card 99 checked');
    assert(countNode.textContent.includes('2'), 'bar shows 已选 2');
    card('99').querySelector('.xhs-enhanced-checkbox').click();
    await checkpoint();
    assert(countNode.textContent.includes('1'), 'bar shows 已选 1 after unchecking');
    // 全选已加载 → 全部已加载卡入选；再点一次 → 取消已加载勾选。
    const selectLoaded = document.getElementById('xhs-enhanced-batch-select-loaded');
    selectLoaded.click();
    await checkpoint();
    assert(countNode.textContent.includes('10'), 'select-all selects all loaded link-bearing cards', countNode.textContent);
    assert(selectLoaded.getAttribute('aria-pressed') === 'true', 'select-all marked pressed');
    selectLoaded.click();
    await checkpoint();
    assert(countNode.textContent.includes('0'), 'select-all toggles off for loaded cards');
    // 清空 button clears a mixed selection.
    card('99').querySelector('.xhs-enhanced-checkbox').click();
    card('search-dual-anchor').querySelector('.xhs-enhanced-checkbox').click();
    await checkpoint();
    document.getElementById('xhs-enhanced-batch-clear').click();
    await checkpoint();
    assert(countNode.textContent.includes('0'), 'clear empties the selection');
    // 连续勾选: newly scanned cards are auto-checked without further clicks.
    const continuous = document.getElementById('xhs-enhanced-batch-continuous');
    continuous.click();
    assert(continuous.getAttribute('aria-pressed') === 'true', 'continuous mode toggled on');
    api.scan(); await checkpoint();
    const autoChecked = sandbox.querySelectorAll('.xhs-enhanced-checkbox[aria-checked="true"]').length;
    assert(autoChecked === 10, 'continuous mode auto-selects loaded cards', `checked=${autoChecked}`);
    continuous.click();
    assert(continuous.getAttribute('aria-pressed') === 'false', 'continuous mode toggled off');
    // 下载已选: the fake CDN serves a small valid JPEG; anchor is intercepted.
    const zipBlobs = [];
    const anchorClicks = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-mock-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function recordClick() { anchorClicks.push({ download: this.download, href: this.href }); };
    document.getElementById('xhs-enhanced-batch-download').click();
    await checkpoint();
    await delay(100);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    assert(anchorClicks.length === 1, 'exactly one zip download triggered', `clicks=${anchorClicks.length}`);
    assert(/^XHS笔记_\d{8}_\d{4}_\d+篇\.zip$/.test(anchorClicks[0].download || ''), 'zip filename follows the template', anchorClicks[0].download);
    assert(zipBlobs.length === 1 && zipBlobs[0].type === 'application/zip' && zipBlobs[0].size > 64, 'zip blob built from fetched covers');
    api.clearTestSelection();
    assert(countNode.textContent.includes('0'), 'test clears its own selection');
  }

  async function batchScopeModeAndInnerImages() {
    api.clearTestSelection();
    api.setBatchScope('all');
    api.setTestRoute('/search_result?keyword=test');
    await useFixture('search-source', '#search-fixture');
    api.scan(); await checkpoint();
    // Scope segmented control renders; default is all.
    const coverBtn = document.getElementById('xhs-enhanced-batch-scope-cover');
    const innerBtn = document.getElementById('xhs-enhanced-batch-scope-inner');
    const allBtn = document.getElementById('xhs-enhanced-batch-scope-all');
    assert(coverBtn && innerBtn && allBtn, 'scope segmented control rendered');
    assert(allBtn.getAttribute('aria-pressed') === 'true', 'default scope is all');
    // Cover scope: the dual-anchor card's own data: image is downloaded.
    coverBtn.click();
    await checkpoint();
    assert(coverBtn.getAttribute('aria-pressed') === 'true' && allBtn.getAttribute('aria-pressed') === 'false', 'scope switches to cover');
    card('search-dual-anchor').querySelector('.xhs-enhanced-checkbox').click();
    await checkpoint();
    let anchorClicks = [];
    let zipBlobs = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-scope-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function recordClick() { anchorClicks.push({ download: this.download }); };
    document.getElementById('xhs-enhanced-batch-download').click();
    await checkpoint();
    await delay(250);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    assert(anchorClicks.length === 1, 'cover scope downloads exactly one zip');
    assert(zipBlobs.length === 1 && zipBlobs[0].type === 'application/zip', 'cover scope zip built');
    // Inner scope: images come from the note detail (fetchBytes text mock), not the card cover.
    innerBtn.click();
    await checkpoint();
    assert(innerBtn.getAttribute('aria-pressed') === 'true', 'scope switches to inner');
    anchorClicks = [];
    zipBlobs = [];
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-scope2-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function recordClick() { anchorClicks.push({ download: this.download }); };
    document.getElementById('xhs-enhanced-batch-download').click();
    await checkpoint();
    await delay(250);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const innerToast = () => {
      const node = document.getElementById('xhs-enhanced-copy-status');
      return node ? node.textContent : '';
    };
    assert(anchorClicks.length === 1, 'inner scope downloads exactly one zip', 'toast=' + innerToast() + ' clicks=' + anchorClicks.length);
    // The detail fixture carries two images; the card's data: cover must NOT be in there.
    assert(zipBlobs.length === 1 && zipBlobs[0].size > 120, 'inner scope zip holds detail images, not the card cover');
    // All scope: cover + inner = 3 images (card cover + 2 detail images)... note detail drives imageList[0] as cover.
    allBtn.click();
    await checkpoint();
    assert(allBtn.getAttribute('aria-pressed') === 'true', 'scope switches to all');
    anchorClicks = [];
    zipBlobs = [];
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-scope3-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function recordClick() { anchorClicks.push({ download: this.download }); };
    document.getElementById('xhs-enhanced-batch-download').click();
    await checkpoint();
    await delay(250);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    assert(anchorClicks.length === 1, 'all scope downloads exactly one zip');
    assert(zipBlobs.length === 1 && zipBlobs[0].size > 150, 'all scope zip holds cover + inner images');
    api.clearTestSelection();
    api.setBatchScope('all');
  }

  async function readZipNames(blob) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    const names = [];
    let offset = 0;
    while (offset + 4 <= buffer.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      const size = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      names.push(new TextDecoder().decode(new Uint8Array(buffer, offset + 30, nameLen)));
      offset += 30 + nameLen + extraLen + size;
    }
    return names;
  }

  async function batchLayoutFlatMode() {
    api.clearTestSelection();
    api.setTestRoute('/search_result?keyword=test');
    await useFixture('search-source', '#search-fixture');
    api.scan(); await checkpoint();
    api.setBatchScope('all');
    api.setBatchLayout('flat');
    card('search-dual-anchor').querySelector('.xhs-enhanced-checkbox').click();
    await checkpoint();
    const zipBlobs = [];
    const anchorClicks = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-layout-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function recordClick() { anchorClicks.push({ download: this.download }); };
    document.getElementById('xhs-enhanced-batch-download').click();
    await checkpoint();
    await delay(250);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    assert(anchorClicks.length === 1 && zipBlobs.length === 1, 'flat layout downloads exactly one zip');
    const names = await readZipNames(zipBlobs[0]);
    assert(names.length === 2, 'flat zip carries both detail images', JSON.stringify(names));
    assert(names.every(name => /^001_s1_/.test(name)), 'flat names carry seq and note id', JSON.stringify(names));
    assert(names.every(name => name.indexOf('/') === -1), 'flat layout has no folders', JSON.stringify(names));
    api.clearTestSelection();
    api.setBatchLayout('notes');
    assert(api.getBatchLayoutSnapshot() === 'notes', 'explicit notes layout round-trips');
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

      assert(prevButton() && prevButton().type === 'button' && prevButton().textContent === '上一条热门笔记', 'previous-note jump button is present and accessible on target route');
      assert(jumpNav() && document.querySelectorAll('#xhs-enhanced-jump-nav').length === 1 && prevButton().parentElement === jumpNav() && jumpButton().parentElement === jumpNav(), 'both jump buttons share one nav row');
      prevButton().click();
      assert((calls.get(above) || []).length === 1 && calls.get(above)[0].behavior === 'smooth' && calls.get(above)[0].block === 'center', 'previous jump selects nearest popular card above viewport');
      assert(!calls.has(visible) && !calls.has(partial), 'previous jump skips intersecting cards');

      setRect(above, 100, 300); setRect(visible, -310, -10);
      prevButton().click();
      assert((calls.get(visible) || []).length === 1, 'second previous jump advances after geometry changes');

      setRect(visible, 100, 300);
      prevButton().click();
      assert(scrollCalls.length === 3 && scrollCalls[2].behavior === 'smooth' && scrollCalls[2].top === 0, 'first popular note scrolls to document top');
      assert(statusNode() && statusNode().textContent === '已经是第一条热门笔记', 'first-note status message is shown');
      prevButton().click();
      assert(document.querySelectorAll('#xhs-enhanced-jump-status').length === 1, 'repeated first-note clicks reuse one status');

      const dynamic = makeCard('jump-dynamic', 101); setRect(dynamic, viewport + 10); dynamic.scrollIntoView = options => calls.set(dynamic, [options]); sandbox.appendChild(dynamic);
      await checkpoint(); jumpButton().click();
      assert((calls.get(dynamic) || []).length === 1 && !statusNode(), 'dynamic popular card becomes next target and clears status');

      api.setTestRoute('/explore/abc'); await checkpoint();
      assert(!jumpButton() && !prevButton() && !statusNode(), 'leaving supported route removes jump UI');
      api.setTestRoute('/user/profile/jump'); await checkpoint();
      assert(document.querySelectorAll('#xhs-enhanced-jump-next').length === 1, 'returning to supported route restores one jump button');
      assert(document.querySelectorAll('#xhs-enhanced-jump-prev').length === 1 && document.querySelectorAll('#xhs-enhanced-jump-nav').length === 1, 'returning restores one previous button in one nav row');
    } finally {
      globalThis.scrollTo = originalScrollTo;
    }
  }

  async function focusMode() {
    api.setTestRoute('/search_result');
    delete globalThis.__XHS_CHROME_STORE__['xhs-enhanced:focus-popular'];
    const hot = makeCard('focus-hot', 101);
    const cold = makeCard('focus-cold', 99);
    sandbox.replaceChildren(hot, cold);
    api.scan(); await checkpoint();
    const toggleNode = focusToggleNode();
    assert(toggleNode && toggleNode.type === 'button' && toggleNode.textContent === '只显示热门' && toggleNode.getAttribute('aria-label') === '只显示热门', 'focus toggle is present and labelled');
    assert(toggleNode.getAttribute('aria-pressed') === 'false', 'focus mode is off by default');
    assert(!dimmed(hot) && !dimmed(cold), 'no card is dimmed while focus mode is off');
    assert(focusToggleNode().parentElement === jumpNav(), 'focus toggle lives in the jump nav row');

    toggleNode.click(); await checkpoint();
    assert(toggleNode.getAttribute('aria-pressed') === 'true' && globalThis.__XHS_CHROME_STORE__['xhs-enhanced:focus-popular'] === '1', 'focus toggle turns on and persists');
    assert(popular(hot) && !dimmed(hot), 'popular card stays clear');
    assert(dimmed(cold), 'non-popular card is blurred when focus mode is on');
    assert(cold.isConnected && sandbox.contains(cold) && !cold.hasAttribute('hidden'), 'dimmed card stays in place as a placeholder');

    api.setThreshold('50'); api.scan(); await checkpoint();
    assert(!dimmed(cold) && popular(cold), 'lowering the threshold un-dims the formerly cold card');
    api.setThreshold('100'); api.scan(); await checkpoint();
    assert(dimmed(cold) && popular(hot) && !dimmed(hot), 'restoring the threshold re-dims without touching the popularity highlight');
    assert(document.getElementById('xhs-enhanced-style').textContent.indexOf('blur(') >= 0, 'dimming blur style is installed');

    api.setTestRoute('/explore/focus'); await checkpoint();
    assert(!focusToggleNode() && !dimmed(cold) && !dimmed(hot), 'leaving target route cleans toggle and dimming');
    api.setTestRoute('/search_result'); await checkpoint();
    const restored = focusToggleNode();
    assert(restored && restored.getAttribute('aria-pressed') === 'true' && dimmed(cold) && !dimmed(hot), 'focus state is restored from storage on return');

    restored.click(); await checkpoint();
    assert(restored.getAttribute('aria-pressed') === 'false' && !dimmed(cold) && globalThis.__XHS_CHROME_STORE__['xhs-enhanced:focus-popular'] === '0' && api.getFocusPopular() === false, 'focus toggle turns off, cleans dimming and persists the off state');
    delete globalThis.__XHS_CHROME_STORE__['xhs-enhanced:focus-popular'];
  }

  async function goodsSkuImages() {
    api.setTestRoute('/goods-detail/685d0fe3c16548001691655c');
    await checkpoint();
    const panel = document.getElementById('xhs-enhanced-goods-panel');
    assert(Boolean(panel), 'goods panel present for SKU test');
    const skuToggle = document.getElementById('xhs-enhanced-goods-sku');
    assert(Boolean(skuToggle) && skuToggle.checked, 'SKU checkbox exists and defaults to checked');
    sandbox.replaceChildren();
    const gallery = document.createElement('div');
    gallery.className = 'layout-swiper';
    const main = document.createElement('img');
    main.src = 'https://sns-webpic-qc.xhscdn.com/base1/1040g2goods0000000000000000000000000001!nd_dft_wlteh_webp_3';
    gallery.appendChild(main);
    // 真实页面里 `p.selected-text` 是 SKU 面板的入口；点击后页面请求签名接口，
    // 响应 template_data[] 带每个规格名 + 预览图。harness 用 postMessage 模拟响应。
    const skuAnchor = document.createElement('p');
    skuAnchor.className = 'selected-text';
    skuAnchor.textContent = '原创红色小羊';
    skuAnchor.addEventListener('click', () => {
      setTimeout(() => {
        window.postMessage({
          __xhsEnhancedSku: true,
          body: JSON.stringify({
            data: {
              template_data: [
                { contentE1: { variants: [{ value: '原创红色小羊' }] }, headerV4: { previewImage: 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng326sbj0dkk4a05phq89shol8ue0tjuj8?imageView2/2/w/1080/format/webp/q/80' } },
                { contentE1: { variants: [{ value: '原创白色小羊' }] }, headerV4: { previewImage: 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng3272jofqe6i705phq89shol8uid1b8og' } }
              ]
            }
          })
        }, '*');
      }, 30);
    });
    sandbox.append(gallery, skuAnchor);
    document.getElementById('xhs-enhanced-goods-scan').click();
    await checkpoint();
    const zipBlobs = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-sku-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function noop() {};
    document.getElementById('xhs-enhanced-goods-download').click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const status = document.getElementById('xhs-enhanced-goods-status');
      if (status && /已下载|失败/.test(status.textContent)) break;
      await delay(50);
    }
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const status = document.getElementById('xhs-enhanced-goods-status');
    assert(status && /SKU 图 2 张/.test(status.textContent), 'download status reports 2 SKU images', status ? status.textContent : '<none>');
    assert(zipBlobs.length === 1, 'one zip produced for SKU download');
    const text = new TextDecoder().decode(await zipBlobs[0].arrayBuffer());
    assert(text.includes('SKU_原创红色小羊_01.jpg'), 'zip contains per-spec filename for red sheep');
    assert(text.includes('SKU_原创白色小羊_01.jpg'), 'zip contains per-spec filename for white sheep');
    assert(text.includes('SKU 规格：') && text.includes('原创红色小羊 → SKU_原创红色小羊_01.jpg'), 'info.txt maps each spec to its file');

    // SKU 开关关闭后不再抓取规格图，zip 里也不该出现 SKU_ 前缀文件。
    skuToggle.checked = false;
    skuToggle.dispatchEvent(new Event('change'));
    await checkpoint();
    const secondBlobs = [];
    URL.createObjectURL = blob => { secondBlobs.push(blob); return 'blob:xhs-enhanced-sku-off-' + secondBlobs.length; };
    HTMLAnchorElement.prototype.click = function noop() {};
    document.getElementById('xhs-enhanced-goods-download').click();
    const deadline2 = Date.now() + 15000;
    while (Date.now() < deadline2) {
      const s = document.getElementById('xhs-enhanced-goods-status');
      if (s && /已下载|失败/.test(s.textContent)) break;
      await delay(50);
    }
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const text2 = secondBlobs.length ? new TextDecoder().decode(await secondBlobs[0].arrayBuffer()) : '';
    assert(!text2.includes('SKU_原创'), 'disabling SKU toggle omits SKU images from zip');
    skuToggle.checked = true;
    skuToggle.dispatchEvent(new Event('change'));
    api.setTestRoute('/search_result');
    await checkpoint();
  }

  async function goodsSkuDomFallback() {
    api.setTestRoute('/goods-detail/685d0fe3c16548001691655c');
    await checkpoint();
    assert(Boolean(document.getElementById('xhs-enhanced-goods-panel')), 'goods panel present for SKU fallback test');
    sandbox.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    const A = 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng326sbj0dkk4a05phq89shol8ue0tjuj8';
    const B = 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng3272jofqe6i705phq89shol8uid1b8og';
    const buildModal = currentSrc => {
      const modal = document.createElement('div');
      modal.className = 'mock-sku-modal';
      const qty = document.createElement('span'); qty.textContent = '数量'; modal.appendChild(qty);
      const closeWrap = document.createElement('div');
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
      closeWrap.appendChild(svg);
      closeWrap.addEventListener('click', () => modal.remove());
      modal.appendChild(closeWrap);
      const zoom = document.createElement('img');
      zoom.setAttribute('data-action', 'zoom'); zoom.src = currentSrc;
      modal.appendChild(zoom);
      for (const [name, url] of [['红色款', A], ['蓝色款', B]]) {
        const chip = document.createElement('span'); chip.textContent = name;
        chip.addEventListener('click', () => { zoom.src = url; });
        modal.appendChild(chip);
      }
      return modal;
    };
    const anchor = document.createElement('p');
    anchor.className = 'selected-text'; anchor.textContent = '红色款';
    anchor.addEventListener('click', () => {
      if (!document.querySelector('.mock-sku-modal')) sandbox.appendChild(buildModal(A));
    });
    sandbox.appendChild(buildModal(A));
    sandbox.appendChild(anchor);
    // 不派发 postMessage：钩子拿不到数据，必须走 DOM 点击兜底。
    const zipBlobs = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-sku-fb-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function noop() {};
    document.getElementById('xhs-enhanced-goods-download').click();
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const s = document.getElementById('xhs-enhanced-goods-status');
      if (s && /已下载|失败/.test(s.textContent)) break;
      await delay(50);
    }
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const status = document.getElementById('xhs-enhanced-goods-status');
    assert(status && /SKU 图 2 张/.test(status.textContent), 'DOM fallback yields both SKU specs', status ? status.textContent : '<none>');
    assert(zipBlobs.length === 1, 'one zip produced by DOM fallback');
    const text = new TextDecoder().decode(await zipBlobs[0].arrayBuffer());
    assert(text.includes('SKU_红色款_01.jpg') && text.includes('SKU_蓝色款_01.jpg'), 'DOM fallback zip contains both per-spec files');
    api.setTestRoute('/search_result');
    await checkpoint();
  }

  async function goodsDetailStitch() {
    api.setTestRoute('/goods-detail/685d0fe3c16548001691655c');
    await checkpoint();
    assert(Boolean(document.getElementById('xhs-enhanced-goods-panel')), 'goods panel present for stitch test');
    sandbox.replaceChildren();
    const detail = document.createElement('div');
    detail.className = 'graphic-detail-container';
    const upper = document.createElement('img');
    upper.src = 'https://mall-i1.xhscdn.com/b/stitch-a-0000000000000000000000000001';
    const lower = document.createElement('img');
    lower.src = 'https://mall-i1.xhscdn.com/b/stitch-b-0000000000000000000000000002';
    detail.append(upper, lower);
    sandbox.appendChild(detail);
    document.getElementById('xhs-enhanced-goods-scan').click();
    await checkpoint();
    const snapshot = api.getGoodsImagesSnapshot();
    const slices = snapshot.filter(entry => /stitch-[ab]/.test(entry.url));
    assert(slices.length === 2 && slices.every(entry => entry.section === 'detail'), 'scan finds both detail slices', JSON.stringify(snapshot));
    const zipBlobs = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { zipBlobs.push(blob); return 'blob:xhs-enhanced-stitch-' + zipBlobs.length; };
    HTMLAnchorElement.prototype.click = function noop() {};
    document.getElementById('xhs-enhanced-goods-download').click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const s = document.getElementById('xhs-enhanced-goods-status');
      if (s && /已下载|失败/.test(s.textContent)) break;
      await delay(50);
    }
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const status = document.getElementById('xhs-enhanced-goods-status');
    assert(status && /详情图拼接 1 组/.test(status.textContent), 'download reports one stitched detail group', status ? status.textContent : '<none>');
    assert(zipBlobs.length === 1, 'one zip produced');
    const bytes = new Uint8Array(await zipBlobs[0].arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    assert(text.includes('详情图_01.jpg') && !text.includes('详情图_02.jpg'), 'two slices become a single 详情图_01.jpg');
    // 从 zip 内嵌 JPEG 的 SOF 段读出尺寸，确认确实拼成 2000×2000。
    let soi = -1;
    for (let i = 0; i < bytes.length - 4; i += 1) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) { soi = i; break; }
    }
    let size = null;
    for (let i = soi + 2; soi >= 0 && i < bytes.length - 9; ) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        size = { w: (bytes[i + 7] << 8) | bytes[i + 8], h: (bytes[i + 5] << 8) | bytes[i + 6] };
        break;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (!len) break;
      i += 2 + len;
    }
    assert(size && size.w === 2000 && size.h === 2000, 'stitched JPEG is 2000x2000 (1500+500)', size ? JSON.stringify(size) : '<no jpeg>');
    api.setTestRoute('/search_result');
    await checkpoint();
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
    const originalPushState = history.pushState;
    const originalRaf = globalThis.requestAnimationFrame;
    const queuedRafs = [];
    globalThis.requestAnimationFrame = callback => { queuedRafs.push(callback); return queuedRafs.length; };
    api.scan();
    api.destroy();
    assert(!sandbox.querySelector('.xhs-enhanced-card--popular') && !document.getElementById('xhs-enhanced-style') && !jumpButton() && !prevButton() && !focusToggleNode() && !statusNode(), 'destroy cleans owned state and jump UI');
    assert(history.pushState === globalThis.__XHS_ORIGINAL_HISTORY__.pushState && history.replaceState === globalThis.__XHS_ORIGINAL_HISTORY__.replaceState, 'destroy leaves history methods untouched');
    api.init();
    const beforeStaleRaf = api.getCounters().batches;
    queuedRafs[0]();
    assert(api.getCounters().batches === beforeStaleRaf, 'stale animation-frame callback cannot flush a new lifecycle');
    queuedRafs[1]();
    assert(api.getCounters().batches === beforeStaleRaf + 1, 'current animation-frame callback flushes exactly once');
    globalThis.requestAnimationFrame = originalRaf;
    api.setTestRoute('/search_result'); api.scan(); await checkpoint();
    navigate('/search_result?generation=2'); await checkpoint();
    api.destroy();
    assert(history.pushState === globalThis.__XHS_ORIGINAL_HISTORY__.pushState, 'destroy leaves history methods untouched across lifecycles');
    api.init(); api.setTestRoute('/search_result'); api.scan(); await checkpoint();
    const pushIdentity = history.pushState; api.init();
    assert(document.querySelectorAll('#xhs-enhanced-style').length === 1 && document.querySelectorAll('#xhs-enhanced-jump-next').length === 1 && history.pushState === pushIdentity, 're-init creates one idempotent lifecycle');
    navigate('/search_result'); await checkpoint();
  }

  async function productionHistorySignals() {
    api.clearTestRoute(); await checkpoint();
    assert(location.pathname === '/search_result', 'browser harness starts on real supported pathname');
    // Isolated world: pushState alone is invisible to the content script; the
    // route change is detected on the DOM mutation + href comparison that a
    // real SPA navigation produces (mirrored by navigate()).
    const beforePush = api.getCounters().routeSignals;
    navigate('/explore/architect-route-test');
    await checkpoint();
    assert(api.getCounters().routeSignals === beforePush + 1 && !jumpButton(), 'SPA-style navigation produces one route signal and removes UI');
    const beforeReplace = api.getCounters().routeSignals;
    navigate('/user/profile/architect-route-test');
    await checkpoint();
    assert(api.getCounters().routeSignals === beforeReplace + 1 && document.querySelectorAll('#xhs-enhanced-jump-next').length === 1, 'back to a target route restores UI without duplication');
    const beforeFailure = api.getCounters().routeSignals;
    let threw = false;
    try { history.pushState({}, '', 'https://example.com/forbidden'); } catch { threw = true; }
    // A failed History call changes nothing; a DOM mutation must not invent a route signal.
    await checkpoint();
    assert(threw && api.getCounters().routeSignals === beforeFailure && location.pathname === '/user/profile/architect-route-test', 'failed History call preserves exception and emits no signal');
    navigate('/search_result'); await checkpoint();
  }

  async function goodsDetailDownload() {
    api.setTestRoute('/goods-detail/685d0fe3c16548001691655c');
    await checkpoint();
    const panel = document.getElementById('xhs-enhanced-goods-panel');
    assert(Boolean(panel), 'goods panel appears on goods-detail route');
    assert(document.getElementById('xhs-enhanced-goods-scan') && document.getElementById('xhs-enhanced-goods-download'), 'goods panel exposes scan and download buttons');
    assert(document.querySelectorAll('#xhs-enhanced-goods-format option').length === 3, 'goods format selector offers png/original/jpeg');
    // Product-gallery-like images plus a static JS asset and an avatar that
    // must be filtered out by the default scan. The gallery image sits in a
    // swiper container (→ 主图), the detail image in the graphic-detail
    // container (→ 详情图).
    sandbox.replaceChildren();
    const swiper = document.createElement('div');
    swiper.className = 'layout-swiper';
    const productImg = document.createElement('img');
    productImg.setAttribute('src', 'https://sns-webpic-qc.xhscdn.com/base1/1040g2goods0000000000000000000000000001!nd_dft_wlteh_webp_3');
    swiper.appendChild(productImg);
    const detailContainer = document.createElement('div');
    detailContainer.className = 'graphic-detail-container';
    const detailImg = document.createElement('img');
    detailImg.setAttribute('src', 'https://fe-img-qc.xhscdn.com/base2/1040g2goods0000000000000000000000000002?imageView2/2/w/1080/format/webp');
    detailContainer.appendChild(detailImg);
    const compressImg = document.createElement('img');
    compressImg.setAttribute('src', 'https://mall-i1.xhscdn.com/arkgoods/1040g2goods0000000000000000000000000009compress-target!nd_dft_wlteh_webp_3');
    swiper.appendChild(compressImg);
    const staticAsset = document.createElement('img');
    staticAsset.setAttribute('src', 'https://fe-static.xhscdn.com/formula-static/goods-detail/public/js/main.d4927ba.js');
    const avatarImg = document.createElement('img');
    avatarImg.setAttribute('src', 'https://sns-avatar-qc.xhscdn.com/avatar/1040g2goods0000000000000000000000000003');
    sandbox.append(swiper, detailContainer, staticAsset, avatarImg);
    document.getElementById('xhs-enhanced-goods-scan').click();
    await checkpoint();
    const snapshot = api.getGoodsImagesSnapshot();
    const productEntry = snapshot.find(u => u.url.includes('base1/1040g2goods0000000000000000000000000001'));
    const detailEntry = snapshot.find(u => u.url.includes('base2/1040g2goods0000000000000000000000000002'));
    assert(productEntry && productEntry.section === 'main', 'scan captures swiper image as 主图');
    assert(detailEntry && detailEntry.section === 'detail', 'scan captures graphic-detail image as 详情图');
    assert(!snapshot.some(u => /\.js($|\?|!)/.test(u.url)), 'scan rejects static JS assets on the CDN');
    assert(!snapshot.some(u => /avatar/i.test(u.url)), 'scan excludes decorative avatars by default');
    const countText = document.getElementById('xhs-enhanced-goods-count').textContent;
    assert(countText.includes('主图') && countText.includes('详情图'), 'count label shows section breakdown', countText);
    // Opt-in: decorative images can be included.
    const decor = document.getElementById('xhs-enhanced-goods-decorations');
    decor.checked = true;
    decor.dispatchEvent(new Event('change'));
    await checkpoint();
    assert(api.getGoodsImagesSnapshot().some(u => /avatar/i.test(u.url)), 'decorations toggle includes avatars');
    decor.checked = false;
    decor.dispatchEvent(new Event('change'));
    await checkpoint();
    assert(!api.getGoodsImagesSnapshot().some(u => /avatar/i.test(u.url)), 'decorations toggle restores filtering');
    // Format switch must not break the panel or the scan.
    const format = document.getElementById('xhs-enhanced-goods-format');
    format.value = 'jpeg';
    format.dispatchEvent(new Event('change'));
    await checkpoint();
    format.value = 'png';
    format.dispatchEvent(new Event('change'));
    await checkpoint();
    // Download: every fetched byte is the harness mock JPEG, so the zip flow
    // completes and the status line announces the save.
    document.getElementById('xhs-enhanced-goods-download').click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const status = document.getElementById('xhs-enhanced-goods-status');
      if (status && /已下载|下载失败|失败/.test(status.textContent)) break;
      await delay(50);
    }
    const finalStatus = document.getElementById('xhs-enhanced-goods-status');
    assert(finalStatus && /已下载/.test(finalStatus.textContent), 'download completes and reports the saved count', finalStatus ? finalStatus.textContent : '<no status node>');
    // Main-image compression: the big mock image must be re-encoded, and the
    // status line must announce it; the toggle defaults to checked.
    const compressToggle = document.getElementById('xhs-enhanced-goods-compress-main');
    assert(Boolean(compressToggle) && compressToggle.checked, 'compress-main checkbox defaults to checked');
    assert(/主图已压缩/.test(finalStatus.textContent), 'download re-encodes oversize main images', finalStatus.textContent);
    compressToggle.checked = false;
    compressToggle.dispatchEvent(new Event('change'));
    await checkpoint();
    document.getElementById('xhs-enhanced-goods-download').click();
    const secondDeadline = Date.now() + 15000;
    while (Date.now() < secondDeadline) {
      const s = document.getElementById('xhs-enhanced-goods-status');
      if (s && /已下载|失败/.test(s.textContent)) break;
      await delay(50);
    }
    const secondStatus = document.getElementById('xhs-enhanced-goods-status');
    assert(secondStatus && !/主图已压缩/.test(secondStatus.textContent), 'disabling compress-main keeps original bytes', secondStatus ? secondStatus.textContent : '<no status node>');
    compressToggle.checked = true;
    compressToggle.dispatchEvent(new Event('change'));
    // Leaving the goods route removes the panel (SPA navigation safety).
    api.setTestRoute('/search_result');
    await checkpoint();
    assert(!document.getElementById('xhs-enhanced-goods-panel'), 'leaving goods-detail removes the panel');
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

  const suiteTimeout = setTimeout(() => { failures.push('suite timeout'); finish('fail'); }, 45000);
  (async () => {
    try {
      assert(Boolean(api), 'test API installed');
      await initialAndIdempotent();
      await profile();
      await popularThresholdConfiguration();
      await librarySync();
      await batchSelectionAndDownload();
      await batchScopeModeAndInnerImages();
      await batchLayoutFlatMode();
      await goodsDetailDownload();
      await goodsSkuImages();
      await goodsSkuDomFallback();
      await goodsDetailStitch();
      await dynamicAndAttributes();
      await jumpNavigation();
      await focusMode();
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
