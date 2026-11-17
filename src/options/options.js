// Extension options page: the content-library (XHS_ALL_IN_ONE) settings panel.
// Replaces the legacy in-page panel. Grants runtime host permission for the
// user's own server when they test/save it, so the extension never ships with
// blanket access to arbitrary hosts.
import {
  ready,
  readLibraryConfig,
  writeLibrarySettings,
  clearLibrarySettings,
  writeSecret,
  LIBRARY_REFRESH_KEY,
  readStoredThreshold,
  writeStoredThreshold,
  readStoredBatchLayout,
  writeStoredBatchLayout
} from '../lib/settings.js';
import { parseBaseUrl, parseThreshold } from '../lib/pure.js';
import {
  checkLibraryHealth,
  fetchLibraryPcAccounts,
  libraryAccountOptionLabel,
  clearLibraryTokens
} from '../lib/library.js';
import { hasPrivilegedChannel, fetchJson } from '../lib/remote.js';
import { normalizeSpace } from '../lib/text.js';

const els = {
  base: document.getElementById('library-base-url'),
  user: document.getElementById('library-username'),
  password: document.getElementById('library-password'),
  account: document.getElementById('library-account'),
  test: document.getElementById('library-test'),
  save: document.getElementById('library-save'),
  clear: document.getElementById('library-clear'),
  status: document.getElementById('library-status'),
  httpWarning: document.getElementById('library-http-warning'),
  threshold: document.getElementById('popular-threshold'),
  thresholdStatus: document.getElementById('threshold-status'),
  layoutStatus: document.getElementById('layout-status'),
  layoutNotes: document.getElementById('batch-layout-notes'),
  layoutFlat: document.getElementById('batch-layout-flat')
};

function isPlainHttp(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
  } catch (_) {
    return false;
  }
}

function updateHttpWarning() {
  if (els.httpWarning) els.httpWarning.hidden = !isPlainHttp(els.base.value);
}

function showStatus(message) {
  els.status.textContent = message || '';
}

function originPattern(baseUrl) {
  try {
    return new URL(baseUrl).origin + '/*';
  } catch (_) {
    return '';
  }
}

// Must be called from a user gesture (click).
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

function setPrefStatus(node, message, isError) {
  if (!node) return;
  node.textContent = message || '';
  if (isError) node.setAttribute('data-error', 'true');
  else node.removeAttribute('data-error');
}

function onThresholdChange() {
  const raw = normalizeSpace(els.threshold ? els.threshold.value : '');
  const parsed = parseThreshold(raw);
  if (!parsed.ok) {
    setPrefStatus(els.thresholdStatus, '热门阈值需为非负整数（例如 100），未保存', true);
    return;
  }
  const persisted = writeStoredThreshold(parsed.value).persisted;
  setPrefStatus(els.thresholdStatus, persisted ? '已保存，所有页面即时生效' : '已应用，但未能持久化（存储不可用）', !persisted);
}

function onLayoutChange() {
  const layout = els.layoutFlat && els.layoutFlat.checked ? 'flat' : 'notes';
  const result = writeStoredBatchLayout(layout);
  setPrefStatus(
    els.layoutStatus,
    result.persisted
      ? (result.value === 'flat' ? '已保存：平铺到同一个文件夹，所有页面即时生效' : '已保存：按笔记建文件夹，所有页面即时生效')
      : '已应用，但未能持久化（存储不可用）',
    !result.persisted
  );
}

function fillForm() {
  const cfg = readLibraryConfig();
  els.base.value = cfg.baseUrl;
  els.user.value = cfg.username;
  els.password.value = cfg.password;
  if (els.threshold) els.threshold.value = String(readStoredThreshold());
  const layout = readStoredBatchLayout();
  if (els.layoutNotes && els.layoutFlat) {
    els.layoutNotes.checked = layout !== 'flat';
    els.layoutFlat.checked = layout === 'flat';
  }
  // Account list is discovered on demand (test connection); keep a placeholder.
  els.account.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = cfg.accountId ? ('已保存账号 #' + cfg.accountId + '（点“测试连接”重新发现）') : '点击“测试连接”自动获取';
  els.account.appendChild(placeholder);
  if (cfg.accountId) {
    const saved = document.createElement('option');
    saved.value = String(cfg.accountId);
    saved.textContent = '#' + cfg.accountId;
    saved.selected = true;
    els.account.appendChild(saved);
  }
}

function readForm() {
  const parsed = parseBaseUrl(els.base.value);
  return {
    base: parsed,
    username: normalizeSpace(els.user.value),
    password: els.password.value || '',
    accountId: Number(els.account.value) || 0
  };
}

function populateAccountSelect(accounts, selectedId) {
  els.account.textContent = '';
  for (const account of accounts) {
    const option = document.createElement('option');
    option.value = String(account.id);
    option.textContent = libraryAccountOptionLabel(account);
    els.account.appendChild(option);
  }
  if (!accounts.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '未发现 PC 端账号，请先在平台绑定';
    els.account.appendChild(option);
    return;
  }
  const values = accounts.map(account => String(account.id));
  const current = String(selectedId || '');
  els.account.value = values.indexOf(current) >= 0 ? current : String(accounts[0].id);
}

