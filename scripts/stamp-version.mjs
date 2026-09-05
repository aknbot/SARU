// config.js の version を index.html（?v=）と sw.js（VERSION）に反映する。 usage: node scripts/stamp-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const cfg = readFileSync('config.js', 'utf8');
const m = cfg.match(/version:\s*'([^']+)'/);
if (!m) { console.error('config.js に version がありません'); process.exit(1); }
const v = m[1];
let html = readFileSync('index.html', 'utf8');
html = html.replace(/\?v=[A-Za-z0-9._-]+/g, '?v=' + v);
writeFileSync('index.html', html);
let sw = readFileSync('sw.js', 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'kn-${v}';`);
writeFileSync('sw.js', sw);
console.log('stamped version', v);
