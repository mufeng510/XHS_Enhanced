'use strict';
// Picks the right browser-test runner for the platform: PowerShell on
// Windows, the bash runner elsewhere. Keeps `npm test` portable.
const { execFileSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/run-browser-tests.ps1'], { cwd: root, stdio: 'inherit' });
} else {
  execFileSync('bash', ['scripts/run-browser-tests.sh'], { cwd: root, stdio: 'inherit' });
}
