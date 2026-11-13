(() => {
  // src/lib/env.js
  function getRoot() {
    return globalThis;
  }
  function isTestMode() {
    return globalThis.__XHS_ENHANCED_TEST_MODE__ === true;
  }
  function getChrome() {
    try {
      const candidate = globalThis.chrome;
      if (candidate && typeof candidate === "object") return candidate;
    } catch (_) {
    }
    return null;
  }
  function getLocalStorage() {
    try {
      return globalThis.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  // src/lib/text.js
  function normalizeSpace(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  // src/lib/pure.js
  var DEFAULT_THRESHOLD = 100;
  var THRESHOLD_STORAGE_KEY = "xhs-enhanced:popular-threshold";
  var FOCUS_STORAGE_KEY = "xhs-enhanced:focus-popular";
  var SHARE_BASE = "https://www.xiaohongshu.com/";
  var XSEC_TOKEN_QUERY = "xsec_token";
  var XSEC_SOURCE_VALUE = "pc_feed";
  var NOTE_ID_PATTERN = /\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9]+)/;
  var DETAIL_ROUTE_PATTERN = /^\/(?:explore|discovery\/item|search_result)\/[A-Za-z0-9]+$|^\/user\/profile\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;
  function parseThreshold(value) {
    const text = String(value == null ? "" : value);
    if (!/^(?:0|[1-9]\d*)$/.test(text)) return { ok: false };
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false };
  }
  function parseLikeCount(input) {
    const original = normalizeSpace(input);
    if (!original) return { ok: false, reason: "empty" };
    const groupedInteger = /^(?:\d+|\d{1,3}(?:[ ,，]\d{3})+)$/.test(original);
    const suffixedNumber = /^\d+(?:\.\d+)?[万萬wWkK]$/.test(original);
    if (!groupedInteger && !suffixedNumber) return { ok: false, reason: "unsupported" };
    const compact = original.replace(/[\s,，]/g, "");
    const match = compact.match(/^(\d+(?:\.\d+)?)([万萬wWkK]?)$/);
    if (!match) return { ok: false, reason: "unsupported" };
    const number = Number(match[1]);
    const multiplier = /[万萬]/.test(match[2]) ? 1e4 : /[wW]/.test(match[2]) ? 1e4 : /[kK]/.test(match[2]) ? 1e3 : 1;
    const value = number * multiplier;
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: "invalid" };
    return { ok: true, value, normalized: compact.toLowerCase() };
  }
  function isTargetRoute(pathname) {
    const path = String(pathname || "").split("?")[0].replace(/\/+$/, "");
    return path === "/search_result" || path === "/explore" || path.startsWith("/user/profile/");
  }
  function isProfileRoute(pathname) {
    const path = String(pathname || "").split("?")[0];
    return path.startsWith("/user/profile/");
  }
  function isDetailRoute(pathname) {
    const path = String(pathname || "").split("?")[0];
    return DETAIL_ROUTE_PATTERN.test(path);
  }
  function getNoteIdFromHref(href) {
    const text = String(href == null ? "" : href);
    if (!text) return "";
    const match = text.match(NOTE_ID_PATTERN);
    return match ? match[1] : "";
  }
  function parseQueryValue(query, key) {
    if (!query || !key) return "";
    const text = String(query);
    const match = text.match(new RegExp("[?&]" + key + "=([^&\\s#]+)"));
    if (!match) return "";
    try {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch (_) {
      return "";
    }
  }
  function getXsecTokenFromHref(href) {
    const text = String(href == null ? "" : href);
    return parseQueryValue(text, XSEC_TOKEN_QUERY);
  }
  function collectTokensFromStateObject(value, map, depth, seen) {
    if (!value || depth > 12) return;
    if (typeof value !== "object") return;
    if (seen) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) collectTokensFromStateObject(value[i], map, depth + 1, seen);
      return;
    }
    const id = typeof value.noteId === "string" ? value.noteId : typeof value.id === "string" ? value.id : "";
    const token = typeof value.xsecToken === "string" ? value.xsecToken : "";
    if (id && token && !map[id]) map[id] = token;
    const keys = Object.keys(value);
    const preferred = [];
    const rest = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === "notes" || key === "note" || key === "noteCard" || key === "noteDetailMap" || key === "user" || key === "feed") preferred.push(key);
      else rest.push(key);
    }
    const ordered = preferred.length ? preferred.concat(rest) : keys;
    for (let i = 0; i < ordered.length; i += 1) collectTokensFromStateObject(value[ordered[i]], map, depth + 1, seen);
  }
  function findTokenForNoteIdInState(value, noteId, depth, seen) {
    if (!value || !noteId || depth > 12) return "";
    if (typeof value !== "object") return "";
    if (seen) {
      if (seen.has(value)) return "";
      seen.add(value);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = findTokenForNoteIdInState(value[i], noteId, depth + 1, seen);
        if (found) return found;
      }
      return "";
    }
    const id = typeof value.noteId === "string" ? value.noteId : typeof value.id === "string" ? value.id : "";
    const token = typeof value.xsecToken === "string" ? value.xsecToken : "";
    if (id === noteId && token) return token;
    const keys = Object.keys(value);
    const preferred = [];
    const rest = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === "notes" || key === "note" || key === "noteCard" || key === "noteDetailMap" || key === "user" || key === "feed" || key === noteId) preferred.push(key);
      else rest.push(key);
    }
    const ordered = preferred.length ? preferred.concat(rest) : keys;
    for (let i = 0; i < ordered.length; i += 1) {
      const found = findTokenForNoteIdInState(value[ordered[i]], noteId, depth + 1, seen);
      if (found) return found;
    }
    return "";
  }
  function parseInitialStateFromScriptText(text) {
    const source = String(text == null ? "" : text);
    if (!source || source.indexOf("__INITIAL_STATE__") < 0) return null;
    const anchor = source.indexOf("__INITIAL_STATE__");
    const eq = source.indexOf("=", anchor);
    if (eq < 0) return null;
    let start = eq + 1;
    while (start < source.length && source[start] !== "{" && source[start] !== "[") {
      if (!/[\s]/.test(source[start])) {
        if (/[a-zA-Z_$]/.test(source[start])) return null;
      }
      start += 1;
    }
    if (start >= source.length) return null;
    const end = scanBalancedObject(source, start);
    if (end < 0) return null;
    const jsonText = source.slice(start, end + 1);
    try {
      return JSON.parse(jsonText);
    } catch (_) {
      try {
        return JSON.parse(jsonText.replace(/\bundefined\b/g, "null"));
      } catch (__) {
        return null;
      }
    }
  }
  function scanBalancedObject(source, start) {
    const stack = [source[start]];
    let inString = false;
    let escaped = false;
    for (let i = start + 1; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }
      if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (ch === "}" && open !== "{") return -1;
        if (ch === "]" && open !== "[") return -1;
        if (!stack.length) return i;
      }
    }
    return -1;
  }
  function buildShareLink(id, token) {
    if (!id) return "";
    const link = SHARE_BASE + "explore/" + id;
    if (token) return link + "?" + XSEC_TOKEN_QUERY + "=" + encodeURIComponent(token) + "&xsec_source=" + XSEC_SOURCE_VALUE;
    return link;
  }
  function signatureFor(route, likeRaw) {
    return `${route}${likeRaw || ""}`;
  }
  function toNoWatermarkCoverUrl(input, base) {
    const raw = normalizeSpace(input);
    if (!raw) return "";
    if (/^(?:data:|blob:)/i.test(raw)) return raw;
    try {
      const pageBase = base || globalThis.location && globalThis.location.href || SHARE_BASE;
      const url = new URL(raw, pageBase);
      url.pathname = url.pathname.replace(/!.*$/, "");
      if (/imageview2|x-oss-process|watermark/i.test(url.search)) {
        url.search = "";
      } else {
        const dropKeys = [];
        url.searchParams.forEach((value, key) => {
          const k = String(key).toLowerCase();
          const v = String(value).toLowerCase();
          if (k.indexOf("imageview") >= 0 || v.indexOf("imageview") >= 0) dropKeys.push(key);
          if (k === "x-oss-process" || k.indexOf("watermark") >= 0) dropKeys.push(key);
        });
        for (const key of dropKeys) url.searchParams.delete(key);
      }
      return url.toString();
    } catch (_) {
      return raw.replace(/![^/?#]*/g, "").replace(/[?&](?:imageView2|x-oss-process|watermark)[^#]*/ig, "");
    }
  }
  function pickLargestFromSrcset(srcset) {
    const text = normalizeSpace(srcset);
    if (!text) return "";
    let bestUrl = "";
    let bestScore = -1;
    for (const part of text.split(",")) {
      const bits = normalizeSpace(part).split(/\s+/);
      if (!bits.length || !bits[0]) continue;
      const url = bits[0];
      let score = 0;
      const desc = bits[1] || "";
      const w = desc.match(/(\d+)w/i);
      const x = desc.match(/([\d.]+)x/i);
      if (w) score = Number(w[1]) || 0;
      else if (x) score = Math.round((Number(x[1]) || 0) * 1e3);
      else score = 1;
      if (score >= bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    }
    return bestUrl;
  }
  function toCdnObjectPath(input, base) {
    const raw = normalizeSpace(input);
    if (!raw || /^(?:data:|blob:)/i.test(raw)) return "";
    let path = "";
    try {
      const pageBase = base || globalThis.location && globalThis.location.href || SHARE_BASE;
      path = new URL(raw, pageBase).pathname;
    } catch (_) {
      path = raw.split("#")[0].split("?")[0];
    }
    path = String(path).replace(/!.*$/, "").replace(/^\/+/, "");
    if (!path) return "";
    const signed = path.match(/^\d{12}\/[0-9a-f]+\/(.+)$/i);
    const body = signed ? signed[1] : path;
    const traceId = body.split("/").pop();
    return /^[0-9a-z_]{8,}$/i.test(traceId) ? body : "";
  }
  function coverUrlCandidates(raw) {
    const original = normalizeSpace(raw);
    if (!original) return [];
    if (/^(?:data:|blob:)/i.test(original)) return [original];
    const normalized = toNoWatermarkCoverUrl(original);
    const out = [];
    const push = (value) => {
      const text = normalizeSpace(value);
      if (!text || out.indexOf(text) >= 0) return;
      out.push(text);
    };
    const objectPath = toCdnObjectPath(original);
    if (objectPath) {
      push("https://ci.xiaohongshu.com/" + objectPath);
      push("https://ci.xiaohongshu.com/" + objectPath + "?imageView2/format/jpeg");
      push("https://sns-img-hw.xhscdn.com/" + objectPath);
    }
    push(normalized);
    push(original);
    if (normalized && !/!/.test(normalized.split("?")[0])) {
      push(normalized.replace(/([?].*)?$/, "!nd_dft_wlteh_webp_3$1"));
    }
    return out.slice(0, 6);
  }
  function isForcedJpegCandidate(url) {
    return /[?&]imageView2\/format\/jpe?g(?:$|[/?&])/i.test(String(url || ""));
  }
  function resolveCoverExtFromMime(mimeType) {
    const mime = normalizeSpace(String(mimeType == null ? "" : mimeType).split(";")[0]).toLowerCase();
    if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/avif") return "avif";
    if (mime === "image/heic" || mime === "image/heif") return "heic";
    if (mime === "image/gif") return "gif";
    return "";
  }
  function resolveCoverExtFromUrl(sourceUrl) {
    let path = "";
    try {
      const base = globalThis.location && globalThis.location.href || SHARE_BASE;
      path = new URL(String(sourceUrl == null ? "" : sourceUrl), base).pathname;
    } catch (_) {
      path = String(sourceUrl == null ? "" : sourceUrl).split("#")[0].split("?")[0];
    }
    path = String(path).replace(/!.*$/, "");
    const match = path.match(/\.(jpe?g|png|webp|avif|heic|heif|gif)$/i);
    if (!match) return "";
    const ext = match[1].toLowerCase();
    return ext === "jpe" || ext === "jpeg" ? "jpg" : ext;
  }
  function buildCoverFileName(noteId, sourceUrl, mimeType) {
    const sanitizedId = String(noteId == null ? "" : noteId).replace(/[^A-Za-z0-9_-]/g, "");
    const baseName = sanitizedId ? "xhs-note-" + sanitizedId : "xhs-cover";
    const ext = resolveCoverExtFromMime(mimeType) || resolveCoverExtFromUrl(sourceUrl) || "jpg";
    return baseName + "." + ext;
  }
  function guessImageMimeFromUrl(url) {
    const text = String(url || "").toLowerCase();
    if (text.indexOf(".png") >= 0) return "image/png";
    if (text.indexOf(".webp") >= 0 || text.indexOf("webp") >= 0) return "image/webp";
    if (text.indexOf(".gif") >= 0) return "image/gif";
    return "image/jpeg";
  }
  function sniffImageMimeFromBytes(bytes) {
    if (!bytes || bytes.length < 4) return "";
    if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
    if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
    if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
    if (bytes.length >= 12 && bytes[4] === 102 && bytes[5] === 116 && bytes[6] === 121 && bytes[7] === 112) {
      const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0).toLowerCase();
      if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|heif)$/.test(brand)) return "image/heic";
      if (/^(avif|avis)$/.test(brand)) return "image/avif";
      return "";
    }
    return "";
  }
  function looksLikeImageBytes(bytes) {
    return sniffImageMimeFromBytes(bytes) !== "";
  }
  function isJpegBlob(blob) {
    const type = normalizeSpace(blob && blob.type).toLowerCase();
    return type === "image/jpeg" || type === "image/jpg";
  }
  function parseBaseUrl(value) {
    const text = normalizeSpace(value).replace(/\/+$/, "");
    if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: "" };
    return { ok: true, value: text };
  }
  function parseTokenExp(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3 || !parts[1] || typeof globalThis.atob !== "function") return 0;
    try {
      let payload = String(parts[1]).replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4 !== 0) payload += "=";
      const match = globalThis.atob(payload).match(/"exp"\s*:\s*(\d+)/);
      return match ? Number(match[1]) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }
  function buildCrawlPayload(accountId, urls) {
    const list = (Array.isArray(urls) ? urls : []).filter((url) => typeof url === "string" && url);
    return { account_id: Number(accountId) || 0, urls: list, save_to_library: true, fetch_comments: false };
  }

  // src/lib/settings.js
  var LIBRARY_BASE_URL_KEY = "xhs-enhanced:library-base-url";
  var LIBRARY_USERNAME_KEY = "xhs-enhanced:library-username";
  var LIBRARY_ACCOUNT_ID_KEY = "xhs-enhanced:library-account-id";
  var LIBRARY_PASSWORD_KEY = "xhs-enhanced:library-password";
  var LIBRARY_REFRESH_KEY = "xhs-enhanced:library-refresh-token";
  var LIBRARY_KEYS = Object.freeze([
    LIBRARY_BASE_URL_KEY,
    LIBRARY_USERNAME_KEY,
    LIBRARY_ACCOUNT_ID_KEY,
    LIBRARY_PASSWORD_KEY,
    LIBRARY_REFRESH_KEY
  ]);
  function chromeStorage() {
    const chrome = getChrome();
    try {
      if (chrome && chrome.storage && chrome.storage.local) return chrome.storage.local;
    } catch (_) {
    }
    return null;
  }
  var libraryCache = {
    baseUrl: "",
    username: "",
    accountId: 0,
    password: "",
    refreshToken: ""
  };
  var libraryHydrated = false;
  function readLocal(key) {
    const storage = getLocalStorage();
    if (!storage) return "";
    try {
      return String(storage.getItem(key) || "");
    } catch (_) {
      return "";
    }
  }
  function writeLocal(key, value) {
    const storage = getLocalStorage();
    if (!storage) return false;
    try {
      storage.setItem(key, String(value == null ? "" : value));
      return true;
    } catch (_) {
      return false;
    }
  }
  function removeLocal(key) {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch (_) {
    }
  }
  function applyLibraryItems(items) {
    const source = items || {};
    libraryCache.baseUrl = String(source[LIBRARY_BASE_URL_KEY] || "");
    libraryCache.username = String(source[LIBRARY_USERNAME_KEY] || "");
    libraryCache.accountId = Number(source[LIBRARY_ACCOUNT_ID_KEY]) || 0;
    if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
    libraryCache.password = String(source[LIBRARY_PASSWORD_KEY] || "");
    libraryCache.refreshToken = String(source[LIBRARY_REFRESH_KEY] || "");
  }
  function migrateLegacyLocalStorage() {
    const moved = [];
    for (const key of [LIBRARY_BASE_URL_KEY, LIBRARY_USERNAME_KEY, LIBRARY_ACCOUNT_ID_KEY]) {
      const legacy = readLocal(key);
      if (legacy) {
        moved.push([key, legacy]);
      }
    }
    return moved;
  }
  function subscribeToChanges() {
    const chrome = getChrome();
    try {
      const onChanged = chrome && chrome.storage && chrome.storage.onChanged;
      if (!onChanged || typeof onChanged.addListener !== "function") return;
      onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes) return;
        for (const key of LIBRARY_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
          const value = changes[key] ? changes[key].newValue : void 0;
          if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value == null ? "" : String(value);
          else if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value == null ? "" : String(value);
          else if (key === LIBRARY_ACCOUNT_ID_KEY) {
            libraryCache.accountId = Number(value) || 0;
            if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
          } else if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = value == null ? "" : String(value);
          else if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = value == null ? "" : String(value);
        }
      });
    } catch (_) {
    }
  }
  subscribeToChanges();
  async function hydrate() {
    const store = chromeStorage();
    if (!store) {
      applyLibraryItems({
        [LIBRARY_BASE_URL_KEY]: readLocal(LIBRARY_BASE_URL_KEY),
        [LIBRARY_USERNAME_KEY]: readLocal(LIBRARY_USERNAME_KEY),
        [LIBRARY_ACCOUNT_ID_KEY]: readLocal(LIBRARY_ACCOUNT_ID_KEY),
        [LIBRARY_PASSWORD_KEY]: readLocal(LIBRARY_PASSWORD_KEY),
        [LIBRARY_REFRESH_KEY]: readLocal(LIBRARY_REFRESH_KEY)
      });
      libraryHydrated = true;
      return;
    }
    let items = {};
    try {
      items = await store.get(LIBRARY_KEYS.slice()) || {};
    } catch (_) {
      items = {};
    }
    applyLibraryItems(items);
    const legacy = migrateLegacyLocalStorage();
    if (legacy.length) {
      const patch = {};
      for (const [key, value] of legacy) {
        if (!items[key]) {
          patch[key] = value;
          if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value;
          if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value;
          if (key === LIBRARY_ACCOUNT_ID_KEY) libraryCache.accountId = Number(value) || 0;
        }
      }
      if (Object.keys(patch).length) {
        let persisted = false;
        try {
          await store.set(patch);
          persisted = true;
        } catch (_) {
        }
        if (persisted) {
          for (const [key] of legacy) removeLocal(key);
        }
      } else {
        for (const [key] of legacy) removeLocal(key);
      }
    }
    libraryHydrated = true;
  }
  var ready = hydrate().catch(() => {
    libraryHydrated = true;
  });
  function persistLibrary(patch) {
    const store = chromeStorage();
    const entries = Object.entries(patch);
    if (store) {
      try {
        const result = store.set(patch);
        if (result && typeof result.catch === "function") result.catch(() => {
        });
        return true;
      } catch (_) {
        return false;
      }
    }
    let ok = true;
    for (const [key, value] of entries) {
      if (!writeLocal(key, value == null ? "" : String(value))) ok = false;
    }
    return ok;
  }
  function readLibraryConfig(storage) {
    const localSource = storage === void 0 ? chromeStorage() ? null : getLocalStorage() : storage;
    let baseUrl = libraryCache.baseUrl;
    let username = libraryCache.username;
    let accountId = libraryCache.accountId;
    if (localSource) {
      try {
        baseUrl = String(localSource.getItem(LIBRARY_BASE_URL_KEY) || "");
      } catch (_) {
        baseUrl = "";
      }
      try {
        username = String(localSource.getItem(LIBRARY_USERNAME_KEY) || "").trim();
      } catch (_) {
        username = "";
      }
      try {
        accountId = Number(localSource.getItem(LIBRARY_ACCOUNT_ID_KEY) || 0) || 0;
      } catch (_) {
        accountId = 0;
      }
    } else if (chromeStorage()) {
      username = normalizeSpace(username);
    }
    const parsedBase = parseBaseUrlSafe(baseUrl);
    if (!Number.isSafeInteger(accountId) || accountId < 0) accountId = 0;
    return {
      baseUrl: parsedBase.ok ? parsedBase.value : "",
      username: normalizeSpace(username),
      accountId,
      password: libraryCache.password
    };
  }
  function parseBaseUrlSafe(value) {
    const text = normalizeSpace(value).replace(/\/+$/, "");
    if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: "" };
    return { ok: true, value: text };
  }
  function writeSecret(key, value) {
    const text = String(value == null ? "" : value);
    if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = text;
    if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = text;
    return persistLibrary({ [key]: text });
  }
  function readRefreshToken() {
    return libraryCache.refreshToken || "";
  }
  function readStoredThreshold(storage) {
    const source = storage === void 0 ? getLocalStorage() : storage;
    if (!source) return DEFAULT_THRESHOLD;
    try {
      const parsed = parseThreshold(source.getItem(THRESHOLD_STORAGE_KEY));
      return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
    } catch (_) {
      return DEFAULT_THRESHOLD;
    }
  }
  function readStoredFocusPopular(storage) {
    const source = storage === void 0 ? getLocalStorage() : storage;
    if (!source) return false;
    try {
      return source.getItem(FOCUS_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  // src/lib/remote.js
  var FETCH_MESSAGE = "xhs-enhanced:fetch";
  async function sendToBackground(request) {
    const chrome = getChrome();
    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return null;
    }
    try {
      const response = await chrome.runtime.sendMessage(Object.assign({ type: FETCH_MESSAGE }, request));
      if (response && typeof response === "object") return response;
      return { ok: false, status: 0, error: "network" };
    } catch (_) {
      return { ok: false, status: 0, error: "network" };
    }
  }
  function base64ToBytes(base64) {
    if (typeof globalThis.atob !== "function") return null;
    let binary;
    try {
      binary = globalThis.atob(base64);
    } catch (_) {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
    return bytes;
  }
  function hasPrivilegedChannel() {
    const chrome = getChrome();
    return Boolean(chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function");
  }
  async function fetchBytes(url, options = {}) {
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 2e4;
    const response = await sendToBackground({
      url,
      method: options.method || "GET",
      headers: options.headers || {},
      data: options.data,
      timeout,
      responseType: "arraybuffer"
    });
    if (!response) return null;
    if (!response.ok) {
      return { ok: false, status: Number(response.status) || 0, bytes: null, error: response.error || "network" };
    }
    const bytes = typeof response.base64 === "string" ? base64ToBytes(response.base64) : null;
    if (!bytes) return { ok: false, status: Number(response.status) || 0, bytes: null, error: "decode" };
    return { ok: true, status: Number(response.status) || 0, bytes, contentType: response.contentType || "" };
  }
  async function fetchJson(urlOrOptions, maybeOptions) {
    const options = typeof urlOrOptions === "string" ? { ...maybeOptions || {}, url: urlOrOptions } : urlOrOptions || {};
    const url = options.url;
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 2e4;
    const method = options.method || "GET";
    const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    let data;
    if (options.data !== void 0) {
      data = JSON.stringify(options.data);
      headers["Content-Type"] = "application/json";
    }
    const response = await sendToBackground({ url, method, headers, data, timeout, responseType: "text" });
    if (!response) return { ok: false, status: 0, json: null, error: "unreachable" };
    let json = null;
    try {
      json = response.text ? JSON.parse(response.text) : null;
    } catch (_) {
    }
    const status = Number(response.status) || 0;
    let error = "";
    if (!json) {
      error = response.error ? String(response.error) : response.text ? normalizeSpace(response.text).slice(0, 200) : "";
    } else if (json.detail) {
      error = typeof json.detail === "string" ? json.detail : normalizeSpace(JSON.stringify(json.detail));
    }
    if (!response.ok && !error) error = response.error || "http";
    return { ok: Boolean(response.ok) && status >= 200 && status < 300, status, json, error };
  }

  // src/lib/library.js
  var LIBRARY_CRAWL_PATH = "/api/xhs/crawl/note-urls";
  var LIBRARY_BATCH_LIMIT = 50;
  var libraryTokenMemory = { accessToken: "", refreshToken: "", exp: 0 };
  function storeLibraryAccessToken(token) {
    libraryTokenMemory.accessToken = String(token || "");
    libraryTokenMemory.exp = parseTokenExp(libraryTokenMemory.accessToken);
  }
  function libraryLogin(cfg) {
    return fetchJson({
      method: "POST",
      url: cfg.baseUrl + "/api/auth/login",
      data: { username: cfg.username, password: cfg.password }
    }).then((res) => {
      if (!res.ok || !res.json || !res.json.access_token) return false;
      storeLibraryAccessToken(res.json.access_token);
      if (res.json.refresh_token) {
        libraryTokenMemory.refreshToken = String(res.json.refresh_token);
        writeSecret(LIBRARY_REFRESH_KEY, libraryTokenMemory.refreshToken);
      }
      return true;
    });
  }
  function libraryRefresh(cfg) {
    const refresh = libraryTokenMemory.refreshToken || readRefreshToken();
    if (!refresh) return Promise.resolve(false);
    return fetchJson({
      method: "POST",
      url: cfg.baseUrl + "/api/auth/refresh",
      data: { refresh_token: refresh }
    }).then((res) => {
      if (!res.ok || !res.json || !res.json.access_token) return false;
      storeLibraryAccessToken(res.json.access_token);
      return true;
    });
  }
  function ensureLibraryToken(forceRenew) {
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) return Promise.resolve({ ok: false, error: "config-missing" });
    const now = Math.floor(Date.now() / 1e3);
    if (!forceRenew && libraryTokenMemory.accessToken && libraryTokenMemory.exp - 30 > now) {
      return Promise.resolve({ ok: true, token: libraryTokenMemory.accessToken });
    }
    return libraryRefresh(cfg).then((refreshed) => refreshed ? true : libraryLogin(cfg)).then((logged) => logged ? { ok: true, token: libraryTokenMemory.accessToken } : { ok: false, error: "auth-failed" });
  }
  function postCrawlNoteUrls(token, cfg, urls) {
    return fetchJson({
      method: "POST",
      url: cfg.baseUrl + LIBRARY_CRAWL_PATH,
      headers: { Authorization: "Bearer " + token },
      data: buildCrawlPayload(cfg.accountId, urls)
    });
  }
  function saveNoteUrlsToLibrary(urls) {
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) {
      return Promise.resolve({ ok: false, status: 0, json: null, error: "config-missing" });
    }
    if (!cfg.accountId) return Promise.resolve({ ok: false, status: 0, json: null, error: "account-missing" });
    return ensureLibraryToken().then((auth) => {
      if (!auth.ok) return { ok: false, status: 0, json: null, error: auth.error };
      return postCrawlNoteUrls(auth.token, cfg, urls).then((res) => {
        if (res.status !== 401) return res;
        return ensureLibraryToken(true).then((renewed) => {
          if (!renewed.ok) return { ok: false, status: 0, json: null, error: renewed.error };
          return postCrawlNoteUrls(renewed.token, cfg, urls);
        });
      });
    });
  }

  // src/lib/initial-state.js
  function createInitialStateResolver(documentRef) {
    let injected = null;
    let hasInjected = false;
    let initialStateCache;
    let fallbackTokenMap = null;
    let fallbackTokenChecked = false;
    function getStateObject() {
      if (isTestMode() && hasInjected) return injected;
      if (initialStateCache !== void 0) return initialStateCache;
      initialStateCache = readInitialStateFromDocument(documentRef());
      return initialStateCache;
    }
    function clearInitialStateCache() {
      initialStateCache = void 0;
    }
    function clearFallbackTokenCache2() {
      fallbackTokenMap = null;
      fallbackTokenChecked = false;
      clearInitialStateCache();
    }
    function extractTokenForNoteIdFromScriptText(noteId) {
      if (!noteId) return "";
      const doc = documentRef();
      if (!doc || !doc.querySelectorAll) return "";
      try {
        const scripts = doc.querySelectorAll("script:not([src])");
        const safeId = String(noteId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const near = new RegExp(
          '"noteId"\\s*:\\s*"' + safeId + '"[\\s\\S]{0,240}?"xsecToken"\\s*:\\s*"([^"]+)"|"xsecToken"\\s*:\\s*"([^"]+)"[\\s\\S]{0,240}?"noteId"\\s*:\\s*"' + safeId + '"|"id"\\s*:\\s*"' + safeId + '"[\\s\\S]{0,400}?"xsecToken"\\s*:\\s*"([^"]+)"'
        );
        for (let i = 0; i < scripts.length; i += 1) {
          const content = scripts[i].textContent || "";
          if (content.indexOf(noteId) < 0) continue;
          if (content.indexOf("xsecToken") < 0 && content.indexOf("__INITIAL_STATE__") < 0) continue;
          const match = near.exec(content);
          if (match) return match[1] || match[2] || match[3] || "";
        }
      } catch (_) {
      }
      return "";
    }
    function buildFallbackTokenMap() {
      const map = /* @__PURE__ */ Object.create(null);
      const state = getStateObject();
      if (state) {
        const seen = typeof getRoot().WeakSet === "function" ? new (getRoot()).WeakSet() : null;
        try {
          collectTokensFromStateObject(state, map, 0, seen);
        } catch (_) {
        }
      }
      return map;
    }
    function getFallbackTokenForNoteId2(noteId) {
      if (!noteId) return "";
      if (!fallbackTokenMap) fallbackTokenMap = /* @__PURE__ */ Object.create(null);
      if (Object.prototype.hasOwnProperty.call(fallbackTokenMap, noteId)) return fallbackTokenMap[noteId] || "";
      let token = "";
      const state = getStateObject();
      if (state) {
        const seen = typeof getRoot().WeakSet === "function" ? new (getRoot()).WeakSet() : null;
        try {
          token = findTokenForNoteIdInState(state, noteId, 0, seen);
        } catch (_) {
          token = "";
        }
      }
      if (!token) token = extractTokenForNoteIdFromScriptText(noteId);
      if (!token && !fallbackTokenChecked) {
        fallbackTokenChecked = true;
        const bulk = buildFallbackTokenMap();
        const keys = Object.keys(bulk);
        for (let i = 0; i < keys.length; i += 1) {
          if (!Object.prototype.hasOwnProperty.call(fallbackTokenMap, keys[i])) fallbackTokenMap[keys[i]] = bulk[keys[i]];
        }
        if (bulk[noteId]) token = bulk[noteId];
      }
      fallbackTokenMap[noteId] = token || "";
      return token || "";
    }
    return {
      getFallbackTokenForNoteId: getFallbackTokenForNoteId2,
      clearFallbackTokenCache: clearFallbackTokenCache2,
      clearInitialStateCache,
      getStateObject,
      setTestInitialState(value) {
        injected = value || null;
        hasInjected = value != null;
        clearFallbackTokenCache2();
      }
    };
  }
  function readInitialStateFromDocument(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    try {
      const scripts = doc.querySelectorAll("script:not([src])");
      for (let i = 0; i < scripts.length; i += 1) {
        const text = scripts[i].textContent || "";
        if (text.indexOf("__INITIAL_STATE__") < 0) continue;
        const parsed = parseInitialStateFromScriptText(text);
        if (parsed) return parsed;
      }
    } catch (_) {
    }
    return null;
  }

  // src/lib/cover.js
  var coverBlobCache = /* @__PURE__ */ new Map();
  var COVER_CACHE_LIMIT = 80;
  function cacheCoverBlob(url, blob) {
    const key = normalizeSpace(url);
    if (!key || !blob) return;
    if (coverBlobCache.size >= COVER_CACHE_LIMIT) {
      const first = coverBlobCache.keys().next().value;
      if (first !== void 0) coverBlobCache.delete(first);
    }
    coverBlobCache.set(key, blob);
  }
  function getCachedCoverBlob(url) {
    const key = normalizeSpace(url);
    if (!key || !coverBlobCache.has(key)) return null;
    const hit = coverBlobCache.get(key);
    return hit && typeof hit.size === "number" ? hit : null;
  }
  function cacheCoverMiss(url) {
    const key = normalizeSpace(url);
    if (!key) return;
    if (coverBlobCache.size >= COVER_CACHE_LIMIT) {
      const first = coverBlobCache.keys().next().value;
      if (first !== void 0) coverBlobCache.delete(first);
    }
    coverBlobCache.set(key, false);
  }
  function isCoverMiss(url) {
    const key = normalizeSpace(url);
    return key ? coverBlobCache.get(key) === false : false;
  }
  function dataUrlToBlob(dataUrl, mimeType) {
    if (!dataUrl) return null;
    if (!/^data:/i.test(dataUrl)) return null;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const typeMatch = header.match(/^data:([^;,]*)/i);
    const type = typeMatch && typeMatch[1] || mimeType || "application/octet-stream";
    const isBase64 = /;base64/i.test(header);
    const BlobCtor = globalThis.Blob;
    if (typeof BlobCtor !== "function") return null;
    try {
      if (!isBase64) {
        const text = decodeURIComponent(body);
        const bytes2 = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes2[i] = text.charCodeAt(i) & 255;
        return new BlobCtor([bytes2], { type: type || "text/plain" });
      }
      if (typeof globalThis.atob !== "function") return null;
      const binary = globalThis.atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
      return new BlobCtor([bytes], { type: type || "application/octet-stream" });
    } catch (_) {
      return null;
    }
  }
  function normalizeFetchedImageBlob(blob, url) {
    if (!blob || typeof blob.size !== "number" || blob.size < 32) return null;
    if (blob.type && /^image\//i.test(blob.type) && blob.type.indexOf("svg") < 0) return blob;
    const BlobCtor = globalThis.Blob;
    if (typeof BlobCtor !== "function") return null;
    try {
      return blob.slice ? blob.slice(0, blob.size, guessImageMimeFromUrl(url)) : new BlobCtor([blob], { type: guessImageMimeFromUrl(url) });
    } catch (_) {
      return null;
    }
  }
  function fetchCoverBlob(url) {
    if (!url) return Promise.resolve(null);
    if (/^data:/i.test(url)) return Promise.resolve(dataUrlToBlob(url, "image/png"));
    if (/^blob:/i.test(url) && typeof globalThis.fetch === "function") {
      return globalThis.fetch(url).then((res) => res && res.ok ? res.blob() : null, () => null).then((blob) => blob ? normalizeFetchedImageBlob(blob, url) : null);
    }
    return Promise.resolve(null);
  }
  function remoteFetchCoverBlob(url) {
    if (!url || /^(?:data:|blob:)/i.test(url) || !hasRemoteChannel() || isCoverMiss(url)) return Promise.resolve(null);
    const cached = getCachedCoverBlob(url);
    if (cached) return Promise.resolve(cached);
    return fetchBytes(url, { timeout: 2e4 }).then((result) => {
      if (!result || !result.ok || !result.bytes) {
        cacheCoverMiss(url);
        return null;
      }
      const bytes = result.bytes;
      if (bytes.byteLength < 32 || !looksLikeImageBytes(bytes)) {
        cacheCoverMiss(url);
        return null;
      }
      const sniffed = result.contentType && /^image\//i.test(result.contentType) && result.contentType.indexOf("svg") < 0 ? result.contentType.split(";")[0].trim() : sniffImageMimeFromBytes(bytes) || guessImageMimeFromUrl(url);
      const BlobCtor = globalThis.Blob;
      if (typeof BlobCtor !== "function") {
        cacheCoverMiss(url);
        return null;
      }
      const blob = new BlobCtor([bytes], { type: sniffed });
      cacheCoverBlob(url, blob);
      return blob;
    }, () => {
      cacheCoverMiss(url);
      return null;
    });
  }
  function hasRemoteChannel() {
    const chrome = getChrome();
    return Boolean(chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function");
  }
  function resolveCoverBlobFromCandidates(candidates) {
    let chain = Promise.resolve(null);
    for (const url of candidates) {
      chain = chain.then((prev) => {
        if (prev && (isJpegBlob(prev.blob) || isForcedJpegCandidate(prev.url))) return prev;
        const loader = /^(?:data:|blob:)/i.test(url) ? fetchCoverBlob(url) : remoteFetchCoverBlob(url);
        return loader.then((blob) => {
          if (!blob) return prev;
          if (isForcedJpegCandidate(url) || isJpegBlob(blob)) return { url, blob };
          return prev || { url, blob };
        }, () => prev);
      });
    }
    return chain;
  }
  function loadCoverPngBlob(src) {
    return resolveCoverBlobFromCandidates(coverUrlCandidates(src)).then((hit) => hit && hit.blob ? { ok: true, blob: hit.blob, url: hit.url || "" } : { ok: false });
  }
  function canvasToBlob(img, mimeType, quality) {
    const documentRef = globalThis.document;
    if (!documentRef || !documentRef.createElement) return Promise.resolve(null);
    const type = mimeType || "image/png";
    try {
      const canvas = documentRef.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") return Promise.resolve(null);
      canvas.width = img.naturalWidth || img.width || 0;
      canvas.height = img.naturalHeight || img.height || 0;
      if (!canvas.width || !canvas.height) return Promise.resolve(null);
      const ctx = canvas.getContext("2d");
      if (!ctx) return Promise.resolve(null);
      if (type === "image/jpeg" || type === "image/jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const viaDataUrl = () => {
        try {
          return dataUrlToBlob(canvas.toDataURL(type, quality), type);
        } catch (_) {
          return null;
        }
      };
      if (typeof canvas.toBlob === "function") {
        return new Promise((resolve) => {
          try {
            canvas.toBlob((blob) => {
              if (!blob) {
                resolve(viaDataUrl());
                return;
              }
              resolve(blob);
            }, type, quality);
          } catch (_) {
            resolve(viaDataUrl());
          }
        });
      }
      return Promise.resolve(viaDataUrl());
    } catch (_) {
      return Promise.resolve(null);
    }
  }
  function canvasToPngBlob(img) {
    return canvasToBlob(img, "image/png");
  }
  function blobToJpegBlob(blob, quality) {
    if (!blob || isJpegBlob(blob)) return Promise.resolve(null);
    if (typeof globalThis.createImageBitmap !== "function") return Promise.resolve(null);
    const q = typeof quality === "number" ? quality : 0.92;
    return globalThis.createImageBitmap(blob).then((bitmap) => canvasToBlob(bitmap, "image/jpeg", q).then((out) => {
      try {
        bitmap.close();
      } catch (_) {
      }
      return out || null;
    }), () => null);
  }
  function ensureJpegCoverBlob(blob) {
    if (!blob || isJpegBlob(blob)) return Promise.resolve(blob);
    return blobToJpegBlob(blob).then((jpeg) => jpeg || blob);
  }
  function blobToPngBlob(blob) {
    if (!blob) return Promise.resolve(null);
    if (blob.type === "image/png") return Promise.resolve(blob);
    if (typeof globalThis.createImageBitmap === "function") {
      return globalThis.createImageBitmap(blob).then((bitmap) => canvasToPngBlob(bitmap).then((png) => {
        try {
          bitmap.close();
        } catch (_) {
        }
        return png || blob;
      }, () => {
        try {
          bitmap.close();
        } catch (_) {
        }
        return blob;
      }), () => blob);
    }
    return Promise.resolve(blob);
  }
  function getClipboard() {
    try {
      if (globalThis.navigator && globalThis.navigator.clipboard) return globalThis.navigator.clipboard;
    } catch (_) {
    }
    return null;
  }
  function getClipboardItemCtor() {
    try {
      if (globalThis.navigator && typeof globalThis.navigator.ClipboardItem === "function") return globalThis.navigator.ClipboardItem;
    } catch (_) {
    }
    try {
      if (typeof globalThis.ClipboardItem === "function") return globalThis.ClipboardItem;
    } catch (_) {
    }
    return null;
  }
  function copyText(text) {
    const clipboard = getClipboard();
    if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(false);
    return clipboard.writeText(text).then(() => true, () => false);
  }
  function copyImageBlob(blobPromise) {
    const clipboard = getClipboard();
    const ClipboardItemCtor = getClipboardItemCtor();
    if (!clipboard || typeof clipboard.write !== "function" || typeof ClipboardItemCtor !== "function") {
      return Promise.resolve(false);
    }
    const pngPromise = Promise.resolve(blobPromise).then((blob) => {
      if (!blob) throw new Error("empty-cover-blob");
      return blobToPngBlob(blob).then((png) => {
        const out = png || blob;
        if (!out) throw new Error("cover-transcode-failed");
        return out;
      });
    }).then((blob) => {
      if (blob.type === "image/png") return blob;
      return blob.slice ? blob.slice(0, blob.size, "image/png") : blob;
    });
    try {
      const item = new ClipboardItemCtor({ "image/png": pngPromise });
      return clipboard.write([item]).then(() => true, () => false);
    } catch (_) {
      return pngPromise.then((blob) => {
        try {
          const item = new ClipboardItemCtor({ "image/png": blob });
          return clipboard.write([item]).then(() => true, () => false);
        } catch (_2) {
          return false;
        }
      }, () => false);
    }
  }
  function triggerCoverDownload(blob, filename) {
    const documentRef = globalThis.document;
    if (!blob || !documentRef || typeof globalThis.URL?.createObjectURL !== "function") return false;
    let objectUrl = "";
    try {
      objectUrl = globalThis.URL.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename || "xhs-cover.jpg";
      anchor.rel = "noopener";
      anchor.style.display = "none";
      (documentRef.body || documentRef.documentElement).appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (_) {
      return false;
    } finally {
      globalThis.setTimeout(() => {
        try {
          globalThis.URL.revokeObjectURL(objectUrl);
        } catch (_) {
        }
      }, 4e3);
    }
  }

  // src/content/index.js
  var ROOT = getRoot();
  var TEST_MODE = isTestMode();
  var STYLE_ID = "xhs-enhanced-style";
  var CARD_CLASS = "xhs-enhanced-card--popular";
  var LIKE_CLASS = "xhs-enhanced-like--popular";
  var SIGNATURE_ATTRIBUTE = "data-xhs-enhanced-signature";
  var JUMP_NAV_ID = "xhs-enhanced-jump-nav";
  var JUMP_BUTTON_ID = "xhs-enhanced-jump-next";
  var JUMP_PREV_BUTTON_ID = "xhs-enhanced-jump-prev";
  var JUMP_STATUS_ID = "xhs-enhanced-jump-status";
  var THRESHOLD_CONTROL_ID = "xhs-enhanced-threshold-control";
  var THRESHOLD_INPUT_ID = "xhs-enhanced-threshold-input";
  var THRESHOLD_STATUS_ID = "xhs-enhanced-threshold-status";
  var JUMP_BUTTON_TEXT = "\u4E0B\u4E00\u6761\u70ED\u95E8\u7B14\u8BB0";
  var JUMP_PREV_BUTTON_TEXT = "\u4E0A\u4E00\u6761\u70ED\u95E8\u7B14\u8BB0";
  var LAST_NOTE_TEXT = "\u5DF2\u7ECF\u662F\u6700\u540E\u4E00\u6761\u70ED\u95E8\u7B14\u8BB0";
  var FIRST_NOTE_TEXT = "\u5DF2\u7ECF\u662F\u7B2C\u4E00\u6761\u70ED\u95E8\u7B14\u8BB0";
  var FOCUS_TOGGLE_ID = "xhs-enhanced-focus-toggle";
  var FOCUS_TOGGLE_TEXT = "\u53EA\u663E\u793A\u70ED\u95E8";
  var DIMMED_CLASS = "xhs-enhanced-card--dimmed";
  var CARD_ACTIONS_CLASS = "xhs-enhanced-card-actions";
  var COPY_LINK_CLASS = "xhs-enhanced-copy-link";
  var COPY_COVER_CLASS = "xhs-enhanced-copy-cover";
  var DOWNLOAD_COVER_CLASS = "xhs-enhanced-download-cover";
  var COPY_LINK_TEXT = "\u590D\u5236\u94FE\u63A5";
  var COPY_COVER_TEXT = "\u590D\u5236\u5C01\u9762";
  var DOWNLOAD_COVER_TEXT = "\u4E0B\u8F7D\u5C01\u9762";
  var COPY_LINK_OK = "\u5DF2\u590D\u5236\u7B14\u8BB0\u94FE\u63A5";
  var COPY_LINK_FAIL = "\u94FE\u63A5\u590D\u5236\u5931\u8D25";
  var COPY_COVER_OK = "\u5DF2\u590D\u5236\u7B14\u8BB0\u5C01\u9762";
  var COPY_COVER_FAIL = "\u5C01\u9762\u590D\u5236\u5931\u8D25";
  var COPY_COVER_AUTH_FAIL = "\u5C01\u9762\u590D\u5236\u5931\u8D25\uFF08\u6269\u5C55\u65E0\u7279\u6743\u901A\u9053\uFF09";
  var DOWNLOAD_COVER_OK = "\u5DF2\u4E0B\u8F7D\u7B14\u8BB0\u5C01\u9762";
  var DOWNLOAD_COVER_FAIL = "\u5C01\u9762\u4E0B\u8F7D\u5931\u8D25";
  var DOWNLOAD_COVER_AUTH_FAIL = "\u5C01\u9762\u4E0B\u8F7D\u5931\u8D25\uFF08\u6269\u5C55\u65E0\u7279\u6743\u901A\u9053\uFF09";
  var DOWNLOAD_COVER_MISSING = "\u672A\u627E\u5230\u7B14\u8BB0\u5C01\u9762";
  var COVER_IMAGE_SELECTORS = 'img.cover,img[src*="sns-img"],img[src*="xhscdn"],picture img,article img,section.note-item img,.note-item img';
  var COPY_STATUS_ID = "xhs-enhanced-copy-status";
  var SAVE_LIBRARY_CLASS = "xhs-enhanced-save-library";
  var SAVE_LIBRARY_TEXT = "\u4FDD\u5B58\u5165\u5E93";
  var SAVE_LIBRARY_DONE_TEXT = "\u5DF2\u5165\u5E93";
  var LIBRARY_PAGE_BUTTON_ID = "xhs-enhanced-library-page";
  var LIBRARY_PAGE_BUTTON_TEXT = "\u4FDD\u5B58\u5230\u5185\u5BB9\u5E93";
  var LIBRARY_BATCH_BUTTON_ID = "xhs-enhanced-library-batch";
  var LIBRARY_BATCH_BUTTON_TEXT = "\u672C\u9875\u5168\u90E8\u5165\u5E93";
  var LIBRARY_BATCH_EMPTY_TEXT = "\u672C\u9875\u6CA1\u6709\u53EF\u5165\u5E93\u7684\u7B14\u8BB0\u94FE\u63A5";
  var LIBRARY_TOGGLE_ID = "xhs-enhanced-library-toggle";
  var LIBRARY_TOGGLE_TEXT = "\u5185\u5BB9\u5E93\u8BBE\u7F6E";
  var LIBRARY_SAVED_OK = "\u5DF2\u4FDD\u5B58\u5230\u5185\u5BB9\u5E93";
  var LIBRARY_SAVE_FAIL = "\u5185\u5BB9\u5E93\u4FDD\u5B58\u5931\u8D25";
  var LIBRARY_NO_TOKEN = "\u672A\u83B7\u53D6\u5230 xsec_token\uFF0C\u65E0\u6CD5\u91C7\u96C6";
  var LIBRARY_NO_CONFIG = "\u8BF7\u5148\u914D\u7F6E\u5185\u5BB9\u5E93\uFF08\u6269\u5C55\u9009\u9879\u9875\uFF09";
  var LIBRARY_NO_ACCOUNT = "\u5185\u5BB9\u5E93\u672A\u53D1\u73B0\u53EF\u7528\u7684\u5C0F\u7EA2\u4E66 PC \u7AEF\u8D26\u53F7";
  var LIBRARY_AUTH_FAIL = "\u5185\u5BB9\u5E93\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u540D\u4E0E\u5BC6\u7801";
  var LIBRARY_CONNECT_FAIL = "\u65E0\u6CD5\u8FDE\u63A5\u5185\u5BB9\u5E93\u670D\u52A1";
  var LIBRARY_CHANNEL_MISSING = "\u6269\u5C55\u65E0\u6CD5\u8BBF\u95EE\u5185\u5BB9\u5E93\uFF08\u8BF7\u91CD\u65B0\u52A0\u8F7D\u6269\u5C55\u540E\u518D\u8BD5\uFF09";
  var LIBRARY_PERMISSION_MISSING = "\u5185\u5BB9\u5E93\u670D\u52A1\u5668\u672A\u6388\u6743\uFF1A\u6253\u5F00\u6269\u5C55\u9009\u9879\u9875\u70B9\u201C\u6D4B\u8BD5\u8FDE\u63A5\u201D\u5E76\u5141\u8BB8\u8BBF\u95EE\u8BE5\u5730\u5740";
  var SELECTORS = Object.freeze({
    noteLinks: 'a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]',
    cardContainers: "[data-note-card],article.note-item,section.note-item,.note-item",
    likeNodes: '[data-like-count],[data-xhs-like-count],[aria-label*="\u70B9\u8D5E"],[title*="\u70B9\u8D5E"],.like-wrapper .count,.like-count',
    contentRoots: "[data-note-list],.feeds-page,.note-list,main"
  });
  var READ_ATTRIBUTES = Object.freeze([
    "aria-label",
    "title",
    "data-like-count",
    "data-xhs-like-count"
  ]);
  var routeProvider = null;
  var observer = null;
  var structureObserver = null;
  var observerRoot = null;
  var scheduled = false;
  var destroyed = true;
  var initialized = false;
  var lifecycleToken = null;
  var lastUrl = "";
  var jumpNav = null;
  var jumpButton = null;
  var jumpPrevButton = null;
  var jumpStatus = null;
  var thresholdControl = null;
  var thresholdInput = null;
  var thresholdStatus = null;
  var threshold = DEFAULT_THRESHOLD;
  var jumpStatusTimer = null;
  var focusPopular = false;
  var focusToggle = null;
  var copyStatus = null;
  var copyStatusTimer = null;
  var copyCoverInFlight = false;
  var downloadCoverInFlight = false;
  var saveInFlight = false;
  var libraryToggle = null;
  var libraryPageButton = null;
  var libraryBatchButton = null;
  var fallbackTokenResolver = null;
  var pending = /* @__PURE__ */ new Set();
  var counters = { batches: 0, processed: 0, fullScans: 0, routeSignals: 0 };
  var eventBindings = [];
  function getResolver() {
    if (!fallbackTokenResolver) {
      fallbackTokenResolver = createInitialStateResolver(() => ROOT.document || null);
    }
    return fallbackTokenResolver;
  }
  function getFallbackTokenForNoteId(noteId) {
    return getResolver().getFallbackTokenForNoteId(noteId);
  }
  function clearFallbackTokenCache() {
    if (fallbackTokenResolver) fallbackTokenResolver.clearFallbackTokenCache();
  }
  function getStorage() {
    try {
      return ROOT.localStorage || null;
    } catch (_) {
      return null;
    }
  }
  function setThreshold(value, storage = getStorage()) {
    const parsed = parseThreshold(value);
    if (!parsed.ok) return { ok: false, value: threshold, persisted: false };
    threshold = parsed.value;
    let persisted = false;
    if (storage) {
      try {
        storage.setItem(THRESHOLD_STORAGE_KEY, String(threshold));
        persisted = true;
      } catch (_) {
      }
    }
    return { ok: true, value: threshold, persisted };
  }
  function setFocusPopular(value, storage = getStorage()) {
    focusPopular = Boolean(value);
    let persisted = false;
    if (storage) {
      try {
        storage.setItem(FOCUS_STORAGE_KEY, focusPopular ? "1" : "0");
        persisted = true;
      } catch (_) {
      }
    }
    return persisted;
  }
  function applyFocusToggleState() {
    if (focusToggle) focusToggle.setAttribute("aria-pressed", focusPopular ? "true" : "false");
  }
  function onFocusToggleClick() {
    const persisted = setFocusPopular(!focusPopular);
    applyFocusToggleState();
    showCopyStatus(focusPopular ? persisted ? "\u5DF2\u5F00\u542F\uFF1A\u53EA\u663E\u793A\u70ED\u95E8\u7B14\u8BB0" : "\u5DF2\u5F00\u542F\uFF1A\u53EA\u663E\u793A\u70ED\u95E8\u7B14\u8BB0\uFF08\u8BBE\u7F6E\u672A\u80FD\u4FDD\u5B58\uFF09" : "\u5DF2\u5173\u95ED\uFF1A\u663E\u793A\u5168\u90E8\u7B14\u8BB0");
    scan(ROOT.document);
  }
  function resolveCardNoteLink(card) {
    if (!card || !card.querySelectorAll) return "";
    let tokenHref = "";
    let fallbackHref = "";
    for (const link of Array.from(card.querySelectorAll(SELECTORS.noteLinks))) {
      const href2 = link.getAttribute("href") || link.getAttribute("xhs:href") || "";
      const id2 = getNoteIdFromHref(href2);
      if (!id2) continue;
      if (!tokenHref && getXsecTokenFromHref(href2)) tokenHref = href2;
      else if (!fallbackHref) fallbackHref = href2;
    }
    const href = tokenHref || fallbackHref;
    const id = getNoteIdFromHref(href);
    if (!id) return "";
    let token = getXsecTokenFromHref(href);
    if (!token) token = getFallbackTokenForNoteId(id);
    return buildShareLink(id, token);
  }
  function extractNoteLink(card) {
    return resolveCardNoteLink(card);
  }
  function extractCoverUrl(card) {
    if (!card || !card.querySelector) return "";
    const images = card.querySelectorAll(COVER_IMAGE_SELECTORS);
    for (const img of images) {
      const raw = pickCoverUrlFromImage(img);
      if (!raw) continue;
      if (/avatar|icon|emoji|logo/i.test(raw) && images.length > 1) continue;
      return raw;
    }
    const mediaNodes = card.querySelectorAll('[style*="background"],.cover,.cover-container,.photo,.img,a');
    for (const node of mediaNodes) {
      const bg = readBackgroundImageUrl(node);
      if (bg && !/avatar|icon|emoji|logo/i.test(bg)) return bg;
    }
    return "";
  }
  function pickCoverUrlFromImage(img) {
    if (!img) return "";
    const candidates = [
      img.currentSrc,
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      pickLargestFromSrcset(img.getAttribute("srcset") || img.getAttribute("data-srcset") || "")
    ];
    for (const candidate of candidates) {
      const value = normalizeSpace(candidate);
      if (value) return value;
    }
    return "";
  }
  function readBackgroundImageUrl(node) {
    if (!node) return "";
    try {
      const inline = node.style && node.style.backgroundImage ? node.style.backgroundImage : "";
      const computed = !inline && ROOT.getComputedStyle ? ROOT.getComputedStyle(node).backgroundImage : inline;
      const text = inline || computed || "";
      const match = String(text).match(/url\((["']?)([^"')]+)\1\)/i);
      return match ? normalizeSpace(match[2]) : "";
    } catch (_) {
      return "";
    }
  }
  function clearCopyStatus() {
    if (copyStatusTimer !== null) ROOT.clearTimeout(copyStatusTimer);
    copyStatusTimer = null;
    const node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT.document && ROOT.document.getElementById(COPY_STATUS_ID);
    if (node) node.remove();
    copyStatus = null;
  }
  function showCopyStatus(message) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT.document.getElementById(COPY_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement("div");
      node.id = COPY_STATUS_ID;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      ROOT.document.body.appendChild(node);
    }
    copyStatus = node;
    node.textContent = message;
    if (copyStatusTimer !== null) ROOT.clearTimeout(copyStatusTimer);
    copyStatusTimer = ROOT.setTimeout(() => {
      copyStatusTimer = null;
      clearCopyStatus();
    }, 2200);
  }
  function onCopyLink(card) {
    const link = extractNoteLink(card);
    if (!link) {
      showCopyStatus(COPY_LINK_FAIL);
      return;
    }
    copyText(link).then((ok) => showCopyStatus(ok ? COPY_LINK_OK : COPY_LINK_FAIL));
  }
  function onCopyCover(card) {
    if (copyCoverInFlight) return;
    const src = extractCoverUrl(card);
    if (!src) {
      showCopyStatus(COPY_COVER_FAIL);
      return;
    }
    copyCoverInFlight = true;
    const blobPromise = loadCoverPngBlob(src).then((result) => {
      if (!result.ok || !result.blob) throw new Error("cover-load-failed");
      return result.blob;
    });
    copyImageBlob(blobPromise).then((copied) => {
      copyCoverInFlight = false;
      showCopyStatus(copied ? COPY_COVER_OK : hasPrivilegedChannel() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL);
    }, () => {
      copyCoverInFlight = false;
      showCopyStatus(hasPrivilegedChannel() ? COPY_COVER_FAIL : COPY_COVER_AUTH_FAIL);
    });
  }
  function onDownloadCover(card) {
    if (downloadCoverInFlight) return;
    const src = extractCoverUrl(card);
    if (!src) {
      showCopyStatus(DOWNLOAD_COVER_MISSING);
      return;
    }
    downloadCoverInFlight = true;
    loadCoverPngBlob(src).then((result) => {
      if (!result.ok || !result.blob) throw new Error("cover-load-failed");
      return result.blob;
    }).then((blob) => ensureJpegCoverBlob(blob)).then((blob) => {
      downloadCoverInFlight = false;
      const ok = triggerCoverDownload(blob, buildCoverFileName(cardNoteTargetId(card), src, blob ? blob.type : ""));
      showCopyStatus(ok ? DOWNLOAD_COVER_OK : hasPrivilegedChannel() ? DOWNLOAD_COVER_FAIL : DOWNLOAD_COVER_AUTH_FAIL);
    }, () => {
      downloadCoverInFlight = false;
      showCopyStatus(hasPrivilegedChannel() ? DOWNLOAD_COVER_FAIL : DOWNLOAD_COVER_AUTH_FAIL);
    });
  }
  function resolveSaveUrlFromCard(card) {
    const link = extractNoteLink(card);
    if (!link) return { ok: false, url: "", reason: "no-link" };
    if (!getXsecTokenFromHref(link)) return { ok: false, url: "", reason: "no-token" };
    return { ok: true, url: link, reason: "" };
  }
  function buildDetailNoteUrl() {
    try {
      const loc = ROOT.location;
      if (!loc || !loc.origin || loc.origin === "null") return "";
      return loc.origin + loc.pathname + (loc.search || "");
    } catch (_) {
      return "";
    }
  }
  function onSaveToLibrary(card, button) {
    if (saveInFlight) return;
    const resolved = resolveSaveUrlFromCard(card);
    if (!resolved.ok) {
      showCopyStatus(resolved.reason === "no-token" ? LIBRARY_NO_TOKEN : COPY_LINK_FAIL);
      return;
    }
    submitNoteUrlsToLibrary([resolved.url]).then((result) => {
      if (!result.ok || !button || !button.isConnected) return;
      button.textContent = SAVE_LIBRARY_DONE_TEXT;
      button.disabled = true;
      ROOT.setTimeout(() => {
        button.textContent = SAVE_LIBRARY_TEXT;
        button.disabled = false;
      }, 2e3);
    });
  }
  function onSaveCurrentDetail() {
    if (saveInFlight) return;
    const url = buildDetailNoteUrl();
    if (!url || !getXsecTokenFromHref(url)) {
      showCopyStatus(LIBRARY_NO_TOKEN);
      return;
    }
    submitNoteUrlsToLibrary([url]);
  }
  function openLibrarySettings() {
    const chrome = ROOT.chrome;
    try {
      if (chrome && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
        chrome.runtime.openOptionsPage();
        return true;
      }
    } catch (_) {
    }
    showCopyStatus('\u8BF7\u5728\u6269\u5C55\u8BE6\u60C5\u9875\u6253\u5F00"\u9009\u9879"\u914D\u7F6E\u5185\u5BB9\u5E93');
    return false;
  }
  function submitNoteUrlsToLibrary(urls, options) {
    const silent = Boolean(options && options.silent);
    if (saveInFlight) return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    const cfg = readLibraryConfig();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) {
      if (!silent) {
        showCopyStatus(LIBRARY_NO_CONFIG);
        openLibrarySettings();
      }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!cfg.accountId) {
      if (!silent) {
        showCopyStatus(LIBRARY_NO_ACCOUNT);
        openLibrarySettings();
      }
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    if (!hasPrivilegedChannel()) {
      if (!silent) showCopyStatus(LIBRARY_CHANNEL_MISSING);
      return Promise.resolve({ ok: false, saved: 0, failed: 0 });
    }
    saveInFlight = true;
    if (!silent) showCopyStatus("\u6B63\u5728\u4FDD\u5B58\u5230\u5185\u5BB9\u5E93\u2026");
    const finish = (result) => {
      saveInFlight = false;
      const errors = result.json && Array.isArray(result.json.errors) ? result.json.errors : [];
      const saved = result.json ? Number(result.json.saved_count) || 0 : 0;
      const failed = errors.length;
      if (result.ok) {
        if (failed > 0) {
          if (!silent) {
            const message = errors[0] && errors[0].error ? normalizeSpace(String(errors[0].error)) : "";
            showCopyStatus("\u91C7\u96C6\u5931\u8D25\uFF1A" + (message || "\u670D\u52A1\u7AEF\u91C7\u96C6\u5931\u8D25"));
          }
        } else if (!silent) {
          showCopyStatus(saved > 0 ? LIBRARY_SAVED_OK : LIBRARY_SAVE_FAIL);
        }
        return { ok: saved > 0 && failed === 0, saved, failed };
      }
      if (!silent) {
        if (result.error === "config-missing") {
          showCopyStatus(LIBRARY_NO_CONFIG);
          openLibrarySettings();
        } else if (result.error === "account-missing") {
          showCopyStatus(LIBRARY_NO_ACCOUNT);
          openLibrarySettings();
        } else if (result.error === "auth-failed") showCopyStatus(LIBRARY_AUTH_FAIL);
        else if (result.error === "permission") showCopyStatus(LIBRARY_PERMISSION_MISSING);
        else if (result.error === "unreachable" || result.error === "network" || result.error === "timeout") showCopyStatus(LIBRARY_CONNECT_FAIL);
        else if (result.error) showCopyStatus("\u4FDD\u5B58\u5931\u8D25\uFF1A" + normalizeSpace(result.error));
        else showCopyStatus(LIBRARY_CONNECT_FAIL);
      }
      return { ok: false, saved, failed };
    };
    return saveNoteUrlsToLibrary(urls).then(finish);
  }
  function onSaveAllVisible() {
    if (saveInFlight) return;
    const seen = /* @__PURE__ */ new Set();
    const urls = [];
    for (const card of discoverCards(ROOT.document)) {
      const resolved = resolveSaveUrlFromCard(card);
      if (resolved.ok && !seen.has(resolved.url)) {
        seen.add(resolved.url);
        urls.push(resolved.url);
      }
    }
    if (!urls.length) {
      showCopyStatus(LIBRARY_BATCH_EMPTY_TEXT);
      return;
    }
    const batches = [];
    for (let i = 0; i < urls.length; i += LIBRARY_BATCH_LIMIT) batches.push(urls.slice(i, i + LIBRARY_BATCH_LIMIT));
    let index = 0;
    const totals = { saved: 0, failed: 0 };
    if (libraryBatchButton) libraryBatchButton.disabled = true;
    const next = () => {
      if (libraryBatchButton) libraryBatchButton.disabled = index < batches.length;
      if (index >= batches.length) {
        showCopyStatus("\u672C\u9875\u5165\u5E93\u5B8C\u6210\uFF1A\u6210\u529F " + totals.saved + " \u6761" + (totals.failed > 0 ? "\uFF0C\u5931\u8D25 " + totals.failed + " \u6761" : ""));
        return;
      }
      const batch = batches[index];
      index += 1;
      showCopyStatus("\u6B63\u5728\u5165\u5E93 " + index + "/" + batches.length + " \u6279\u2026");
      submitNoteUrlsToLibrary(batch, { silent: true }).then((result) => {
        totals.saved += result.saved;
        totals.failed += result.failed;
        if (!result.ok && result.saved === 0 && result.failed === 0) totals.failed += batch.length;
        next();
      });
    };
    next();
  }
  function ensureCardActions(card) {
    if (!card || !card.querySelector || !card.isConnected) return;
    if (!isTargetRoute(getCurrentRoute())) {
      removeCardActions(card);
      return;
    }
    let container = card.querySelector("." + CARD_ACTIONS_CLASS);
    if (!container) {
      container = ROOT.document.createElement("div");
      container.className = CARD_ACTIONS_CLASS;
      const linkButton = ROOT.document.createElement("button");
      linkButton.type = "button";
      linkButton.className = COPY_LINK_CLASS;
      linkButton.textContent = COPY_LINK_TEXT;
      linkButton.setAttribute("aria-label", COPY_LINK_TEXT);
      linkButton.addEventListener("click", () => onCopyLink(card));
      const coverButton = ROOT.document.createElement("button");
      coverButton.type = "button";
      coverButton.className = COPY_COVER_CLASS;
      coverButton.textContent = COPY_COVER_TEXT;
      coverButton.setAttribute("aria-label", COPY_COVER_TEXT);
      coverButton.addEventListener("click", () => onCopyCover(card));
      const downloadButton = ROOT.document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = DOWNLOAD_COVER_CLASS;
      downloadButton.textContent = DOWNLOAD_COVER_TEXT;
      downloadButton.setAttribute("aria-label", DOWNLOAD_COVER_TEXT);
      downloadButton.addEventListener("click", () => onDownloadCover(card));
      const saveButton = ROOT.document.createElement("button");
      saveButton.type = "button";
      saveButton.className = SAVE_LIBRARY_CLASS;
      saveButton.textContent = SAVE_LIBRARY_TEXT;
      saveButton.setAttribute("aria-label", SAVE_LIBRARY_TEXT);
      saveButton.addEventListener("click", () => onSaveToLibrary(card, saveButton));
      container.append(linkButton, coverButton, downloadButton, saveButton);
      card.appendChild(container);
    }
  }
  function removeCardActions(card) {
    if (!card || !card.querySelectorAll) return;
    const container = card.querySelector("." + CARD_ACTIONS_CLASS);
    if (container) container.remove();
  }
  function getCurrentRoute() {
    if (TEST_MODE && routeProvider) return String(routeProvider() || "");
    return ROOT.location ? ROOT.location.pathname : "";
  }
  function getAttributeSource(node, names) {
    for (const name of names) {
      const value = node.getAttribute(name);
      if (normalizeSpace(value)) return value;
    }
    return "";
  }
  function extractLike(card) {
    const nodes = Array.from(card.querySelectorAll(SELECTORS.likeNodes));
    for (const node of nodes) {
      const explicit = getAttributeSource(node, ["data-like-count", "data-xhs-like-count"]);
      const labelled = getAttributeSource(node, ["aria-label", "title"]).replace(/^.*?点赞[：:\s]*/u, "");
      const candidates = [explicit, labelled, node.textContent];
      for (const candidate of candidates) {
        const parsed = parseLikeCount(candidate);
        if (parsed.ok) return { node, parsed, raw: normalizeSpace(candidate) };
      }
    }
    return null;
  }
  function cardNoteTargetId(card) {
    if (!card || !card.querySelectorAll) return "";
    let targetId = "";
    for (const link of Array.from(card.querySelectorAll(SELECTORS.noteLinks))) {
      const href = link.getAttribute("href") || link.getAttribute("xhs:href") || "";
      const id = getNoteIdFromHref(href);
      if (!id) continue;
      if (targetId && targetId !== id) return "";
      targetId = id;
    }
    return targetId;
  }
  function isReliableCard(card) {
    if (!card || !card.querySelector) return false;
    return Boolean(cardNoteTargetId(card)) && Boolean(card.querySelector(SELECTORS.likeNodes));
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
    const cards = /* @__PURE__ */ new Set();
    if (root.matches && root.matches(SELECTORS.cardContainers) && isReliableCard(root)) cards.add(root);
    for (const link of root.querySelectorAll(SELECTORS.noteLinks)) {
      const card = findCard(link);
      if (card) cards.add(card);
    }
    return Array.from(cards);
  }
  function discoverLinkCards(root) {
    if (!root || !root.querySelectorAll) return [];
    const cards = /* @__PURE__ */ new Set();
    for (const link of root.querySelectorAll(SELECTORS.noteLinks)) {
      const element = link.nodeType === 1 ? link : link.parentElement;
      if (!element) continue;
      const card = element.closest(SELECTORS.cardContainers);
      if (card && card.isConnected && cardNoteTargetId(card)) cards.add(card);
    }
    return Array.from(cards);
  }
  function applyCardActionsFallback() {
    if (!ROOT.document || !isTargetRoute(getCurrentRoute())) return;
    for (const card of discoverLinkCards(ROOT.document)) ensureCardActions(card);
  }
  function ensureStyle() {
    if (!ROOT.document || ROOT.document.getElementById(STYLE_ID)) return;
    const style = ROOT.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS}{outline:2px solid #ff2442!important;background:rgba(255,36,66,.07)!important;box-shadow:0 2px 10px rgba(255,36,66,.14)!important}
      .${LIKE_CLASS}{color:#ff2442!important;font-weight:700!important}
      #${JUMP_NAV_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;display:flex;gap:8px}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID}{border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${JUMP_PREV_BUTTON_ID}:hover,#${JUMP_BUTTON_ID}:hover{background:#e61e3c}
      #${JUMP_PREV_BUTTON_ID}:focus-visible,#${JUMP_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${FOCUS_TOGGLE_ID}{border:0;border-radius:999px;padding:10px 16px;background:rgba(30,30,30,.9);color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${FOCUS_TOGGLE_ID}:hover{background:rgba(15,15,15,1)}
      #${FOCUS_TOGGLE_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]{background:#ff2442}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]:hover{background:#e61e3c}
      .${DIMMED_CLASS}{filter:blur(8px) grayscale(.35);opacity:.55;transition:filter .18s ease,opacity .18s ease}
      .${DIMMED_CLASS}:hover{filter:none;opacity:1}
      #${THRESHOLD_CONTROL_ID}{position:fixed;top:138px;right:24px;z-index:2147483646;display:flex;gap:6px;align-items:center;padding:8px;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.16);font:14px/1.4 system-ui,sans-serif}
      #${THRESHOLD_INPUT_ID}{width:72px;border:1px solid #aaa;border-radius:4px;padding:5px 6px;font:inherit}#${THRESHOLD_CONTROL_ID} button{border:0;border-radius:4px;padding:6px 9px;background:#ff2442;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
      #${THRESHOLD_STATUS_ID}{position:fixed;top:190px;right:24px;z-index:2147483646;max-width:260px;padding:7px 10px;border-radius:6px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
      #${JUMP_STATUS_ID}{position:fixed;top:228px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
      #${COPY_STATUS_ID}{position:fixed;top:276px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
      #${LIBRARY_PAGE_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_PAGE_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_PAGE_BUTTON_ID}:focus-visible{outline:3px solid #111;outline-offset:3px}
      #${LIBRARY_BATCH_BUTTON_ID}{position:fixed;top:316px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:#ff2442;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_BATCH_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_BATCH_BUTTON_ID}:disabled{opacity:.6;cursor:default}
      #${LIBRARY_TOGGLE_ID}{position:fixed;bottom:24px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 16px;background:rgba(30,30,30,.9);color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer}
      #${LIBRARY_TOGGLE_ID}:hover{background:rgba(15,15,15,1)}
      .${CARD_ACTIONS_CLASS}{position:absolute;top:6px;left:6px;z-index:2147483640;display:flex;gap:4px;opacity:0;transition:opacity .15s ease;pointer-events:none}
      .xhs-enhanced-card--popular .${CARD_ACTIONS_CLASS},.note-item:hover .${CARD_ACTIONS_CLASS},section.note-item:hover .${CARD_ACTIONS_CLASS},article.note-item:hover .${CARD_ACTIONS_CLASS}{opacity:1;pointer-events:auto}
      [data-note-card],article.note-item,section.note-item,.note-item{position:relative}
      .${CARD_ACTIONS_CLASS} button{border:0;border-radius:6px;padding:5px 9px;background:rgba(255,36,66,.92);color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}
      .${CARD_ACTIONS_CLASS} button:hover{background:#e61e3c}
      .${COPY_COVER_CLASS}{background:rgba(30,30,30,.82)!important}
      .${DOWNLOAD_COVER_CLASS}{background:rgba(37,99,235,.92)!important}
      .${DOWNLOAD_COVER_CLASS}:hover{background:rgba(29,78,216,1)!important}
    `;
    (ROOT.document.head || ROOT.document.documentElement).appendChild(style);
  }
  function renderCard(card) {
    if (!card || !card.isConnected) return;
    const like = extractLike(card);
    const route = getCurrentRoute();
    const signature = signatureFor(route, like ? like.raw : "");
    const popular = Boolean(like && like.parsed.value > threshold);
    card.classList.toggle(CARD_CLASS, popular);
    card.classList.toggle(DIMMED_CLASS, focusPopular && !popular);
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);
    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    ensureCardActions(card);
    counters.processed += 1;
  }
  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
    card.classList.remove(DIMMED_CLASS);
    card.removeAttribute(SIGNATURE_ATTRIBUTE);
    removeCardActions(card);
    for (const node of card.querySelectorAll(`.${LIKE_CLASS}`)) node.classList.remove(LIKE_CLASS);
  }
  function cleanupAll() {
    if (!ROOT.document) return;
    for (const card of ROOT.document.querySelectorAll(`.${CARD_CLASS},[${SIGNATURE_ATTRIBUTE}]`)) cleanupCard(card);
    for (const container of ROOT.document.querySelectorAll("." + CARD_ACTIONS_CLASS)) container.remove();
  }
  function selectNextPopularCard(cards, viewportHeight) {
    let selected = null;
    let selectedTop = Infinity;
    for (const card of cards || []) {
      if (!card || !card.isConnected || !card.classList || !card.classList.contains(CARD_CLASS) || typeof card.getBoundingClientRect !== "function") continue;
      const rect = card.getBoundingClientRect();
      const top = Number(rect && rect.top);
      if (!Number.isFinite(top) || top < viewportHeight || top >= selectedTop) continue;
      selected = card;
      selectedTop = top;
    }
    return selected;
  }
  function selectPreviousPopularCard(cards) {
    let selected = null;
    let selectedBottom = -Infinity;
    for (const card of cards || []) {
      if (!card || !card.isConnected || !card.classList || !card.classList.contains(CARD_CLASS) || typeof card.getBoundingClientRect !== "function") continue;
      const rect = card.getBoundingClientRect();
      const bottom = Number(rect && rect.bottom);
      if (!Number.isFinite(bottom) || bottom > 0 || bottom <= selectedBottom) continue;
      selected = card;
      selectedBottom = bottom;
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
  function showJumpStatus(message = LAST_NOTE_TEXT) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT.document.getElementById(JUMP_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement("div");
      node.id = JUMP_STATUS_ID;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.textContent = message;
      ROOT.document.body.appendChild(node);
    }
    jumpStatus = node;
    node.textContent = message;
    if (jumpStatusTimer !== null) ROOT.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = ROOT.setTimeout(() => {
      jumpStatusTimer = null;
      clearJumpStatus();
    }, 3e3);
  }
  function jumpToNextPopularCard() {
    if (!ROOT.document) return;
    const viewportHeight = ROOT.innerHeight || ROOT.document.documentElement.clientHeight || 0;
    const target = selectNextPopularCard(ROOT.document.querySelectorAll(`.${CARD_CLASS}`), viewportHeight);
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const documentElement = ROOT.document.documentElement;
    const body = ROOT.document.body;
    const bottom = Math.max(documentElement ? documentElement.scrollHeight : 0, body ? body.scrollHeight : 0);
    if (typeof ROOT.scrollTo === "function") ROOT.scrollTo({ top: bottom, behavior: "smooth" });
    showJumpStatus();
  }
  function jumpToPreviousPopularCard() {
    if (!ROOT.document) return;
    const target = selectPreviousPopularCard(ROOT.document.querySelectorAll(`.${CARD_CLASS}`));
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (typeof ROOT.scrollTo === "function") ROOT.scrollTo({ top: 0, behavior: "smooth" });
    showJumpStatus(FIRST_NOTE_TEXT);
  }
  function ensureJumpUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT.document.getElementById(JUMP_NAV_ID);
    if (!nav) {
      nav = ROOT.document.createElement("div");
      nav.id = JUMP_NAV_ID;
      ROOT.document.body.appendChild(nav);
    }
    jumpNav = nav;
    let prev = jumpPrevButton && jumpPrevButton.isConnected ? jumpPrevButton : ROOT.document.getElementById(JUMP_PREV_BUTTON_ID);
    if (!prev) {
      prev = ROOT.document.createElement("button");
      prev.id = JUMP_PREV_BUTTON_ID;
      prev.type = "button";
      prev.textContent = JUMP_PREV_BUTTON_TEXT;
      prev.setAttribute("aria-label", JUMP_PREV_BUTTON_TEXT);
      prev.addEventListener("click", jumpToPreviousPopularCard);
    }
    jumpPrevButton = prev;
    let button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT.document.getElementById(JUMP_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement("button");
      button.id = JUMP_BUTTON_ID;
      button.type = "button";
      button.textContent = JUMP_BUTTON_TEXT;
      button.setAttribute("aria-label", JUMP_BUTTON_TEXT);
      button.addEventListener("click", jumpToNextPopularCard);
    }
    jumpButton = button;
    let toggle = focusToggle && focusToggle.isConnected ? focusToggle : ROOT.document.getElementById(FOCUS_TOGGLE_ID);
    if (!toggle) {
      toggle = ROOT.document.createElement("button");
      toggle.id = FOCUS_TOGGLE_ID;
      toggle.type = "button";
      toggle.textContent = FOCUS_TOGGLE_TEXT;
      toggle.setAttribute("aria-label", FOCUS_TOGGLE_TEXT);
      toggle.setAttribute("aria-pressed", focusPopular ? "true" : "false");
      toggle.addEventListener("click", onFocusToggleClick);
    }
    focusToggle = toggle;
    if (prev.parentElement !== nav) nav.appendChild(prev);
    if (button.parentElement !== nav) nav.appendChild(button);
    if (toggle.parentElement !== nav) nav.appendChild(toggle);
  }
  function showThresholdStatus(message) {
    if (!ROOT.document || !ROOT.document.body) return;
    let node = thresholdStatus && thresholdStatus.isConnected ? thresholdStatus : ROOT.document.getElementById(THRESHOLD_STATUS_ID);
    if (!node) {
      node = ROOT.document.createElement("div");
      node.id = THRESHOLD_STATUS_ID;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      ROOT.document.body.appendChild(node);
    }
    node.textContent = message;
    thresholdStatus = node;
  }
  function applyThresholdInput() {
    if (!thresholdInput) return;
    const result = setThreshold(thresholdInput.value);
    thresholdInput.value = String(threshold);
    if (!result.ok) {
      showThresholdStatus(`\u8BF7\u8F93\u5165\u975E\u8D1F\u6574\u6570\uFF0C\u5F53\u524D\u9608\u503C\u4E3A ${threshold}`);
      return;
    }
    showThresholdStatus(result.persisted ? `\u70ED\u95E8\u9608\u503C\u5DF2\u8BBE\u4E3A ${threshold}` : `\u70ED\u95E8\u9608\u503C\u5DF2\u8BBE\u4E3A ${threshold}\uFF0C\u4F46\u672A\u80FD\u4FDD\u5B58`);
    scan(ROOT.document);
  }
  function ensureThresholdUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    let control = thresholdControl && thresholdControl.isConnected ? thresholdControl : ROOT.document.getElementById(THRESHOLD_CONTROL_ID);
    let created = false;
    if (!control) {
      created = true;
      control = ROOT.document.createElement("div");
      control.id = THRESHOLD_CONTROL_ID;
      control.setAttribute("role", "group");
      control.setAttribute("aria-label", "\u70ED\u95E8\u9608\u503C\u8BBE\u7F6E");
      const label = ROOT.document.createElement("label");
      label.htmlFor = THRESHOLD_INPUT_ID;
      label.textContent = "\u70ED\u95E8\u9608\u503C";
      const input = ROOT.document.createElement("input");
      input.id = THRESHOLD_INPUT_ID;
      input.type = "text";
      input.inputMode = "numeric";
      input.setAttribute("aria-label", "\u70ED\u95E8\u9608\u503C");
      const button = ROOT.document.createElement("button");
      button.type = "button";
      button.textContent = "\u5E94\u7528";
      button.addEventListener("click", applyThresholdInput);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.returnValue = false;
          applyThresholdInput();
        }
      });
      control.append(label, input, button);
      ROOT.document.body.appendChild(control);
    }
    thresholdControl = control;
    thresholdInput = control.querySelector(`#${THRESHOLD_INPUT_ID}`);
    if (created && thresholdInput) thresholdInput.value = String(threshold);
  }
  function removeThresholdUi() {
    const control = thresholdControl && thresholdControl.isConnected ? thresholdControl : ROOT.document && ROOT.document.getElementById(THRESHOLD_CONTROL_ID);
    if (control) control.remove();
    thresholdControl = null;
    thresholdInput = null;
    const status = thresholdStatus && thresholdStatus.isConnected ? thresholdStatus : ROOT.document && ROOT.document.getElementById(THRESHOLD_STATUS_ID);
    if (status) status.remove();
    thresholdStatus = null;
  }
  function removeJumpUi() {
    clearJumpStatus();
    const nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT.document && ROOT.document.getElementById(JUMP_NAV_ID);
    if (nav) nav.remove();
    for (const id of [JUMP_PREV_BUTTON_ID, JUMP_BUTTON_ID, FOCUS_TOGGLE_ID]) {
      const stray = ROOT.document && ROOT.document.getElementById(id);
      if (stray) stray.remove();
    }
    jumpNav = null;
    jumpButton = null;
    jumpPrevButton = null;
    focusToggle = null;
  }
  function ensureLibraryToggle() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryToggle && libraryToggle.isConnected ? libraryToggle : ROOT.document.getElementById(LIBRARY_TOGGLE_ID);
    if (!button) {
      button = ROOT.document.createElement("button");
      button.id = LIBRARY_TOGGLE_ID;
      button.type = "button";
      button.textContent = LIBRARY_TOGGLE_TEXT;
      button.setAttribute("aria-label", LIBRARY_TOGGLE_TEXT);
      button.addEventListener("click", openLibrarySettings);
      ROOT.document.body.appendChild(button);
    }
    libraryToggle = button;
  }
  function removeLibraryToggle() {
    const button = libraryToggle && libraryToggle.isConnected ? libraryToggle : ROOT.document && ROOT.document.getElementById(LIBRARY_TOGGLE_ID);
    if (button) button.remove();
    libraryToggle = null;
  }
  function ensureLibraryPageButton() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement("button");
      button.id = LIBRARY_PAGE_BUTTON_ID;
      button.type = "button";
      button.textContent = LIBRARY_PAGE_BUTTON_TEXT;
      button.setAttribute("aria-label", LIBRARY_PAGE_BUTTON_TEXT);
      button.addEventListener("click", onSaveCurrentDetail);
      ROOT.document.body.appendChild(button);
    }
    libraryPageButton = button;
  }
  function removeLibraryPageButton() {
    const button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT.document && ROOT.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (button) button.remove();
    libraryPageButton = null;
  }
  function ensureLibraryBatchButton() {
    if (!ROOT.document || !ROOT.document.body) return;
    let button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (!button) {
      button = ROOT.document.createElement("button");
      button.id = LIBRARY_BATCH_BUTTON_ID;
      button.type = "button";
      button.textContent = LIBRARY_BATCH_BUTTON_TEXT;
      button.setAttribute("aria-label", LIBRARY_BATCH_BUTTON_TEXT);
      button.addEventListener("click", onSaveAllVisible);
      ROOT.document.body.appendChild(button);
    }
    libraryBatchButton = button;
  }
  function removeLibraryBatchButton() {
    const button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT.document && ROOT.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (button) button.remove();
    libraryBatchButton = null;
  }
  function removeLibraryUi() {
    removeLibraryToggle();
    removeLibraryPageButton();
    removeLibraryBatchButton();
  }
  function syncLibraryUi() {
    if (!ROOT.document || !ROOT.document.body) return;
    const route = getCurrentRoute();
    if (isDetailRoute(route)) {
      ensureLibraryToggle();
      ensureLibraryPageButton();
      removeLibraryBatchButton();
      return;
    }
    if (isTargetRoute(route)) {
      ensureLibraryToggle();
      ensureLibraryBatchButton();
      removeLibraryPageButton();
      return;
    }
    removeLibraryUi();
  }
  function syncJumpUi() {
    if (isTargetRoute(getCurrentRoute())) {
      ensureJumpUi();
      ensureThresholdUi();
    } else {
      removeJumpUi();
      removeThresholdUi();
    }
  }
  function flush() {
    scheduled = false;
    if (destroyed || !ROOT.document) return;
    counters.batches += 1;
    syncJumpUi();
    syncLibraryUi();
    const url = ROOT.location ? ROOT.location.href : getCurrentRoute();
    if (url !== lastUrl) {
      lastUrl = url;
      counters.routeSignals += 1;
      clearFallbackTokenCache();
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
    applyCardActionsFallback();
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
    if (typeof ROOT.requestAnimationFrame === "function") ROOT.requestAnimationFrame(run);
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
      if (mutation.type === "attributes" || mutation.type === "characterData") schedule(mutation.target);
      else {
        schedule(mutation.target);
        for (const node of mutation.addedNodes) schedule(node);
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== 1) continue;
          node.classList.remove(LIKE_CLASS, CARD_CLASS, DIMMED_CLASS);
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
    if (!observerRoot || typeof ROOT.MutationObserver !== "function") return false;
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
    scan(ROOT.document);
    schedule();
  }
  function init() {
    if (!ROOT.document || initialized) return;
    initialized = true;
    lifecycleToken = { active: true };
    destroyed = false;
    threshold = readStoredThreshold();
    focusPopular = readStoredFocusPopular();
    ensureStyle();
    bindObserverRoot(selectObserverRoot());
    if (ROOT.document.documentElement && typeof ROOT.MutationObserver === "function") {
      structureObserver = new ROOT.MutationObserver(structureMutationCallback);
      structureObserver.observe(ROOT.document.documentElement, { childList: true, subtree: true });
    }
    bind(ROOT, "popstate", signalRoute);
    bind(ROOT, "hashchange", signalRoute);
    bind(ROOT.document, "visibilitychange", signalRoute);
    lastUrl = "";
    scan(ROOT.document);
    syncJumpUi();
    syncLibraryUi();
  }
  function destroy() {
    if (!initialized) return;
    initialized = false;
    if (lifecycleToken) lifecycleToken.active = false;
    lifecycleToken = null;
    destroyed = true;
    scheduled = false;
    pending.clear();
    clearFallbackTokenCache();
    if (observer) observer.disconnect();
    observer = null;
    observerRoot = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
    removeJumpUi();
    removeThresholdUi();
    removeLibraryUi();
    saveInFlight = false;
    clearCopyStatus();
    cleanupAll();
    const style = ROOT.document && ROOT.document.getElementById(STYLE_ID);
    if (style) style.remove();
  }
  var pureApi = Object.freeze({
    parseLikeCount,
    parseThreshold,
    readStoredThreshold,
    readStoredFocusPopular,
    isTargetRoute,
    isProfileRoute,
    isDetailRoute,
    getCurrentRoute,
    signatureFor,
    selectNextPopularCard,
    selectPreviousPopularCard,
    getNoteIdFromHref,
    buildShareLink,
    getXsecTokenFromHref,
    parseQueryValue,
    findTokenForNoteIdInState,
    getFallbackTokenForNoteId,
    clearFallbackTokenCache,
    toNoWatermarkCoverUrl,
    extractCoverUrl,
    dataUrlToBlob,
    coverUrlCandidates,
    pickLargestFromSrcset,
    buildCoverFileName,
    toCdnObjectPath,
    isForcedJpegCandidate,
    sniffImageMimeFromBytes,
    looksLikeImageBytes,
    isJpegBlob,
    resolveCoverBlobFromCandidates,
    parseBaseUrl,
    readLibraryConfig,
    parseTokenExp,
    buildCrawlPayload,
    parseInitialStateFromScriptText,
    buildDetailNoteUrl,
    resolveSaveUrlFromCard,
    cardNoteTargetId,
    resolveCardNoteLink,
    READ_ATTRIBUTES,
    SELECTORS
  });
  if (TEST_MODE) {
    const testApi = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) {
        routeProvider = () => String(pathname || "");
        lastUrl = "";
        if (scheduleChange) schedule(ROOT.document);
      },
      clearTestRoute() {
        routeProvider = null;
        lastUrl = "";
        schedule(ROOT.document);
      },
      setTestInitialState(value) {
        getResolver().setTestInitialState(value);
      },
      scan: () => scan(ROOT.document),
      flush,
      init,
      destroy,
      setThreshold: (value) => setThreshold(value),
      getThreshold: () => threshold,
      setFocusPopular: (value, storage) => setFocusPopular(value, storage),
      getFocusPopular: () => focusPopular,
      getCounters: () => Object.assign({}, counters, {
        bindings: eventBindings.length,
        observerRootIsBody: observerRoot === ROOT.document.body
      })
    });
    ROOT.__XHS_ENHANCED_TEST_API__ = testApi;
  }
  if (ROOT.document) {
    ready.then(() => {
      init();
    });
  }
})();
