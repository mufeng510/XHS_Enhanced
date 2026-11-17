(() => {
  // src/lib/remote.js
  var FETCH_MESSAGE = "xhs-enhanced:fetch";
  var COLLECT_NOTE_VIA_TAB_MESSAGE = "xhs-enhanced:collect-note-via-tab";
  var COLLECT_NOTE_MESSAGE = "xhs-enhanced:collect-note";

  // src/background/index.js
  var MAX_BODY_BYTES = 32 * 1024 * 1024;
  var STATIC_EXACT_HOSTS = /* @__PURE__ */ new Set(["ci.xiaohongshu.com", "img.xiaohongshu.com", "qimg.xiaohongshu.com"]);
  var SAFE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD"]);
  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  }
  function isStaticCdn(url, method) {
    if (!SAFE_METHODS.has(method)) return false;
    if (!/^https:\/\//i.test(url)) return false;
    if (STATIC_EXACT_HOSTS.has(hostOf(url))) return true;
    return /^https:\/\/(?:[a-z0-9-]+\.)+xhscdn\.com(?::\d+)?(?:\/|$)/i.test(url) || /^https:\/\/xhscdn\.com(?::\d+)?(?:\/|$)/i.test(url);
  }
  function originPattern(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.origin + "/*";
    } catch (_) {
      return "";
    }
  }
  async function isAllowed(url, method) {
    if (isStaticCdn(url, method)) return true;
    const pattern = originPattern(url);
    if (!pattern) return false;
    try {
      return await chrome.permissions.contains({ origins: [pattern] });
    } catch (_) {
      return false;
    }
  }
  function base64FromBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 32768;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      const slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }
  function contentLengthOf(response) {
    try {
      const header = response.headers && typeof response.headers.get === "function" ? response.headers.get("content-length") : null;
      const size = Number(header);
      return Number.isFinite(size) && size >= 0 ? size : -1;
    } catch (_) {
      return -1;
    }
  }
  async function handleFetch(request, sender) {
    const runtimeId = chrome.runtime && chrome.runtime.id;
    if (runtimeId && sender && sender.id && sender.id !== runtimeId) {
      return { ok: false, status: 0, error: "forbidden" };
    }
    const url = String(request.url || "");
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, status: 0, error: "network" };
    }
    const method = String(request.method || "GET").toUpperCase();
    if (!await isAllowed(url, method)) {
      return { ok: false, status: 0, error: "permission" };
    }
    const headers = request.headers && typeof request.headers === "object" ? request.headers : {};
    const timeout = Number(request.timeout) > 0 ? Math.min(Number(request.timeout), 6e4) : 2e4;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const fetchInit = {
        method,
        headers,
        credentials: "include",
        redirect: "follow",
        signal: controller.signal
      };
      if (typeof request.data === "string") fetchInit.body = request.data;
      const response = await fetch(url, fetchInit);
      const declaredLength = contentLengthOf(response);
      if (declaredLength > MAX_BODY_BYTES) {
        return { ok: false, status: response.status, error: "too-large" };
      }
      if (request.responseType === "arraybuffer") {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_BODY_BYTES) {
          return { ok: false, status: response.status, error: "too-large" };
        }
        return {
          ok: response.ok,
          status: response.status,
          base64: base64FromBuffer(buffer),
          contentType: response.headers.get("content-type") || "",
          error: response.ok ? "" : "http"
        };
      }
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text: text.slice(0, MAX_BODY_BYTES),
        error: response.ok ? "" : "http"
      };
    } catch (error) {
      const aborted = error && (error.name === "AbortError" || error.code === 20);
      return { ok: false, status: 0, error: aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  async function handleCollectNoteViaTab(request) {
    const link = String(request && request.link || "");
    if (!/^https:\/\/(?:[a-z0-9-]+\.)+xiaohongshu\.com\//i.test(link)) {
      return { ok: false, error: "forbidden" };
    }
    const tabsApi = chrome.tabs;
    if (!tabsApi || typeof tabsApi.create !== "function" || typeof tabsApi.sendMessage !== "function") {
      return { ok: false, error: "unavailable" };
    }
    let tab;
    try {
      tab = await tabsApi.create({ url: link, active: false });
    } catch (_) {
      return { ok: false, error: "tab-create-failed" };
    }
    const tabId = tab && typeof tab.id === "number" ? tab.id : null;
    if (tabId == null) {
      try {
        if (tabsApi.remove) await tabsApi.remove(tab.id);
      } catch (_) {
      }
      return { ok: false, error: "tab-create-failed" };
    }
    try {
      const deadline = Date.now() + 25e3;
      let lastError = "timeout";
      while (Date.now() < deadline) {
        try {
          const response = await tabsApi.sendMessage(tabId, { type: COLLECT_NOTE_MESSAGE });
          if (response && response.ok && response.note && Array.isArray(response.note.imageList)) {
            return { ok: true, note: response.note, source: "tab" };
          }
          lastError = response && response.error || "no-state";
          if (response && response.error === "no-state") break;
          await sleep(700);
        } catch (_) {
          lastError = "unreachable";
          await sleep(400);
        }
      }
      return { ok: false, error: lastError };
    } finally {
      try {
        await tabsApi.remove(tabId);
      } catch (_) {
      }
    }
  }
  function openOptionsPageFromBackground() {
    try {
      const runtime = chrome.runtime;
      if (runtime && typeof runtime.openOptionsPage === "function") {
        runtime.openOptionsPage();
        return;
      }
    } catch (_) {
    }
    try {
      if (chrome.tabs && typeof chrome.tabs.create === "function" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
        chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
      }
    } catch (_) {
    }
  }
  try {
    const action = chrome.action;
    if (action && action.onClicked && typeof action.onClicked.addListener === "function") {
      action.onClicked.addListener(() => openOptionsPageFromBackground());
    }
  } catch (_) {
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return void 0;
    if (message.type === FETCH_MESSAGE) {
      handleFetch(message, sender || {}).then(sendResponse, () => sendResponse({ ok: false, status: 0, error: "network" }));
      return true;
    }
    if (message.type === COLLECT_NOTE_VIA_TAB_MESSAGE) {
      const runtimeId = chrome.runtime && chrome.runtime.id;
      if (runtimeId && sender && sender.id && sender.id !== runtimeId) {
        sendResponse({ ok: false, error: "forbidden" });
        return false;
      }
      handleCollectNoteViaTab(message).then(sendResponse, () => sendResponse({ ok: false, error: "network" }));
      return true;
    }
    return void 0;
  });
})();
