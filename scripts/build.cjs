'use strict';
// Builds the extension bundles from src/ with esbuild. The output is committed
// (extension/) so the unpacked extension can be loaded straight from the repo.
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (_) {
  console.error('esbuild is not installed. Run `npm install` first.');
  process.exit(1);
}

const shared = {
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'edge110'],
  logLevel: 'warning',
  // Readable output: this project ships reviewable source, not minified blobs.
  minify: false,
  legalComments: 'none',
  sourcemap: false
};

const builds = [
  { entryPoints: [path.join(root, 'src/content/index.js')], outfile: path.join(root, 'extension/content.js') },
  { entryPoints: [path.join(root, 'src/options/options.js')], outfile: path.join(root, 'extension/options.js') },
  { entryPoints: [path.join(root, 'src/background/index.js')], outfile: path.join(root, 'extension/background.js') }
];

(async () => {
  for (const config of builds) {
    await esbuild.build({ ...shared, ...config });
    const size = fs.statSync(config.outfile).size;
    console.log(`built ${path.relative(root, config.outfile)} (${size} bytes)`);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
