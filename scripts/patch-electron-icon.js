#!/usr/bin/env node
// Patch the electron.exe PE resource with the app's custom icon.
// This makes the taskbar icon show the red MS-ALL icon in dev mode (npm start).
// Run this once after npm install, or add to the postinstall script.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const rceditPaths = [
  // electron-winstaller vendor copy
  path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
  // app-builder-lib / electron-builder copy
  path.join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'ia32', 'rcedit.exe'),
  path.join(ROOT, 'node_modules', 'app-builder-lib', 'vendor', 'rcedit.exe'),
];

const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const iconFile   = path.join(ROOT, 'assets', 'icon.ico');

if (!fs.existsSync(electronExe)) {
  console.error('electron.exe not found at', electronExe);
  process.exit(1);
}
if (!fs.existsSync(iconFile)) {
  console.error('icon.ico not found at', iconFile);
  process.exit(1);
}

let rcedit = null;
for (const p of rceditPaths) {
  if (fs.existsSync(p)) { rcedit = p; break; }
}

if (!rcedit) {
  console.error('rcedit.exe not found. Skipping icon patch.');
  process.exit(0);
}

console.log('Patching electron.exe icon...');
console.log('  rcedit  :', rcedit);
console.log('  target  :', electronExe);
console.log('  icon    :', iconFile);

try {
  execFileSync(rcedit, [electronExe, '--set-icon', iconFile], { stdio: 'inherit' });
  console.log('Done! electron.exe icon patched successfully.');
} catch (err) {
  console.error('Failed to patch icon:', err.message);
  process.exit(1);
}
