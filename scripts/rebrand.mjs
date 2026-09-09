// サイト名の一括差し替え（フォークした譲渡用サイトで使う）。
// usage: node scripts/rebrand.mjs "サボウカ" "https://sabouka.com/"
//   - 静的ページ・マニフェスト・config.js のサイト名を置き換える
//   - config.js の baseUrl を差し替える
//   - privacy.transfer.html があれば privacy.html に置き換える
// 実行後に `npm run build:guide` と `npm run stamp` を実行すること。
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
const [name, baseUrl] = process.argv.slice(2);
if (!name) { console.error('usage: node scripts/rebrand.mjs <サイト名> [baseUrl]'); process.exit(1); }
const OLD = '検定ノート';
const files = ['index.html', 'terms.html', 'privacy.html', 'tokushoho.html', 'about.html', '404.html', 'manifest.webmanifest', 'sw.js', 'app.js', 'tests/smoke.mjs', 'config.js', 'scripts/build-guide.mjs'];
if (existsSync('privacy.transfer.html')) { renameSync('privacy.transfer.html', 'privacy.html'); console.log('privacy.transfer.html -> privacy.html'); }
let total = 0;
for (const f of files) {
  if (!existsSync(f)) continue;
  let s = readFileSync(f, 'utf8'); const n = s.split(OLD).length - 1; if (!n && f !== 'config.js') continue;
  s = s.split(OLD).join(name);
  if (f === 'privacy.html') s = s.replace('<meta name="robots" content="noindex">\n', '').replace(/<!-- 譲渡用サイト.*?-->\n/s, '');
  if (f === 'config.js' && baseUrl) s = s.replace(/baseUrl:\s*'[^']*'/, `baseUrl: '${baseUrl}'`);
  writeFileSync(f, s); total += n; console.log(f, n);
}
const readme = readFileSync('README.md', 'utf8').replace(/^# .*$/m, `# ${name}`); writeFileSync('README.md', readme);
console.log('replaced', total, 'occurrences ->', name);
