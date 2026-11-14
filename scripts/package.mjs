#!/usr/bin/env node
// Packages extension/ into dist/xhs-enhanced-extension-v<version>.zip for
// store upload (Chrome Web Store / Edge Add-ons). Uses the project's own
// stored-zip builder (src/lib/zip.js) so no external zip dependency is
// needed. Excludes Chrome's runtime cache (extension/_metadata/) and
// dotfiles. Manifest must sit at the zip root.
import { readdirSync, readFileSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../src/lib/zip.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const distDir = join(root, 'dist');

const EXCLUDED_DIRS = new Set(['_metadata', '.git', 'node_modules']);

function listFiles(dir, prefix) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // dotfiles never ship
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...listFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ rel, full });
    }
  }
  return out;
}

const manifestPath = join(extensionDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = String(manifest.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`manifest.json version "${version}" is not semver (x.y.z); refusing to package`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (packageJson.version !== version) {
  console.error(`version mismatch: package.json ${packageJson.version} vs manifest.json ${version}`);
  process.exit(1);
}

const files = listFiles(extensionDir, '');
if (!files.some(file => file.rel === 'manifest.json')) {
  console.error('manifest.json missing from extension/ — run npm run build first');
  process.exit(1);
}
files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
const entries = files.map(({ rel, full }) => ({ name: rel.split(sep).join('/'), bytes: new Uint8Array(readFileSync(full)) }));
const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);

const zipBytes = buildZip(entries, { now: new Date() });
mkdirSync(distDir, { recursive: true });
const outFile = join(distDir, `xhs-enhanced-extension-v${version}.zip`);
rmSync(outFile, { force: true });
writeFileSync(outFile, Buffer.from(zipBytes));
console.log(`packaged ${relative(root, outFile)} (${files.length} entries, ${totalBytes} bytes uncompressed, ${zipBytes.length} bytes zipped)`);
