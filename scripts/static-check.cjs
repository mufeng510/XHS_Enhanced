'use strict';
// Static guard rails for the extension: manifest shape, bundled output markers,
// and source-level forbidden patterns. Runs `node --check` on the CommonJS
// scripts and the built bundles.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

execFileSync(process.execPath, ['--check', 'scripts/build.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'scripts/browser-test-server.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'tests/browser/harness.js'], { stdio: 'inherit' });

// --- manifest ---------------------------------------------------------------
const manifest = JSON.parse(read('extension/manifest.json'));
assert.equal(manifest.manifest_version, 3, 'MV3 required');
assert.ok(manifest.name && manifest.version && manifest.description, 'name/version/description required');
assert.deepEqual(manifest.content_scripts.length, 1, 'exactly one content_scripts entry');
assert.deepEqual(manifest.content_scripts[0].matches, [
  'https://www.xiaohongshu.com/search_result*',
  'https://www.xiaohongshu.com/user/profile/*',
  'https://www.xiaohongshu.com/explore*',
  'https://www.xiaohongshu.com/discovery/item/*'
], 'content script match patterns changed unexpectedly');
assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);
assert.equal(manifest.background && manifest.background.service_worker, 'background.js');
assert.equal(manifest.options_ui && manifest.options_ui.page, 'options.html');
assert.equal(manifest.options_ui && manifest.options_ui.open_in_tab, true);
for (const permission of ['storage', 'declarativeNetRequestWithHostAccess']) {
  assert(manifest.permissions.includes(permission), `missing permission: ${permission}`);
}
assert(!manifest.permissions.includes('declarativeNetRequest'), 'use declarativeNetRequestWithHostAccess to avoid the broad install warning');
assert(!manifest.permissions.includes('<all_urls>'), '<all_urls> must stay out of permissions');
assert(!JSON.stringify(manifest.permissions).includes('tabs'), 'tabs permission is not needed');
const packageVersion = JSON.parse(read('package.json')).version;
assert(manifest.version === packageVersion, `version mismatch: manifest ${manifest.version} vs package.json ${packageVersion}`);
const hostPermissions = manifest.host_permissions || [];
assert(hostPermissions.includes('https://*.xhscdn.com/*'), 'CDN host permission required');
assert(hostPermissions.includes('https://*.xiaohongshu.com/*'), 'image CDN host permission required');
const optionalHosts = manifest.optional_host_permissions || [];
assert.deepEqual(optionalHosts, ['http://*/*', 'https://*/*'], 'optional host permissions only for the user-configured library server');
for (const icon of Object.values(manifest.icons || {})) {
  assert(exists(path.join('extension', icon)), `missing icon: ${icon}`);
}

// --- declarativeNetRequest rules --------------------------------------------
assert(!fs.existsSync(path.join(root, 'extension/_metadata')), 'extension/_metadata (Chrome runtime cache) must not be committed or shipped');
const rules = JSON.parse(read('extension/rules.json'));
assert(Array.isArray(rules) && rules.length === 2, 'exactly two Referer override rules');
for (const rule of rules) {
  assert.equal(rule.action.type, 'modifyHeaders');
  assert.equal(rule.action.requestHeaders[0].header, 'referer');
  assert.equal(rule.action.requestHeaders[0].value, 'https://www.xiaohongshu.com/');
}
const ruleResources = manifest.declarative_net_request && manifest.declarative_net_request.rule_resources;
assert(Array.isArray(ruleResources) && ruleResources[0].path === 'rules.json' && ruleResources[0].enabled === true, 'DNR rule resource must be wired up');

// --- bundled output ----------------------------------------------------------
for (const file of ['extension/content.js', 'extension/options.js', 'extension/background.js']) {
  assert(exists(file), `${file} missing — run npm run build`);
  assert(fs.statSync(path.join(root, file)).size > 1000, `${file} looks stale`);
}
const content = read('extension/content.js');
for (const required of [
  'xhs-enhanced-jump-next', 'xhs-enhanced-jump-prev', 'xhs-enhanced-focus-toggle',
  'xhs-enhanced-card--dimmed', 'xhs-enhanced-jump-status', 'xhs-enhanced-copy-status',
  'xhs-enhanced-library-page', 'xhs-enhanced-library-batch', 'xhs-enhanced-library-toggle',
  'xhs-enhanced-save-library', 'xhs-enhanced-card--popular', 'xhs-enhanced-like--popular',
  'xhs-enhanced-threshold-control'
]) {
  assert(content.includes(required), `bundle missing marker: ${required}`);
}
assert(!content.includes('GM_xmlhttpRequest'), 'bundle must not reference GM_xmlhttpRequest');
assert(!content.includes('unsafeWindow'), 'bundle must not reference unsafeWindow');

// --- source-level forbidden patterns -----------------------------------------
const srcFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(js|cjs|html|css)$/.test(entry.name)) srcFiles.push(rel);
  }
})('src');
for (const rel of srcFiles) {
  const source = read(rel);
  for (const forbidden of ['.innerHTML =', '.innerHTML=', 'outerHTML =', 'document.write', 'eval(', 'new Function(', 'WebSocket', 'sendBeacon', 'unsafeWindow', 'GM_xmlhttpRequest', 'XMLHttpRequest']) {
    assert(!source.includes(forbidden), `forbidden pattern in ${rel}: ${forbidden}`);
  }
}
for (const rel of ['extension/content.js', 'extension/options.js', 'extension/background.js']) {
  const source = read(rel);
  for (const forbidden of ['.innerHTML =', 'eval(', 'new Function(', 'XMLHttpRequest']) {
    assert(!source.includes(forbidden), `forbidden pattern in ${rel}: ${forbidden}`);
  }
}

// --- options page ------------------------------------------------------------
const optionsHtml = read('extension/options.html');
assert(optionsHtml.includes('options.js'), 'options.html must load options.js');
assert(optionsHtml.includes('options.css'), 'options.html must load options.css');
assert(optionsHtml.includes('id="library-base-url"'), 'options page must expose the server address field');
const optionsJs = read('extension/options.js');
for (const required of ['chrome.permissions.request', 'library-test', 'library-save', 'clearLibrarySettings']) {
  assert(optionsJs.includes(required), `options.js missing: ${required}`);
}

// --- icons --------------------------------------------------------------------
for (const size of [16, 32, 48, 128]) {
  const file = path.join(root, 'extension/icons', `icon${size}.png`);
  assert(fs.existsSync(file), `icon${size}.png missing`);
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('latin1', 1, 4), 'PNG', `icon${size}.png is not a PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.equal(width, size, `icon${size}.png width`);
  assert.equal(height, size, `icon${size}.png height`);
}

// --- tests wired to the extension --------------------------------------------
assert(read('tests/browser/harness.html').includes('extension/content.js'), 'browser harness must load the extension bundle');
assert(read('tests/unit/extension.test.cjs').includes('extension/content.js'), 'unit tests must vm-load the extension bundle');
assert(!read('tests/unit/extension.test.cjs').includes('xhs-enhanced.user.js'), 'stale userscript reference in unit tests');

console.log('Static checks passed.');
