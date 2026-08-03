'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const file = 'xhs-enhanced.user.js';
const ADDITIONAL_INFO_MAX_CHARACTERS = 50000;
const source = fs.readFileSync(file, 'utf8');
const additionalInfo = fs.readFileSync('greasyfork-additional-info.html', 'utf8');
execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'tests/browser/harness.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'scripts/browser-test-server.cjs'], { stdio: 'inherit' });
for (const line of [
  '@match        https://www.xiaohongshu.com/search_result*',
  '@match        https://www.xiaohongshu.com/user/profile/*',
  '@grant        none', '@run-at       document-idle'
]) assert(source.includes(line), `missing metadata: ${line}`);
for (const forbidden of ['@connect', '@require', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'GM_xmlhttpRequest', 'preventDefault(', 'stopPropagation(', 'stopImmediatePropagation(', '.innerHTML =', 'alert(']) {
  assert(!source.includes(forbidden), `forbidden API/pattern: ${forbidden}`);
}
const matchCount = (source.match(/^\/\/ @match/gm) || []).length;
assert.strictEqual(matchCount, 2, 'exactly two @match entries required');
assert(source.includes('attributeFilter: READ_ATTRIBUTES.slice()'), 'filtered attribute observer required');
const additionalInfoCharacterCount = Array.from(additionalInfo).length;
assert(
  additionalInfoCharacterCount <= ADDITIONAL_INFO_MAX_CHARACTERS,
  `greasyfork-additional-info.html is too long (${additionalInfoCharacterCount}/${ADDITIONAL_INFO_MAX_CHARACTERS} characters)`
);
for (const attribute of ['aria-label', 'title', 'data-like-count', 'data-xhs-like-count']) assert(source.includes(`'${attribute}'`));
for (const forbiddenAttribute of ['datetime', 'data-publish-time', 'data-xhs-publish-time']) assert(!/READ_ATTRIBUTES[\s\S]{0,300}/.exec(source)?.[0].includes(`'${forbiddenAttribute}'`), `unused time attribute in observer filter: ${forbiddenAttribute}`);
assert(!source.includes('xhs-enhanced-publish-time'), 'publication-time UI must not be generated');
for (const required of ["'xhs-enhanced-jump-next'", "'xhs-enhanced-jump-status'", "setAttribute('role', 'status')", "setAttribute('aria-live', 'polite')"]) assert(source.includes(required), `missing jump UI contract: ${required}`);
console.log('Static checks passed.');
