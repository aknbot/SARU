// 検定ノート smoke test (Playwright). 使い方: node tests/smoke.mjs [baseUrl]
// baseUrl 省略時はリポジトリ直下を簡易サーバーで配信して検証する。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function serve() {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    try { await stat(file); const body = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() };
}

const FAKE_SUPABASE = `window.supabase={createClient(){return{auth:{
  async getSession(){return{data:{session:window.__session||null}}},
  onAuthStateChange(cb){window.__authCb=cb;return{data:{subscription:{unsubscribe(){}}}}},
  async signOut(){window.__session=null;window.__authCb&&window.__authCb('SIGNED_OUT',null);return{}},
  async signInWithOAuth(){return{}},
  async refreshSession(){return{data:{session:window.__session||null},error:null}} },
  from(){const q={select(){return q},eq(){return q},async maybeSingle(){return{data:null,error:null}},async upsert(){return{error:null}},async delete(){return q}};return q},
  async rpc(){return{error:null}} }}};`;
const USER = { id: 'u-test', email: 'test@example.com', user_metadata: { full_name: 'テスト太郎' } };

let failures = 0;
function check(name, ok, extra = '') { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failures++; }

const base = process.argv[2];
const local = base ? null : await serve();
const origin = base || local.url;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route(/supabase(\.min)?\.js/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE }));
  await p.route(/supabase\.co/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (opts.loggedIn) await p.addInitScript(u => { window.__session = { user: u }; }, USER);
  return { p, ctx, errors };
}

// 1. 未ログイン → ゲート表示、コース未読込
{
  const { p, ctx, errors } = await page();
  await p.goto(origin + '#/c/bk3', { waitUntil: 'load' }); await p.waitForTimeout(600);
  check('gate shown when logged out', await p.evaluate(() => !document.querySelector('#gate').hidden && document.querySelector('.app').hidden));
  check('course not loaded behind gate', await p.evaluate(() => !(window.COURSES && window.COURSES.bk3 && window.COURSES.bk3.questions)));
  check('no JS errors (gate)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 2. ログイン済み → コース一覧 → コース → 各ビュー
{
  const { p, ctx, errors } = await page({ loggedIn: true });
  await p.goto(origin, { waitUntil: 'load' }); await p.waitForTimeout(600);
  check('index shows courses', (await p.$$('#course-list .course')).length >= 2);
  await p.click('#avatar'); await p.waitForTimeout(150);
  check('account menu shows name', !(await p.evaluate(()=>document.querySelector('#menu').hidden)) && (await p.textContent('#menu-name')).includes('テスト太郎'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  check('menu closes on Escape', await p.evaluate(()=>document.querySelector('#menu').hidden));
  await p.click('#course-list .course'); await p.waitForTimeout(1200);
  const info = await p.evaluate(() => ({ view: document.querySelector('.view.on')?.id, q: window.COURSES?.bk3?.questions?.length || 0, nav: !document.querySelector('#nav').hidden }));
  check('course home opens', info.view === 'v-home' && info.nav, JSON.stringify(info));
  check('questions loaded', info.q > 100, 'q=' + info.q);
  await p.click('#nav button[data-view="notes"]'); await p.waitForTimeout(300);
  check('notes chapters rendered', (await p.$$('#v-notes details.ch')).length >= 5);
  await p.click('#nav button[data-view="quiz"]'); await p.waitForTimeout(300);
  check('set picker rendered', !!(await p.$('#quiz #start')));
  await p.click('#quiz #start'); await p.waitForTimeout(300);
  check('question rendered', (await p.$$('#quiz .choice')).length === 4);
  await p.click('#quiz .choice'); await p.waitForTimeout(200);
  check('verdict shown', !!(await p.$('#quiz .verdict')));
  const nextVisible = await p.evaluate(() => getComputedStyle(document.querySelector('#next')).display !== 'none');
  check('next button visible after answer', nextVisible);
  await p.click('#nav button[data-view="sched"]'); await p.waitForTimeout(300);
  check('schedule rendered', (await p.$$('#sched .day')).length >= 10);
  check('plan form present', !!(await p.$('#plan-round')) && !!(await p.$('#plan-apply')));
  // 完了チェックがホームと予定で同期する
  await p.click('#sched input[type=checkbox]'); await p.waitForTimeout(200);
  await p.click('#nav button[data-view="home"]'); await p.waitForTimeout(200);
  check('step done reflected on home', (await p.textContent('#prog-text')).includes('1 /'));
  // 模試
  await p.click('#nav button[data-view="quiz"]'); await p.waitForTimeout(300);
  check('quiz in progress is kept across tabs', !!(await p.$('#quit')));
  await p.click('#quit'); await p.waitForTimeout(300);
  if (await p.$('#dlg-ok')) { const open = await p.evaluate(()=>document.querySelector('#dlg').open); if (open) { await p.click('#dlg-ok'); await p.waitForTimeout(200); } }
  const ex = await p.$('#exam-start'); check('mock exam button', !!ex);
  if (ex) {
    await ex.click(); await p.waitForTimeout(300);
    check('exam question rendered', (await p.$$('#quiz .choice')).length === 4 && !!(await p.$('#exam-timer')));
    await p.click('#quiz .choice'); await p.waitForTimeout(400);
    // 中断 → 再開
    await p.click('#ex-quit'); await p.waitForTimeout(200); await p.click('#dlg-ok'); await p.waitForTimeout(300);
    check('exam resume card shown', !!(await p.$('#exam-resume')));
    await p.click('#exam-resume'); await p.waitForTimeout(300);
    check('exam resumed with answer kept', (await p.$$('#quiz .choice.sel, #ex-grid button.done')).length >= 1);
    await p.click('#ex-quit'); await p.waitForTimeout(200); await p.click('#dlg-ok'); await p.waitForTimeout(200);
  }
  // 設定画面
  await p.goto(origin + '#/settings', { waitUntil: 'load' }); await p.waitForTimeout(500);
  check('settings view', await p.evaluate(()=>document.querySelector('.view.on')?.id==='v-settings') && !!(await p.$('#delete-account')));
  await p.click('#bk-export'); await p.waitForTimeout(200);
  check('backup code produced', (await p.inputValue('#bk-code')).startsWith('KN-'));
  check('no JS errors (course)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 3. 2級コースも読める
{
  const { p, ctx, errors } = await page({ loggedIn: true });
  await p.goto(origin + '#/c/bk2/notes', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  check('bk2 notes rendered', (await p.$$('#v-notes details.ch')).length >= 12);
  check('no JS errors (bk2)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close(); if (local) local.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
