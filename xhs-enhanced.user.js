// ==UserScript==
// @name         小红书网页版增强
// @namespace    https://github.com/mufeng510/XHS_Enhanced
// @version      1.1.0
// @description  高亮热门笔记（点赞数 > 100）并快速跳转到下一条热门笔记
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.xiaohongshu.com/user/profile/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/mufeng510/XHS_Enhanced
// @supportURL   https://github.com/mufeng510/XHS_Enhanced/issues
// @updateURL    https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
// @downloadURL  https://github.com/mufeng510/XHS_Enhanced/raw/main/xhs-enhanced.user.js
// @license      MIT
// @author       mufeng510
// ==/UserScript==

(function () {
  'use strict';

  const ROOT = globalThis;
  const TEST_MODE = ROOT.__XHS_ENHANCED_TEST_MODE__ === true;
  const THRESHOLD = 100;
  const STYLE_ID = 'xhs-enhanced-style';
  const CARD_CLASS = 'xhs-enhanced-card--popular';
  const LIKE_CLASS = 'xhs-enhanced-like--popular';
  const SIGNATURE_ATTRIBUTE = 'data-xhs-enhanced-signature';
  const JUMP_BUTTON_ID = 'xhs-enhanced-jump-next';
  const JUMP_STATUS_ID = 'xhs-enhanced-jump-status';
  const JUMP_BUTTON_TEXT = '下一条热门笔记';
  const LAST_NOTE_TEXT = '已经是最后一条热门笔记';

  const SELECTORS = Object.freeze({
    noteLinks: 'a[href*="/explore/"],a[href*="/discovery/item/"]',
    cardContainers: '[data-note-card],article.note-item,section.note-item,.note-item',
    likeNodes: '[data-like-count],[data-xhs-like-count],[aria-label*="点赞"],[title*="点赞"],.like-wrapper .count,.like-count',
    contentRoots: '[data-note-list],.feeds-page,.note-list,main'
  });
  const READ_ATTRIBUTES = Object.freeze([
    'aria-label', 'title', 'data-like-count', 'data-xhs-like-count'
  ]);

  let routeProvider = null;
  let observer = null;
  let structureObserver = null;
  let observerRoot = null;
  let scheduled = false;
  let destroyed = true;
  let initialized = false;
  let lifecycleToken = null;
  let lastUrl = '';
  let jumpButton = null;
  let jumpStatus = null;
  let jumpStatusTimer = null;
  let originalPushState = null;
  let originalReplaceState = null;
  let ownedPushState = null;
  let ownedReplaceState = null;
  const pending = new Set();
  const counters = { batches: 0, processed: 0, fullScans: 0, routeSignals: 0 };
  const eventBindings = [];

  function normalizeSpace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function parseLikeCount(input) {
    const original = normalizeSpace(input);
    if (!original) return { ok: false, reason: 'empty' };
    const groupedInteger = /^(?:\d+|\d{1,3}(?:[ ,，]\d{3})+)$/.test(original);
    const suffixedNumber = /^\d+(?:\.\d+)?[万萬wWkK]$/.test(original);
    if (!groupedInteger && !suffixedNumber) return { ok: false, reason: 'unsupported' };
    const compact = original.replace(/[\s,，]/g, '');
    const match = compact.match(/^(\d+(?:\.\d+)?)([万萬wWkK]?)$/);
    if (!match) return { ok: false, reason: 'unsupported' };
    const number = Number(match[1]);
    const multiplier = /[万萬]/.test(match[2]) ? 10000 : /[wW]/.test(match[2]) ? 10000 : /[kK]/.test(match[2]) ? 1000 : 1;
    const value = number * multiplier;
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: 'invalid' };
    return { ok: true, value, normalized: compact.toLowerCase() };
  }

  function isTargetRoute(pathname) {
    const path = String(pathname || '').split('?')[0];
    return path === '/search_result' || path.startsWith('/user/profile/');
  }

  function getCurrentRoute() {
    if (TEST_MODE && routeProvider) return String(routeProvider() || '');
    return ROOT.location ? ROOT.location.pathname : '';
  }

  function getAttributeSource(node, names) {
    for (const name of names) {
      const value = node.getAttribute(name);
      if (normalizeSpace(value)) return value;
    }
    return '';
  }

  function extractLike(card) {
    const nodes = Array.from(card.querySelectorAll(SELECTORS.likeNodes));
    for (const node of nodes) {
      const explicit = getAttributeSource(node, ['data-like-count', 'data-xhs-like-count']);
      const labelled = getAttributeSource(node, ['aria-label', 'title']).replace(/^.*?点赞[：:\s]*/u, '');
      const candidates = [explicit, labelled, node.textContent];
      for (const candidate of candidates) {
        const parsed = parseLikeCount(candidate);
        if (parsed.ok) return { node, parsed, raw: normalizeSpace(candidate) };
      }
    }
    return null;
  }

  function isReliableCard(card) {
    if (!card || !card.querySelector) return false;
    const links = card.querySelectorAll(SELECTORS.noteLinks);
    return links.length === 1 && Boolean(card.querySelector(SELECTORS.likeNodes));
  }

  function findCard(node) {
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return null;
    const card = element.closest(SELECTORS.cardContainers);
    return isReliableCard(card) ? card : null;
  }

  function discoverCards(root) {
    if (!root || !root.querySelectorAll) return [];
    const cards = new Set();
    if (root.matches && root.matches(SELECTORS.cardContainers) && isReliableCard(root)) cards.add(root);
    for (const link of root.querySelectorAll(SELECTORS.noteLinks)) {
      const card = findCard(link);
      if (card) cards.add(card);
    }
    return Array.from(cards);
  }

  function signatureFor(route, likeRaw) {
    return `${route}\u001f${likeRaw || ''}`;
  }

  function ensureStyle() {
    if (!ROOT.document || ROOT.document.getElementById(STYLE_ID)) return;
    const style = ROOT.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS}{outline:2px solid #ff2442!important;background:rgba(255,36,66,.07)!important;box-shadow:0 2px 10px rgba(255,36,66,.14)!important}
      .${LIKE_CLASS}{color:#ff2442!important;font-weight:700!important}
      #${JUMP_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${JUMP_BUTTON_ID}:hover{background:#e61e3c}#${JUMP_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${JUMP_STATUS_ID}{position:fixed;top:138px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
    `;
    (ROOT.document.head || ROOT.document.documentElement).appendChild(style);
  }

  function renderCard(card) {
    if (!card || !card.isConnected) return;
    const like = extractLike(card);
    const route = getCurrentRoute();
    const signature = signatureFor(route, like ? like.raw : '');
    const popular = Boolean(like && like.parsed.value > THRESHOLD);

    card.classList.toggle(CARD_CLASS, popular);
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);

    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    counters.processed += 1;
  }

  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
    card.removeAttribute(SIGNATURE_ATTRIBUTE);
    for (const node of card.querySelectorAll(`.${LIKE_CLASS}`)) node.classList.remove(LIKE_CLASS);
  }

  function cleanupAll() {
    if (!ROOT.document) return;
    for (const card of ROOT.document.querySelectorAll(`.${CARD_CLASS},[${SIGNATURE_ATTRIBUTE}]`)) cleanupCard(card);
  }

  function selectNextPopularCard(cards, viewportHeight) {
    let selected = null;
    let selectedTop = Infinity;
    for (const card of cards || []) {
      if (!card || !card.isConnected || !card.classList || !card.classList.contains(CARD_CLASS) || typeof card.getBoundingClientRect !== 'function') continue;
      const rect = card.getBoundingClientRect();
      const top = Number(rect && rect.top);
      if (!Number.isFinite(top) || top < viewportHeight || top >= selectedTop) continue;
      selected = card;
      selectedTop = top;
    }
    return selected;
  }

  function clearJumpStatus() {
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = null;
    const node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document && ROOT.document.getElementById(JUMP_STATUS_ID);
    if (node) node.remove();
    jumpStatus = null;
  }

  function showJumpStatus() {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document.getElementById(JUMP_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement('div');
      node.id = JUMP_STATUS_ID;
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.textContent = LAST_NOTE_TEXT;
      ROOT.document.body.appendChild(node);
    }
    jumpStatus = node;
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = ROOT.setTimeout(() => { jumpStatusTimer = null; clearJumpStatus(); }, 3000);
  }

  function jumpToNextPopularCard() {
    if (!ROOT.document) return;
    const viewportHeight = ROOT.innerHeight || ROOT.document.documentElement.clientHeight || 0;
    const target = selectNextPopularCard(ROOT.document.querySelectorAll(`.${CARD_CLASS}`), viewportHeight);
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const documentElement = ROOT.document.documentElement;
    const body = ROOT.document.body;
    const bottom = Math.max(documentElement ? documentElement.scrollHeight : 0, body ? body.scrollHeight : 0);
    if (typeof ROOT.scrollTo === 'function') ROOT.scrollTo({ top: bottom, behavior: 'smooth' });
    showJumpStatus();
  }

  function ensureJumpUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement('button');
      button.id = JUMP_BUTTON_ID;
      button.type = 'button';
      button.textContent = JUMP_BUTTON_TEXT;
      button.setAttribute('aria-label', JUMP_BUTTON_TEXT);
      button.addEventListener('click', jumpToNextPopularCard);
      ROOT.document.body.appendChild(button);
    }
    jumpButton = button;
  }

  function removeJumpUi() {
    clearJumpStatus();
    const button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document && ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (button) {
      button.removeEventListener('click', jumpToNextPopularCard);
      button.remove();
    }
    jumpButton = null;
  }

  function syncJumpUi() {
    if (isTargetRoute(getCurrentRoute())) ensureJumpUi();
    else removeJumpUi();
  }

  function flush() {
    scheduled = false;
    if (destroyed || !ROOT.document) return;
    counters.batches += 1;
    syncJumpUi();
    const url = ROOT.location ? ROOT.location.href : getCurrentRoute();
    if (url !== lastUrl) {
      lastUrl = url;
      if (!isTargetRoute(getCurrentRoute())) cleanupAll();
      else for (const card of discoverCards(ROOT.document)) pending.add(card);
    }
    if (!isTargetRoute(getCurrentRoute())) {
      pending.clear();
      cleanupAll();
      return;
    }
    const batch = Array.from(pending);
    pending.clear();
    for (const candidate of batch) {
      const card = findCard(candidate) || (isReliableCard(candidate) ? candidate : null);
      if (card) renderCard(card);
    }
  }

  function schedule(root) {
    if (destroyed) return;
    if (root) {
      const card = findCard(root);
      if (card) pending.add(card);
      else for (const found of discoverCards(root)) pending.add(found);
    }
    if (scheduled) return;
    scheduled = true;
    const token = lifecycleToken;
    const run = () => {
      if (!token || !token.active || lifecycleToken !== token) return;
      flush();
    };
    if (typeof ROOT.requestAnimationFrame === 'function') ROOT.requestAnimationFrame(run);
    else Promise.resolve().then(run);
  }

  function scan(root) {
    if (!ROOT.document || !isTargetRoute(getCurrentRoute())) return;
    counters.fullScans += 1;
    for (const card of discoverCards(root || ROOT.document)) pending.add(card);
    schedule();
  }

  function mutationCallback(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' || mutation.type === 'characterData') schedule(mutation.target);
      else {
        schedule(mutation.target);
        for (const node of mutation.addedNodes) schedule(node);
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== 1) continue;
          node.classList.remove(LIKE_CLASS, CARD_CLASS);
          node.removeAttribute(SIGNATURE_ATTRIBUTE);
          for (const stale of node.querySelectorAll(`.${LIKE_CLASS}`)) stale.classList.remove(LIKE_CLASS);
        }
      }
    }
  }

  function bind(target, type, handler) {
    target.addEventListener(type, handler);
    eventBindings.push([target, type, handler]);
  }

  function selectObserverRoot() {
    return ROOT.document.querySelector(SELECTORS.contentRoots) || ROOT.document.body;
  }

  function bindObserverRoot(nextRoot) {
    if (nextRoot === observerRoot && observer) return false;
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = nextRoot || null;
    if (!observerRoot || typeof ROOT.MutationObserver !== 'function') return false;
    observer = new ROOT.MutationObserver(mutationCallback);
    observer.observe(observerRoot, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: READ_ATTRIBUTES.slice() });
    return true;
  }

  function structureMutationCallback() {
    const nextRoot = selectObserverRoot();
    if (nextRoot === observerRoot && observerRoot && observerRoot.isConnected) return;
    if (bindObserverRoot(nextRoot)) scan(nextRoot);
  }

  function signalRoute() {
    if (destroyed) return;
    counters.routeSignals += 1;
    lastUrl = '';
    scan(ROOT.document);
    schedule();
  }

  function installHistorySignals() {
    if (!ROOT.history) return;
    originalPushState = ROOT.history.pushState;
    originalReplaceState = ROOT.history.replaceState;
    const upstreamPushState = originalPushState;
    const upstreamReplaceState = originalReplaceState;
    const token = lifecycleToken;
    ownedPushState = function (...args) {
      const result = upstreamPushState.apply(this, args);
      if (token && token.active && lifecycleToken === token) signalRoute();
      return result;
    };
    ownedReplaceState = function (...args) {
      const result = upstreamReplaceState.apply(this, args);
      if (token && token.active && lifecycleToken === token) signalRoute();
      return result;
    };
    ROOT.history.pushState = ownedPushState;
    ROOT.history.replaceState = ownedReplaceState;
  }

  function restoreHistorySignals() {
    if (ROOT.history) {
      if (ROOT.history.pushState === ownedPushState) ROOT.history.pushState = originalPushState;
      if (ROOT.history.replaceState === ownedReplaceState) ROOT.history.replaceState = originalReplaceState;
    }
    originalPushState = null;
    originalReplaceState = null;
    ownedPushState = null;
    ownedReplaceState = null;
  }

  function init() {
    if (!ROOT.document || initialized) return;
    initialized = true;
    lifecycleToken = { active: true };
    destroyed = false;
    ensureStyle();
    bindObserverRoot(selectObserverRoot());
    if (ROOT.document.documentElement && typeof ROOT.MutationObserver === 'function') {
      structureObserver = new ROOT.MutationObserver(structureMutationCallback);
      structureObserver.observe(ROOT.document.documentElement, { childList: true, subtree: true });
    }
    bind(ROOT, 'popstate', signalRoute);
    bind(ROOT, 'hashchange', signalRoute);
    bind(ROOT.document, 'visibilitychange', signalRoute);
    installHistorySignals();
    lastUrl = '';
    scan(ROOT.document);
    syncJumpUi();
  }

  function destroy() {
    if (!initialized) return;
    initialized = false;
    if (lifecycleToken) lifecycleToken.active = false;
    lifecycleToken = null;
    destroyed = true;
    scheduled = false;
    pending.clear();
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
    restoreHistorySignals();
    removeJumpUi();
    cleanupAll();
    const style = ROOT.document && ROOT.document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  const pureApi = Object.freeze({
    parseLikeCount, isTargetRoute, getCurrentRoute, signatureFor, selectNextPopularCard,
    READ_ATTRIBUTES, SELECTORS
  });

  if (TEST_MODE) {
    ROOT.__XHS_ENHANCED_TEST_API__ = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) { routeProvider = () => String(pathname || ''); lastUrl = ''; if (scheduleChange) schedule(ROOT.document); },
      clearTestRoute() { routeProvider = null; lastUrl = ''; schedule(ROOT.document); },
      scan: () => scan(ROOT.document), flush, init, destroy,
      getCounters: () => Object.assign({}, counters, { bindings: eventBindings.length, ownedHistoryWrappers: Number(Boolean(ownedPushState)) + Number(Boolean(ownedReplaceState)), observerRootIsBody: observerRoot === ROOT.document.body })
    });
  }

  if (ROOT.document) init();
}());
