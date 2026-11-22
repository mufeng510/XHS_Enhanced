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
      const fixes = [
        (value) => value.replace(/\bundefined\b/g, "null"),
        (value) => value.replace(/\bundefined\b/g, "null").replace(/\bnew\s+(?:Map|Set)\(\s*\[\s*\]\s*\)/g, "null"),
        (value) => value.replace(/\bundefined\b/g, "null").replace(/\bnew\s+(?:Map|Set)\(\s*\[[\s\S]*?\]\s*\)/g, "null")
      ];
      for (const fix of fixes) {
        try {
          return JSON.parse(fix(jsonText));
        } catch (__) {
        }
      }
      return null;
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
  function slimNoteDetail(note) {
    const value = note && typeof note === "object" ? note : null;
    if (!value) return null;
    const rawList = Array.isArray(value.imageList) ? value.imageList : [];
    const imageList = [];
    for (const item of rawList) {
      if (!item || typeof item !== "object") continue;
      const infoList = [];
      if (Array.isArray(item.infoList)) {
        for (const entry of item.infoList) {
          if (!entry || typeof entry !== "object") continue;
          const url = String(entry.url || "");
          if (!url) continue;
          infoList.push({ imageScene: String(entry.imageScene || ""), url });
        }
      }
      imageList.push({
        urlDefault: String(item.urlDefault || ""),
        urlPre: String(item.urlPre || ""),
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        infoList
      });
    }
    return {
      title: String(value.title || ""),
      type: String(value.type || ""),
      imageList
    };
  }
  var BATCH_LAYOUT_VALUES = Object.freeze(["notes", "flat"]);
  function normalizeBatchLayout(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return text === "notes" ? "notes" : "flat";
  }
  var BATCH_SCOPE_VALUES = Object.freeze(["cover", "inner", "all"]);
  function normalizeBatchScope(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return text === "cover" || text === "inner" ? text : "all";
  }
  function extractNoteFromInitialStateHtml(htmlText) {
    const text = String(htmlText == null ? "" : htmlText);
    const marker = "__INITIAL_STATE__=";
    const anchor = text.indexOf(marker);
    if (anchor < 0) return null;
    const scriptStart = text.lastIndexOf("<script", anchor);
    const scriptEnd = text.indexOf("<\/script>", anchor);
    if (scriptStart < 0 || scriptEnd < 0) return null;
    const openTagEnd = text.indexOf(">", scriptStart);
    if (openTagEnd < 0 || openTagEnd >= scriptEnd) return null;
    const scriptText = text.slice(openTagEnd + 1, scriptEnd);
    const state = parseInitialStateFromScriptText(scriptText);
    const noteMap = state && state.note && state.note.noteDetailMap;
    if (!noteMap || typeof noteMap !== "object") return null;
    const first = Object.values(noteMap)[0];
    const note = first && first.note;
    return slimNoteDetail(note);
  }
  function pickBestImageUrl(image) {
    if (!image || typeof image !== "object") return "";
    const direct = String(image.urlDefault || "").trim() || String(image.urlPre || "").trim();
    if (direct) return direct;
    const list = Array.isArray(image.infoList) ? image.infoList : [];
    const preferred = ["WB_DFT", "WB_PRV", "WB_BIG"];
    for (const scene of preferred) {
      const hit = list.find((entry) => entry && String(entry.imageScene || "").toUpperCase() === scene && entry.url);
      if (hit) return String(hit.url).trim();
    }
    const any = list.find((entry) => entry && entry.url);
    return any ? String(any.url).trim() : "";
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
  var THRESHOLD_KEY = "xhs-enhanced:popular-threshold";
  var FOCUS_KEY = "xhs-enhanced:focus-popular";
  var BATCH_SCOPE_KEY = "xhs-enhanced:batch-scope";
  var BATCH_LAYOUT_KEY = "xhs-enhanced:batch-layout";
  var LIBRARY_KEYS = Object.freeze([
    LIBRARY_BASE_URL_KEY,
    LIBRARY_USERNAME_KEY,
    LIBRARY_ACCOUNT_ID_KEY,
    LIBRARY_PASSWORD_KEY,
    LIBRARY_REFRESH_KEY
  ]);
  var PREF_KEYS = Object.freeze([THRESHOLD_KEY, FOCUS_KEY, BATCH_SCOPE_KEY, BATCH_LAYOUT_KEY]);
  var STORAGE_KEYS = Object.freeze(LIBRARY_KEYS.concat(PREF_KEYS));
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
  var thresholdCache = DEFAULT_THRESHOLD;
  var focusCache = false;
  var batchScopeCache = "all";
  var batchLayoutCache = "flat";
  function parseThresholdSafe(value) {
    if (value == null) return DEFAULT_THRESHOLD;
    const parsed = parseThreshold(String(value));
    return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
  }
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
        for (const key of STORAGE_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
          const value = changes[key] ? changes[key].newValue : void 0;
          if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value == null ? "" : String(value);
          else if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value == null ? "" : String(value);
          else if (key === LIBRARY_ACCOUNT_ID_KEY) {
            libraryCache.accountId = Number(value) || 0;
            if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
          } else if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = value == null ? "" : String(value);
          else if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = value == null ? "" : String(value);
          else if (key === THRESHOLD_KEY) thresholdCache = parseThresholdSafe(value);
          else if (key === FOCUS_KEY) focusCache = value === true || value === "1";
          else if (key === BATCH_SCOPE_KEY) batchScopeCache = normalizeBatchScope(value);
          else if (key === BATCH_LAYOUT_KEY) batchLayoutCache = normalizeBatchLayout(value);
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
      thresholdCache = parseThresholdSafe(readLocal(THRESHOLD_KEY));
      focusCache = readLocal(FOCUS_KEY) === "1";
      batchScopeCache = normalizeBatchScope(readLocal(BATCH_SCOPE_KEY));
      batchLayoutCache = normalizeBatchLayout(readLocal(BATCH_LAYOUT_KEY));
      libraryHydrated = true;
      return;
    }
    let items = {};
    try {
      items = await store.get(STORAGE_KEYS.slice()) || {};
    } catch (_) {
      items = {};
    }
    applyLibraryItems(items);
    thresholdCache = parseThresholdSafe(items[THRESHOLD_KEY]);
    focusCache = items[FOCUS_KEY] === true || items[FOCUS_KEY] === "1";
    batchScopeCache = normalizeBatchScope(items[BATCH_SCOPE_KEY]);
    batchLayoutCache = normalizeBatchLayout(items[BATCH_LAYOUT_KEY]);
    const legacy = migrateLegacyLocalStorage();
    for (const key of PREF_KEYS) {
      if (items[key] == null && readLocal(key)) legacy.push([key, readLocal(key)]);
    }
    if (legacy.length) {
      const patch = {};
      for (const [key, value] of legacy) {
        if (!items[key]) {
          patch[key] = value;
          if (key === LIBRARY_BASE_URL_KEY) libraryCache.baseUrl = value;
          if (key === LIBRARY_USERNAME_KEY) libraryCache.username = value;
          if (key === LIBRARY_ACCOUNT_ID_KEY) libraryCache.accountId = Number(value) || 0;
          if (key === THRESHOLD_KEY) thresholdCache = parseThresholdSafe(value);
          if (key === FOCUS_KEY) focusCache = value === "1";
          if (key === BATCH_SCOPE_KEY) batchScopeCache = normalizeBatchScope(value);
          if (key === BATCH_LAYOUT_KEY) batchLayoutCache = normalizeBatchLayout(value);
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
    if (storage !== void 0) {
      if (!storage) return DEFAULT_THRESHOLD;
      try {
        const parsed = parseThreshold(storage.getItem(THRESHOLD_KEY));
        return parsed.ok ? parsed.value : DEFAULT_THRESHOLD;
      } catch (_) {
        return DEFAULT_THRESHOLD;
      }
    }
    return thresholdCache;
  }
  function readStoredFocusPopular(storage) {
    if (storage !== void 0) {
      if (!storage) return false;
      try {
        return storage.getItem(FOCUS_KEY) === "1";
      } catch (_) {
        return false;
      }
    }
    return focusCache;
  }
  function writeStoredThreshold(value) {
    const parsed = parseThreshold(value);
    if (!parsed.ok) return { ok: false, value: thresholdCache, persisted: false };
    thresholdCache = parsed.value;
    return { ok: true, value: thresholdCache, persisted: persistLibrary({ [THRESHOLD_KEY]: String(thresholdCache) }) };
  }
  function writeStoredFocusPopular(value) {
    focusCache = Boolean(value);
    return { ok: true, value: focusCache, persisted: persistLibrary({ [FOCUS_KEY]: focusCache ? "1" : "0" }) };
  }
  function readStoredBatchScope(storage) {
    if (storage !== void 0) {
      if (!storage) return "all";
      try {
        return normalizeBatchScope(storage.getItem(BATCH_SCOPE_KEY));
      } catch (_) {
        return "all";
      }
    }
    return batchScopeCache;
  }
  function writeStoredBatchScope(value) {
    batchScopeCache = normalizeBatchScope(value);
    return { ok: true, value: batchScopeCache, persisted: persistLibrary({ [BATCH_SCOPE_KEY]: batchScopeCache }) };
  }
  function readStoredBatchLayout(storage) {
    if (storage !== void 0) {
      if (!storage) return "flat";
      try {
        return normalizeBatchLayout(storage.getItem(BATCH_LAYOUT_KEY));
      } catch (_) {
        return "flat";
      }
    }
    return batchLayoutCache;
  }
  function writeStoredBatchLayout(value) {
    batchLayoutCache = normalizeBatchLayout(value);
    return { ok: true, value: batchLayoutCache, persisted: persistLibrary({ [BATCH_LAYOUT_KEY]: batchLayoutCache }) };
  }

  // src/lib/remote.js
  var FETCH_MESSAGE = "xhs-enhanced:fetch";
  var COLLECT_NOTE_VIA_TAB_MESSAGE = "xhs-enhanced:collect-note-via-tab";
  var COLLECT_NOTE_MESSAGE = "xhs-enhanced:collect-note";
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
  async function fetchText(url, options = {}) {
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 3e4;
    const response = await sendToBackground({
      url,
      method: options.method || "GET",
      headers: options.headers || {},
      data: options.data,
      timeout,
      responseType: "text"
    });
    if (!response) return { ok: false, status: 0, text: "", error: "network" };
    if (!response.ok) {
      return { ok: false, status: Number(response.status) || 0, text: "", error: response.error || "network" };
    }
    return {
      ok: true,
      status: Number(response.status) || 200,
      text: typeof response.text === "string" ? response.text : "",
      contentType: response.contentType || ""
    };
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

  // src/lib/zip.js
  var MAX_ZIP_BYTES = 200 * 1024 * 1024;
  var LOCAL_HEADER_SIGNATURE = 67324752;
  var CENTRAL_SIGNATURE = 33639248;
  var EOCD_SIGNATURE = 101010256;
  var VERSION_NEEDED = 20;
  var FLAG_UTF8 = 2048;
  var METHOD_STORED = 0;
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? (3988292384 ^ c >>> 1) >>> 0 : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    const buf = bytes || new Uint8Array(0);
    let c = 4294967295;
    for (let i = 0; i < buf.length; i += 1) {
      c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
    }
    return (c ^ 4294967295) >>> 0;
  }
  function sanitizeFileName(value, fallback = "untitled", maxLength = 40) {
    const text = String(value == null ? "" : value);
    const cleaned = text.replace(/[<>:"/\\|?*]/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+/g, "").replace(/[\s.]+$/g, "").trim();
    let name = cleaned;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = "_" + name;
    const chars = Array.from(name);
    if (chars.length > maxLength) name = chars.slice(0, maxLength).join("");
    name = name.replace(/[\s.]+$/g, "");
    return name || fallback;
  }
  function pad2(value) {
    return String(value).padStart(2, "0");
  }
  function asValidDate(value) {
    const time = value && typeof value.getTime === "function" ? value.getTime() : NaN;
    return Number.isFinite(time) ? new Date(time) : /* @__PURE__ */ new Date();
  }
  function buildBatchZipFileName(now, count, partIndex = 0, partTotal = 1) {
    const date = asValidDate(now);
    const stamp = String(date.getFullYear()) + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "_" + pad2(date.getHours()) + pad2(date.getMinutes());
    const base = `XHS\u7B14\u8BB0_${stamp}_${Number(count) || 0}\u7BC7`;
    return partTotal > 1 ? `${base}_part${partIndex + 1}.zip` : `${base}.zip`;
  }
  function buildNoteFolderName(index, noteId, title) {
    const seq = String((Number(index) || 0) + 1).padStart(3, "0");
    const id = sanitizeFileName(noteId, "note");
    const suffix = sanitizeFileName(title, "", 30);
    return suffix ? `${seq}_${id}_${suffix}` : `${seq}_${id}`;
  }
  function buildFlatEntryName(index, noteId, fileName) {
    const seq = String((Number(index) || 0) + 1).padStart(3, "0");
    const id = sanitizeFileName(noteId, "note");
    const file = sanitizeFileName(String(fileName || "image.jpg").replace(/^\/+/, ""), "image.jpg", 120);
    return `${seq}_${id}_${file}`;
  }
  function buildImageFileName(order, ext, isCover = false) {
    const seq = pad2((Number(order) || 0) + 1);
    const safeExt = sanitizeFileName(String(ext || "jpg").replace(/^\.+/, ""), "jpg", 8).toLowerCase();
    return `${seq}${isCover ? "_\u5C01\u9762" : ""}.${safeExt}`;
  }
  function splitZipEntries(entries, maxBytes = MAX_ZIP_BYTES) {
    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_ZIP_BYTES;
    const list = Array.isArray(entries) ? entries : [];
    const parts = [];
    let current = [];
    let currentBytes = 0;
    for (const entry of list) {
      const size = entry && entry.bytes ? entry.bytes.length : 0;
      if (current.length && currentBytes + size > limit) {
        parts.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(entry);
      currentBytes += size;
    }
    if (current.length) parts.push(current);
    return parts;
  }
  function dosDateTime(date) {
    const d = asValidDate(date);
    const year = Math.max(1980, d.getFullYear());
    const time = (d.getHours() & 31) << 11 | (d.getMinutes() & 63) << 5 | d.getSeconds() >>> 1 & 31;
    const day = (year - 1980 & 127) << 9 | (d.getMonth() + 1 & 15) << 5 | d.getDate() & 31;
    return { time, day };
  }
  function encodeName(name) {
    const value = String(name == null ? "" : name).replace(/\\/g, "/");
    return new TextEncoder().encode(value);
  }
  function buildZip(entries, options = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const { time, day } = dosDateTime(options.now);
    const prepared = list.map((entry) => {
      const nameBytes = encodeName(entry && entry.name);
      const data = entry && entry.bytes instanceof Uint8Array ? entry.bytes : entry && entry.bytes ? new Uint8Array(entry.bytes) : new Uint8Array(0);
      return { nameBytes, data, crc: crc32(data), size: data.length };
    });
    let offset = 0;
    let centralBytes = 0;
    for (const item of prepared) {
      item.localOffset = offset;
      offset += 30 + item.nameBytes.length + item.size;
      if (offset > 4294967295) throw new RangeError("zip-too-large");
      centralBytes += 46 + item.nameBytes.length;
    }
    const eocdBytes = 22;
    const total = offset + centralBytes + eocdBytes;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let cursor = 0;
    for (const item of prepared) {
      view.setUint32(cursor, LOCAL_HEADER_SIGNATURE, true);
      view.setUint16(cursor + 4, VERSION_NEEDED, true);
      view.setUint16(cursor + 6, FLAG_UTF8, true);
      view.setUint16(cursor + 8, METHOD_STORED, true);
      view.setUint16(cursor + 10, time, true);
      view.setUint16(cursor + 12, day, true);
      view.setUint32(cursor + 14, item.crc, true);
      view.setUint32(cursor + 18, item.size, true);
      view.setUint32(cursor + 22, item.size, true);
      view.setUint16(cursor + 26, item.nameBytes.length, true);
      view.setUint16(cursor + 28, 0, true);
      cursor += 30;
      out.set(item.nameBytes, cursor);
      cursor += item.nameBytes.length;
      out.set(item.data, cursor);
      cursor += item.size;
    }
    const centralStart = cursor;
    for (const item of prepared) {
      view.setUint32(cursor, CENTRAL_SIGNATURE, true);
      view.setUint16(cursor + 4, VERSION_NEEDED, true);
      view.setUint16(cursor + 6, VERSION_NEEDED, true);
      view.setUint16(cursor + 8, FLAG_UTF8, true);
      view.setUint16(cursor + 10, METHOD_STORED, true);
      view.setUint16(cursor + 12, time, true);
      view.setUint16(cursor + 14, day, true);
      view.setUint32(cursor + 16, item.crc, true);
      view.setUint32(cursor + 20, item.size, true);
      view.setUint32(cursor + 24, item.size, true);
      view.setUint16(cursor + 28, item.nameBytes.length, true);
      view.setUint16(cursor + 30, 0, true);
      view.setUint16(cursor + 32, 0, true);
      view.setUint16(cursor + 34, 0, true);
      view.setUint16(cursor + 36, 0, true);
      view.setUint32(cursor + 38, 0, true);
      view.setUint32(cursor + 42, item.localOffset, true);
      cursor += 46;
      out.set(item.nameBytes, cursor);
      cursor += item.nameBytes.length;
    }
    view.setUint32(cursor, EOCD_SIGNATURE, true);
    view.setUint16(cursor + 4, 0, true);
    view.setUint16(cursor + 6, 0, true);
    view.setUint16(cursor + 8, prepared.length, true);
    view.setUint16(cursor + 10, prepared.length, true);
    view.setUint32(cursor + 12, centralBytes, true);
    view.setUint32(cursor + 16, centralStart, true);
    view.setUint16(cursor + 20, 0, true);
    return out;
  }

  // src/lib/selection.js
  var SELECTION_STORAGE_KEY = "xhs-enhanced:batch-selected";
  function validateSnapshot(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = String(entry.id || "").trim();
    if (!id) return null;
    return {
      id,
      link: String(entry.link || ""),
      coverUrl: String(entry.coverUrl || ""),
      title: String(entry.title || ""),
      ts: Number(entry.ts) || Date.now()
    };
  }
  function createSelectionStore(storage) {
    const map = /* @__PURE__ */ new Map();
    let hydrated = false;
    let hydratePromise = null;
    let persistTimer = null;
    async function hydrate2() {
      if (hydrated) return map.size;
      if (hydratePromise) return hydratePromise;
      hydratePromise = (async () => {
        try {
          if (storage && typeof storage.get === "function") {
            const items = await storage.get(SELECTION_STORAGE_KEY);
            const list = items && items[SELECTION_STORAGE_KEY];
            if (Array.isArray(list)) {
              for (const raw of list) {
                const value = validateSnapshot(raw);
                if (value && !map.has(value.id)) map.set(value.id, value);
              }
            }
          }
        } catch (_) {
        }
        hydrated = true;
        return map.size;
      })();
      return hydratePromise;
    }
    function payload() {
      return { [SELECTION_STORAGE_KEY]: Array.from(map.values()) };
    }
    function persistNow() {
      if (!storage || typeof storage.set !== "function") return Promise.resolve(false);
      try {
        return Promise.resolve(storage.set(payload())).then(() => true, () => false);
      } catch (_) {
        return Promise.resolve(false);
      }
    }
    function clearPending() {
      if (persistTimer !== null && typeof globalThis.clearTimeout === "function") {
        globalThis.clearTimeout(persistTimer);
      }
      persistTimer = null;
    }
    function schedulePersist() {
      if (!storage) return;
      clearPending();
      if (typeof globalThis.setTimeout !== "function") {
        persistNow();
        return;
      }
      persistTimer = globalThis.setTimeout(() => {
        persistTimer = null;
        persistNow();
      }, 300);
    }
    return Object.freeze({
      get size() {
        return map.size;
      },
      hydrate: hydrate2,
      flush: persistNow,
      has(id) {
        return map.has(String(id || ""));
      },
      get(id) {
        return map.get(String(id || "")) || null;
      },
      values() {
        return Array.from(map.values());
      },
      ids() {
        return Array.from(map.keys());
      },
      add(item) {
        const value = validateSnapshot(item);
        if (!value) return false;
        const isNew = !map.has(value.id);
        map.set(value.id, value);
        schedulePersist();
        return isNew;
      },
      remove(id) {
        const had = map.delete(String(id || ""));
        if (had) schedulePersist();
        return had;
      },
      toggle(item) {
        const value = validateSnapshot(item);
        if (!value) return null;
        if (map.has(value.id)) {
          map.delete(value.id);
          schedulePersist();
          return false;
        }
        map.set(value.id, value);
        schedulePersist();
        return true;
      },
      clear() {
        if (!map.size) return false;
        map.clear();
        clearPending();
        persistNow();
        return true;
      }
    });
  }

  // src/lib/goods.js
  var GOODS_ROUTE_RE = /^\/goods-detail\/[^/?#]+/;
  var IMAGE_CDN_HOST_RE = /(^|\.)xhscdn\.com$/i;
  var IMAGE_CDN_EXACT_HOSTS = /* @__PURE__ */ new Set(["ci.xiaohongshu.com", "img.xiaohongshu.com", "qimg.xiaohongshu.com"]);
  var STATIC_ASSET_PATH_RE = /\.(?:m?js|css|mjs|map|json|woff2?|ttf|otf|svg|html|txt)(\?|$|!)/i;
  var STATIC_ASSET_HOST_RE = /(^|\.)(?:fe-static|formula-static)\.xhscdn\.com$/i;
  var DECORATION_RE = /(avatar|emoji|favicon|logo|spacer|placeholder|1x1)/i;
  var TRAILING_JUNK_RE = /(?:[.,;:!?>)]+|&[a-z#0-9]+;)$/i;
  var URL_TEXT_RE = /https?:\/\/[^\s"'<>()\\]+/g;
  var GOODS_SECTIONS = Object.freeze(["main", "detail", "sku", "other"]);
  var GOODS_SECTION_LABELS = Object.freeze({ main: "\u4E3B\u56FE", detail: "\u8BE6\u60C5\u56FE", sku: "SKU \u56FE", other: "\u5176\u5B83" });
  var SECTION_DETAIL_SELECTOR = '[class*="graphic-detail"]';
  var SECTION_MAIN_SELECTOR = '[class*="layout-swiper"], [class*="layout-slide"], [class*="swiper"], [class*="scroll-x"], [class*="carousel-container"], [class*="carousel-image"], [class*="swiper-area"]';
  var DOCUMENT_POSITION_FOLLOWING = 4;
  function classifyGoodsSection(node, doc) {
    if (!node || typeof node.closest !== "function") return "other";
    if (node.closest(SECTION_DETAIL_SELECTOR)) return "detail";
    const scope = doc || (node.ownerDocument || null);
    const detailRoot = scope && typeof scope.querySelector === "function" ? scope.querySelector(SECTION_DETAIL_SELECTOR) : null;
    const mainHit = node.closest(SECTION_MAIN_SELECTOR);
    const beforeDetail = !detailRoot || typeof node.compareDocumentPosition !== "function" || Boolean(node.compareDocumentPosition(detailRoot) & DOCUMENT_POSITION_FOLLOWING);
    if (mainHit) return beforeDetail ? "main" : "other";
    return beforeDetail ? "main" : "other";
  }
  function countGoodsSections(entries) {
    const counts = { main: 0, detail: 0, sku: 0, other: 0 };
    for (const entry of entries || []) {
      const section = entry && entry.section;
      if (section === "main" || section === "detail" || section === "sku") counts[section] += 1;
      else counts.other += 1;
    }
    return counts;
  }
  var GOODS_COMPRESS_MAX_BYTES = 3 * 1024 * 1024;
  var JPEG_QUALITY_LADDER = Object.freeze([0.85, 0.75, 0.65, 0.55, 0.45]);
  var SCALE_DOWN_FACTOR = 0.85;
  var SCALE_DOWN_MIN = 0.35;
  function shouldCompressGoodsImage(section, byteLength, enabled) {
    if (!enabled) return false;
    if (section !== "main" && section !== "sku") return false;
    const size = Number(byteLength);
    if (!Number.isFinite(size) || size <= 0) return false;
    return size > GOODS_COMPRESS_MAX_BYTES;
  }
  function scaledDimensions(width, height, factor) {
    const f = Number(factor);
    const w = Math.max(1, Math.floor((Number(width) || 1) * (Number.isFinite(f) ? f : 1)));
    const h = Math.max(1, Math.floor((Number(height) || 1) * (Number.isFinite(f) ? f : 1)));
    return { width: w, height: h };
  }
  function isGoodsDetailRoute(href) {
    const text = String(href || "");
    if (!text) return false;
    let pathname = text;
    try {
      pathname = new URL(text, "https://www.xiaohongshu.com").pathname;
    } catch (_) {
      const cut = text.search(/[?#]/);
      if (cut >= 0) pathname = text.slice(0, cut);
    }
    return GOODS_ROUTE_RE.test(pathname);
  }
  function getGoodsIdFromHref(href) {
    const text = String(href || "");
    let pathname = text;
    try {
      pathname = new URL(text, "https://www.xiaohongshu.com").pathname;
    } catch (_) {
      const cut = text.search(/[?#]/);
      if (cut >= 0) pathname = text.slice(0, cut);
    }
    const match = pathname.match(/^\/goods-detail\/([0-9a-zA-Z_-]{6,})/);
    return match ? match[1] : "";
  }
  function isXhsImageCdnUrl(url) {
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      const host = u.hostname.toLowerCase();
      return IMAGE_CDN_HOST_RE.test(host) || IMAGE_CDN_EXACT_HOSTS.has(host);
    } catch (_) {
      return false;
    }
  }
  function extractUrlsFromText(text) {
    const source = String(text || "").replace(/\\u002[fF]/g, "/");
    const out = [];
    const matches = source.match(URL_TEXT_RE) || [];
    for (const raw of matches) {
      const trimmed = raw.replace(TRAILING_JUNK_RE, "");
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        out.push(u.href);
      } catch (_) {
      }
    }
    return out;
  }
  function looksLikeGoodsImageUrl(url, options) {
    if (!isXhsImageCdnUrl(url)) return false;
    let u;
    try {
      u = new URL(String(url || ""));
    } catch (_) {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (STATIC_ASSET_HOST_RE.test(host)) return false;
    const path = u.pathname;
    if (STATIC_ASSET_PATH_RE.test(path)) return false;
    const includeDecorations2 = Boolean(options && options.includeDecorations);
    if (!includeDecorations2 && DECORATION_RE.test(host + path)) return false;
    return true;
  }
  function canonicalGoodsImageKey(url) {
    try {
      const u = new URL(String(url || ""));
      const path = u.pathname.replace(/![^/]*$/, "");
      return (u.hostname.toLowerCase() + path).toLowerCase();
    } catch (_) {
      return String(url || "");
    }
  }
  function rankGoodsImageCandidate(url) {
    const text = String(url || "");
    const widthMatch = text.match(/\/w\/(\d{2,5})/);
    if (!widthMatch) return 4096;
    return Math.min(Number(widthMatch[1]) || 0, 4096);
  }
  function dedupeGoodsImages(urls) {
    const bestByKey = /* @__PURE__ */ new Map();
    const order = [];
    for (const raw of urls || []) {
      const url = String(raw || "").trim();
      if (!url || !isXhsImageCdnUrl(url)) continue;
      const key = canonicalGoodsImageKey(url);
      const prev = bestByKey.get(key);
      if (!prev) {
        bestByKey.set(key, url);
        order.push(key);
        continue;
      }
      if (rankGoodsImageCandidate(url) > rankGoodsImageCandidate(prev)) {
        bestByKey.set(key, url);
      }
    }
    return order.map((key) => bestByKey.get(key));
  }
  function normalizeGoodsSection(value) {
    return value === "main" || value === "detail" || value === "sku" ? value : "other";
  }
  var GOODS_DETAIL_SLICE_HEIGHT = 1500;
  function planDetailImageGroups(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const groups = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      const next = list[i + 1];
      const w = Math.round(Number(item && item.width) || 0);
      const h = Math.round(Number(item && item.height) || 0);
      const nw = Math.round(Number(next && next.width) || 0);
      const nh = Math.round(Number(next && next.height) || 0);
      const isSplit = item && item.section === "detail" && next && next.section === "detail" && w > 0 && nw === w && h === GOODS_DETAIL_SLICE_HEIGHT && nh > 0 && nh < GOODS_DETAIL_SLICE_HEIGHT;
      if (isSplit) {
        groups.push([i, i + 1]);
        i += 1;
      } else {
        groups.push([i]);
      }
    }
    return groups;
  }
  function dedupeSkuEntries(entries) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const entry of entries || []) {
      const skuName = normalizeSpace(entry && entry.skuName).slice(0, 60);
      const url = String(entry && entry.url || "").trim();
      if (!skuName || !url || !looksLikeGoodsImageUrl(url, {})) continue;
      const key = skuName + "|" + canonicalGoodsImageKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, section: "sku", skuName });
    }
    return out;
  }
  function collectGoodsImageEntries(domEntries, textUrls, options) {
    const merged = [];
    for (const item of domEntries || []) {
      const url = String(item && item.url || "").trim();
      if (!url) continue;
      merged.push({ url, section: normalizeGoodsSection(item.section) });
    }
    for (const url of textUrls || []) {
      const clean = String(url || "").trim();
      if (!clean) continue;
      merged.push({ url: clean, section: "other" });
    }
    const filtered = merged.filter((item) => looksLikeGoodsImageUrl(item.url, options));
    const bestByKey = /* @__PURE__ */ new Map();
    const order = [];
    for (const item of filtered) {
      const key = canonicalGoodsImageKey(item.url);
      const prev = bestByKey.get(key);
      if (!prev) {
        bestByKey.set(key, item);
        order.push(key);
        continue;
      }
      const mergedSection = prev.section === "other" && item.section !== "other" ? item.section : prev.section;
      if (rankGoodsImageCandidate(item.url) > rankGoodsImageCandidate(prev.url)) {
        bestByKey.set(key, { url: item.url, section: mergedSection });
      } else if (mergedSection !== prev.section) {
        bestByKey.set(key, { url: prev.url, section: mergedSection });
      }
    }
    return order.map((key) => bestByKey.get(key));
  }
  var GOODS_FORMAT_MODES = Object.freeze([
    { value: "png", label: "\u9AD8\u6E05 PNG" },
    { value: "original", label: "\u539F\u59CB\u683C\u5F0F" },
    { value: "jpeg", label: "JPEG q90" }
  ]);
  var GOODS_FORMAT_LABELS = Object.freeze({ png: "\u9AD8\u6E05 PNG\uFF08imageView2/2/format/png\uFF09", original: "\u539F\u59CB\u683C\u5F0F\uFF08\u4E0D\u6539\u5199\u53C2\u6570\uFF09", jpeg: "JPEG q90\uFF08imageView2/2/format/jpeg/q/90\uFF09" });
  function toHDGoodsUrl(url, mode) {
    const search = mode === "original" ? "" : mode === "jpeg" ? "?imageView2/2/format/jpeg/q/90" : "?imageView2/2/format/png";
    try {
      const u = new URL(String(url || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return String(url || "");
      u.search = search;
      return u.href;
    } catch (_) {
      return String(url || "");
    }
  }
  function extensionForMime(mime, fallback = "png") {
    const text = String(mime || "").toLowerCase();
    if (/jpeg|jpg/.test(text)) return "jpg";
    if (/png/.test(text)) return "png";
    if (/webp/.test(text)) return "webp";
    if (/gif/.test(text)) return "gif";
    if (/avif/.test(text)) return "avif";
    if (/heic/.test(text)) return "heic";
    const safe = normalizeSpace(fallback).replace(/[^a-z0-9]/gi, "").toLowerCase();
    return safe || "png";
  }
  function pad22(value) {
    return String(value).padStart(2, "0");
  }
  function buildGoodsZipFileName(now, count, goodsId, partIndex = 0, partTotal = 1) {
    const date = now && typeof now.getTime === "function" && !Number.isNaN(now.getTime()) ? now : /* @__PURE__ */ new Date();
    const stamp = String(date.getFullYear()) + pad22(date.getMonth() + 1) + pad22(date.getDate()) + "_" + pad22(date.getHours()) + pad22(date.getMinutes());
    const safeId = String(normalizeSpace(goodsId || "") || "unknown").replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 32) || "unknown";
    const base = `\u5C0F\u7EA2\u4E66\u5546\u54C1\u9AD8\u6E05\u56FE_${safeId}_${stamp}_${Number(count) || 0}\u5F20`;
    return partTotal > 1 ? `${base}_part${partIndex + 1}.zip` : `${base}.zip`;
  }
  function buildGoodsImageFileName(index, ext, section) {
    const seq = String((Number(index) || 0) + 1).padStart(2, "0");
    const safeExt = String(ext || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    const prefix = section === "main" ? "\u4E3B\u56FE" : section === "detail" ? "\u8BE6\u60C5\u56FE" : section ? "\u5176\u5B83" : "";
    return prefix ? `${prefix}_${seq}.${safeExt}` : `${seq}.${safeExt}`;
  }
  function buildGoodsSkuImageFileName(skuName, index, ext) {
    const seq = String((Number(index) || 0) + 1).padStart(2, "0");
    const safeExt = String(ext || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
    const safeName = sanitizeFileName(skuName || "", "\u89C4\u683C", 40) || "\u89C4\u683C";
    return `SKU_${safeName}_${seq}.${safeExt}`;
  }
  function buildGoodsInfoText(meta) {
    const m = meta || {};
    const lines = [
      "\u5C0F\u7EA2\u4E66\u5546\u54C1\u9AD8\u6E05\u56FE",
      "\u5546\u54C1\u94FE\u63A5\uFF1A" + (m.pageUrl || ""),
      "\u5546\u54C1 ID\uFF1A" + (m.goodsId || ""),
      "\u5546\u54C1\u6807\u9898\uFF1A" + (m.title || ""),
      "\u626B\u63CF\u65F6\u95F4\uFF1A" + (m.scannedAt || ""),
      "\u56FE\u7247\u6570\u91CF\uFF1A" + (Number(m.count) || 0),
      "\u9AD8\u6E05\u683C\u5F0F\uFF1A" + (GOODS_FORMAT_LABELS[m.mode] || m.mode || ""),
      "\u6765\u6E90\uFF1A\u5C0F\u7EA2\u4E66\u5546\u54C1\u8BE6\u60C5\u9875\uFF08\u7531\u201C\u5C0F\u7EA2\u4E66\u7F51\u9875\u7248\u589E\u5F3A\u201D\u6269\u5C55\u6279\u91CF\u5BFC\u51FA\uFF09"
    ];
    const sections = m.sections && typeof m.sections === "object" ? m.sections : null;
    if (sections) {
      const parts = [];
      for (const section of ["main", "detail", "sku", "other"]) {
        const n = Number(sections[section]) || 0;
        if (n > 0) parts.push(GOODS_SECTION_LABELS[section] + " " + n + " \u5F20");
      }
      if (parts.length) {
        const at = lines.findIndex((line) => line.indexOf("\u56FE\u7247\u6570\u91CF\uFF1A") === 0);
        lines.splice(at + 1, 0, "\u5206\u533A\uFF1A" + parts.join("\uFF0C"));
      }
    }
    const skus = Array.isArray(m.skus) ? m.skus : null;
    if (skus && skus.length) {
      const sourceAt = lines.findIndex((line) => line.indexOf("\u6765\u6E90\uFF1A") === 0);
      const skuLines = ["SKU \u89C4\u683C\uFF1A"];
      for (const sku of skus) {
        skuLines.push("  " + String(sku && sku.name || "") + " \u2192 " + String(sku && sku.file || ""));
      }
      lines.splice(sourceAt >= 0 ? sourceAt : lines.length, 0, ...skuLines);
    }
    const addCompressLine = (label, meta2) => {
      if (!meta2 || typeof meta2 !== "object") return;
      const pieces = [label + "\u538B\u7F29\uFF1A" + (meta2.enabled ? "\u5F00\u542F\uFF08\u76EE\u6807 \u22643MB\uFF09" : "\u5173\u95ED")];
      if (Number(meta2.compressed) > 0) pieces.push("\u5DF2\u538B\u7F29 " + Number(meta2.compressed) + " \u5F20");
      if (Number(meta2.oversize) > 0) pieces.push("\u4ECD\u8D85\u8FC7 3MB " + Number(meta2.oversize) + " \u5F20");
      if (Number(meta2.failed) > 0) pieces.push("\u65E0\u6CD5\u89E3\u7801 " + Number(meta2.failed) + " \u5F20\uFF08\u4FDD\u7559\u539F\u56FE\uFF09");
      lines.splice(lines.length - 1, 0, pieces.join("\uFF0C"));
    };
    addCompressLine("\u4E3B\u56FE", m.compressMain);
    addCompressLine("SKU \u56FE", m.compressSku);
    const stitched = Number(m.stitched) || 0;
    if (stitched > 0) {
      lines.splice(lines.length - 1, 0, "\u8BE6\u60C5\u56FE\u62FC\u63A5\uFF1A" + stitched + " \u7EC4\uFF08\u4E0A\u4E0B\u5207\u7247\u8FD8\u539F\u4E3A\u6574\u56FE\uFF09");
    }
    return lines.join("\n") + "\n";
  }
  function getGoodsTitleFromDocument(documentRef) {
    try {
      const doc = documentRef || (typeof document !== "undefined" ? document : null);
      const raw = doc && doc.title ? String(doc.title) : "";
      const cleaned = normalizeSpace(raw.replace(/\s*[-–_|]\s*小红书\s*$/, "").replace(/^(小红书\s*[-–_|]\s*)/, ""));
      return cleaned;
    } catch (_) {
      return "";
    }
  }

  // src/content/goods.js
  var ROOT = getRoot();
  var PANEL_ID = "xhs-enhanced-goods-panel";
  var SCAN_BUTTON_ID = "xhs-enhanced-goods-scan";
  var DOWNLOAD_BUTTON_ID = "xhs-enhanced-goods-download";
  var COUNT_ID = "xhs-enhanced-goods-count";
  var STATUS_ID = "xhs-enhanced-goods-status";
  var FORMAT_ID = "xhs-enhanced-goods-format";
  var DECOR_ID = "xhs-enhanced-goods-decorations";
  var COMPRESS_ID = "xhs-enhanced-goods-compress-main";
  var SKU_ID = "xhs-enhanced-goods-sku";
  var SKU_HOOK_ATTR = "data-xhs-enhanced-sku-hook";
  var SKU_MSG = "xhs-enhanced:sku-variant-data";
  var TITLE_TEXT = "\u{1F4F7} \u5546\u54C1\u9AD8\u6E05\u56FE\u4E0B\u8F7D";
  var COUNT_EMPTY = "\u672A\u626B\u63CF";
  var COUNT_NONE = "\u672A\u53D1\u73B0\u5C0F\u7EA2\u4E66\u5546\u54C1\u56FE\u7247";
  var COUNT_FOUND_PREFIX = "\u53D1\u73B0\u9AD8\u6E05\u56FE\u7247\uFF1A";
  var panel = null;
  var countNode = null;
  var statusNode = null;
  var scanButton = null;
  var downloadButton = null;
  var formatSelect = null;
  var decorToggle = null;
  var compressToggle = null;
  var skuToggle = null;
  var pendingSkuResolve = null;
  var skuMessageBound = false;
  var observer = null;
  var rescanTimer = null;
  var autoScanTimer = null;
  var currentImages = [];
  var includeDecorations = false;
  var formatMode = "png";
  var compressMainEnabled = true;
  var skuEnabled = true;
  var inFlight = false;
  function utf8Bytes(text) {
    const source = String(text == null ? "" : text);
    if (typeof TextEncoder !== "undefined") {
      try {
        return new TextEncoder().encode(source);
      } catch (_) {
      }
    }
    const bytes = [];
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else if (code < 2048) bytes.push(192 | code >> 6, 128 | code & 63);
      else bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    }
    return new Uint8Array(bytes);
  }
  function setStatus(message) {
    if (statusNode && statusNode.isConnected) statusNode.textContent = message || "";
  }
  function formatSectionCounts(counts) {
    const parts = [];
    for (const section of ["main", "detail", "sku", "other"]) {
      const n = counts[section] || 0;
      if (n > 0) parts.push(GOODS_SECTION_LABELS[section] + " " + n);
    }
    return parts.join(" \xB7 ");
  }
  function updateCountLabel() {
    if (!countNode || !countNode.isConnected) return;
    countNode.textContent = currentImages.length ? COUNT_FOUND_PREFIX + formatSectionCounts(countGoodsSections(currentImages)) + " \u5F20" : COUNT_NONE;
  }
  function setBusy(busy) {
    inFlight = busy;
    if (scanButton) scanButton.disabled = busy;
    if (downloadButton) downloadButton.disabled = busy;
    if (downloadButton) downloadButton.textContent = busy ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u4E0B\u8F7D\u9AD8\u6E05\u56FE";
  }
  function collectDomImageEntries(doc) {
    const out = [];
    if (!doc) return out;
    const imageNodes = Array.from(doc.querySelectorAll("img,source"));
    for (const node of imageNodes) {
      const section = classifyGoodsSection(node, doc);
      const push = (url) => {
        if (url) out.push({ url, section });
      };
      if (node.currentSrc) push(node.currentSrc);
      for (const attribute of ["src", "data-src", "data-original", "data-lazy-src", "data-actualsrc", "data-originalsrc"]) {
        const value = node.getAttribute && node.getAttribute(attribute);
        if (value) push(value);
      }
      const srcset = node.getAttribute ? node.getAttribute("srcset") || node.getAttribute("data-srcset") || node.getAttribute("data-original-srcset") || "" : "";
      if (srcset) {
        const largest = pickLargestFromSrcset(srcset);
        if (largest) push(largest);
      }
    }
    const styledNodes = doc.querySelectorAll ? Array.from(doc.querySelectorAll('[style*="background"]')) : [];
    for (const node of styledNodes) {
      const style = node.getAttribute && node.getAttribute("style");
      if (!style) continue;
      const match = String(style).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
      if (match && match[1]) out.push({ url: match[1], section: classifyGoodsSection(node, doc) });
    }
    return out;
  }
  function computeImages(doc, options) {
    const dom = collectDomImageEntries(doc);
    const html = doc && doc.documentElement ? String(doc.documentElement.innerHTML || "") : "";
    const textUrls = extractUrlsFromText(html);
    return collectGoodsImageEntries(dom, textUrls, options);
  }
  function rescan(silent) {
    const doc = ROOT.document;
    if (!doc) return 0;
    currentImages = computeImages(doc, { includeDecorations });
    updateCountLabel();
    if (!silent) setStatus(currentImages.length ? "\u626B\u63CF\u5B8C\u6210\uFF1A" + currentImages.length + " \u5F20" : COUNT_NONE);
    return currentImages.length;
  }
  function extForImage(bytes, contentType, url) {
    const sniffed = bytes ? sniffImageMimeFromBytes(bytes) : "";
    if (sniffed) return extensionForMime(sniffed);
    const fromType = String(contentType || "").split(";")[0].trim();
    if (/image\//.test(fromType)) return extensionForMime(fromType);
    const match = String(url || "").match(/\.(png|jpe?g|webp|gif|avif|heic)(?:[!?#]|$)/i);
    if (match && match[1]) return match[1].toLowerCase().replace("jpeg", "jpg");
    return formatMode === "jpeg" ? "jpg" : "png";
  }
  function createImageBitmapSafe(bytes) {
    const source = bytes && bytes.length ? new Blob([bytes]) : null;
    if (!source) return Promise.resolve(null);
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(source).then((bitmap) => bitmap || null, () => null);
    }
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(source);
        const img = new Image();
        img.onload = () => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {
          }
          resolve(img);
        };
        img.onerror = () => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {
          }
          resolve(null);
        };
        img.src = url;
      } catch (_) {
        resolve(null);
      }
    });
  }
  function sourceDimensions(source) {
    const width = Number(source && (source.width || source.naturalWidth)) || 0;
    const height = Number(source && (source.height || source.naturalHeight)) || 0;
    return { width, height };
  }
  async function imageSize(bytes) {
    const source = await createImageBitmapSafe(bytes);
    if (!source) return {};
    const size = sourceDimensions(source);
    try {
      if (source.close) source.close();
    } catch (_) {
    }
    return size;
  }
  function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve) => {
      try {
        if (typeof canvas.convertToBlob === "function") {
          canvas.convertToBlob({ type: "image/jpeg", quality }).then((b) => resolve(b || null), () => resolve(null));
          return;
        }
        if (typeof canvas.toBlob === "function") {
          canvas.toBlob((b) => resolve(b || null), "image/jpeg", quality);
          return;
        }
        resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  async function compressGoodsImageToLimit(bytes) {
    const source = await createImageBitmapSafe(bytes);
    if (!source) return null;
    const { width, height } = sourceDimensions(source);
    if (!width || !height) {
      try {
        if (source.close) source.close();
      } catch (_) {
      }
      return null;
    }
    let bestBlob = null;
    const attempt = async (w, h) => {
      let canvas;
      try {
        if (typeof OffscreenCanvas === "function") canvas = new OffscreenCanvas(w, h);
        else if (ROOT.document) {
          canvas = ROOT.document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
        } else return null;
      } catch (_) {
        return null;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try {
        ctx.drawImage(source, 0, 0, w, h);
      } catch (_) {
        return null;
      }
      for (const quality of JPEG_QUALITY_LADDER) {
        const blob2 = await canvasToJpegBlob(canvas, quality);
        if (!blob2) continue;
        if (!bestBlob || blob2.size < bestBlob.size) bestBlob = blob2;
        if (blob2.size <= GOODS_COMPRESS_MAX_BYTES) return blob2;
      }
      return null;
    };
    let blob = await attempt(width, height);
    if (!blob) {
      let factor = SCALE_DOWN_FACTOR;
      while (!blob && factor >= SCALE_DOWN_MIN) {
        const dims = scaledDimensions(width, height, factor);
        blob = await attempt(dims.width, dims.height);
        factor = Math.round((factor - 0.15) * 100) / 100;
      }
    }
    try {
      if (source.close) source.close();
    } catch (_) {
    }
    return blob || bestBlob;
  }
  function installSkuNetworkHook() {
    const doc = ROOT.document;
    if (!doc || !doc.documentElement || doc.documentElement.hasAttribute(SKU_HOOK_ATTR)) return;
    try {
      doc.documentElement.setAttribute(SKU_HOOK_ATTR, "1");
      const script = doc.createElement("script");
      script.textContent = `(function(){
  var MSG = ${JSON.stringify(SKU_MSG)};
  function send(body){ try { window.postMessage({__xhsEnhancedSku:true, body:body}, '*'); } catch(e){} }
  function watch(xhr){
    try {
      xhr.addEventListener('load', function(){
        try {
          var u = String(this.__xhsSkuUrl || this.responseURL || '');
          if (u.indexOf('/toc/variant') < 0) return;
          var b = this.responseText;
          if (b) send(b);
        } catch(e){}
      });
    } catch(e){}
  }
  var XhrCtor = window['XML' + 'HttpRequest'];
  var Open = XhrCtor.prototype.open;
  XhrCtor.prototype.open = function(method, url){
    try { if (String(url||'').indexOf('/toc/variant') >= 0) this.__xhsSkuUrl = String(url); } catch(e){}
    try { watch(this); } catch(e){}
    return Open.apply(this, arguments);
  };
  var NativeFetch = window.fetch;
  if (typeof NativeFetch === 'function') {
    window.fetch = function(input, init){
      var p = NativeFetch.apply(this, arguments);
      try {
        var u = String((input && input.url) || input || '');
        if (u.indexOf('/toc/variant') >= 0) {
          p.then(function(r){ return r.clone().text().then(send); }).catch(function(){});
        }
      } catch(e){}
      return p;
    };
  }
})();`;
      (doc.head || doc.documentElement).appendChild(script);
    } catch (_) {
    }
  }
  function onSkuMessage(event) {
    const data = event && event.data;
    if (!data || data.__xhsEnhancedSku !== true || typeof data.body !== "string") return;
    if (!pendingSkuResolve) return;
    const resolve = pendingSkuResolve;
    pendingSkuResolve = null;
    resolve(data.body);
  }
  function waitForSkuData(timeoutMs) {
    return new Promise((resolve) => {
      const timer = ROOT.setTimeout(() => {
        if (pendingSkuResolve) {
          pendingSkuResolve = null;
          resolve("");
        }
      }, timeoutMs);
      pendingSkuResolve = (body) => {
        ROOT.clearTimeout(timer);
        resolve(body);
      };
    });
  }
  function parseSkuVariantResponse(body) {
    let data;
    try {
      data = JSON.parse(String(body || ""));
    } catch (_) {
      return [];
    }
    const templates = data && data.data && data.data.template_data;
    if (!Array.isArray(templates)) return [];
    const out = [];
    for (const item of templates) {
      const variants = item && item.contentE1 && item.contentE1.variants;
      const value = Array.isArray(variants) && variants[0] ? variants[0].value : null;
      const url = item && item.headerV4 && item.headerV4.previewImage;
      if (value && url) out.push({ url, section: "sku", skuName: value });
    }
    return dedupeSkuEntries(out);
  }
  function closeSkuPanel(doc) {
    try {
      const zoom = doc.querySelector('img[data-action="zoom"]');
      if (!zoom) return;
      let root = zoom.parentElement;
      while (root && root !== doc.body && !/数量|加入购物车/.test(String(root.textContent || ""))) {
        root = root.parentElement;
      }
      const close = root && root.querySelector('svg[width="14"][height="14"]');
      if (close && close.parentElement) close.parentElement.click();
    } catch (_) {
    }
  }
  async function collectSkuVariants() {
    const doc = ROOT.document;
    if (!doc) return [];
    const anchor = doc.querySelector("p.selected-text");
    if (!anchor || typeof anchor.click !== "function") return [];
    const selectedName = normalizeSpace(anchor.textContent || "").slice(0, 60);
    closeSkuPanel(doc);
    const captured = waitForSkuData(4e3);
    try {
      anchor.click();
    } catch (_) {
    }
    let body = "";
    try {
      body = await captured;
    } catch (_) {
    }
    const entries = body ? parseSkuVariantResponse(body) : [];
    if (entries.length < 2) {
      const domEntries = await collectSkuFromDom(doc, anchor, selectedName);
      if (domEntries.length > entries.length) {
        entries.length = 0;
        entries.push(...domEntries);
      }
    }
    closeSkuPanel(doc);
    return entries;
  }
  var SKU_STATIC_LABELS = /* @__PURE__ */ new Set([
    "\u6570\u91CF",
    "\u52A0\u5165\u8D2D\u7269\u8F66",
    "\u7ACB\u5373\u8D2D\u4E70",
    "\u989C\u8272\u5206\u7C7B",
    "\u89C4\u683C",
    "\u5DF2\u9009",
    "\u9009\u62E9\u89C4\u683C",
    "\u8FD0\u8D39",
    "7\u5929\u65E0\u7406\u7531\u9000\u8D27",
    "\u6781\u901F\u9000\u6B3E",
    "\u665A\u53D1\u5FC5\u8D54"
  ]);
  function skuPreviewSrc(doc) {
    const img = doc.querySelector('img[data-action="zoom"]');
    return img && img.src ? img.src : "";
  }
  function waitForSkuPreview(doc, prevSrc, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const src = skuPreviewSrc(doc);
        if (src && src !== prevSrc) return resolve(src);
        if (Date.now() - start >= timeoutMs) return resolve("");
        ROOT.setTimeout(tick, 50);
      };
      tick();
    });
  }
  async function collectSkuFromDom(doc, anchor, selectedName) {
    const out = [];
    let preview = skuPreviewSrc(doc);
    if (!preview) {
      try {
        anchor.click();
      } catch (_) {
      }
      preview = await waitForSkuPreview(doc, "", 2e3);
    }
    if (!preview) return out;
    if (selectedName) out.push({ url: preview, section: "sku", skuName: selectedName });
    let root = doc.querySelector('img[data-action="zoom"]');
    if (!root) return dedupeSkuEntries(out);
    root = root.parentElement;
    while (root && root !== doc.body && !/数量|加入购物车/.test(String(root.textContent || ""))) {
      root = root.parentElement;
    }
    if (!root || root === doc.body) return dedupeSkuEntries(out);
    const chips = Array.from(root.querySelectorAll("*")).filter((el) => {
      if (el.children.length || el.closest("svg") || el.closest("button")) return false;
      const text = normalizeSpace(el.textContent || "");
      return text && text.length <= 40 && !/^[\d.]+$/.test(text) && !SKU_STATIC_LABELS.has(text);
    });
    for (const chip of chips) {
      const name = normalizeSpace(chip.textContent || "").slice(0, 60);
      if (!name) continue;
      const before = skuPreviewSrc(doc);
      try {
        chip.click();
      } catch (_) {
        continue;
      }
      const after = await waitForSkuPreview(doc, before, 800);
      if (after) out.push({ url: after, section: "sku", skuName: name });
    }
    if (selectedName) {
      const original = chips.find((el) => normalizeSpace(el.textContent || "") === selectedName);
      if (original) {
        try {
          original.click();
        } catch (_) {
        }
      }
    }
    return dedupeSkuEntries(out);
  }
  function mapWithConcurrencyLocal(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const lanes = [];
    const results = new Array(list.length);
    let cursor = 0;
    const width = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
    for (let lane = 0; lane < width; lane += 1) {
      lanes.push((async () => {
        while (cursor < list.length) {
          const index = cursor;
          cursor += 1;
          try {
            results[index] = await worker(list[index], index);
          } catch (_) {
            results[index] = null;
          }
        }
      })());
    }
    return Promise.all(lanes).then(() => results);
  }
  function onDownload() {
    if (inFlight) return;
    const doc = ROOT.document;
    const base = currentImages.length ? currentImages.slice() : computeImages(doc, { includeDecorations });
    const finish = (images) => {
      if (!images.length) {
        setBusy(false);
        setStatus(COUNT_NONE + "\uFF0C\u8BF7\u5148\u626B\u63CF");
        return;
      }
      startPacking(images, doc);
    };
    if (!skuEnabled) {
      finish(base);
      return;
    }
    setBusy(true);
    setStatus("\u6B63\u5728\u8BFB\u53D6 SKU \u89C4\u683C\u56FE\u2026");
    collectSkuVariants().then((skuEntries) => {
      const images = base.concat(skuEntries);
      if (skuEntries.length) setStatus("\u5DF2\u8BFB\u53D6 " + skuEntries.length + " \u4E2A SKU \u89C4\u683C\uFF0C\u5F00\u59CB\u4E0B\u8F7D\u2026");
      finish(images);
    }).catch(() => finish(base));
  }
  function startPacking(images, doc) {
    const goodsId = getGoodsIdFromHref(ROOT.location ? ROOT.location.pathname : "") || "goods";
    const pageUrl = ROOT.location ? String(ROOT.location.href || "") : "";
    const title = getGoodsTitleFromDocument(doc);
    const scannedAt = (/* @__PURE__ */ new Date()).toLocaleString();
    const total = images.length;
    let done = 0;
    let failed = 0;
    setBusy(true);
    setStatus("\u6B63\u5728\u4E0B\u8F7D 0/" + total + "\u2026");
    mapWithConcurrencyLocal(images, 3, (item, index) => {
      const url = item.url || item;
      const section = item.section || "other";
      const skuName = item.skuName || "";
      const hd = toHDGoodsUrl(url, formatMode);
      return fetchBytes(hd, { timeout: 3e4 }).then((first) => {
        let res = first;
        if (!res || !res.ok) {
          if (hd !== url) {
            return fetchBytes(url, { timeout: 3e4 }).then((retry) => {
              done += 1;
              setStatus("\u6B63\u5728\u4E0B\u8F7D " + done + "/" + total + "\u2026");
              return packEntry(url, retry, section, skuName);
            });
          }
          done += 1;
          setStatus("\u6B63\u5728\u4E0B\u8F7D " + done + "/" + total + "\u2026");
          return packEntry(url, null, section, skuName);
        }
        done += 1;
        setStatus("\u6B63\u5728\u4E0B\u8F7D " + done + "/" + total + "\u2026");
        return packEntry(url, res, section, skuName);
      });
    }).then(async (packed) => {
      const fetched = [];
      for (const item of packed) {
        if (item && item.entry) fetched.push(item.entry);
        else failed += 1;
      }
      if (!fetched.length) {
        setBusy(false);
        setStatus("\u5168\u90E8 " + total + " \u5F20\u56FE\u7247\u4E0B\u8F7D\u5931\u8D25");
        return;
      }
      let stitchedCount = 0;
      const assembled = [];
      for (const group of planDetailImageGroups(fetched)) {
        if (group.length === 1) {
          assembled.push(fetched[group[0]]);
          continue;
        }
        const merged = await stitchDetailGroup(group.map((index) => fetched[index]));
        if (merged) {
          assembled.push(merged);
          stitchedCount += 1;
        } else {
          for (const index of group) assembled.push(fetched[index]);
        }
      }
      const finalEntries = assembled;
      const sectionSeq = { main: 0, detail: 0, sku: 0, other: 0 };
      const skuSeqByName = /* @__PURE__ */ new Map();
      const skuManifest = [];
      const entries = finalEntries.map((entry) => {
        const section = entry.section === "main" || entry.section === "detail" || entry.section === "sku" ? entry.section : "other";
        if (section === "sku") {
          const skuName = entry.skuName || "\u89C4\u683C";
          const seq2 = skuSeqByName.get(skuName) || 0;
          skuSeqByName.set(skuName, seq2 + 1);
          const name = buildGoodsSkuImageFileName(skuName, seq2, entry.ext);
          skuManifest.push({ name: skuName, file: name });
          return { name, bytes: entry.bytes };
        }
        const seq = sectionSeq[section] || 0;
        sectionSeq[section] = seq + 1;
        return { name: buildGoodsImageFileName(seq, entry.ext, section), bytes: entry.bytes };
      });
      const sectionCounts = countGoodsSections(finalEntries);
      const compressStats = (section) => ({
        enabled: compressMainEnabled,
        compressed: finalEntries.filter((entry) => entry.section === section && entry.compressed).length,
        failed: finalEntries.filter((entry) => entry.section === section && entry.compressFailed).length,
        oversize: finalEntries.filter((entry) => entry.section === section && entry.oversize).length
      });
      const mainStats = compressStats("main");
      const skuStats = compressStats("sku");
      const info = buildGoodsInfoText({
        pageUrl,
        goodsId,
        title,
        scannedAt,
        count: entries.length,
        mode: formatMode,
        sections: sectionCounts,
        skus: skuManifest,
        stitched: stitchedCount,
        compressMain: mainStats,
        compressSku: skuStats
      });
      entries.unshift({ name: "00_\u5546\u54C1\u4FE1\u606F.txt", bytes: utf8Bytes(info) });
      setStatus("\u6B63\u5728\u6253\u5305 " + entries.length + " \u4E2A\u6587\u4EF6\u2026");
      const now = /* @__PURE__ */ new Date();
      try {
        const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes ? entry.bytes.length : 0), 0);
        const parts = totalBytes > MAX_ZIP_BYTES ? splitZipEntries(entries, MAX_ZIP_BYTES) : [entries];
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const zipBytes = buildZip(parts[partIndex], { now });
          const zipBlob = new Blob([zipBytes], { type: "application/zip" });
          triggerCoverDownload(zipBlob, buildGoodsZipFileName(now, entries.length - 1, goodsId, partIndex, parts.length));
        }
        setBusy(false);
        const details = [];
        if (failed) details.push("\u5931\u8D25 " + failed + " \u5F20");
        const skuCount = finalEntries.filter((entry) => entry.section === "sku").length;
        if (skuCount > 0) details.push("SKU \u56FE " + skuCount + " \u5F20");
        if (stitchedCount > 0) details.push("\u8BE6\u60C5\u56FE\u62FC\u63A5 " + stitchedCount + " \u7EC4");
        if (mainStats.compressed > 0) details.push("\u4E3B\u56FE\u5DF2\u538B\u7F29 " + mainStats.compressed + " \u5F20");
        if (skuStats.compressed > 0) details.push("SKU \u56FE\u5DF2\u538B\u7F29 " + skuStats.compressed + " \u5F20");
        if (mainStats.oversize > 0) details.push("\u4E3B\u56FE " + mainStats.oversize + " \u5F20\u4ECD\u8D85\u8FC7 3MB");
        if (skuStats.oversize > 0) details.push("SKU \u56FE " + skuStats.oversize + " \u5F20\u4ECD\u8D85\u8FC7 3MB");
        setStatus("\u5DF2\u4E0B\u8F7D " + (entries.length - 1) + " \u5F20\u56FE\u7247" + (details.length ? "\uFF08" + details.join("\uFF1B") + "\uFF09" : "") + "\uFF08zip \u5DF2\u4FDD\u5B58\uFF09");
      } catch (_) {
        setBusy(false);
        setStatus("\u6253\u5305\u4E0B\u8F7D\u5931\u8D25");
      }
    }, () => {
      setBusy(false);
      setStatus("\u4E0B\u8F7D\u5931\u8D25");
    });
  }
  async function stitchDetailGroup(entries) {
    const sources = [];
    try {
      for (const entry of entries) {
        const source = await createImageBitmapSafe(entry && entry.bytes);
        if (!source) return null;
        sources.push(source);
      }
      const sizes = sources.map(sourceDimensions);
      const width = sizes[0].width;
      const height = sizes.reduce((sum, size) => sum + size.height, 0);
      if (!width || !height) return null;
      let canvas;
      try {
        if (typeof OffscreenCanvas === "function") canvas = new OffscreenCanvas(width, height);
        else if (ROOT.document) {
          canvas = ROOT.document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
        } else return null;
      } catch (_) {
        return null;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      let y = 0;
      for (const source of sources) {
        ctx.drawImage(source, 0, y);
        y += sourceDimensions(source).height;
      }
      const blob = await canvasToJpegBlob(canvas, 0.92);
      if (!blob) return null;
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (!bytes.length) return null;
      return { name: "", bytes, ext: "jpg", section: "detail", width, height, stitched: true };
    } catch (_) {
      return null;
    } finally {
      for (const source of sources) {
        try {
          if (source.close) source.close();
        } catch (_) {
        }
      }
    }
  }
  async function packEntry(url, res, section, skuName) {
    const bytes = res && res.ok && res.bytes && res.bytes.length ? res.bytes : null;
    if (!bytes) return { entry: null };
    const ext = extForImage(bytes, res.contentType, url);
    const common = { name: "", ext, section, skuName: skuName || "" };
    if (section === "detail") {
      const size = await imageSize(bytes);
      if (size.width && size.height) {
        common.width = size.width;
        common.height = size.height;
      }
    }
    if (shouldCompressGoodsImage(section, bytes.length, compressMainEnabled)) {
      const blob = await compressGoodsImageToLimit(bytes);
      if (blob) {
        const buffer = await blob.arrayBuffer();
        const compressed = new Uint8Array(buffer);
        if (compressed.length && compressed.length <= GOODS_COMPRESS_MAX_BYTES) {
          return { entry: { ...common, bytes: compressed, ext: "jpg", compressed: true, oversize: false } };
        }
        if (compressed.length && compressed.length < bytes.length) {
          return { entry: { ...common, bytes: compressed, ext: "jpg", compressed: true, oversize: true } };
        }
      }
      return {
        entry: { ...common, bytes, compressed: false, oversize: true, compressFailed: true }
      };
    }
    return { entry: { ...common, bytes } };
  }
  function onDecorationsToggle() {
    includeDecorations = Boolean(decorToggle && decorToggle.checked);
    rescan(true);
    setStatus(includeDecorations ? "\u5DF2\u5305\u542B\u5934\u50CF/\u8868\u60C5\u7B49\u4FEE\u9970\u56FE" : "\u5DF2\u6392\u9664\u5934\u50CF/\u8868\u60C5\u7B49\u4FEE\u9970\u56FE");
  }
  function onCompressToggle() {
    compressMainEnabled = Boolean(compressToggle && compressToggle.checked);
    setStatus(compressMainEnabled ? "\u4E3B\u56FE\u5C06\u538B\u7F29\u5230 3MB \u4EE5\u5185" : "\u4E3B\u56FE\u4E0D\u538B\u7F29\uFF08\u4FDD\u7559\u539F\u59CB\u5B57\u8282\uFF09");
  }
  function onSkuToggle() {
    skuEnabled = Boolean(skuToggle && skuToggle.checked);
    setStatus(skuEnabled ? "\u5C06\u6293\u53D6 SKU \u89C4\u683C\u56FE\uFF08\u4E0B\u8F7D\u65F6\u5C55\u5F00\u89C4\u683C\u9762\u677F\uFF09" : "\u4E0D\u6293\u53D6 SKU \u89C4\u683C\u56FE");
  }
  function onFormatChange() {
    formatMode = formatSelect ? formatSelect.value : "png";
    if (formatMode !== "png" && formatMode !== "original" && formatMode !== "jpeg") formatMode = "png";
    setStatus("\u5DF2\u5207\u6362\u683C\u5F0F\uFF1A" + (formatSelect ? formatSelect.options[formatSelect.selectedIndex].textContent : formatMode));
  }
  function onManualScan() {
    setStatus("\u6B63\u5728\u626B\u63CF\u2026");
    rescan(false);
  }
  function buildPanel() {
    const doc = ROOT.document;
    const element = doc.createElement("div");
    element.id = PANEL_ID;
    element.setAttribute("role", "complementary");
    element.setAttribute("aria-label", "\u5C0F\u7EA2\u4E66\u5546\u54C1\u9AD8\u6E05\u56FE\u7247\u4E0B\u8F7D");
    const header = doc.createElement("div");
    header.className = "xhs-enhanced-goods-title";
    header.textContent = TITLE_TEXT;
    element.appendChild(header);
    const buttonRow = doc.createElement("div");
    buttonRow.className = "xhs-enhanced-goods-row";
    scanButton = doc.createElement("button");
    scanButton.type = "button";
    scanButton.id = SCAN_BUTTON_ID;
    scanButton.className = "xhs-enhanced-goods-secondary";
    scanButton.textContent = "\u626B\u63CF\u56FE\u7247";
    scanButton.addEventListener("click", onManualScan);
    downloadButton = doc.createElement("button");
    downloadButton.type = "button";
    downloadButton.id = DOWNLOAD_BUTTON_ID;
    downloadButton.className = "xhs-enhanced-goods-primary";
    downloadButton.textContent = "\u4E0B\u8F7D\u9AD8\u6E05\u56FE";
    downloadButton.addEventListener("click", onDownload);
    buttonRow.appendChild(scanButton);
    buttonRow.appendChild(downloadButton);
    element.appendChild(buttonRow);
    const formatLabel = doc.createElement("label");
    formatLabel.className = "xhs-enhanced-goods-field";
    formatLabel.setAttribute("for", FORMAT_ID);
    formatLabel.appendChild(doc.createTextNode("\u9AD8\u6E05\u683C\u5F0F"));
    formatSelect = doc.createElement("select");
    formatSelect.id = FORMAT_ID;
    for (const mode of GOODS_FORMAT_MODES) {
      const option = doc.createElement("option");
      option.value = mode.value;
      option.textContent = mode.label;
      if (mode.value === formatMode) option.selected = true;
      formatSelect.appendChild(option);
    }
    formatSelect.addEventListener("change", onFormatChange);
    formatLabel.appendChild(formatSelect);
    element.appendChild(formatLabel);
    const decorLabel = doc.createElement("label");
    decorLabel.className = "xhs-enhanced-goods-check";
    decorToggle = doc.createElement("input");
    decorToggle.type = "checkbox";
    decorToggle.id = DECOR_ID;
    decorToggle.addEventListener("change", onDecorationsToggle);
    decorLabel.appendChild(decorToggle);
    decorLabel.appendChild(doc.createTextNode("\u5305\u542B\u5934\u50CF/\u8868\u60C5\u7B49\u4FEE\u9970\u56FE"));
    element.appendChild(decorLabel);
    const compressLabel = doc.createElement("label");
    compressLabel.className = "xhs-enhanced-goods-check";
    compressToggle = doc.createElement("input");
    compressToggle.type = "checkbox";
    compressToggle.id = COMPRESS_ID;
    compressToggle.checked = compressMainEnabled;
    compressToggle.addEventListener("change", onCompressToggle);
    compressLabel.appendChild(compressToggle);
    compressLabel.appendChild(doc.createTextNode("\u4E3B\u56FE / SKU \u56FE\u538B\u7F29\u5230 3MB \u4EE5\u5185"));
    element.appendChild(compressLabel);
    const skuLabel = doc.createElement("label");
    skuLabel.className = "xhs-enhanced-goods-check";
    skuToggle = doc.createElement("input");
    skuToggle.type = "checkbox";
    skuToggle.id = SKU_ID;
    skuToggle.checked = skuEnabled;
    skuToggle.addEventListener("change", onSkuToggle);
    skuLabel.appendChild(skuToggle);
    skuLabel.appendChild(doc.createTextNode("\u5305\u542B SKU \u89C4\u683C\u56FE\uFF08\u6BCF\u4E2A\u89C4\u683C\u5355\u72EC\u4E00\u5F20\uFF09"));
    element.appendChild(skuLabel);
    countNode = doc.createElement("p");
    countNode.id = COUNT_ID;
    countNode.className = "xhs-enhanced-goods-count";
    countNode.textContent = COUNT_EMPTY;
    element.appendChild(countNode);
    statusNode = doc.createElement("p");
    statusNode.id = STATUS_ID;
    statusNode.className = "xhs-enhanced-goods-status";
    statusNode.setAttribute("role", "status");
    statusNode.setAttribute("aria-live", "polite");
    element.appendChild(statusNode);
    return element;
  }
  function scheduleRescan() {
    if (rescanTimer !== null) ROOT.clearTimeout(rescanTimer);
    rescanTimer = ROOT.setTimeout(() => {
      rescanTimer = null;
      rescan(true);
    }, 1200);
  }
  function bindObserver() {
    if (!ROOT.document || typeof ROOT.MutationObserver !== "function") return;
    const target = ROOT.document.documentElement;
    if (!target) return;
    if (observer) return;
    observer = new ROOT.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation && mutation.type === "attributes" && mutation.attributeName !== "src" && mutation.attributeName !== "srcset") continue;
        scheduleRescan();
        break;
      }
    });
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
  }
  function ensureGoodsPanel() {
    if (!ROOT.document || !ROOT.document.body) return false;
    if (panel && panel.isConnected) return true;
    removeGoodsPanel();
    panel = buildPanel();
    ROOT.document.body.appendChild(panel);
    installSkuNetworkHook();
    if (!skuMessageBound && typeof ROOT.addEventListener === "function") {
      ROOT.addEventListener("message", onSkuMessage);
      skuMessageBound = true;
    }
    bindObserver();
    autoScanTimer = ROOT.setTimeout(() => {
      autoScanTimer = null;
      rescan(true);
    }, 800);
    return true;
  }
  function removeGoodsPanel() {
    if (observer) {
      try {
        observer.disconnect();
      } catch (_) {
      }
      observer = null;
    }
    if (rescanTimer !== null) {
      ROOT.clearTimeout(rescanTimer);
      rescanTimer = null;
    }
    if (autoScanTimer !== null) {
      ROOT.clearTimeout(autoScanTimer);
      autoScanTimer = null;
    }
    const node = panel && panel.isConnected ? panel : ROOT.document && ROOT.document.getElementById ? ROOT.document.getElementById(PANEL_ID) : null;
    if (node) node.remove();
    panel = null;
    countNode = null;
    statusNode = null;
    scanButton = null;
    downloadButton = null;
    formatSelect = null;
    decorToggle = null;
    compressToggle = null;
    skuToggle = null;
    pendingSkuResolve = null;
    currentImages = [];
    inFlight = false;
  }
  function syncGoodsPanel(route) {
    const pathname = String(route || "");
    if (isGoodsDetailRoute(pathname)) return ensureGoodsPanel();
    removeGoodsPanel();
    return false;
  }
  function getGoodsImagesSnapshot() {
    return currentImages.slice();
  }

  // src/content/index.js
  var ROOT2 = getRoot();
  var TEST_MODE = isTestMode();
  var STYLE_ID = "xhs-enhanced-style";
  var CARD_CLASS = "xhs-enhanced-card--popular";
  var LIKE_CLASS = "xhs-enhanced-like--popular";
  var SIGNATURE_ATTRIBUTE = "data-xhs-enhanced-signature";
  var JUMP_NAV_ID = "xhs-enhanced-jump-nav";
  var JUMP_BUTTON_ID = "xhs-enhanced-jump-next";
  var JUMP_PREV_BUTTON_ID = "xhs-enhanced-jump-prev";
  var JUMP_STATUS_ID = "xhs-enhanced-jump-status";
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
  var SETTINGS_BUTTON_ID = "xhs-enhanced-settings";
  var SETTINGS_BUTTON_TEXT = "\u2699 \u8BBE\u7F6E";
  var LIBRARY_SAVED_OK = "\u5DF2\u4FDD\u5B58\u5230\u5185\u5BB9\u5E93";
  var LIBRARY_SAVE_FAIL = "\u5185\u5BB9\u5E93\u4FDD\u5B58\u5931\u8D25";
  var LIBRARY_NO_TOKEN = "\u672A\u83B7\u53D6\u5230 xsec_token\uFF0C\u65E0\u6CD5\u91C7\u96C6";
  var LIBRARY_NO_CONFIG = "\u8BF7\u5148\u914D\u7F6E\u5185\u5BB9\u5E93\uFF08\u6269\u5C55\u9009\u9879\u9875\uFF09";
  var LIBRARY_NO_ACCOUNT = "\u5185\u5BB9\u5E93\u672A\u53D1\u73B0\u53EF\u7528\u7684\u5C0F\u7EA2\u4E66 PC \u7AEF\u8D26\u53F7";
  var LIBRARY_AUTH_FAIL = "\u5185\u5BB9\u5E93\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u540D\u4E0E\u5BC6\u7801";
  var LIBRARY_CONNECT_FAIL = "\u65E0\u6CD5\u8FDE\u63A5\u5185\u5BB9\u5E93\u670D\u52A1";
  var LIBRARY_CHANNEL_MISSING = "\u6269\u5C55\u65E0\u6CD5\u8BBF\u95EE\u5185\u5BB9\u5E93\uFF08\u8BF7\u91CD\u65B0\u52A0\u8F7D\u6269\u5C55\u540E\u518D\u8BD5\uFF09";
  var LIBRARY_PERMISSION_MISSING = "\u5185\u5BB9\u5E93\u670D\u52A1\u5668\u672A\u6388\u6743\uFF1A\u6253\u5F00\u6269\u5C55\u9009\u9879\u9875\u70B9\u201C\u6D4B\u8BD5\u8FDE\u63A5\u201D\u5E76\u5141\u8BB8\u8BBF\u95EE\u8BE5\u5730\u5740";
  var BATCH_BAR_ID = "xhs-enhanced-batch-bar";
  var BATCH_COUNT_ID = "xhs-enhanced-batch-count";
  var BATCH_SELECT_LOADED_ID = "xhs-enhanced-batch-select-loaded";
  var BATCH_CONTINUOUS_ID = "xhs-enhanced-batch-continuous";
  var BATCH_CLEAR_ID = "xhs-enhanced-batch-clear";
  var BATCH_DOWNLOAD_ID = "xhs-enhanced-batch-download";
  var CHECKBOX_CLASS = "xhs-enhanced-checkbox";
  var CHECKBOX_CHECKED_TEXT = "\u2713";
  var BATCH_EMPTY_TEXT = "\u8BF7\u5148\u52FE\u9009\u7B14\u8BB0";
  var BATCH_NO_COVER_TEXT = "\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7684\u5C01\u9762";
  var BATCH_CONTINUOUS_ON_TEXT = "\u5DF2\u5F00\u542F\u8FDE\u7EED\u52FE\u9009\uFF1A\u6EDA\u52A8\u52A0\u8F7D\u7684\u65B0\u7B14\u8BB0\u4F1A\u81EA\u52A8\u52FE\u9009";
  var BATCH_CONTINUOUS_OFF_TEXT = "\u5DF2\u5173\u95ED\u8FDE\u7EED\u52FE\u9009";
  var BATCH_CLEARED_TEXT = "\u5DF2\u6E05\u7A7A\u52FE\u9009";
  var BATCH_SELECT_ALL_ON_TEXT = (count) => "\u5DF2\u52FE\u9009\u5DF2\u52A0\u8F7D\u7684 " + count + " \u7BC7\u7B14\u8BB0";
  var BATCH_SELECT_ALL_OFF_TEXT = "\u5DF2\u53D6\u6D88\u5DF2\u52A0\u8F7D\u7B14\u8BB0\u7684\u52FE\u9009";
  var BATCH_NO_LOADED_TEXT = "\u672C\u9875\u6CA1\u6709\u53EF\u52FE\u9009\u7684\u7B14\u8BB0";
  var BATCH_DOWNLOAD_START_TEXT = (count) => "\u6B63\u5728\u51C6\u5907 " + count + " \u7BC7\u7B14\u8BB0\u2026";
  var BATCH_DOWNLOAD_FETCHING_TEXT = (done, total) => "\u6B63\u5728\u4E0B\u8F7D " + done + "/" + total + " \u7BC7\u2026";
  var BATCH_DOWNLOAD_PACKING_TEXT = (count) => "\u6B63\u5728\u6253\u5305 " + count + " \u5F20\u56FE\u7247\u2026";
  var BATCH_DOWNLOAD_DONE_TEXT = (summary) => "\u5DF2\u4E0B\u8F7D " + summary.saved + " \u5F20\u56FE\u7247" + (summary.notes ? "\uFF08" + summary.notes + " \u7BC7\uFF09" : "") + (summary.innerFailedNotes ? "\uFF1B\u5185\u56FE\u83B7\u53D6\u5931\u8D25 " + summary.innerFailedNotes + " \u7BC7" : "") + (summary.failedImages ? "\uFF1B" + summary.failedImages + " \u5F20\u4E0B\u8F7D\u5931\u8D25" : "") + (summary.videoSkipped ? "\uFF1B" + summary.videoSkipped + " \u7BC7\u89C6\u9891\u65E0\u5185\u56FE\u5DF2\u8DF3\u8FC7" : "");
  var BATCH_DOWNLOAD_FAIL_TEXT = "\u5168\u90E8\u56FE\u7247\u4E0B\u8F7D\u5931\u8D25";
  var BATCH_DOWNLOAD_NOTHING_TEXT = "\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7684\u56FE\u7247";
  var BATCH_SCOPE_ID = "xhs-enhanced-batch-scope";
  var BATCH_SCOPE_COVER_ID = "xhs-enhanced-batch-scope-cover";
  var BATCH_SCOPE_INNER_ID = "xhs-enhanced-batch-scope-inner";
  var BATCH_SCOPE_ALL_ID = "xhs-enhanced-batch-scope-all";
  var BATCH_PROGRESS_ID = "xhs-enhanced-batch-progress";
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
  var observer2 = null;
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
  var jumpStatusTimer = null;
  var focusToggle = null;
  var copyStatus = null;
  var copyStatusTimer = null;
  var copyCoverInFlight = false;
  var downloadCoverInFlight = false;
  var saveInFlight = false;
  var libraryPageButton = null;
  var libraryBatchButton = null;
  var batchBar = null;
  var batchDownloadButton = null;
  var batchSelectLoadedButton = null;
  var batchContinuousButton = null;
  var continuousSelect = false;
  var batchDownloadInFlight = false;
  var batchScopeCache2 = "all";
  var selection = createSelectionStore(getSessionStorageSafe());
  var fallbackTokenResolver = null;
  var pending = /* @__PURE__ */ new Set();
  var counters = { batches: 0, processed: 0, fullScans: 0, routeSignals: 0 };
  var eventBindings = [];
  function getResolver() {
    if (!fallbackTokenResolver) {
      fallbackTokenResolver = createInitialStateResolver(() => ROOT2.document || null);
    }
    return fallbackTokenResolver;
  }
  function getFallbackTokenForNoteId(noteId) {
    return getResolver().getFallbackTokenForNoteId(noteId);
  }
  function clearFallbackTokenCache() {
    if (fallbackTokenResolver) fallbackTokenResolver.clearFallbackTokenCache();
  }
  function onFocusToggleClick() {
    const enabled = !readStoredFocusPopular();
    const { persisted } = writeStoredFocusPopular(enabled);
    if (focusToggle) focusToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    showCopyStatus((enabled ? "\u5DF2\u5F00\u542F\uFF1A\u53EA\u663E\u793A\u70ED\u95E8\u7B14\u8BB0" : "\u5DF2\u5173\u95ED\uFF1A\u663E\u793A\u5168\u90E8\u7B14\u8BB0") + (persisted ? "" : "\uFF08\u8BBE\u7F6E\u672A\u80FD\u4FDD\u5B58\uFF09"));
    scan(ROOT2.document);
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
      const computed = !inline && ROOT2.getComputedStyle ? ROOT2.getComputedStyle(node).backgroundImage : inline;
      const text = inline || computed || "";
      const match = String(text).match(/url\((["']?)([^"')]+)\1\)/i);
      return match ? normalizeSpace(match[2]) : "";
    } catch (_) {
      return "";
    }
  }
  function clearCopyStatus() {
    if (copyStatusTimer !== null) ROOT2.clearTimeout(copyStatusTimer);
    copyStatusTimer = null;
    const node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT2.document && ROOT2.document.getElementById(COPY_STATUS_ID);
    if (node) node.remove();
    copyStatus = null;
  }
  function showCopyStatus(message) {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let node = copyStatus && copyStatus.isConnected ? copyStatus : ROOT2.document.getElementById(COPY_STATUS_ID);
    if (!node) {
      node = ROOT2.document.createElement("div");
      node.id = COPY_STATUS_ID;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      ROOT2.document.body.appendChild(node);
    }
    copyStatus = node;
    node.textContent = message;
    if (copyStatusTimer !== null) ROOT2.clearTimeout(copyStatusTimer);
    copyStatusTimer = ROOT2.setTimeout(() => {
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
      const loc = ROOT2.location;
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
      ROOT2.setTimeout(() => {
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
    const chrome = ROOT2.chrome;
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
  function subscribePreferenceChanges() {
    const chromeObj = ROOT2.chrome;
    try {
      const store = chromeObj && chromeObj.storage;
      const onChanged = store && store.onChanged;
      if (!onChanged || typeof onChanged.addListener !== "function") return;
      preferenceChangeHandler = (changes, areaName) => {
        if (areaName !== "local" || !changes) return;
        if (!Object.prototype.hasOwnProperty.call(changes, THRESHOLD_KEY) && !Object.prototype.hasOwnProperty.call(changes, FOCUS_KEY)) return;
        scan(ROOT2.document);
      };
      onChanged.addListener(preferenceChangeHandler);
    } catch (_) {
    }
  }
  function unsubscribePreferenceChanges() {
    const chromeObj = ROOT2.chrome;
    try {
      const onChanged = chromeObj && chromeObj.storage && chromeObj.storage.onChanged;
      if (onChanged && typeof onChanged.removeListener === "function" && preferenceChangeHandler) {
        onChanged.removeListener(preferenceChangeHandler);
      }
    } catch (_) {
    }
    preferenceChangeHandler = null;
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
    for (const card of discoverCards(ROOT2.document)) {
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
      container = ROOT2.document.createElement("div");
      container.className = CARD_ACTIONS_CLASS;
      const linkButton = ROOT2.document.createElement("button");
      linkButton.type = "button";
      linkButton.className = COPY_LINK_CLASS;
      linkButton.textContent = COPY_LINK_TEXT;
      linkButton.setAttribute("aria-label", COPY_LINK_TEXT);
      linkButton.addEventListener("click", () => onCopyLink(card));
      const coverButton = ROOT2.document.createElement("button");
      coverButton.type = "button";
      coverButton.className = COPY_COVER_CLASS;
      coverButton.textContent = COPY_COVER_TEXT;
      coverButton.setAttribute("aria-label", COPY_COVER_TEXT);
      coverButton.addEventListener("click", () => onCopyCover(card));
      const downloadButton2 = ROOT2.document.createElement("button");
      downloadButton2.type = "button";
      downloadButton2.className = DOWNLOAD_COVER_CLASS;
      downloadButton2.textContent = DOWNLOAD_COVER_TEXT;
      downloadButton2.setAttribute("aria-label", DOWNLOAD_COVER_TEXT);
      downloadButton2.addEventListener("click", () => onDownloadCover(card));
      const saveButton = ROOT2.document.createElement("button");
      saveButton.type = "button";
      saveButton.className = SAVE_LIBRARY_CLASS;
      saveButton.textContent = SAVE_LIBRARY_TEXT;
      saveButton.setAttribute("aria-label", SAVE_LIBRARY_TEXT);
      saveButton.addEventListener("click", () => onSaveToLibrary(card, saveButton));
      container.append(linkButton, coverButton, downloadButton2, saveButton);
      card.appendChild(container);
    }
  }
  function removeCardActions(card) {
    if (!card || !card.querySelectorAll) return;
    const container = card.querySelector("." + CARD_ACTIONS_CLASS);
    if (container) container.remove();
  }
  function removeCardCheckbox(card) {
    if (!card || !card.querySelector) return;
    const box = card.querySelector("." + CHECKBOX_CLASS);
    if (box) box.remove();
  }
  function ensureCardCheckbox(card) {
    if (!card || !card.querySelector || !card.isConnected) return null;
    if (!isTargetRoute(getCurrentRoute())) {
      removeCardCheckbox(card);
      return null;
    }
    try {
      const position = ROOT2.getComputedStyle ? ROOT2.getComputedStyle(card).position : "";
      if (position === "static" || !position) card.style.position = "relative";
    } catch (_) {
    }
    let box = card.querySelector("." + CHECKBOX_CLASS);
    if (!box) {
      box = ROOT2.document.createElement("button");
      box.type = "button";
      box.className = CHECKBOX_CLASS;
      box.textContent = CHECKBOX_CHECKED_TEXT;
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", "false");
      box.setAttribute("aria-label", "\u9009\u62E9\u8FD9\u7BC7\u7B14\u8BB0");
      box.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleCardSelection(card);
      });
      card.appendChild(box);
    }
    return box;
  }
  function syncCardCheckbox(card) {
    if (!card || !card.querySelector) return;
    const box = card.querySelector("." + CHECKBOX_CLASS);
    if (!box) return;
    const id = cardNoteTargetId(card);
    const checked = Boolean(id && selection.has(id));
    box.setAttribute("aria-checked", checked ? "true" : "false");
    box.classList.toggle("xhs-enhanced-checkbox--checked", checked);
  }
  function syncAllCheckboxes(root) {
    const scope = root || ROOT2.document;
    if (!scope || !scope.querySelectorAll) return;
    for (const card of discoverCards(scope)) syncCardCheckbox(card);
  }
  function renderCardChrome(card) {
    if (!card) return;
    ensureCardCheckbox(card);
    if (continuousSelect) {
      const id = cardNoteTargetId(card);
      if (id && !selection.has(id)) {
        const snapshot = snapshotFromCard(card);
        if (snapshot) selection.add(snapshot);
      }
    }
    syncCardCheckbox(card);
  }
  var batchCountCache = "";
  var selectLoadedCache = null;
  var batchDownloadCache = null;
  function updateBatchBarCount() {
    if (!batchBar || !batchBar.isConnected) return;
    const countNode2 = batchBar.querySelector("#" + BATCH_COUNT_ID);
    const text = "\u5DF2\u9009 " + selection.size + " \u7BC7";
    if (countNode2 && batchCountCache !== text) {
      batchCountCache = text;
      countNode2.textContent = text;
    }
    if (batchSelectLoadedButton) {
      const cards = isTargetRoute(getCurrentRoute()) ? discoverCards(ROOT2.document) : [];
      let loaded = 0;
      let selectedLoaded = 0;
      for (const card of cards) {
        const id = cardNoteTargetId(card);
        if (!id) continue;
        loaded += 1;
        if (selection.has(id)) selectedLoaded += 1;
      }
      const allLoadedSelected = loaded > 0 && selectedLoaded === loaded;
      if (selectLoadedCache !== allLoadedSelected) {
        selectLoadedCache = allLoadedSelected;
        batchSelectLoadedButton.setAttribute("aria-pressed", allLoadedSelected ? "true" : "false");
      }
    }
  }
  function updateBatchDownloadButton() {
    if (!batchDownloadButton) return;
    const text = batchDownloadInFlight ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u4E0B\u8F7D\u5DF2\u9009";
    if (batchDownloadCache === text && batchDownloadButton.disabled === batchDownloadInFlight) return;
    batchDownloadCache = text;
    batchDownloadButton.disabled = batchDownloadInFlight;
    batchDownloadButton.textContent = text;
  }
  function toggleCardSelection(card) {
    const snapshot = snapshotFromCard(card);
    if (!snapshot) {
      showCopyStatus("\u672A\u627E\u5230\u7B14\u8BB0 ID\uFF0C\u65E0\u6CD5\u52FE\u9009");
      return;
    }
    selection.toggle(snapshot);
    syncCardCheckbox(card);
    updateBatchBarCount();
  }
  function onSelectLoadedClick() {
    const cards = discoverCards(ROOT2.document);
    const loaded = [];
    for (const card of cards) {
      const id = cardNoteTargetId(card);
      if (id) loaded.push({ card, id });
    }
    if (!loaded.length) {
      showCopyStatus(BATCH_NO_LOADED_TEXT);
      return;
    }
    const allSelected = loaded.every(({ id }) => selection.has(id));
    for (const { card, id } of loaded) {
      if (allSelected) {
        selection.remove(id);
      } else if (!selection.has(id)) {
        const snapshot = snapshotFromCard(card);
        if (snapshot) selection.add(snapshot);
      }
    }
    syncAllCheckboxes(ROOT2.document);
    updateBatchBarCount();
    showCopyStatus(allSelected ? BATCH_SELECT_ALL_OFF_TEXT : BATCH_SELECT_ALL_ON_TEXT(loaded.length));
  }
  function onContinuousToggleClick() {
    continuousSelect = !continuousSelect;
    if (batchContinuousButton) batchContinuousButton.setAttribute("aria-pressed", continuousSelect ? "true" : "false");
    showCopyStatus(continuousSelect ? BATCH_CONTINUOUS_ON_TEXT : BATCH_CONTINUOUS_OFF_TEXT);
    if (continuousSelect) scan(ROOT2.document);
  }
  function onBatchClearClick() {
    selection.clear();
    syncAllCheckboxes(ROOT2.document);
    updateBatchBarCount();
    showCopyStatus(BATCH_CLEARED_TEXT);
  }
  var SCOPE_LABELS = { cover: "\u53EA\u5C01\u9762", inner: "\u53EA\u5185\u56FE", all: "\u5168\u90E8\u56FE\u7247" };
  function updateBatchScopeButtons() {
    if (!batchBar) return;
    for (const [scope, id] of [["cover", BATCH_SCOPE_COVER_ID], ["inner", BATCH_SCOPE_INNER_ID], ["all", BATCH_SCOPE_ALL_ID]]) {
      const button = ROOT2.document.getElementById(id);
      if (!button) continue;
      const pressed = batchScopeCache2 === scope;
      if (button.getAttribute("aria-pressed") !== (pressed ? "true" : "false")) {
        button.setAttribute("aria-pressed", pressed ? "true" : "false");
      }
    }
  }
  function onBatchScopeClick(scope) {
    const result = writeStoredBatchScope(scope);
    batchScopeCache2 = result.value;
    updateBatchScopeButtons();
    showCopyStatus("\u4E0B\u8F7D\u8303\u56F4\uFF1A" + (SCOPE_LABELS[batchScopeCache2] || batchScopeCache2));
  }
  var batchProgressNode = null;
  function showBatchProgress(message) {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let node = batchProgressNode && batchProgressNode.isConnected ? batchProgressNode : ROOT2.document.getElementById(BATCH_PROGRESS_ID);
    if (!node) {
      node = ROOT2.document.createElement("div");
      node.id = BATCH_PROGRESS_ID;
      node.setAttribute("role", "status");
      ROOT2.document.body.appendChild(node);
    }
    if (node.textContent !== message) node.textContent = message;
    batchProgressNode = node;
  }
  function clearBatchProgress() {
    const node = batchProgressNode && batchProgressNode.isConnected ? batchProgressNode : ROOT2.document && ROOT2.document.getElementById(BATCH_PROGRESS_ID);
    if (node) node.remove();
    batchProgressNode = null;
  }
  function onBatchDownload() {
    if (batchDownloadInFlight) return;
    const items = selection.values();
    if (!items.length) {
      showCopyStatus(BATCH_EMPTY_TEXT);
      return;
    }
    const scope = batchScopeCache2;
    if (scope !== "inner" && !items.some((item) => item.coverUrl) && !items.some((item) => item.link)) {
      showCopyStatus(BATCH_NO_COVER_TEXT);
      return;
    }
    batchDownloadInFlight = true;
    updateBatchDownloadButton();
    showCopyStatus(BATCH_DOWNLOAD_START_TEXT(items.length));
    showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(0, items.length));
    let fetched = 0;
    mapWithConcurrency(items, 2, (item, index) => downloadNoteImages(scope, item).then((result) => {
      fetched += 1;
      showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(fetched, items.length));
      return result;
    }, () => {
      fetched += 1;
      showBatchProgress(BATCH_DOWNLOAD_FETCHING_TEXT(fetched, items.length));
      return { item, ok: false, reason: "error", entries: [], failedImages: 0, skippedVideo: false, innerFailed: false, detailSource: "" };
    })).then((jobs) => {
      const entries = [];
      let sequence = 0;
      let notesSaved = 0;
      let failedImages = 0;
      let failedNotes = 0;
      let videoSkipped = 0;
      let innerFailedNotes = 0;
      const layout = readStoredBatchLayout();
      for (const job of jobs || []) {
        failedImages += job && typeof job.failedImages === "number" ? job.failedImages : 0;
        if (job && job.skippedVideo) videoSkipped += 1;
        if (job && job.innerFailed) innerFailedNotes += 1;
        if (!job || !Array.isArray(job.entries) || !job.entries.length) {
          if (scope === "inner" || job && job.ok === false) failedNotes += 1;
          continue;
        }
        for (const entry of job.entries) {
          const name = layout === "flat" ? buildFlatEntryName(sequence, job.item.id, entry.name) : buildNoteFolderName(sequence, job.item.id, job.item.title) + "/" + entry.name;
          entries.push({ name, bytes: entry.bytes });
        }
        sequence += 1;
        notesSaved += 1;
      }
      if (!entries.length) {
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus(scope === "inner" && videoSkipped === items.length ? "\u89C6\u9891\u7B14\u8BB0\u4E0D\u542B\u5185\u56FE\uFF0C\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7684\u56FE\u7247" : BATCH_DOWNLOAD_NOTHING_TEXT);
        return;
      }
      showBatchProgress(BATCH_DOWNLOAD_PACKING_TEXT(entries.length));
      const now = /* @__PURE__ */ new Date();
      try {
        const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes ? entry.bytes.length : 0), 0);
        const parts = totalBytes > MAX_ZIP_BYTES ? splitZipEntries(entries, MAX_ZIP_BYTES) : [entries];
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const zipBytes = buildZip(parts[partIndex], { now });
          const zipBlob = new Blob([zipBytes], { type: "application/zip" });
          triggerCoverDownload(zipBlob, buildBatchZipFileName(now, entries.length, partIndex, parts.length));
        }
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus(BATCH_DOWNLOAD_DONE_TEXT({
          saved: entries.length,
          notes: notesSaved,
          failedImages,
          videoSkipped,
          innerFailedNotes: scope === "all" ? innerFailedNotes : 0
        }));
      } catch (_) {
        batchDownloadInFlight = false;
        updateBatchDownloadButton();
        clearBatchProgress();
        showCopyStatus("\u6253\u5305\u4E0B\u8F7D\u5931\u8D25");
      }
    }, () => {
      batchDownloadInFlight = false;
      updateBatchDownloadButton();
      clearBatchProgress();
      showCopyStatus(BATCH_DOWNLOAD_FAIL_TEXT);
    });
  }
  function removeBatchBar() {
    const bar = batchBar && batchBar.isConnected ? batchBar : ROOT2.document && ROOT2.document.getElementById(BATCH_BAR_ID);
    if (bar) bar.remove();
    batchBar = null;
    batchDownloadButton = null;
    batchSelectLoadedButton = null;
    batchContinuousButton = null;
    batchCountCache = "";
    selectLoadedCache = null;
    batchDownloadCache = null;
  }
  function ensureBatchBar() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let bar = batchBar && batchBar.isConnected ? batchBar : ROOT2.document.getElementById(BATCH_BAR_ID);
    if (!bar) {
      bar = ROOT2.document.createElement("div");
      bar.id = BATCH_BAR_ID;
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "\u6279\u91CF\u4E0B\u8F7D\u5DF2\u9009\u7B14\u8BB0\u7684\u5C01\u9762");
      const countNode2 = ROOT2.document.createElement("span");
      countNode2.id = BATCH_COUNT_ID;
      countNode2.textContent = "\u5DF2\u9009 " + selection.size + " \u7BC7";
      const selectLoaded = ROOT2.document.createElement("button");
      selectLoaded.id = BATCH_SELECT_LOADED_ID;
      selectLoaded.type = "button";
      selectLoaded.textContent = "\u5168\u9009\u5DF2\u52A0\u8F7D";
      selectLoaded.setAttribute("aria-pressed", "false");
      selectLoaded.addEventListener("click", onSelectLoadedClick);
      const continuous = ROOT2.document.createElement("button");
      continuous.id = BATCH_CONTINUOUS_ID;
      continuous.type = "button";
      continuous.textContent = "\u8FDE\u7EED\u52FE\u9009";
      continuous.setAttribute("aria-pressed", "false");
      continuous.setAttribute("title", "\u5F00\u542F\u540E\u6EDA\u52A8\u52A0\u8F7D\u7684\u65B0\u7B14\u8BB0\u4F1A\u81EA\u52A8\u52FE\u9009");
      continuous.addEventListener("click", onContinuousToggleClick);
      const clear = ROOT2.document.createElement("button");
      clear.id = BATCH_CLEAR_ID;
      clear.type = "button";
      clear.textContent = "\u6E05\u7A7A";
      clear.addEventListener("click", onBatchClearClick);
      const scopeGroup = ROOT2.document.createElement("div");
      scopeGroup.id = BATCH_SCOPE_ID;
      scopeGroup.setAttribute("role", "group");
      scopeGroup.setAttribute("aria-label", "\u4E0B\u8F7D\u8303\u56F4");
      for (const [scope, id, label] of [["cover", BATCH_SCOPE_COVER_ID, "\u5C01\u9762"], ["inner", BATCH_SCOPE_INNER_ID, "\u5185\u56FE"], ["all", BATCH_SCOPE_ALL_ID, "\u5168\u90E8"]]) {
        const scopeButton = ROOT2.document.createElement("button");
        scopeButton.id = id;
        scopeButton.type = "button";
        scopeButton.textContent = label;
        scopeButton.setAttribute("data-scope", scope);
        scopeButton.setAttribute("aria-pressed", batchScopeCache2 === scope ? "true" : "false");
        scopeButton.addEventListener("click", () => onBatchScopeClick(scope));
        scopeGroup.appendChild(scopeButton);
      }
      const download = ROOT2.document.createElement("button");
      download.id = BATCH_DOWNLOAD_ID;
      download.type = "button";
      download.textContent = "\u4E0B\u8F7D\u5DF2\u9009";
      download.addEventListener("click", onBatchDownload);
      bar.append(countNode2, selectLoaded, continuous, clear, scopeGroup, download);
      ROOT2.document.body.appendChild(bar);
      batchDownloadButton = download;
      batchSelectLoadedButton = selectLoaded;
      batchContinuousButton = continuous;
    } else {
      batchDownloadButton = bar.querySelector("#" + BATCH_DOWNLOAD_ID);
      batchSelectLoadedButton = bar.querySelector("#" + BATCH_SELECT_LOADED_ID);
      batchContinuousButton = bar.querySelector("#" + BATCH_CONTINUOUS_ID);
    }
    batchBar = bar;
    updateBatchScopeButtons();
    updateBatchBarCount();
    updateBatchDownloadButton();
  }
  function syncBatchBar() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    if (isTargetRoute(getCurrentRoute())) {
      ensureBatchBar();
    } else {
      removeBatchBar();
    }
  }
  function getCurrentRoute() {
    if (TEST_MODE && routeProvider) return String(routeProvider() || "");
    return ROOT2.location ? ROOT2.location.pathname : "";
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
  function getSessionStorageSafe() {
    try {
      const chrome = getChrome();
      if (chrome && chrome.storage && chrome.storage.session) return chrome.storage.session;
    } catch (_) {
    }
    return null;
  }
  function extractCardTitle(card) {
    if (!card || !card.querySelector) return "";
    const node = card.querySelector('.title span, .title, [class*="title"]');
    const text = node ? normalizeSpace(node.textContent || "") : "";
    return text.slice(0, 60);
  }
  function snapshotFromCard(card) {
    const id = cardNoteTargetId(card);
    if (!id) return null;
    return {
      id,
      link: resolveCardNoteLink(card),
      coverUrl: extractCoverUrl(card),
      title: extractCardTitle(card),
      ts: Date.now()
    };
  }
  function mapWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const results = new Array(list.length);
    let cursor = 0;
    const lanes = [];
    for (let lane = 0; lane < Math.max(1, Math.min(limit, list.length)); lane += 1) {
      lanes.push((async () => {
        while (cursor < list.length) {
          const index = cursor;
          cursor += 1;
          try {
            results[index] = await worker(list[index], index);
          } catch (_) {
            results[index] = { ok: false, reason: "error", item: list[index] };
          }
        }
      })());
    }
    return Promise.all(lanes).then(() => results);
  }
  function isCaptureMode() {
    try {
      const search = ROOT2.location && ROOT2.location.search;
      return typeof search === "string" && search.indexOf("xhs_enh_capture=1") >= 0;
    } catch (_) {
      return false;
    }
  }
  function initCaptureMode() {
    initialized = true;
    const chrome = getChrome();
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== "function") return;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== COLLECT_NOTE_MESSAGE) return void 0;
      const note = collectSlimNoteFromDocument();
      sendResponse(note ? { ok: true, note } : { ok: false, error: "no-state" });
      return void 0;
    });
  }
  function collectSlimNoteFromDocument() {
    if (!ROOT2.document) return null;
    for (const script of Array.from(ROOT2.document.querySelectorAll("script"))) {
      const text = script.textContent || "";
      if (text.indexOf("__INITIAL_STATE__=") < 0) continue;
      const state = parseInitialStateFromScriptText(text);
      const noteMap = state && state.note && state.note.noteDetailMap;
      const first = noteMap && Object.values(noteMap)[0];
      const slim = slimNoteDetail(first && first.note);
      if (slim) return slim;
    }
    return null;
  }
  async function fetchNoteDetailFromPage(link) {
    const res = await fetchText(link, { timeout: 3e4 });
    if (res && res.ok && typeof res.text === "string" && res.text) {
      const note = extractNoteFromInitialStateHtml(res.text);
      if (note) return { ok: true, note, source: "fetch" };
      return { ok: false, reason: "parse" };
    }
    return { ok: false, reason: res && res.status ? "http-" + res.status : res && res.error || "network" };
  }
  async function collectNoteDetail(link) {
    if (!link) return { ok: false, reason: "no-link" };
    const direct = await fetchNoteDetailFromPage(link);
    if (direct.ok) return direct;
    const chrome = getChrome();
    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return { ok: false, reason: direct.reason || "no-channel" };
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: COLLECT_NOTE_VIA_TAB_MESSAGE, link });
      if (resp && resp.ok && resp.note && Array.isArray(resp.note.imageList)) {
        return { ok: true, note: resp.note, source: "tab" };
      }
      return { ok: false, reason: resp && resp.error || direct.reason || "tab-failed" };
    } catch (_) {
      return { ok: false, reason: direct && direct.reason || "tab-failed" };
    }
  }
  function loadImageEntry(url) {
    if (!url) return Promise.resolve(null);
    return loadCoverPngBlob(url).then((result) => {
      const blob = result && result.ok ? result.blob : null;
      if (!blob) return null;
      return ensureJpegCoverBlob(blob).then((finalBlob) => {
        const ext = resolveCoverExtFromMime(finalBlob.type) || resolveCoverExtFromUrl(url) || "jpg";
        return finalBlob.arrayBuffer().then((buffer) => ({ bytes: new Uint8Array(buffer), ext }), () => null);
      }, () => null);
    }, () => null);
  }
  async function downloadNoteImages(scope, item) {
    const result = {
      item,
      ok: true,
      failedImages: 0,
      skippedVideo: false,
      innerFailed: false,
      detailSource: "",
      entries: []
    };
    let note = null;
    if (scope !== "cover") {
      const detail = await collectNoteDetail(item.link);
      if (detail.ok) {
        note = detail.note;
        result.detailSource = detail.source;
      } else if (scope === "inner") {
        result.ok = false;
        result.error = detail.reason || "detail-failed";
        return result;
      } else {
        result.innerFailed = true;
      }
    }
    const images = note && Array.isArray(note.imageList) ? note.imageList : [];
    const isVideo = Boolean(note && note.type === "video");
    if (scope !== "inner") {
      const coverImage = images[0] || null;
      const coverUrl = coverImage ? pickBestImageUrl(coverImage) : item.coverUrl || "";
      const entry = await loadImageEntry(coverUrl);
      if (entry) result.entries.push({ name: buildImageFileName(0, entry.ext, true), bytes: entry.bytes });
      else result.failedImages += 1;
    }
    if (scope !== "cover" && note) {
      const innerImages = isVideo ? [] : images.slice(1);
      if (isVideo && scope === "inner") result.skippedVideo = true;
      for (let index = 0; index < innerImages.length; index += 1) {
        const url = pickBestImageUrl(innerImages[index]);
        const entry = await loadImageEntry(url);
        if (!entry) {
          result.failedImages += 1;
          continue;
        }
        const order = scope === "inner" ? index : index + 1;
        result.entries.push({ name: buildImageFileName(order, entry.ext, false), bytes: entry.bytes });
      }
    }
    return result;
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
    if (!ROOT2.document || !isTargetRoute(getCurrentRoute())) return;
    for (const card of discoverLinkCards(ROOT2.document)) {
      ensureCardActions(card);
      renderCardChrome(card);
    }
  }
  function ensureStyle() {
    if (!ROOT2.document || ROOT2.document.getElementById(STYLE_ID)) return;
    const style = ROOT2.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS}{outline:2px solid #ff2442!important;background:rgba(255,36,66,.07)!important;box-shadow:0 2px 10px rgba(255,36,66,.14)!important}
      .${LIKE_CLASS}{color:#ff2442!important;font-weight:700!important}
      #${JUMP_NAV_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;display:flex;gap:8px;align-items:center}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID},#${FOCUS_TOGGLE_ID}{border:0;border-radius:999px;padding:9px 15px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.22);cursor:pointer;transition:background .15s ease,color .15s ease,opacity .15s ease}
      #${JUMP_PREV_BUTTON_ID},#${JUMP_BUTTON_ID}{background:#ff2442;color:#fff}
      #${JUMP_PREV_BUTTON_ID}:hover,#${JUMP_BUTTON_ID}:hover{background:#e61e3c}
      #${JUMP_PREV_BUTTON_ID}:focus-visible,#${JUMP_BUTTON_ID}:focus-visible,#${FOCUS_TOGGLE_ID}:focus-visible,#${LIBRARY_PAGE_BUTTON_ID}:focus-visible,#${LIBRARY_BATCH_BUTTON_ID}:focus-visible,#${SETTINGS_BUTTON_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${FOCUS_TOGGLE_ID}{background:rgba(30,30,30,.88);color:#fff}
      #${FOCUS_TOGGLE_ID}:hover{background:rgba(15,15,15,.98)}
      #${FOCUS_TOGGLE_ID}[aria-pressed="true"]{background:#ff2442;color:#fff}
      .${DIMMED_CLASS}{filter:blur(8px) grayscale(.35);opacity:.55;transition:filter .18s ease,opacity .18s ease}
      .${DIMMED_CLASS}:hover{filter:none;opacity:1}
      #${JUMP_STATUS_ID}{position:fixed;top:136px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
      #${COPY_STATUS_ID}{position:fixed;top:182px;right:24px;z-index:2147483646;max-width:260px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.92);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
      #${LIBRARY_PAGE_BUTTON_ID}{position:fixed;top:88px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 18px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      #${LIBRARY_PAGE_BUTTON_ID}:hover{background:#e61e3c}
      #${LIBRARY_BATCH_BUTTON_ID}{position:fixed;top:316px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:10px 18px;background:#ff2442;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      #${LIBRARY_BATCH_BUTTON_ID}:hover{background:#e61e3c}#${LIBRARY_BATCH_BUTTON_ID}:disabled{opacity:.55;cursor:default}
      #${SETTINGS_BUTTON_ID}{position:fixed;bottom:24px;right:24px;z-index:2147483646;border:0;border-radius:999px;padding:9px 16px;background:rgba(30,30,30,.88);color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer}
      #${SETTINGS_BUTTON_ID}:hover{background:rgba(15,15,15,.98)}
      .${CARD_ACTIONS_CLASS}{position:absolute;top:6px;left:6px;z-index:2147483640;display:flex;gap:4px;opacity:0;transition:opacity .15s ease;pointer-events:none}
      .xhs-enhanced-card--popular .${CARD_ACTIONS_CLASS},.note-item:hover .${CARD_ACTIONS_CLASS},section.note-item:hover .${CARD_ACTIONS_CLASS},article.note-item:hover .${CARD_ACTIONS_CLASS}{opacity:1;pointer-events:auto}
      [data-note-card],article.note-item,section.note-item,.note-item{position:relative}
      .${CARD_ACTIONS_CLASS} button{border:0;border-radius:6px;padding:5px 8px;background:rgba(255,36,66,.92);color:#fff;font:600 11px/1.35 system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.18)}
      .${CARD_ACTIONS_CLASS} button:hover{background:#e61e3c}
      .${COPY_COVER_CLASS}{background:rgba(30,30,30,.82)!important}
      .${DOWNLOAD_COVER_CLASS}{background:rgba(37,99,235,.92)!important}
      .${DOWNLOAD_COVER_CLASS}:hover{background:rgba(29,78,216,1)!important}
      .${CHECKBOX_CLASS}{position:absolute;top:6px;right:6px;z-index:2147483645;width:24px;height:24px;border-radius:7px;border:2px solid rgba(255,255,255,.9);background:rgba(0,0,0,.38);color:transparent;font:700 15px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.4);transition:background .15s ease,border-color .15s ease,color .15s ease}
      .${CHECKBOX_CLASS}:hover{background:rgba(0,0,0,.6)}
      .${CHECKBOX_CLASS}--checked,.${CHECKBOX_CLASS}[aria-checked="true"]{background:#ff2442;border-color:#ff2442;color:#fff}
      .${CHECKBOX_CLASS}:focus-visible,#${BATCH_SELECT_LOADED_ID}:focus-visible,#${BATCH_CONTINUOUS_ID}:focus-visible,#${BATCH_CLEAR_ID}:focus-visible,#${BATCH_DOWNLOAD_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${BATCH_BAR_ID}{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:min(680px,calc(100vw - 32px));padding:8px 10px;border-radius:14px;background:rgba(30,30,30,.93);box-shadow:0 6px 24px rgba(0,0,0,.4);font:13px/1.4 system-ui,sans-serif;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
      #${BATCH_COUNT_ID}{color:#fff;font-weight:700;white-space:nowrap;padding:0 4px}
      #${BATCH_BAR_ID} button{border:0;border-radius:999px;padding:8px 14px;font:600 13px/1.4 system-ui,sans-serif;white-space:nowrap;cursor:pointer;background:rgba(255,255,255,.14);color:#fff;transition:background .15s ease,opacity .15s ease}
      #${BATCH_BAR_ID} button:hover{background:rgba(255,255,255,.24)}
      #${BATCH_SELECT_LOADED_ID}[aria-pressed="true"],#${BATCH_CONTINUOUS_ID}[aria-pressed="true"]{background:#ff2442;color:#fff}
      #${BATCH_DOWNLOAD_ID}{background:#ff2442;color:#fff;font-weight:700}
      #${BATCH_DOWNLOAD_ID}:hover{background:#e61e3c}
      #${BATCH_DOWNLOAD_ID}:disabled{opacity:.55;cursor:default}
      #${BATCH_SCOPE_ID}{display:flex;gap:2px;padding:2px;border-radius:999px;background:rgba(255,255,255,.12)}
      #${BATCH_SCOPE_ID} button{border:0;border-radius:999px;padding:6px 11px;background:transparent;color:rgba(255,255,255,.72);font:600 12px/1.4 system-ui,sans-serif;cursor:pointer}
      #${BATCH_SCOPE_ID} button:hover{background:rgba(255,255,255,.18);color:#fff}
      #${BATCH_SCOPE_ID} button[aria-pressed="true"]{background:#ff2442;color:#fff}
      #${BATCH_SCOPE_ID} button:focus-visible,#${BATCH_PROGRESS_ID}:focus-visible{outline:2px solid #fff;outline-offset:2px}
      #${BATCH_PROGRESS_ID}{position:fixed;top:226px;right:24px;z-index:2147483646;max-width:300px;padding:9px 13px;border-radius:8px;background:rgba(30,30,30,.93);color:#fff;font:13px/1.5 system-ui,sans-serif;pointer-events:none}
      #xhs-enhanced-goods-panel{position:fixed;right:20px;top:150px;z-index:2147483646;width:252px;padding:14px 14px 12px;border-radius:12px;background:rgba(30,30,30,.93);color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
      .xhs-enhanced-goods-title{font-weight:700;font-size:14px;margin-bottom:8px}
      .xhs-enhanced-goods-row{display:flex;gap:8px;margin-bottom:10px}
      #xhs-enhanced-goods-scan,#xhs-enhanced-goods-download{flex:1;border:0;border-radius:8px;padding:8px 10px;font:600 13px/1.4 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
      .xhs-enhanced-goods-secondary{background:rgba(255,255,255,.14);color:#fff}
      .xhs-enhanced-goods-secondary:hover{background:rgba(255,255,255,.24)}
      .xhs-enhanced-goods-primary{background:#ff2442;color:#fff}
      .xhs-enhanced-goods-primary:hover{background:#e61e3c}
      #xhs-enhanced-goods-scan:disabled,#xhs-enhanced-goods-download:disabled{opacity:.55;cursor:default}
      .xhs-enhanced-goods-field{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:rgba(255,255,255,.85)}
      .xhs-enhanced-goods-field select{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:6px;padding:5px 8px;font:13px/1.4 system-ui,sans-serif}
      .xhs-enhanced-goods-field select:focus-visible,#xhs-enhanced-goods-scan:focus-visible,#xhs-enhanced-goods-download:focus-visible,.xhs-enhanced-goods-check input:focus-visible{outline:2px solid #fff;outline-offset:2px}
      .xhs-enhanced-goods-check{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.85);margin-bottom:8px;cursor:pointer}
      .xhs-enhanced-goods-count{color:#fff;font-weight:700;margin:2px 0 4px}
      .xhs-enhanced-goods-status{min-height:1.4em;color:rgba(255,255,255,.78);margin:0;word-break:break-all}
    `;
    (ROOT2.document.head || ROOT2.document.documentElement).appendChild(style);
  }
  function renderCard(card) {
    if (!card || !card.isConnected) return;
    const like = extractLike(card);
    const route = getCurrentRoute();
    const signature = signatureFor(route, like ? like.raw : "");
    const popular = Boolean(like && like.parsed.value > readStoredThreshold());
    card.classList.toggle(CARD_CLASS, popular);
    card.classList.toggle(DIMMED_CLASS, readStoredFocusPopular() && !popular);
    for (const stale of card.querySelectorAll(`.${LIKE_CLASS}`)) if (!like || stale !== like.node) stale.classList.remove(LIKE_CLASS);
    if (like) like.node.classList.toggle(LIKE_CLASS, popular);
    card.setAttribute(SIGNATURE_ATTRIBUTE, signature);
    ensureCardActions(card);
    renderCardChrome(card);
    counters.processed += 1;
  }
  function cleanupCard(card) {
    if (!card || !card.querySelectorAll) return;
    card.classList.remove(CARD_CLASS);
    card.classList.remove(DIMMED_CLASS);
    card.removeAttribute(SIGNATURE_ATTRIBUTE);
    removeCardActions(card);
    removeCardCheckbox(card);
    for (const node of card.querySelectorAll(`.${LIKE_CLASS}`)) node.classList.remove(LIKE_CLASS);
  }
  function cleanupAll() {
    if (!ROOT2.document) return;
    for (const card of ROOT2.document.querySelectorAll(`.${CARD_CLASS},[${SIGNATURE_ATTRIBUTE}]`)) cleanupCard(card);
    for (const container of ROOT2.document.querySelectorAll("." + CARD_ACTIONS_CLASS)) container.remove();
    for (const checkbox of ROOT2.document.querySelectorAll("." + CHECKBOX_CLASS)) checkbox.remove();
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
    if (jumpStatusTimer !== null) ROOT2.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = null;
    const node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT2.document && ROOT2.document.getElementById(JUMP_STATUS_ID);
    if (node) node.remove();
    jumpStatus = null;
  }
  function showJumpStatus(message = LAST_NOTE_TEXT) {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let node = jumpStatus && jumpStatus.isConnected ? jumpStatus : ROOT2.document.getElementById(JUMP_STATUS_ID);
    if (!node) {
      node = ROOT2.document.createElement("div");
      node.id = JUMP_STATUS_ID;
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.textContent = message;
      ROOT2.document.body.appendChild(node);
    }
    jumpStatus = node;
    node.textContent = message;
    if (jumpStatusTimer !== null) ROOT2.clearTimeout(jumpStatusTimer);
    jumpStatusTimer = ROOT2.setTimeout(() => {
      jumpStatusTimer = null;
      clearJumpStatus();
    }, 3e3);
  }
  function jumpToNextPopularCard() {
    if (!ROOT2.document) return;
    const viewportHeight = ROOT2.innerHeight || ROOT2.document.documentElement.clientHeight || 0;
    const target = selectNextPopularCard(ROOT2.document.querySelectorAll(`.${CARD_CLASS}`), viewportHeight);
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const documentElement = ROOT2.document.documentElement;
    const body = ROOT2.document.body;
    const bottom = Math.max(documentElement ? documentElement.scrollHeight : 0, body ? body.scrollHeight : 0);
    if (typeof ROOT2.scrollTo === "function") ROOT2.scrollTo({ top: bottom, behavior: "smooth" });
    showJumpStatus();
  }
  function jumpToPreviousPopularCard() {
    if (!ROOT2.document) return;
    const target = selectPreviousPopularCard(ROOT2.document.querySelectorAll(`.${CARD_CLASS}`));
    if (target) {
      clearJumpStatus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (typeof ROOT2.scrollTo === "function") ROOT2.scrollTo({ top: 0, behavior: "smooth" });
    showJumpStatus(FIRST_NOTE_TEXT);
  }
  function ensureJumpUi() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT2.document.getElementById(JUMP_NAV_ID);
    if (!nav) {
      nav = ROOT2.document.createElement("div");
      nav.id = JUMP_NAV_ID;
      ROOT2.document.body.appendChild(nav);
    }
    jumpNav = nav;
    let prev = jumpPrevButton && jumpPrevButton.isConnected ? jumpPrevButton : ROOT2.document.getElementById(JUMP_PREV_BUTTON_ID);
    if (!prev) {
      prev = ROOT2.document.createElement("button");
      prev.id = JUMP_PREV_BUTTON_ID;
      prev.type = "button";
      prev.textContent = JUMP_PREV_BUTTON_TEXT;
      prev.setAttribute("aria-label", JUMP_PREV_BUTTON_TEXT);
      prev.addEventListener("click", jumpToPreviousPopularCard);
    }
    jumpPrevButton = prev;
    let button = jumpButton && jumpButton.isConnected ? jumpButton : ROOT2.document.getElementById(JUMP_BUTTON_ID);
    if (!button) {
      button = ROOT2.document.createElement("button");
      button.id = JUMP_BUTTON_ID;
      button.type = "button";
      button.textContent = JUMP_BUTTON_TEXT;
      button.setAttribute("aria-label", JUMP_BUTTON_TEXT);
      button.addEventListener("click", jumpToNextPopularCard);
    }
    jumpButton = button;
    let toggle = focusToggle && focusToggle.isConnected ? focusToggle : ROOT2.document.getElementById(FOCUS_TOGGLE_ID);
    if (!toggle) {
      toggle = ROOT2.document.createElement("button");
      toggle.id = FOCUS_TOGGLE_ID;
      toggle.type = "button";
      toggle.textContent = FOCUS_TOGGLE_TEXT;
      toggle.setAttribute("aria-label", FOCUS_TOGGLE_TEXT);
      toggle.setAttribute("aria-pressed", readStoredFocusPopular() ? "true" : "false");
      toggle.addEventListener("click", onFocusToggleClick);
    }
    focusToggle = toggle;
    if (prev.parentElement !== nav) nav.appendChild(prev);
    if (button.parentElement !== nav) nav.appendChild(button);
    if (toggle.parentElement !== nav) nav.appendChild(toggle);
  }
  function removeJumpUi() {
    clearJumpStatus();
    const nav = jumpNav && jumpNav.isConnected ? jumpNav : ROOT2.document && ROOT2.document.getElementById(JUMP_NAV_ID);
    if (nav) nav.remove();
    for (const id of [JUMP_PREV_BUTTON_ID, JUMP_BUTTON_ID, FOCUS_TOGGLE_ID]) {
      const stray = ROOT2.document && ROOT2.document.getElementById(id);
      if (stray) stray.remove();
    }
    jumpNav = null;
    jumpButton = null;
    jumpPrevButton = null;
    focusToggle = null;
  }
  var settingsButton = null;
  var preferenceChangeHandler = null;
  function ensureSettingsButton() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let button = settingsButton && settingsButton.isConnected ? settingsButton : ROOT2.document.getElementById(SETTINGS_BUTTON_ID);
    if (!button) {
      button = ROOT2.document.createElement("button");
      button.id = SETTINGS_BUTTON_ID;
      button.type = "button";
      button.textContent = SETTINGS_BUTTON_TEXT;
      button.setAttribute("aria-label", "\u6253\u5F00\u6269\u5C55\u9009\u9879\u9875\uFF08\u70ED\u95E8\u9608\u503C\u3001\u5185\u5BB9\u5E93\u8BBE\u7F6E\uFF09");
      button.setAttribute("title", "\u6269\u5C55\u9009\u9879\uFF1A\u70ED\u95E8\u9608\u503C / \u5185\u5BB9\u5E93\u8BBE\u7F6E");
      button.addEventListener("click", openLibrarySettings);
      ROOT2.document.body.appendChild(button);
    }
    settingsButton = button;
  }
  function removeSettingsButton() {
    const button = settingsButton && settingsButton.isConnected ? settingsButton : ROOT2.document && ROOT2.document.getElementById(SETTINGS_BUTTON_ID);
    if (button) button.remove();
    settingsButton = null;
  }
  function ensureLibraryPageButton() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT2.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (!button) {
      button = ROOT2.document.createElement("button");
      button.id = LIBRARY_PAGE_BUTTON_ID;
      button.type = "button";
      button.textContent = LIBRARY_PAGE_BUTTON_TEXT;
      button.setAttribute("aria-label", LIBRARY_PAGE_BUTTON_TEXT);
      button.addEventListener("click", onSaveCurrentDetail);
      ROOT2.document.body.appendChild(button);
    }
    libraryPageButton = button;
  }
  function removeLibraryPageButton() {
    const button = libraryPageButton && libraryPageButton.isConnected ? libraryPageButton : ROOT2.document && ROOT2.document.getElementById(LIBRARY_PAGE_BUTTON_ID);
    if (button) button.remove();
    libraryPageButton = null;
  }
  function ensureLibraryBatchButton() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    let button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT2.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (!button) {
      button = ROOT2.document.createElement("button");
      button.id = LIBRARY_BATCH_BUTTON_ID;
      button.type = "button";
      button.textContent = LIBRARY_BATCH_BUTTON_TEXT;
      button.setAttribute("aria-label", LIBRARY_BATCH_BUTTON_TEXT);
      button.addEventListener("click", onSaveAllVisible);
      ROOT2.document.body.appendChild(button);
    }
    libraryBatchButton = button;
  }
  function removeLibraryBatchButton() {
    const button = libraryBatchButton && libraryBatchButton.isConnected ? libraryBatchButton : ROOT2.document && ROOT2.document.getElementById(LIBRARY_BATCH_BUTTON_ID);
    if (button) button.remove();
    libraryBatchButton = null;
  }
  function removeLibraryUi() {
    removeSettingsButton();
    removeLibraryPageButton();
    removeLibraryBatchButton();
  }
  function syncLibraryUi() {
    if (!ROOT2.document || !ROOT2.document.body) return;
    const route = getCurrentRoute();
    if (isDetailRoute(route)) {
      ensureSettingsButton();
      ensureLibraryPageButton();
      removeLibraryBatchButton();
      return;
    }
    if (isTargetRoute(route)) {
      ensureSettingsButton();
      ensureLibraryBatchButton();
      removeLibraryPageButton();
      return;
    }
    removeLibraryUi();
  }
  function syncJumpUi() {
    if (isTargetRoute(getCurrentRoute())) {
      ensureJumpUi();
    } else {
      removeJumpUi();
    }
  }
  function flush() {
    scheduled = false;
    if (destroyed || !ROOT2.document) return;
    counters.batches += 1;
    syncJumpUi();
    syncLibraryUi();
    syncBatchBar();
    syncGoodsPanel(getCurrentRoute());
    const url = ROOT2.location ? ROOT2.location.href : getCurrentRoute();
    if (url !== lastUrl) {
      lastUrl = url;
      counters.routeSignals += 1;
      clearFallbackTokenCache();
      if (!isTargetRoute(getCurrentRoute())) cleanupAll();
      else for (const card of discoverCards(ROOT2.document)) pending.add(card);
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
    updateBatchBarCount();
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
    if (typeof ROOT2.requestAnimationFrame === "function") {
      ROOT2.requestAnimationFrame(run);
      if (ROOT2.document && ROOT2.document.visibilityState === "hidden" && typeof ROOT2.setTimeout === "function") {
        ROOT2.setTimeout(run, 150);
      }
    } else {
      Promise.resolve().then(run);
    }
  }
  function scan(root) {
    if (!ROOT2.document || !isTargetRoute(getCurrentRoute())) return;
    counters.fullScans += 1;
    for (const card of discoverCards(root || ROOT2.document)) pending.add(card);
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
    return ROOT2.document.querySelector(SELECTORS.contentRoots) || ROOT2.document.body;
  }
  function bindObserverRoot(nextRoot) {
    if (nextRoot === observerRoot && observer2) return false;
    if (observer2) observer2.disconnect();
    observer2 = null;
    observerRoot = nextRoot || null;
    if (!observerRoot || typeof ROOT2.MutationObserver !== "function") return false;
    observer2 = new ROOT2.MutationObserver(mutationCallback);
    observer2.observe(observerRoot, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: READ_ATTRIBUTES.slice() });
    return true;
  }
  function structureMutationCallback() {
    const nextRoot = selectObserverRoot();
    if (nextRoot === observerRoot && observerRoot && observerRoot.isConnected) return;
    if (bindObserverRoot(nextRoot)) scan(nextRoot);
  }
  function signalRoute() {
    if (destroyed) return;
    scan(ROOT2.document);
    schedule();
  }
  function init() {
    if (!ROOT2.document || initialized) return;
    if (!ROOT2.document.body) {
      if (typeof ROOT2.document.addEventListener === "function") {
        const onReady = () => {
          try {
            ROOT2.document.removeEventListener("DOMContentLoaded", onReady);
          } catch (_) {
          }
          init();
        };
        ROOT2.document.addEventListener("DOMContentLoaded", onReady, { once: true });
      }
      return;
    }
    initialized = true;
    if (isCaptureMode()) {
      initCaptureMode();
      return;
    }
    lifecycleToken = { active: true };
    destroyed = false;
    batchScopeCache2 = readStoredBatchScope();
    ensureStyle();
    bindObserverRoot(selectObserverRoot());
    subscribePreferenceChanges();
    if (ROOT2.document.documentElement && typeof ROOT2.MutationObserver === "function") {
      structureObserver = new ROOT2.MutationObserver(structureMutationCallback);
      structureObserver.observe(ROOT2.document.documentElement, { childList: true, subtree: true });
    }
    bind(ROOT2, "popstate", signalRoute);
    bind(ROOT2, "hashchange", signalRoute);
    bind(ROOT2.document, "visibilitychange", signalRoute);
    lastUrl = "";
    scan(ROOT2.document);
    syncJumpUi();
    syncLibraryUi();
    syncBatchBar();
    syncGoodsPanel(getCurrentRoute());
    selection.hydrate().then(() => {
      syncAllCheckboxes(ROOT2.document);
      updateBatchBarCount();
    }, () => {
    });
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
    if (observer2) observer2.disconnect();
    observer2 = null;
    observerRoot = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    unsubscribePreferenceChanges();
    for (const [target, type, handler] of eventBindings.splice(0)) target.removeEventListener(type, handler);
    removeJumpUi();
    removeLibraryUi();
    removeBatchBar();
    removeGoodsPanel();
    clearBatchProgress();
    batchDownloadInFlight = false;
    continuousSelect = false;
    saveInFlight = false;
    clearCopyStatus();
    cleanupAll();
    const style = ROOT2.document && ROOT2.document.getElementById(STYLE_ID);
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
    extractNoteFromInitialStateHtml,
    slimNoteDetail,
    pickBestImageUrl,
    isGoodsDetailRoute,
    getGoodsIdFromHref,
    extractUrlsFromText,
    looksLikeGoodsImageUrl,
    isXhsImageCdnUrl,
    canonicalGoodsImageKey,
    rankGoodsImageCandidate,
    dedupeGoodsImages,
    collectGoodsImageEntries,
    classifyGoodsSection,
    countGoodsSections,
    normalizeGoodsSection,
    GOODS_SECTION_LABELS,
    toHDGoodsUrl,
    extensionForMime,
    buildGoodsZipFileName,
    buildGoodsImageFileName,
    buildGoodsInfoText,
    getGoodsTitleFromDocument,
    GOODS_FORMAT_MODES,
    shouldCompressGoodsImage,
    JPEG_QUALITY_LADDER,
    GOODS_COMPRESS_MAX_BYTES,
    SCALE_DOWN_FACTOR,
    SCALE_DOWN_MIN,
    scaledDimensions,
    dedupeSkuEntries,
    buildGoodsSkuImageFileName,
    planDetailImageGroups,
    GOODS_DETAIL_SLICE_HEIGHT,
    buildDetailNoteUrl,
    resolveSaveUrlFromCard,
    cardNoteTargetId,
    resolveCardNoteLink,
    extractCardTitle,
    snapshotFromCard,
    onBatchDownload,
    mapWithConcurrency,
    buildZip,
    splitZipEntries,
    buildBatchZipFileName,
    buildNoteFolderName,
    buildImageFileName,
    buildFlatEntryName,
    readStoredBatchLayout,
    crc32,
    sanitizeFileName,
    createSelectionStore,
    SELECTION_STORAGE_KEY,
    normalizeBatchScope,
    normalizeBatchLayout,
    READ_ATTRIBUTES,
    SELECTORS
  });
  if (TEST_MODE) {
    const testApi = Object.assign({}, pureApi, {
      setTestRoute(pathname, scheduleChange = true) {
        routeProvider = () => String(pathname || "");
        lastUrl = "";
        if (scheduleChange) schedule(ROOT2.document);
      },
      clearTestRoute() {
        routeProvider = null;
        lastUrl = "";
        schedule(ROOT2.document);
      },
      setTestInitialState(value) {
        getResolver().setTestInitialState(value);
      },
      scan: () => scan(ROOT2.document),
      flush,
      init,
      destroy,
      clearTestSelection() {
        continuousSelect = false;
        batchDownloadInFlight = false;
        if (batchContinuousButton) batchContinuousButton.setAttribute("aria-pressed", "false");
        selection.clear();
        syncAllCheckboxes(ROOT2.document);
        updateBatchBarCount();
        updateBatchDownloadButton();
      },
      getBatchSelectionSnapshot: () => selection.values(),
      getBatchScopeSnapshot: () => batchScopeCache2,
      setBatchScope: (scope) => {
        batchScopeCache2 = writeStoredBatchScope(scope).value;
        updateBatchScopeButtons();
        return batchScopeCache2;
      },
      setBatchLayout: (layout) => writeStoredBatchLayout(layout).value,
      getBatchLayoutSnapshot: () => readStoredBatchLayout(),
      syncGoodsPanel,
      getGoodsImagesSnapshot,
      setThreshold: (value) => writeStoredThreshold(value),
      getThreshold: () => readStoredThreshold(),
      setFocusPopular: (value, _storage) => writeStoredFocusPopular(value).persisted,
      getFocusPopular: () => readStoredFocusPopular(),
      getCounters: () => Object.assign({}, counters, {
        bindings: eventBindings.length,
        observerRootIsBody: observerRoot === ROOT2.document.body
      })
    });
    ROOT2.__XHS_ENHANCED_TEST_API__ = testApi;
  }
  if (ROOT2.document) {
    ready.then(() => {
      init();
    });
  }
})();