async function onTestConnection() {
  const form = readForm();
  if (!form.base.ok) { showStatus('服务器地址需以 http:// 或 https:// 开头'); return; }
  if (!form.username || !form.password) { showStatus('请先填写用户名与密码'); return; }
  showStatus('正在请求授权并连接内容库…');
  const granted = await ensureHostPermission(form.base.value);
  if (!granted) { showStatus('未能获得该服务器的访问授权（可在扩展详情页“权限”中允许）'); return; }
  if (!hasPrivilegedChannel()) { showStatus('扩展无法访问后台服务，请重新加载扩展'); return; }
  showStatus('正在连接内容库…');
  const health = await checkLibraryHealth(form.base.value);
  if (!health.ok) { showStatus('无法连接内容库服务（未保存）'); return; }
  // Verify credentials against a temporary probe first; persist only after the
  // server accepts them (nothing is stored on a failed test).
  const login = await fetchJson({
    method: 'POST',
    url: form.base.value + '/api/auth/login',
    data: { username: form.username, password: form.password }
  });
  if (!login.ok || !login.json || !login.json.access_token) {
    showStatus('内容库登录失败，请检查用户名与密码（未保存）');
    return;
  }
  const result = await fetchLibraryPcAccounts(String(login.json.access_token), form.base.value);
  if (!result.ok) { showStatus('登录成功，但获取账号列表失败（未保存）'); return; }
  if (!result.accounts.length) { showStatus('内容库未发现可用的小红书 PC 端账号（未保存）'); return; }
  populateAccountSelect(result.accounts, readLibraryConfig().accountId);
  const picked = Number(els.account.value) || result.accounts[0].id;
  const persisted = writeLibrarySettings({ baseUrl: form.base.value, username: form.username, accountId: picked, password: form.password });
  if (login.json.refresh_token) writeSecret(LIBRARY_REFRESH_KEY, String(login.json.refresh_token));
  showStatus('连接成功，共发现 ' + result.accounts.length + ' 个账号' + (persisted ? '，已保存' : '（保存失败）'));
}

async function onSave() {
  // Validate and persist the local preferences first; they need no server
  // permission and stay independent of the library flow.
  const thresholdRaw = normalizeSpace(els.threshold ? els.threshold.value : '100');
  const parsedThreshold = parseThreshold(thresholdRaw);
  if (!parsedThreshold.ok) {
    showStatus('热门阈值需为非负整数（例如 100），设置未保存');
    return;
  }
  const thresholdPersisted = writeStoredThreshold(parsedThreshold.value).persisted;
  const layoutPersisted = writeStoredBatchLayout(els.layoutFlat && els.layoutFlat.checked ? 'flat' : 'notes').persisted;
  const prefsPersisted = thresholdPersisted && layoutPersisted;

  const form = readForm();
  if (!form.base.ok) { showStatus('热门阈值 ' + (prefsPersisted ? '已保存，但服务器地址需以 http:// 或 https:// 开头' : '未能持久化，且服务器地址需以 http:// 或 https:// 开头')); return; }
  showStatus('正在保存…');
  const granted = await ensureHostPermission(form.base.value);
  if (!granted) { showStatus('偏好设置' + (prefsPersisted ? '已保存' : '未能持久化') + '；未能获得该服务器的访问授权（可在扩展详情页“权限”中允许）'); return; }
  const persisted = writeLibrarySettings({
    baseUrl: form.base.value,
    username: form.username,
    accountId: form.accountId,
    password: form.password
  });
  clearLibraryTokens();
  showStatus(persisted
    ? (prefsPersisted ? '全部设置已保存' : '设置已保存，但部分偏好未能持久化')
    : '设置已应用，但未能持久化');
}

async function onClear() {
  const previous = readLibraryConfig();
  await clearLibrarySettings();
  clearLibraryTokens();
  const pattern = previous.baseUrl ? originPattern(previous.baseUrl) : '';
  let revoked = false;
  if (pattern) {
    try {
      revoked = await chrome.permissions.remove({ origins: [pattern] });
    } catch (_) {}
  }
  fillForm();
  updateHttpWarning();
  showStatus('已清除内容库设置' + (pattern ? (revoked ? '，并撤销了该服务器的授权' : '（授权未撤销或未授予）') : ''));
}

if (els.base && els.user && els.password && els.account && els.test && els.save && els.status) {
  ready.then(() => { fillForm(); updateHttpWarning(); });
  els.base.addEventListener('input', updateHttpWarning);
  els.test.addEventListener('click', onTestConnection);
  els.save.addEventListener('click', onSave);
  els.clear.addEventListener('click', onClear);
  els.account.addEventListener('change', () => {
    const form = readForm();
    if (!form.base.ok) return;
    writeLibrarySettings({ baseUrl: form.base.value, username: form.username, accountId: form.accountId, password: form.password });
  });
}
// Preference cards save themselves immediately (hint text in each card says
// so); the library "保存设置" button persists the same keys too (idempotent).
if (els.threshold) els.threshold.addEventListener('change', onThresholdChange);
if (els.layoutNotes) els.layoutNotes.addEventListener('change', onLayoutChange);
if (els.layoutFlat) els.layoutFlat.addEventListener('change', onLayoutChange);
