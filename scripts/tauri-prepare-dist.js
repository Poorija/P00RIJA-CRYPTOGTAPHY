const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'desktop-dist');

const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'vendor',
  'Fonts',
  'assets'
];

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const entry of INCLUDE) {
  copyRecursive(path.join(ROOT, entry), path.join(DIST, entry));
}

console.log(`Prepared desktop-dist at ${DIST}`);
