(() => {
  // src/lib/env.js
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
  function parseThreshold(value) {
    const text = String(value == null ? "" : value);
    if (!/^(?:0|[1-9]\d*)$/.test(text)) return { ok: false };
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false };
  }
  var BATCH_LAYOUT_VALUES = Object.freeze(["notes", "flat"]);
  function normalizeBatchLayout(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return text === "flat" ? "flat" : "notes";
  }
  var BATCH_SCOPE_VALUES = Object.freeze(["cover", "inner", "all"]);
  function normalizeBatchScope(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return text === "cover" || text === "inner" ? text : "all";
  }
  function parseBaseUrl(value) {
    const text = normalizeSpace(value).replace(/\/+$/, "");
    if (!text || !/^https?:\/\/\S+$/i.test(text)) return { ok: false, value: "" };
    return { ok: true, value: text };
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
    const chrome2 = getChrome();
    try {
      if (chrome2 && chrome2.storage && chrome2.storage.local) return chrome2.storage.local;
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
  var batchLayoutCache = "notes";
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
    const chrome2 = getChrome();
    try {
      const onChanged = chrome2 && chrome2.storage && chrome2.storage.onChanged;
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
  function writeLibrarySettings({ baseUrl, username, accountId, password }) {
    libraryCache.baseUrl = baseUrl || "";
    libraryCache.username = normalizeSpace(username || "");
    libraryCache.accountId = Number(accountId) || 0;
    if (!Number.isSafeInteger(libraryCache.accountId) || libraryCache.accountId < 0) libraryCache.accountId = 0;
    libraryCache.password = String(password == null ? "" : password);
    return persistLibrary({
      [LIBRARY_BASE_URL_KEY]: libraryCache.baseUrl,
      [LIBRARY_USERNAME_KEY]: libraryCache.username,
      [LIBRARY_ACCOUNT_ID_KEY]: libraryCache.accountId ? String(libraryCache.accountId) : "",
      [LIBRARY_PASSWORD_KEY]: libraryCache.password
    });
  }
  function writeSecret(key, value) {
    const text = String(value == null ? "" : value);
    if (key === LIBRARY_REFRESH_KEY) libraryCache.refreshToken = text;
    if (key === LIBRARY_PASSWORD_KEY) libraryCache.password = text;
    return persistLibrary({ [key]: text });
  }
  async function clearLibrarySettings() {
    libraryCache.baseUrl = "";
    libraryCache.username = "";
    libraryCache.accountId = 0;
    libraryCache.password = "";
    libraryCache.refreshToken = "";
    const store = chromeStorage();
    if (store) {
      try {
        await store.remove(LIBRARY_KEYS.slice());
        return true;
      } catch (_) {
        return false;
      }
    }
    for (const key of LIBRARY_KEYS) removeLocal(key);
    return true;
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
  function writeStoredThreshold(value) {
    const parsed = parseThreshold(value);
    if (!parsed.ok) return { ok: false, value: thresholdCache, persisted: false };
    thresholdCache = parsed.value;
    return { ok: true, value: thresholdCache, persisted: persistLibrary({ [THRESHOLD_KEY]: String(thresholdCache) }) };
  }
  function readStoredBatchLayout(storage) {
    if (storage !== void 0) {
      if (!storage) return "notes";
      try {
        return normalizeBatchLayout(storage.getItem(BATCH_LAYOUT_KEY));
      } catch (_) {
        return "notes";
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
  async function sendToBackground(request) {
    const chrome2 = getChrome();
    if (!chrome2 || !chrome2.runtime || typeof chrome2.runtime.sendMessage !== "function") {
      return null;
    }
    try {
      const response = await chrome2.runtime.sendMessage(Object.assign({ type: FETCH_MESSAGE }, request));
      if (response && typeof response === "object") return response;
      return { ok: false, status: 0, error: "network" };
    } catch (_) {
      return { ok: false, status: 0, error: "network" };
    }
  }
  function hasPrivilegedChannel() {
    const chrome2 = getChrome();
    return Boolean(chrome2 && chrome2.runtime && typeof chrome2.runtime.sendMessage === "function");
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
  var libraryTokenMemory = { accessToken: "", refreshToken: "", exp: 0 };
  function clearLibraryTokens() {
    libraryTokenMemory.accessToken = "";
    libraryTokenMemory.refreshToken = "";
    libraryTokenMemory.exp = 0;
    writeSecret(LIBRARY_REFRESH_KEY, "");
  }
  function checkLibraryHealth(baseUrl) {
    return fetchJson({ method: "GET", url: baseUrl + "/api/health", timeout: 8e3 });
  }
  function fetchLibraryPcAccounts(token, baseUrl) {
    return fetchJson({
      method: "GET",
      url: baseUrl + "/api/accounts?platform=xhs&page_size=100",
      headers: { Authorization: "Bearer " + token }
    }).then((res) => {
      if (!res.ok || !res.json || !Array.isArray(res.json.items)) {
        return { ok: false, accounts: [], error: res.error || "bad-response" };
      }
      const accounts = [];
      for (const item of res.json.items) {
        if (item && item.platform === "xhs" && item.sub_type === "pc" && Number(item.id) > 0) {
          accounts.push({ id: Number(item.id), nickname: String(item.nickname || ""), status: String(item.status || "") });
        }
      }
      return { ok: true, accounts, error: "" };
    });
  }
  function libraryAccountOptionLabel(account) {
    const nickname = normalizeSpace(account.nickname);
    const status = account.status && account.status !== "ok" ? "\uFF08" + account.status + "\uFF09" : "";
    return "#" + account.id + (nickname ? " " + nickname : "") + status;
  }

  // src/options/options.js
  var els = {
    base: document.getElementById("library-base-url"),
    user: document.getElementById("library-username"),
    password: document.getElementById("library-password"),
    account: document.getElementById("library-account"),
    test: document.getElementById("library-test"),
    save: document.getElementById("library-save"),
    clear: document.getElementById("library-clear"),
    status: document.getElementById("library-status"),
    httpWarning: document.getElementById("library-http-warning"),
    threshold: document.getElementById("popular-threshold"),
    layoutNotes: document.getElementById("batch-layout-notes"),
    layoutFlat: document.getElementById("batch-layout-flat")
  };
  function isPlainHttp(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      if (parsed.protocol !== "http:") return false;
      const host = parsed.hostname.toLowerCase();
      return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
    } catch (_) {
      return false;
    }
  }
  function updateHttpWarning() {
    if (els.httpWarning) els.httpWarning.hidden = !isPlainHttp(els.base.value);
  }
  function showStatus(message) {
    els.status.textContent = message || "";
  }
  function originPattern(baseUrl) {
    try {
      return new URL(baseUrl).origin + "/*";
    } catch (_) {
      return "";
    }
  }
  async function ensureHostPermission(baseUrl) {
    const pattern = originPattern(baseUrl);
    if (!pattern || !/^https?:/.test(pattern)) return false;
    try {
      const contains = await chrome.permissions.contains({ origins: [pattern] });
      if (contains) return true;
      return await chrome.permissions.request({ origins: [pattern] });
    } catch (_) {
      return false;
    }
  }
  function fillForm() {
    const cfg = readLibraryConfig();
    els.base.value = cfg.baseUrl;
    els.user.value = cfg.username;
    els.password.value = cfg.password;
    if (els.threshold) els.threshold.value = String(readStoredThreshold());
    const layout = readStoredBatchLayout();
    if (els.layoutNotes && els.layoutFlat) {
      els.layoutNotes.checked = layout !== "flat";
      els.layoutFlat.checked = layout === "flat";
    }
    els.account.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = cfg.accountId ? "\u5DF2\u4FDD\u5B58\u8D26\u53F7 #" + cfg.accountId + "\uFF08\u70B9\u201C\u6D4B\u8BD5\u8FDE\u63A5\u201D\u91CD\u65B0\u53D1\u73B0\uFF09" : "\u70B9\u51FB\u201C\u6D4B\u8BD5\u8FDE\u63A5\u201D\u81EA\u52A8\u83B7\u53D6";
    els.account.appendChild(placeholder);
    if (cfg.accountId) {
      const saved = document.createElement("option");
      saved.value = String(cfg.accountId);
      saved.textContent = "#" + cfg.accountId;
      saved.selected = true;
      els.account.appendChild(saved);
    }
  }
  function readForm() {
    const parsed = parseBaseUrl(els.base.value);
    return {
      base: parsed,
      username: normalizeSpace(els.user.value),
      password: els.password.value || "",
      accountId: Number(els.account.value) || 0
    };
  }
  function populateAccountSelect(accounts, selectedId) {
    els.account.textContent = "";
    for (const account of accounts) {
      const option = document.createElement("option");
      option.value = String(account.id);
      option.textContent = libraryAccountOptionLabel(account);
      els.account.appendChild(option);
    }
    if (!accounts.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "\u672A\u53D1\u73B0 PC \u7AEF\u8D26\u53F7\uFF0C\u8BF7\u5148\u5728\u5E73\u53F0\u7ED1\u5B9A";
      els.account.appendChild(option);
      return;
    }
    const values = accounts.map((account) => String(account.id));
    const current = String(selectedId || "");
    els.account.value = values.indexOf(current) >= 0 ? current : String(accounts[0].id);
  }
  async function onTestConnection() {
    const form = readForm();
    if (!form.base.ok) {
      showStatus("\u670D\u52A1\u5668\u5730\u5740\u9700\u4EE5 http:// \u6216 https:// \u5F00\u5934");
      return;
    }
    if (!form.username || !form.password) {
      showStatus("\u8BF7\u5148\u586B\u5199\u7528\u6237\u540D\u4E0E\u5BC6\u7801");
      return;
    }
    showStatus("\u6B63\u5728\u8BF7\u6C42\u6388\u6743\u5E76\u8FDE\u63A5\u5185\u5BB9\u5E93\u2026");
    const granted = await ensureHostPermission(form.base.value);
    if (!granted) {
      showStatus("\u672A\u80FD\u83B7\u5F97\u8BE5\u670D\u52A1\u5668\u7684\u8BBF\u95EE\u6388\u6743\uFF08\u53EF\u5728\u6269\u5C55\u8BE6\u60C5\u9875\u201C\u6743\u9650\u201D\u4E2D\u5141\u8BB8\uFF09");
      return;
    }
    if (!hasPrivilegedChannel()) {
      showStatus("\u6269\u5C55\u65E0\u6CD5\u8BBF\u95EE\u540E\u53F0\u670D\u52A1\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u6269\u5C55");
      return;
    }
    showStatus("\u6B63\u5728\u8FDE\u63A5\u5185\u5BB9\u5E93\u2026");
    const health = await checkLibraryHealth(form.base.value);
    if (!health.ok) {
      showStatus("\u65E0\u6CD5\u8FDE\u63A5\u5185\u5BB9\u5E93\u670D\u52A1\uFF08\u672A\u4FDD\u5B58\uFF09");
      return;
    }
    const login = await fetchJson({
      method: "POST",
      url: form.base.value + "/api/auth/login",
      data: { username: form.username, password: form.password }
    });
    if (!login.ok || !login.json || !login.json.access_token) {
      showStatus("\u5185\u5BB9\u5E93\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u540D\u4E0E\u5BC6\u7801\uFF08\u672A\u4FDD\u5B58\uFF09");
      return;
    }
    const result = await fetchLibraryPcAccounts(String(login.json.access_token), form.base.value);
    if (!result.ok) {
      showStatus("\u767B\u5F55\u6210\u529F\uFF0C\u4F46\u83B7\u53D6\u8D26\u53F7\u5217\u8868\u5931\u8D25\uFF08\u672A\u4FDD\u5B58\uFF09");
      return;
    }
    if (!result.accounts.length) {
      showStatus("\u5185\u5BB9\u5E93\u672A\u53D1\u73B0\u53EF\u7528\u7684\u5C0F\u7EA2\u4E66 PC \u7AEF\u8D26\u53F7\uFF08\u672A\u4FDD\u5B58\uFF09");
      return;
    }
    populateAccountSelect(result.accounts, readLibraryConfig().accountId);
    const picked = Number(els.account.value) || result.accounts[0].id;
    const persisted = writeLibrarySettings({ baseUrl: form.base.value, username: form.username, accountId: picked, password: form.password });
    if (login.json.refresh_token) writeSecret(LIBRARY_REFRESH_KEY, String(login.json.refresh_token));
    showStatus("\u8FDE\u63A5\u6210\u529F\uFF0C\u5171\u53D1\u73B0 " + result.accounts.length + " \u4E2A\u8D26\u53F7" + (persisted ? "\uFF0C\u5DF2\u4FDD\u5B58" : "\uFF08\u4FDD\u5B58\u5931\u8D25\uFF09"));
  }
  async function onSave() {
    const thresholdRaw = normalizeSpace(els.threshold ? els.threshold.value : "100");
    const parsedThreshold = parseThreshold(thresholdRaw);
    if (!parsedThreshold.ok) {
      showStatus("\u70ED\u95E8\u9608\u503C\u9700\u4E3A\u975E\u8D1F\u6574\u6570\uFF08\u4F8B\u5982 100\uFF09\uFF0C\u8BBE\u7F6E\u672A\u4FDD\u5B58");
      return;
    }
    const thresholdPersisted = writeStoredThreshold(parsedThreshold.value).persisted;
    const layoutPersisted = writeStoredBatchLayout(els.layoutFlat && els.layoutFlat.checked ? "flat" : "notes").persisted;
    const prefsPersisted = thresholdPersisted && layoutPersisted;
    const form = readForm();
    if (!form.base.ok) {
      showStatus("\u70ED\u95E8\u9608\u503C " + (prefsPersisted ? "\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u670D\u52A1\u5668\u5730\u5740\u9700\u4EE5 http:// \u6216 https:// \u5F00\u5934" : "\u672A\u80FD\u6301\u4E45\u5316\uFF0C\u4E14\u670D\u52A1\u5668\u5730\u5740\u9700\u4EE5 http:// \u6216 https:// \u5F00\u5934"));
      return;
    }
    showStatus("\u6B63\u5728\u4FDD\u5B58\u2026");
    const granted = await ensureHostPermission(form.base.value);
    if (!granted) {
      showStatus("\u504F\u597D\u8BBE\u7F6E" + (prefsPersisted ? "\u5DF2\u4FDD\u5B58" : "\u672A\u80FD\u6301\u4E45\u5316") + "\uFF1B\u672A\u80FD\u83B7\u5F97\u8BE5\u670D\u52A1\u5668\u7684\u8BBF\u95EE\u6388\u6743\uFF08\u53EF\u5728\u6269\u5C55\u8BE6\u60C5\u9875\u201C\u6743\u9650\u201D\u4E2D\u5141\u8BB8\uFF09");
      return;
    }
    const persisted = writeLibrarySettings({
      baseUrl: form.base.value,
      username: form.username,
      accountId: form.accountId,
      password: form.password
    });
    clearLibraryTokens();
    showStatus(persisted ? prefsPersisted ? "\u5168\u90E8\u8BBE\u7F6E\u5DF2\u4FDD\u5B58" : "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u90E8\u5206\u504F\u597D\u672A\u80FD\u6301\u4E45\u5316" : "\u8BBE\u7F6E\u5DF2\u5E94\u7528\uFF0C\u4F46\u672A\u80FD\u6301\u4E45\u5316");
  }
  async function onClear() {
    const previous = readLibraryConfig();
    await clearLibrarySettings();
    clearLibraryTokens();
    const pattern = previous.baseUrl ? originPattern(previous.baseUrl) : "";
    let revoked = false;
    if (pattern) {
      try {
        revoked = await chrome.permissions.remove({ origins: [pattern] });
      } catch (_) {
      }
    }
    fillForm();
    updateHttpWarning();
    showStatus("\u5DF2\u6E05\u9664\u5185\u5BB9\u5E93\u8BBE\u7F6E" + (pattern ? revoked ? "\uFF0C\u5E76\u64A4\u9500\u4E86\u8BE5\u670D\u52A1\u5668\u7684\u6388\u6743" : "\uFF08\u6388\u6743\u672A\u64A4\u9500\u6216\u672A\u6388\u4E88\uFF09" : ""));
  }
  if (els.base && els.user && els.password && els.account && els.test && els.save && els.status) {
    ready.then(() => {
      fillForm();
      updateHttpWarning();
    });
    els.base.addEventListener("input", updateHttpWarning);
    els.test.addEventListener("click", onTestConnection);
    els.save.addEventListener("click", onSave);
    els.clear.addEventListener("click", onClear);
    els.account.addEventListener("change", () => {
      const form = readForm();
      if (!form.base.ok) return;
      writeLibrarySettings({ baseUrl: form.base.value, username: form.username, accountId: form.accountId, password: form.password });
    });
  }
})();
