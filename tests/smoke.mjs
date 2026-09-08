// 検定ノート smoke test (Playwright). 使い方: node tests/smoke.mjs [baseUrl]
// baseUrl 省略時はリポジトリ直下を簡易サーバーで配信して検証する。
import { readFileSync } from 'node:fs';
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
const CONFIG_GUEST = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/allowGuest:\s*false/, 'allowGuest: true');
const USER = { id: 'u-test', email: 'test@example.com', user_metadata: { full_name: 'テスト太郎' } };

let failures = 0;
function check(name, ok, extra = '') { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failures++; }

const base = process.argv[2];
const local = base ? null : await serve();
const origin = base || local.url;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, proxy: process.env.PW_PROXY ? { server: process.env.PW_PROXY } : undefined });

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', ignoreHTTPSErrors: !!process.env.PW_INSECURE });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  p.on('response', r => { try { if (r.url().startsWith(origin) && r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url().slice(origin.length)); } catch {} });
  await p.route(/supabase(\.min)?\.js/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE }));
  await p.route(/supabase\.co/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (opts.guest) await p.route(/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: CONFIG_GUEST }));
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
  // 解説からノートの見出しへ飛べる
  const ref = await p.$('#quiz .ref a[data-ch]'); check('note reference link shown in verdict', !!ref);
  if (ref) {
    await ref.click(); await p.waitForTimeout(400);
    const st = await p.evaluate(() => { const on = document.querySelector('.view.on')?.id; const a = document.querySelector('#chapnav a.on'); const d = a && document.getElementById(a.dataset.ch); return { on, open: !!(d && d.open) }; });
    check('reference opens the chapter in notes', st.on === 'v-notes' && st.open, JSON.stringify(st));
  }
  // ノート内検索
  await p.fill('#nsearch', '減価償却'); await p.waitForTimeout(500);
  const sr = await p.evaluate(() => ({ hits: document.querySelectorAll('#notes mark.hit').length, count: document.querySelector('#nsearch-count').textContent, openHit: !!document.querySelector('#notes mark.hit')?.closest('details.ch')?.open }));
  check('note search highlights matches and opens the chapter', sr.hits > 0 && /件/.test(sr.count) && sr.openHit, JSON.stringify(sr));
  await p.fill('#nsearch', ''); await p.waitForTimeout(400);
  check('note search clears', (await p.$$('#notes mark.hit')).length === 0);
  // 弱点カード（復習リストがあれば出る）とリマインド
  await p.click('#nav button[data-view="home"]'); await p.waitForTimeout(300);
  const wk = await p.evaluate(() => ({ n: window.KN.weak().wrongQ.length, hidden: document.querySelector('#weak-card').hidden, rows: document.querySelectorAll('#weak-card .weak li').length }));
  check('weak card matches review list', (wk.n === 0) === wk.hidden && (wk.n === 0 || wk.rows > 0), JSON.stringify(wk));
  const ics = await p.evaluate(() => window.KN.ics('21:00'));
  check('ics has exam day and daily reminder', /BEGIN:VCALENDAR/.test(ics) && /試験日/.test(ics) && /RRULE:FREQ=DAILY;UNTIL=\d{8}T145959Z/.test(ics) && /\r\n$/.test(ics), ics.slice(0, 80));
  await p.click('#nav button[data-view="sched"]'); await p.waitForTimeout(300);
  check('reminder section in schedule', !!(await p.$('#rem-ics')) && (await p.$$('#rem-details .rem li')).length >= 1);
  await p.click('#nav button[data-view="sched"]'); await p.waitForTimeout(300);
  check('schedule rendered', (await p.$$('#sched .day')).length >= 10);
  check('plan form present', !!(await p.$('#plan-round')) && !!(await p.$('#plan-apply')));
  // 完了チェックがホームと予定で同期する
  await p.click('#sched input[type=checkbox]'); await p.waitForTimeout(200);
  await p.click('#nav button[data-view="home"]'); await p.waitForTimeout(200);
  check('step done reflected on home', (await p.textContent('#prog-text')).includes('1 /'));
  // 完了にしたステップの次が今日の画面の先頭に出る（手動で戻った場合は維持、再読み込みで戻る）
  const shown1 = await p.textContent('#today-card .daynum');
  check('home shows next uncompleted step after completing today\'s', /STEP 02/.test(shown1) && /予定より先行/.test(shown1), shown1);
  await p.click('#day-prev'); await p.waitForTimeout(100);
  await p.click('#nav button[data-view="notes"]'); await p.waitForTimeout(100); await p.click('#nav button[data-view="home"]'); await p.waitForTimeout(150);
  check('manual step navigation is kept across tabs', /STEP 01/.test(await p.textContent('#today-card .daynum')));
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
  // 再読み込み後は、完了にしたステップの次が先頭に出る（上で STEP 1 を完了にしている）
  await p.goto(origin + '#/c/bk3/home', { waitUntil: 'load' }); await p.waitForTimeout(900);
  check('next uncompleted step shown after reload', /STEP 02/.test(await p.textContent('#today-card .daynum')), await p.textContent('#today-card .daynum'));
  check('no JS errors (course)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 3. 進捗の単体ロジック（マージ・移行・予定生成）
{
  const { p, ctx, errors } = await page({ loggedIn: true });
  await p.addInitScript(() => { try { localStorage.setItem('kn_bk3', JSON.stringify({ wrong: [0, 1, 999], sched: { 1: true }, best: { 1: { p: 60, c: 6, t: 10 } }, updatedAt: 5 })); } catch {} });
  await p.goto(origin + '#/c/bk3/quiz', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  const mig = await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('kn2_u-test_bk3') || '{}'); return { legacyGone: !localStorage.getItem('kn_bk3'), wrongIds: Object.keys(st.wrong || {}), sched: st.sched, best: st.best }; });
  check('legacy local progress migrated to user namespace', mig.legacyGone && mig.sched && !!mig.sched['1'] && mig.best && mig.best['1'] && mig.best['1'].p === 60, JSON.stringify(mig));
  check('legacy numeric wrong ids mapped to stable ids', mig.wrongIds.length === 2 && mig.wrongIds.every(id => /^bk3-[0-9a-f]{8}$/.test(id)), JSON.stringify(mig.wrongIds));
  check('review set shows migrated count', (await p.textContent('#quiz [data-pick="wrong"] .s')).includes('2問'));
  const unit = await p.evaluate(() => {
    const a = { v: 2, sched: { 1: 50 }, wrong: { 'bk3-aaaaaaaa': 10 }, cleared: {}, best: { 1: { p: 50, c: 5, t: 10 } }, applied: true, updatedAt: 100 };
    const b = { v: 2, sched: { 2: 60 }, wrong: {}, cleared: { 'bk3-aaaaaaaa': 20 }, best: { 1: { p: 80, c: 8, t: 10 }, 2: { p: 40, c: 4, t: 10 } }, applied: false, updatedAt: 90 };
    const m = KN.merge(a, b);
    // チェック解除（unsched）とリセット（resetAt）
    const u = KN.merge({ v: 2, sched: { 1: 50, 2: 55 }, unsched: { 1: 70 }, updatedAt: 200 }, { v: 2, sched: { 1: 50, 2: 55 }, updatedAt: 150 });
    const r = KN.merge({ v: 2, plan: { round: 39, start: '2026-09-01', at: 1 }, resetAt: 300, updatedAt: 300 }, { v: 2, sched: { 1: 50 }, wrong: { 'bk3-aaaaaaaa': 10 }, best: { 1: { p: 90, c: 9, t: 10 } }, updatedAt: 250 });
    const plan = KN.buildPlan({ id: 'bk3', steps: [ { n: 1, days: 4 }, { n: 2, days: 4 }, { n: 3, days: 2 } ] }, { round: 39, start: '2026-10-10' });
    const bad = KN.sanitize({ best: { 1: { p: '<img src=x onerror=alert(1)>' } }, wrong: 'abc', sched: { x: true } });
    return { m, u, r, plan: plan.steps.map(s => [s.s, s.e]), compressed: plan.compressed, bad };
  });
  check('merge keeps both sched keys', unit.m.sched['1'] === 50 && unit.m.sched['2'] === 60);
  check('merge: unchecking a step wins over an older check', !unit.u.sched['1'] && unit.u.sched['2'] === 55, JSON.stringify(unit.u.sched));
  check('merge: reset tombstone drops older records', Object.keys(unit.r.sched).length === 0 && Object.keys(unit.r.wrong).length === 0 && Object.keys(unit.r.best).length === 0 && unit.r.resetAt === 300 && unit.r.plan && unit.r.plan.round === 39, JSON.stringify(unit.r));
  check('merge: later correct answer removes wrong', !unit.m.wrong['bk3-aaaaaaaa'] && unit.m.cleared['bk3-aaaaaaaa'] === 20);
  check('merge: best takes max per set, applied follows the newer side', unit.m.best['1'].p === 80 && unit.m.best['2'].p === 40 && unit.m.applied === true);
  check('plan compressed to exam date', unit.compressed && unit.plan[unit.plan.length - 1][1] === '2026-10-18' && unit.plan[0][0] === '2026-10-10', JSON.stringify(unit.plan));
  check('sanitize drops invalid values', unit.bad.best['1'].p === 0 && Object.keys(unit.bad.wrong).length === 0 && Object.keys(unit.bad.sched).length === 0);
  check('no JS errors (unit)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 4. 2級コースも読める
{
  const { p, ctx, errors } = await page({ loggedIn: true });
  await p.goto(origin + '#/c/bk2/notes', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  check('bk2 notes rendered', (await p.$$('#v-notes details.ch')).length >= 12);
  check('no JS errors (bk2)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 5. 財務3級（五答択一・CBT 予定・科目別模試）
{
  const { p, ctx, errors } = await page({ loggedIn: true });
  await p.goto(origin + '#/c/zm3/notes', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  check('zm3 notes rendered', (await p.$$('#v-notes details.ch')).length >= 10);
  const zq = await p.evaluate(() => { const qs = window.COURSES?.zm3?.questions || []; return { n: qs.length, five: qs.every(q => q.c && q.c.length === 5), ds: qs.filter(q => q.ds).length }; });
  check('zm3 questions are five-choice with datasets', zq.n >= 150 && zq.five && zq.ds >= 20, JSON.stringify(zq));
  await p.click('#nav [data-view="quiz"]'); await p.waitForTimeout(300); await p.click('#quiz #start'); await p.waitForTimeout(300);
  check('zm3 question shows five choices', (await p.$$('#quiz .choice')).length === 5);
  await p.click('#nav [data-view="sched"]'); await p.waitForTimeout(300);
  check('zm3 plan form offers CBT with a date field', !!(await p.$('#plan-round option[value="cbt"]')) && !!(await p.$('#plan-cbt-date')));
  await p.evaluate(() => { document.querySelector('#plan-details').open = true; }); await p.selectOption('#plan-round', 'cbt'); await p.waitForTimeout(100);
  check('CBT date field appears when CBT is chosen', await p.evaluate(() => !document.querySelector('#plan-cbt-wrap').hidden));
  await p.click('#nav [data-view="quiz"]'); await p.waitForTimeout(300);
  await p.click('#quit'); await p.waitForTimeout(300);
  if (await p.$('#dlg-ok')) { const open = await p.evaluate(()=>document.querySelector('#dlg').open); if (open) { await p.click('#dlg-ok'); await p.waitForTimeout(200); } }
  check('zm3 mock card counts 50 questions', /50問/.test(await p.textContent('#quiz')));
  await p.click('#exam-start'); await p.waitForTimeout(500);
  check('zm3 mock starts in 財務諸表 section', /財務諸表/.test(await p.textContent('#quiz .qhead')) && (await p.$$('#quiz .choice')).length === 5);
  check('no JS errors (zm3)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// 6. ゲスト利用（allowGuest）→ ログインで引き継ぎ
{
  const { p, ctx, errors } = await page({ guest: true });
  await p.goto(origin, { waitUntil: 'load' }); await p.waitForTimeout(600);
  check('guest button shown on landing when allowGuest', await p.evaluate(() => { const b = document.querySelector('#gate-guest'); return !!b && !b.hidden && !document.querySelector('#gate').hidden; }));
  await p.click('#gate-guest'); await p.waitForTimeout(400);
  check('guest enters the app', await p.evaluate(() => document.querySelector('#gate').hidden && !document.querySelector('.app').hidden));
  await p.goto(origin + '#/c/bk3/sched', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  check('guest can open a course and sees a login button', await p.evaluate(() => document.querySelector('.view.on')?.id === 'v-sched' && !document.querySelector('#head-login').hidden && document.querySelector('#avatar').hidden));
  await p.click('#sched input[type=checkbox]'); await p.waitForTimeout(200);
  await p.click('#nav button[data-view="home"]'); await p.waitForTimeout(300);
  const g = await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('kn2_local_bk3') || '{}'); return { sched: st.sched, nudge: !!document.querySelector('#guest-login') }; });
  check('guest progress saved locally and sync nudge shown', !!(g.sched && g.sched['1']) && g.nudge, JSON.stringify(g));
  await p.click('#guest-later'); await p.waitForTimeout(100);
  check('nudge can be dismissed', !(await p.$('#guest-login')));
  await p.evaluate(u => { window.__session = { user: u }; window.__authCb && window.__authCb('SIGNED_IN', { user: u }); }, USER); await p.waitForTimeout(1200);
  const m = await p.evaluate(() => ({ local: localStorage.getItem('kn2_local_bk3'), user: (JSON.parse(localStorage.getItem('kn2_u-test_bk3') || '{}').sched || {}), guest: localStorage.getItem('kn_guest'), avatar: !document.querySelector('#avatar').hidden, head: document.querySelector('#head-login').hidden }));
  check('guest progress migrated to the account on login', !m.local && !!m.user['1'] && !m.guest && m.avatar && m.head, JSON.stringify(m));
  check('no JS errors (guest)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// 7. allowGuest が無効なら従来どおり（ゲストボタンなし）
{
  const { p, ctx, errors } = await page({});
  await p.goto(origin, { waitUntil: 'load' }); await p.waitForTimeout(500);
  check('guest button hidden by default', await p.evaluate(() => document.querySelector('#gate-guest').hidden));
  check('no JS errors (default gate)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close(); if (local) local.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
