/* 検定ノート — 学習サイトのエンジン（コース共通）
   ・コースの中身は courses/<id>/ に置く（course.js / questions.js / datasets.js / notes.html / legacy.js）
   ・進捗はユーザーごとに localStorage に保存し、Supabase の progress テーブルとキー単位でマージ同期する
   ・試験回のマスタは exams.js。学習予定は「受験する回」と「開始日」からその場で組み立てる */
(function(){
  'use strict';
  const APP_VERSION = (window.SITE && window.SITE.version) || '2.0.0';
  const $ = (s, r) => (r||document).querySelector(s);
  const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v, d=0) => { const n=Number(v); return Number.isFinite(n)?n:d; };
  const SITE = window.SITE || {};
  const LIST = window.COURSE_LIST || [];
  const EXAMS = (window.EXAMS || []).slice().sort((a,b)=>a.date<b.date?-1:1);
  const LEVELS = window.LEVELS || {};
  const PASS = window.PASS_RATES || {};
  const SITE_NAME = SITE.name || '検定ノート';
  const VIEWS = ['home','notes','quiz','sched'];

  /* ---------- 小物 ---------- */
  let toastT;
  function toast(msg, ms){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'), ms||2200); }
  function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseISO(iso){ const [y,m,d]=String(iso).split('-').map(Number); return new Date(y, m-1, d); }
  function toISO(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function addDays(iso, n){ const d=parseISO(iso); d.setDate(d.getDate()+n); return toISO(d); }
  function daysBetween(a, b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
  function daysUntil(iso){ return daysBetween(todayStr(), iso); }
  function md(iso){ return Number(iso.slice(5,7))+'/'+Number(iso.slice(8)); }
  function jpDate(iso){ const d=parseISO(iso); const w='日月火水木金土'[d.getDay()]; return (d.getMonth()+1)+'月'+d.getDate()+'日（'+w+'）'; }
  function jpDateY(iso){ const d=parseISO(iso); const w='日月火水木金土'[d.getDay()]; return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日（'+w+'）'; }
  function fnv(s){ let h=0x811c9dc5; s=String(s); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h.toString(16).padStart(8,'0'); }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  const LETTERS='ABCDEFGH';

  /* ---------- ダイアログ ---------- */
  const dlg=$('#dlg');
  let dlgResolve=null;
  function ask(o){
    return new Promise(res=>{
      dlgResolve=res;
      $('#dlg-title').textContent=o.title||'';
      $('#dlg-body').innerHTML=o.body||''; $('#dlg-body').hidden=!o.body;
      $('#dlg-slot').innerHTML=o.slot||'';
      const ok=$('#dlg-ok'); ok.textContent=o.ok||'OK'; ok.className='btn '+(o.danger?'danger':'primary'); ok.disabled=!!o.okDisabled;
      const cancel=$('#dlg-cancel'); cancel.textContent=o.cancel||'キャンセル'; cancel.hidden=o.cancel===false;
      if(o.onOpen) o.onOpen();
      if(typeof dlg.showModal==='function') dlg.showModal(); else { dlg.setAttribute('open',''); }
    });
  }
  function closeDlg(v){ try{ dlg.close(); }catch(e){ dlg.removeAttribute('open'); } if(dlgResolve){ const r=dlgResolve; dlgResolve=null; r(v); } }
  $('#dlg-ok').addEventListener('click', ()=>closeDlg(true));
  $('#dlg-cancel').addEventListener('click', ()=>closeDlg(false));
  dlg.addEventListener('cancel', e=>{ e.preventDefault(); closeDlg(false); });
  dlg.addEventListener('click', e=>{ if(e.target===dlg) closeDlg(false); });

  /* =================== 認証（Supabase / Google） =================== */
  let sb=null, user=null;
  const REQUIRE_LOGIN = SITE.requireLogin !== false;
  const configured = !!(SITE.supabaseUrl && SITE.supabaseAnonKey && !/YOUR-/.test(SITE.supabaseUrl+SITE.supabaseAnonKey));
  try{ if(configured && window.supabase) sb = window.supabase.createClient(SITE.supabaseUrl, SITE.supabaseAnonKey, { auth:{ flowType:'pkce', detectSessionInUrl:true, persistSession:true, autoRefreshToken:true } }); }catch(e){ sb=null; }
  const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches:false };
  function gated(){ return REQUIRE_LOGIN && !user; }
  function uid(){ return user ? user.id : 'local'; }
  function setSync(cls, txt){ const el=$('#sync'); el.className='sync '+cls; el.textContent=txt; el.hidden=false; }
  function syncLabel(){
    if(!navigator.onLine) return ['offline','オフライン · 端末に保存中'];
    if(sb&&user) return ['ok','同期済み'];
    return ['off', sb?'端末に保存（ログインで同期）':'端末に保存'];
  }

  /* ---- ゲート（ログイン前ランディング） ---- */
  const gate=$('#gate'), app=$('#app');
  function gateStatus(msg, isError){ const s=$('#gate-status'); s.textContent=msg||''; s.hidden=!msg; const n=$('#gate-note'); if(isError){ n.textContent=msg; n.hidden=false; s.hidden=true; } else { n.hidden=true; } }
  function gateReady(){ $$('[data-login]').forEach(b=>b.disabled=false); gateStatus(''); }
  $('#gate-brand').textContent=SITE_NAME; $('#brand-link').textContent=SITE_NAME;
  if(SITE.contactEmail){ ['#gate-contact','#settings-contact'].forEach(s=>{ const a=$(s); a.href='mailto:'+SITE.contactEmail; a.hidden=false; }); }
  $$('[data-login]').forEach(b=>b.addEventListener('click', login));
  let started=false;
  function updateGate(){
    if(gated()){ gate.hidden=false; app.hidden=true; $('#nav').hidden=true; }
    else { gate.hidden=true; app.hidden=false; if(!started){ started=true; route(); } }
  }
  function renderGateCourses(){
    const el=$('#gate-course-list'); if(!el) return;
    el.innerHTML=LIST.map(c=>{ const ex=nextExamFor(c.id); return '<div class="course" style="cursor:default"><div class="em" aria-hidden="true">'+esc(c.emoji||'')+'</div><div><p class="t">'+esc(c.title)+'</p><p class="s">'+esc(c.sub)+'</p></div><div class="d">'+(ex?'第'+ex.round+'回<b>'+md(ex.date)+'</b>':'')+'</div></div>'; }).join('');
    const total=LIST.reduce((n,c)=>n+num(c.questions),0); if(total) $('#gate-qcount').textContent=String(total);
  }
  renderGateCourses();

  async function initAuth(){
    if(!REQUIRE_LOGIN && !sb){ updateGate(); return; }
    if(!sb){
      gateStatus(configured?'ログイン機能を読み込めませんでした。通信環境をご確認のうえ、ページを再読み込みしてください。':'ログイン機能が設定されていません（config.js）。', true);
      $$('[data-login]').forEach(b=>b.disabled=true);
      gate.hidden=false; app.hidden=true; return;
    }
    /* OAuth から ?error= / #error= で戻ってきた場合 */
    try{ const p=new URLSearchParams(location.search.slice(1) || (location.hash.indexOf('error')>=0 ? location.hash.slice(1) : '')); if(p.get('error')){ gateStatus('ログインできませんでした: '+(p.get('error_description')||p.get('error')), true); history.replaceState(null,'',location.pathname); } }catch(e){}
    try{
      const { data, error } = await sb.auth.getSession();
      user = data && data.session ? data.session.user : null;
      if(user) cacheUser(user);
      if(!user && error && (!navigator.onLine || error.name==='AuthRetryableFetchError')){ const cached=readCachedUser(); if(cached){ user=cached; offlineSession=true; } }
      sb.auth.onAuthStateChange((ev, session)=>{
        if(session && session.user){ cacheUser(session.user); offlineSession=false; }
        const was = user && user.id; user = session ? session.user : null;
        if(!user && was && ev==='SIGNED_OUT' && !manualLogout){ gateStatus('セッションの有効期限が切れました。もう一度ログインしてください。', true); }
        if(user && user.id!==was){ onUserChanged(); }
        if(!user && was){ resetCourseState(); started=false; }
        renderAccount(); updateGate();
      });
    }catch(e){ gateStatus('ログイン状態を確認できませんでした。ページを再読み込みしてください。', true); }
    gateReady();
    if(user) await onUserChanged();
    renderAccount(); updateGate();
    /* ログインから戻ってきたら元の場所へ */
    try{ const back=sessionStorage.getItem('kn_return'); if(back){ sessionStorage.removeItem('kn_return'); if(location.search){ history.replaceState(null,'',location.pathname+back); } location.hash=back; route(); } }catch(e){}
  }
  let manualLogout=false, offlineSession=false;
  function cacheUser(u){ try{ localStorage.setItem('kn_user', JSON.stringify({ id:u.id, email:u.email, user_metadata:u.user_metadata||{} })); }catch(e){} }
  function readCachedUser(){ try{ return JSON.parse(localStorage.getItem('kn_user')||'null'); }catch(e){ return null; } }
  window.addEventListener('online', async()=>{ if(offlineSession && sb){ try{ const { data } = await sb.auth.getSession(); if(data && data.session){ offlineSession=false; user=data.session.user; cacheUser(user); if(course) pullProgress(); } }catch(e){} } });
  async function login(){
    if(!sb){ toast('ログイン機能が利用できません。'); return; }
    const btns=$$('[data-login]'); btns.forEach(b=>b.disabled=true); const lab=$('#gate-login-label'); const old=lab.textContent; lab.textContent='Google へ移動しています…';
    try{ sessionStorage.setItem('kn_return', /^#\/[a-z0-9_\/-]*$/.test(location.hash) ? location.hash : '#/'); }catch(e){}
    const redirectTo = location.origin + location.pathname.replace(/index\.html$/, '');
    const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo, queryParams:{ prompt:'select_account' } } });
    if(error){ gateStatus('ログインに失敗しました: '+error.message, true); btns.forEach(b=>b.disabled=false); lab.textContent=old; }
  }
  async function logout(){
    if(!sb) return;
    manualLogout=true;
    clearTimeout(saveT); await pushNow();
    await sb.auth.signOut({ scope:'local' });
    manualLogout=false;
    try{ localStorage.removeItem('kn_user'); }catch(e){}
    user=null; resetCourseState(); started=false; renderAccount(); updateGate(); gateStatus('ログアウトしました。');
    location.hash='#/';
  }
  function resetCourseState(){ abortExam(); course=null; lastCourseId=null; mem={}; quiz.active=false; pick.key=null; closeMenu(); }
  async function onUserChanged(){
    resetCourseState();
    migrateLegacyLocal();
    await pullAll();
  }

  /* ---- アカウント表示（ヘッダー・設定） ---- */
  function displayName(){ const m=(user&&user.user_metadata)||{}; return m.full_name||m.name||(user&&user.email)||'ユーザー'; }
  function avatarUrl(){ const m=(user&&user.user_metadata)||{}; return m.avatar_url||m.picture||''; }
  function renderAccount(){
    const av=$('#avatar');
    if(user){ const pic=avatarUrl(); av.innerHTML = pic ? '<img src="'+esc(pic)+'" alt="" referrerpolicy="no-referrer">' : esc(displayName().slice(0,1)); av.hidden=false; }
    else { av.hidden=true; }
    $('#menu-name').textContent=user?displayName():''; $('#menu-email').textContent=user?(user.email||''):'';
    renderIndex();
  }
  const menu=$('#menu'), backdrop=$('#menu-backdrop');
  function openMenu(){ menu.hidden=false; backdrop.hidden=false; $('#avatar').setAttribute('aria-expanded','true'); }
  function closeMenu(){ menu.hidden=true; backdrop.hidden=true; $('#avatar').setAttribute('aria-expanded','false'); }
  $('#avatar').addEventListener('click', ()=>{ menu.hidden?openMenu():closeMenu(); });
  backdrop.addEventListener('click', closeMenu);
  menu.addEventListener('click', e=>{ if(e.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !menu.hidden) closeMenu(); });
  $('#menu-logout').addEventListener('click', async()=>{ closeMenu(); if(await ask({title:'ログアウトしますか？', body:'進捗はアカウントに保存済みです。次回ログインすると続きから再開できます。', ok:'ログアウト'})) logout(); });

  /* =================== 進捗ストア（ユーザー × コース） =================== */
  const KEYS=['applied','sheet','sched','wrong','cleared','best','plan'];
  let course=null, mem={}, saveT=null;
  function lsKey(cid){ return 'kn2_'+uid()+'_'+(cid||course.id); }
  function sanitize(o){
    const s={ v:2 };
    if(!o||typeof o!=='object') return s;
    s.applied=!!o.applied; s.sheet=!!o.sheet;
    s.sched={}; if(o.sched&&typeof o.sched==='object') Object.keys(o.sched).forEach(k=>{ if(/^\d+$/.test(k) && o.sched[k]) s.sched[k]=true; });
    s.wrong={}; s.cleared={};
    const idOk = id => typeof id==='string' && /^[a-z0-9_-]+-[0-9a-f]{8}$/.test(id);
    if(Array.isArray(o.wrong)){ /* v1: 数値index配列 → 後で移行 */ s._legacyWrong=o.wrong.filter(x=>Number.isInteger(x)&&x>=0); }
    else if(o.wrong&&typeof o.wrong==='object') Object.keys(o.wrong).forEach(id=>{ if(idOk(id)) s.wrong[id]=num(o.wrong[id],1); });
    if(o.cleared&&typeof o.cleared==='object') Object.keys(o.cleared).forEach(id=>{ if(idOk(id)) s.cleared[id]=num(o.cleared[id],1); });
    s.best={}; if(o.best&&typeof o.best==='object') Object.keys(o.best).forEach(k=>{ const b=o.best[k]; if(!b||typeof b!=='object') return; if(!/^(\d+|exam)$/.test(k)) return; const p=Math.max(0,Math.min(100,Math.round(num(b.p)))); const c=Math.max(0,Math.round(num(b.c))), t=Math.max(0,Math.round(num(b.t))); const e={p,c,t}; if(typeof b.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.date)) e.date=b.date; s.best[k]=e; });
    if(o.plan&&typeof o.plan==='object'){ const r=num(o.plan.round), st=String(o.plan.start||''); if(r&&/^\d{4}-\d{2}-\d{2}$/.test(st)) s.plan={round:r,start:st,at:num(o.plan.at)}; }
    s.done=num(o.done); s.total=num(o.total);
    s.updatedAt=num(o.updatedAt);
    return s;
  }
  function readLocal(cid){ try{ const v=localStorage.getItem(lsKey(cid)); return sanitize(v?JSON.parse(v):{}); }catch(e){ return sanitize({}); } }
  function writeLocal(cid, state){ try{ localStorage.setItem(lsKey(cid), JSON.stringify(state||mem)); }catch(e){} }
  /* 旧キー kn_<course>（ユーザー別になる前）を、この端末で最初にログインしたユーザーに引き継ぐ */
  function migrateLegacyLocal(){
    if(!user) return;
    LIST.forEach(c=>{
      try{
        const old=localStorage.getItem('kn_'+c.id); if(!old) return;
        if(!localStorage.getItem(lsKey(c.id))) localStorage.setItem(lsKey(c.id), old);
        localStorage.removeItem('kn_'+c.id);
      }catch(e){}
    });
  }
  /* キー単位マージ：両方の変更を残す */
  function merge(a, b){
    a=sanitize(a); b=sanitize(b);
    const newer = (a.updatedAt||0)>=(b.updatedAt||0) ? a : b;
    const m={ v:2, applied:a.applied||b.applied, sheet:newer.sheet, sched:Object.assign({},a.sched,b.sched), wrong:{}, cleared:{}, best:{}, plan:null };
    const ids=new Set([...Object.keys(a.wrong),...Object.keys(b.wrong),...Object.keys(a.cleared),...Object.keys(b.cleared)]);
    ids.forEach(id=>{ const w=Math.max(a.wrong[id]||0,b.wrong[id]||0), c=Math.max(a.cleared[id]||0,b.cleared[id]||0); if(w>c) m.wrong[id]=w; if(c) m.cleared[id]=c; });
    new Set([...Object.keys(a.best),...Object.keys(b.best)]).forEach(k=>{ const x=a.best[k], y=b.best[k]; m.best[k] = (!y||(x&&x.p>=y.p)) ? x : y; });
    const pa=a.plan, pb=b.plan; m.plan = (pa&&pb) ? ((pa.at||0)>=(pb.at||0)?pa:pb) : (pa||pb||null);
    if(a._legacyWrong) m._legacyWrong=a._legacyWrong; if(b._legacyWrong) m._legacyWrong=(m._legacyWrong||[]).concat(b._legacyWrong);
    m.done=Math.max(a.done,b.done); m.total=Math.max(a.total,b.total);
    m.updatedAt=Math.max(a.updatedAt||0,b.updatedAt||0);
    return m;
  }
  const store = {
    get(k, d){ return (mem[k]!==undefined && mem[k]!==null) ? mem[k] : d; },
    set(k, v){ mem[k]=v; mem.updatedAt=Date.now(); writeLocal(); schedulePush(); }
  };
  function touch(){ mem.updatedAt=Date.now(); writeLocal(); schedulePush(); }
  function schedulePush(){
    if(!sb||!user){ const [c,t]=syncLabel(); setSync(c,t); return; }
    if(!navigator.onLine){ setSync('offline','オフライン · 端末に保存中'); pendingPush=true; return; }
    setSync('pend','保存中…'); clearTimeout(saveT); saveT=setTimeout(pushNow, 800);
  }
  let pendingPush=false, pushing=false, failN=0;
  const isAuthErr = e => e && (e.status===401 || e.code==='PGRST301' || /JWT/i.test(e.message||''));
  $('#sync').addEventListener('click', ()=>{ if(!sb||!user||!course) return; failN=0; if(pendingPush||saveT) pushNow(); else pullProgress(); });
  function rowOf(cid, state){ const s=Object.assign({},state); delete s._legacyWrong; return { user_id:user.id, course_id:cid, state:s, updated_at:new Date().toISOString() }; }
  async function pushNow(cid, state){
    if(!sb||!user) return;
    cid=cid||(course&&course.id); state=state||mem; if(!cid) return;
    clearTimeout(saveT); saveT=null;
    if(!navigator.onLine){ pendingPush=true; if(course&&cid===course.id) setSync('offline','オフライン · 端末に保存中'); return; }
    try{
      pushing=true;
      const { error } = await sb.from('progress').upsert(rowOf(cid,state), { onConflict:'user_id,course_id' });
      if(error) throw error;
      pendingPush=false; failN=0;
      if(course&&cid===course.id) setSync('ok','同期済み');
    }catch(e){
      pendingPush=true; failN++;
      if(isAuthErr(e) && failN===1){ try{ const r=await sb.auth.refreshSession(); if(!r.error){ pushing=false; return pushNow(cid, state); } }catch(_){} }
      if(course&&cid===course.id) setSync('err', failN>=5 ? '保存できません · タップで再試行' : '再保存待ち…');
      if(failN>=5){ toast('進捗を保存できませんでした。通信環境をご確認ください。'); }
      else { clearTimeout(saveT); saveT=setTimeout(()=>pushNow(cid, state), Math.min(60000, 4000*Math.pow(2, failN))); }
    }
    finally{ pushing=false; }
  }
  /* ログイン直後：全コースの進捗を取得して端末とマージ（コース一覧の進捗表示のため） */
  async function pullAll(){
    if(!sb||!user) return;
    try{
      const { data, error } = await sb.from('progress').select('course_id,state').eq('user_id', user.id);
      if(error) throw error;
      (data||[]).forEach(r=>{ if(!LIST.some(c=>c.id===r.course_id)) return; const merged=merge(readLocal(r.course_id), r.state); writeLocal(r.course_id, merged); });
      renderIndex();
    }catch(e){ /* 表示は端末の値で続行 */ }
  }
  async function pullProgress(){
    if(!sb||!user||!course) return;
    setSync('pend','同期中…');
    try{
      const { data, error } = await sb.from('progress').select('state,updated_at').eq('user_id', user.id).eq('course_id', course.id).maybeSingle();
      if(error) throw error;
      const remote = data && data.state ? sanitize(data.state) : null;
      const before=JSON.stringify(mem);
      if(remote){ mem=merge(mem, remote); migrateLegacyIds(); }
      writeLocal();
      const changed = before!==JSON.stringify(mem);
      if(changed) rerenderAll();
      if(!remote || JSON.stringify(remote)!==JSON.stringify(mem)) await pushNow(); else setSync('ok','同期済み');
    }catch(e){ setSync('err','同期エラー'); }
  }
  /* 旧バージョン（問題IDが配列インデックス）の復習リストを安定IDに移行 */
  function migrateLegacyIds(){
    if(!course||!mem._legacyWrong) return;
    const map=(window.__LEGACY||{})[course.id]||[];
    mem._legacyWrong.forEach(i=>{ const id=map[i]; if(id && course.questions.some(q=>q.id===id) && !mem.wrong[id]) mem.wrong[id]=mem.updatedAt||Date.now(); });
    delete mem._legacyWrong;
  }
  /* 離脱時の確実な送信 */
  function flushBeacon(){
    if(!sb||!user||!course) return;
    if(!saveT && !pendingPush) return;
    clearTimeout(saveT); saveT=null;
    try{
      const tokenP = sb.auth.getSession();
      tokenP.then(({data})=>{
        const tok=data&&data.session&&data.session.access_token; if(!tok) return;
        fetch(SITE.supabaseUrl+'/rest/v1/progress?on_conflict=user_id,course_id', { method:'POST', keepalive:true, headers:{ apikey:SITE.supabaseAnonKey, Authorization:'Bearer '+tok, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' }, body:JSON.stringify(rowOf(course.id, mem)) }).catch(()=>{});
      });
    }catch(e){}
  }
  window.addEventListener('pagehide', flushBeacon);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushBeacon(); else { checkDayRollover(); if(course && sb && user && navigator.onLine) pullProgress(); } });
  window.addEventListener('online', ()=>{ if(course){ schedulePush(); } else { const [c,t]=syncLabel(); if(course) setSync(c,t); } });
  window.addEventListener('offline', ()=>{ if(course) setSync('offline','オフライン · 端末に保存中'); });

  /* =================== 試験回・学習予定 =================== */
  function examsFor(cid){ return EXAMS.filter(e=>!e.levels || e.levels[cid]); }
  function nextExamFor(cid){ const t=todayStr(); return examsFor(cid).find(e=>e.date>=t) || examsFor(cid).slice(-1)[0] || null; }
  function examByRound(cid, round){ return examsFor(cid).find(e=>e.round===round) || null; }
  function ensurePlan(){
    if(!course) return;
    let p=mem.plan;
    if(!p || !examByRound(course.id, p.round)){ const ex=nextExamFor(course.id); p={ round: ex?ex.round:0, start: todayStr(), at: Date.now() }; mem.plan=p; writeLocal(); }
    course.plan=buildPlan(course, p);
  }
  function templateSteps(c){ return (c.steps||[]).map(s=>({ n:s.n, days: s.days || (s.s&&s.e ? daysBetween(s.s,s.e)+1 : 3), title:s.title, read:s.read||[], set:s.set, desc:s.desc, exam:!!s.exam, first:!!s.first })); }
  /* 受験する回と開始日から、各ステップの日付を割り当てる */
  function buildPlan(c, p){
    const ex=examByRound(c.id, p.round);
    const examDate = ex ? ex.date : addDays(p.start, 45);
    const tpl=templateSteps(c);
    const W=tpl.reduce((n,s)=>n+s.days,0);
    let start=p.start;
    let total=daysBetween(start, examDate)+1;
    let preStart=null;
    if(total > W*2){ preStart=start; start=addDays(examDate, -(W*2)+1); total=W*2; }
    const scale = total>0 ? total/W : 1;
    let durs=tpl.map(s=>Math.max(1, Math.round(s.days*scale)));
    let diff=durs.reduce((a,b)=>a+b,0)-Math.max(total, tpl.length);
    /* 合計を total に合わせる（大きいステップから調整） */
    const order=tpl.map((s,i)=>i).sort((i,j)=>tpl[j].days-tpl[i].days);
    let guard=0;
    while(diff!==0 && guard++<500){ for(const i of order){ if(diff===0) break; if(diff>0 && durs[i]>1){ durs[i]--; diff--; } else if(diff<0){ durs[i]++; diff++; } } }
    const steps=[]; let cur=start;
    tpl.forEach((s,i)=>{ const e=addDays(cur, durs[i]-1); steps.push(Object.assign({}, s, { s:cur, e })); cur=addDays(e,1); });
    if(steps.length){ steps[steps.length-1].e=examDate; }
    const compressed = total < W;
    return { round:p.round, exam:ex, examDate, start, preStart, steps, compressed, templateDays:W };
  }
  function STEPS(){ return course.plan.steps; }
  function todayIndex(){
    const S=STEPS(), t=todayStr();
    if(!S.length) return 0;
    if(t < S[0].s) return 0;
    for(let i=0;i<S.length;i++){ if(t>=S[i].s && t<=S[i].e) return i; }
    return S.length-1;
  }
  function examPassed(){ return course && course.plan.examDate < todayStr(); }

  /* =================== ルーティング =================== */
  function route(){
    if(gated()) return;
    closeMenu();
    const h=location.hash||'#/';
    if(h==='#/settings' || h.startsWith('#/settings')){ showSettings(); return; }
    const m=h.match(/^#\/c\/([a-z0-9_-]+)(?:\/([a-z]+))?/);
    if(m){ const v=VIEWS.includes(m[2])?m[2]:'home'; if(m[2]&&!VIEWS.includes(m[2])) history.replaceState(null,'',location.pathname+'#/c/'+m[1]+'/home'); openCourse(m[1], v); }
    else showIndex();
  }
  window.addEventListener('hashchange', route);
  const VIEW_TITLES={index:'コース一覧', loading:'読み込み中', error:'エラー', home:'今日の学習', notes:'要点ノート', quiz:'問題演習', sched:'合格までの予定', settings:'設定・アカウント'};
  function showView(view){
    $$('.view').forEach(v=>v.classList.toggle('on', v.id==='v-'+view));
    $$('#nav button').forEach(b=>{ const on=b.dataset.view===view; b.classList.toggle('on', on); if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
    document.title=(VIEW_TITLES[view]||'')+(course?' · '+(course.short||course.title):'')+' · '+SITE_NAME;
    window.scrollTo({top:0});
    const h=$('#v-'+view+' h2'); if(h && view!=='loading'){ h.setAttribute('tabindex','-1'); try{ h.focus({preventScroll:true}); }catch(e){} }
    setTop();
  }
  function leaveCourseUI(){ $('#nav').hidden=true; $('#countdown').textContent=''; $('#sync').hidden=true; $('#brand-badge').textContent=''; applyTheme(null); document.title=SITE_NAME; }
  async function showIndex(){
    if(exam.active){ if(!(await ask({title:'模試を中断しますか？', body:'中断した模試は、あとで「問題」タブから再開できます。', ok:'中断する'}))){ location.hash='#/c/'+course.id+'/quiz'; return; } saveExam(); abortExam(); }
    course=null; lastCourseId=null; leaveCourseUI();
    showView('index'); renderIndex();
  }
  $$('#nav button').forEach(b=>b.addEventListener('click', ()=>{ if(!course) return; location.hash='#/c/'+course.id+'/'+b.dataset.view; }));
  function courseStateSummary(cid){
    const st=readLocal(cid); const done=num(st.done), total=num(st.total);
    const ex=nextExamFor(cid); const d=ex?daysUntil(ex.date):null;
    const wrongN=Object.keys(st.wrong||{}).length;
    let text = total ? 'STEP '+done+'/'+total+' 完了' : '未開始 · まず STEP 1 から';
    if(st.best&&st.best.exam) text+=' · 模試ベスト '+st.best.exam.p+'点';
    if(wrongN) text+=' · 復習 '+wrongN+'問';
    return { st, done, total, pct: total?Math.round(done/total*100):0, ex, d, text };
  }
  function renderIndex(){
    const el=$('#course-list'); if(!el) return;
    el.innerHTML=LIST.map(c=>{
      const s=courseStateSummary(c.id);
      return '<a class="course" href="#/c/'+c.id+'"><div class="em" aria-hidden="true">'+esc(c.emoji||'')+'</div><div><p class="t">'+esc(c.title)+'</p><p class="s">'+esc(c.sub)+'</p><div class="pb"><i style="width:'+s.pct+'%"></i></div><p class="st">'+esc(s.text)+'</p></div><div class="d">'+(s.ex?(s.d>0?'あと<b>'+s.d+'</b>日':s.d===0?'<b>今日</b>':'終了'):'')+'</div></a>';
    }).join('');
    /* 続きから */
    const rc=$('#resume-card'); let last=null; try{ last=localStorage.getItem('kn_last_'+uid()); }catch(e){}
    const lc=LIST.find(c=>c.id===last);
    if(lc){ const s=courseStateSummary(lc.id); const step=s.st.plan ? null : null; rc.innerHTML='<div class="card today resume"><p class="eyebrow">続きから</p><h2 style="font-size:19px;margin-bottom:4px">'+esc(lc.title)+'</h2><p class="small muted" style="margin:0">'+esc(s.text)+(s.ex&&s.d>0?' · 第'+s.ex.round+'回まで '+s.d+' 日':'')+'</p><a class="btn primary" href="#/c/'+lc.id+'/home">今日の学習を始める</a></div>'; }
    else rc.innerHTML='';
  }

  /* =================== コースの読み込み =================== */
  const loaded={}; let loadChain=Promise.resolve();
  function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src+'?v='+encodeURIComponent(APP_VERSION); s.onload=res; s.onerror=()=>rej(new Error(src+' を読み込めません')); document.head.appendChild(s); }); }
  function loadCourse(id){
    if(loaded[id]) return loaded[id];
    const p = loadChain.then(()=>doLoad(id)).catch(e=>{ delete loaded[id]; throw e; });
    loaded[id]=p; loadChain=p.catch(()=>{});
    return p;
  }
  async function doLoad(id){
    window.__Q=[]; window.__DS=null; window.__DSQ=null;
    const notesP=fetch('courses/'+id+'/notes.html?v='+encodeURIComponent(APP_VERSION), {cache:'no-cache'});
    let dsErr=null;
    await Promise.all([ loadScript('courses/'+id+'/questions.js'), loadScript('courses/'+id+'/legacy.js').catch(()=>{}), loadScript('courses/'+id+'/datasets.js').catch(e=>{ dsErr=e; }), loadScript('courses/'+id+'/course.js') ]);
    const c=window.COURSES&&window.COURSES[id]; if(!c) throw new Error('コース定義が見つかりません');
    if(dsErr && c.mock && c.mock.data>0) throw dsErr;
    let qs=window.__Q.slice();
    if(window.__DS){ c.datasets=window.__DS; Object.keys(window.__DSQ||{}).forEach(k=>{ qs=qs.concat(window.__DSQ[k]); }); }
    const seen={};
    qs.forEach((q,i)=>{ q.idx=i; let h=id+'-'+fnv(q.q); if(seen[h]){ h=id+'-'+fnv(q.q+'#'+i); } seen[h]=1; q.id=h; if(!Array.isArray(q.c)||q.c.length<2||!(q.a>=0&&q.a<q.c.length)) console.error('invalid question', id, i, q); });
    c.questions=qs;
    const r=await notesP;
    if(!r.ok) throw new Error('ノートを読み込めません（'+r.status+'）');
    const html=await r.text(); if(!/<details class="ch"/.test(html)) throw new Error('ノートの内容が不正です');
    c.notesHtml=html;
    return c;
  }
  function applyTheme(t){
    let el=$('#theme-style'); if(!el){ el=document.createElement('style'); el.id='theme-style'; document.head.appendChild(el); }
    if(!t){ el.textContent=''; return; }
    const L=t, D=t.dark||t;
    el.textContent=':root:root{--accent:'+L.accent+';--accent-soft:'+L.accentSoft+';--accent-text:'+L.accentText+';--accent-ink:'+L.accentInk+'}'+
      '@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"]){--accent:'+D.accent+';--accent-soft:'+D.accentSoft+';--accent-text:'+D.accentText+';--accent-ink:'+D.accentInk+'}}'+
      ':root:root[data-theme="dark"]{--accent:'+D.accent+';--accent-soft:'+D.accentSoft+';--accent-text:'+D.accentText+';--accent-ink:'+D.accentInk+'}';
  }
  let lastCourseId=null, openGen=0;
  async function openCourse(id, view){
    const meta=LIST.find(c=>c.id===id);
    if(!meta){ location.hash='#/'; return; }
    const gen=++openGen;
    if(!loaded[id] || lastCourseId!==id){ leaveCourseUI(); $('#loading-title').textContent=meta.title+' を読み込んでいます…'; showView('loading'); }
    let c;
    try{ c=await loadCourse(id); }
    catch(e){
      if(gen!==openGen) return;
      $('#error-detail').textContent='通信環境をご確認のうえ、もう一度お試しください。（詳細: '+(e&&e.message||e)+'）';
      $('#error-retry').onclick=()=>{ delete loaded[id]; openCourse(id, view); };
      showView('error'); return;
    }
    if(gen!==openGen || !location.hash.startsWith('#/c/'+id)) return;
    if(lastCourseId!==id){
      abortExam();
      course=c; lastCourseId=id; mem=readLocal(id); migrateLegacyIds(); quiz.active=false; pick.key=null;
      ensurePlan();
      applyTheme(c.theme); $('#brand-badge').textContent=(LEVELS[id]&&LEVELS[id].name)||c.badge||'';
      document.title=(c.short||c.title)+' · '+SITE_NAME;
      homeStep=todayIndex();
      renderStatic(); renderNotes(); rerenderAll();
      $('#nav').hidden=false;
      renderCountdown();
      const [sc,st]=syncLabel(); setSync(sb&&user?'pend':sc, sb&&user?'同期中…':st);
      try{ localStorage.setItem('kn_last_'+uid(), id); }catch(e){}
      if(sb&&user) pullProgress();
    }
    showView(view);
    if(view==='quiz' && !quiz.active) renderSetPicker();
  }
  function renderCountdown(){
    if(!course) return;
    const ex=course.plan.exam; const d=daysUntil(course.plan.examDate);
    $('#countdown').innerHTML=(ex?'第'+ex.round+'回 · ':'')+(d>0?'試験まで <b>'+d+'</b> 日':d===0?'<b>今日が試験日</b>':'試験終了');
  }
  function rerenderAll(){ if(!course) return; ensurePlan(); renderHome(); renderSched(); applySheet(); renderCountdown(); if($('#v-quiz').classList.contains('on') && !quiz.active) renderSetPicker(); }

  /* =================== 静的部分（試験情報など） =================== */
  function factsHtml(){
    const c=course, lv=LEVELS[c.id]||{}, ex=course.plan.exam;
    const pr=PASS[c.id]||[]; const latest=pr[0]; const vals=pr.map(x=>x[1]); const lo=vals.length?Math.min.apply(null,vals):0, hi=vals.length?Math.max.apply(null,vals):0;
    const facts=[];
    if(ex){ facts.push({l:'試験日', v:md(ex.date), s:'第'+ex.round+'回 · '+jpDate(ex.date).slice(-3)+(lv.gather?' '+lv.gather+'集合':'')}); facts.push({l:'申込締切', v:md(ex.apply.conv), s:'コンビニ ／ クレカ '+md(ex.apply.card)}); }
    facts.push({l:'形式・時間', v:'マークシート', s:'試験時間 '+(lv.minutes?lv.minutes/60+'時間':'2時間')+'・会場受験', text:true});
    facts.push({l:'合格基準', v:'70', s:'点 ／ 100点'});
    if(latest) facts.push({l:'合格率', v:latest[1]+'%', s:'第'+latest[0]+'回（直近'+pr.length+'回 '+Math.round(lo)+'〜'+Math.round(hi)+'%）'});
    if(lv.fee) facts.push({l:'受験料', v:lv.fee.toLocaleString()+'円', s:'税込', text:true});
    facts.push({l:'電卓', v:'持込可', s:'（四則演算のみ・無音）', text:true});
    return '<div class="facts">'+facts.map(f=>'<div class="fact"><div class="l">'+esc(f.l)+'</div><div class="v"'+(f.text?' style="font-family:var(--font-body);font-size:14px;font-weight:700"':'')+'>'+esc(f.v)+(f.s?(f.text?'<br>':' ')+'<small>'+esc(f.s)+'</small>':'')+'</div></div>').join('')+'</div>'+(c.factsNote?'<p class="small muted" style="margin:12px 0 0">'+c.factsNote+'</p>':'')+'<p class="small muted" style="margin:8px 0 0">日程・受験料は変更されることがあります。必ず<a href="https://www.b-accounting.jp/" target="_blank" rel="noopener">公式サイト</a>で最新情報をご確認ください。</p>';
  }
  function renderStatic(){
    const c=course;
    $('#home-title').textContent=c.homeTitle||'今日の学習';
    $('#notes-intro').innerHTML=c.notesIntro||'';
    $('#sched-title').textContent=c.schedTitle||'合格までの予定';
    $('#examday-home').innerHTML=(c.examDay||[]).map(x=>'<li>'+x+'</li>').join('');
  }
  function renderSchedInfo(){
    const c=course, p=course.plan;
    const ex=p.exam;
    const planForm='<div class="plan-form">'+
      '<label>受験する回<select id="plan-round">'+examsFor(c.id).map(e=>'<option value="'+e.round+'"'+(e.round===p.round?' selected':'')+'>第'+e.round+'回 · '+jpDateY(e.date)+(e.date<todayStr()?'（終了）':'')+'</option>').join('')+'</select></label>'+
      '<label>学習の開始日<input type="date" id="plan-start" value="'+esc(mem.plan.start)+'"></label>'+
      '<div class="row"><button type="button" class="btn primary small" id="plan-apply">この設定で予定を組み直す</button><span class="small muted">'+(p.compressed?'試験までの日数が標準（'+p.templateDays+'日）より短いため、圧縮した予定です。':'標準 '+p.templateDays+'日の予定を、試験日に合わせて配分しています。')+'</span></div></div>';
    $('#sched-info').innerHTML=
      '<details class="info" id="plan-details"><summary>受験する回・開始日を変更</summary><div class="body">'+planForm+'</div></details>'+
      '<details class="info"><summary>試験概要'+(ex?'（第'+ex.round+'回）':'')+'</summary><div class="body">'+factsHtml()+'</div></details>'+
      '<details class="info"><summary>毎日の回し方</summary><div class="body"><ol class="steps">'+(c.howto||[]).map(h=>'<li><span class="t">'+esc(h.t)+'</span><span>'+h.html+'</span><span></span></li>').join('')+'</ol>'+(c.howtoNote?'<p class="small muted" style="margin:10px 0 0">'+c.howtoNote+'</p>':'')+'</div></details>'+
      '<details class="info"><summary>当日の動き方</summary><div class="body"><ul class="b small">'+(c.examDay||[]).map(x=>'<li>'+x+'</li>').join('')+'</ul></div></details>';
    $('#plan-apply').addEventListener('click', ()=>{
      const round=Number($('#plan-round').value); const start=$('#plan-start').value||todayStr();
      mem.plan={round, start, at:Date.now()}; touch(); ensurePlan(); homeStep=todayIndex(); rerenderAll(); toast('予定を組み直しました。');
    });
    $('#sched-note').textContent=(p.exam?jpDate(p.start)+'から第'+p.exam.round+'回（'+jpDate(p.examDate)+'）まで、':'')+STEPS().length+'ステップ。終わったステップはチェックを入れる。遅れたら次のステップに進まず、今のステップを縮めて追いつく。';
  }

  /* =================== 今日・予定 =================== */
  let homeStep=0;
  function range(st){ return st.s===st.e ? md(st.s) : md(st.s)+'–'+md(st.e); }
  function chapterTitle(id){ const d=$('#'+id); if(!d) return id; const n=$('summary .name', d); return n ? n.childNodes[0].textContent.trim() : id; }
  function bestOf(n){ const b=store.get('best',{}); return b[n]; }
  function wrongIds(){ const w=store.get('wrong',{}); return Object.keys(w); }
  function renderDeadline(){
    const el=$('#deadline-card'); const p=course.plan, ex=p.exam; const applied=store.get('applied', false); const t=todayStr();
    if(!ex){ el.innerHTML=''; return; }
    const later=examsFor(course.id).find(e=>e.date>ex.date);
    let html='';
    if(applied){
      if(ex.ticket && t>=addDays(ex.ticket,-7) && t<=ex.date) html='<div class="card"><p class="eyebrow">受験票</p><p style="margin:0" class="small">受験票は '+jpDate(ex.ticket)+' 発送予定。'+(ex.ticketAsk?'届かない場合は '+md(ex.ticketAsk[0])+'・'+md(ex.ticketAsk[1])+' に検定試験センターへ問い合わせ。':'')+'</p></div>';
    } else if(t<=ex.apply.card){
      const closedConv = t>ex.apply.conv;
      html='<div class="card warn"><p class="eyebrow" style="color:var(--warn-text)">まず申込</p><p style="margin:0"><b>第'+ex.round+'回の申込締切：'+jpDate(ex.apply.conv)+'＝コンビニ払い ／ '+jpDate(ex.apply.card)+'＝クレジットカード払い。</b>'+(closedConv?'コンビニ払いは受付終了。クレジットカード払いのみ受付中。':'')+'公式サイト（<a href="https://www.b-accounting.jp/" target="_blank" rel="noopener">b-accounting.jp</a>）の「受験申込」から申し込む。'+(LEVELS[course.id]&&LEVELS[course.id].fee?'受験料 '+LEVELS[course.id].fee.toLocaleString()+'円（税込）。':'')+'</p><label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:700;cursor:pointer"><input type="checkbox" id="applied" style="width:20px;height:20px;accent-color:var(--warn)"> 申込済み</label></div>';
    } else if(t<=ex.date){
      html='<div class="card aka"><p class="eyebrow" style="color:var(--aka-text)">申込は締め切られました</p><p style="margin:0" class="small">第'+ex.round+'回（'+jpDate(ex.date)+'）の申込受付は終了しています。'+(later?'次回 第'+later.round+'回は '+jpDateY(later.date)+'。申込は '+(later.applyFrom?jpDate(later.applyFrom)+'〜':'')+md(later.apply.conv)+'（コンビニ）／'+md(later.apply.card)+'（クレカ）。':'次回の日程は公式サイトで公開され次第、反映します。')+'</p><div class="row" style="margin-top:10px">'+(later?'<button type="button" class="btn small primary" id="switch-round" data-round="'+later.round+'">第'+later.round+'回に向けた予定に切り替える</button>':'')+'<label style="display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer"><input type="checkbox" id="applied" style="width:20px;height:20px;accent-color:var(--accent)"> 申込済みだった</label></div></div>';
    }
    el.innerHTML=html;
    const ap=$('#applied'); if(ap) ap.addEventListener('change', e=>{ store.set('applied', e.target.checked); toast(e.target.checked?'申込済みとして記録しました。':'未申込に戻しました。'); renderHome(); });
    const sw=$('#switch-round'); if(sw) sw.addEventListener('click', ()=>switchRound(Number(sw.dataset.round)));
  }
  function switchRound(round){
    mem.plan={round, start:todayStr(), at:Date.now()}; mem.sched={}; mem.applied=false; touch(); ensurePlan(); homeStep=todayIndex(); rerenderAll(); toast('第'+round+'回に向けた予定に切り替えました。');
  }
  function renderPlanNotice(){
    const el=$('#plan-notice'); const p=course.plan; const t=todayStr();
    const later=examsFor(course.id).find(e=>e.date>p.examDate);
    if(p.examDate < t){
      el.innerHTML='<div class="card aka"><p class="eyebrow" style="color:var(--aka-text)">第'+p.round+'回は終了しました</p><p class="small" style="margin:0">お疲れさまでした。'+(later?'次回 第'+later.round+'回（'+jpDateY(later.date)+'）に向けて、予定を組み直せます。':'次回の日程が公開され次第、反映します。それまでは復習リストとノートで維持を。')+'</p>'+(later?'<button type="button" class="btn small primary" style="margin-top:10px" id="switch-round2" data-round="'+later.round+'">第'+later.round+'回の予定を作る</button>':'')+'</div>';
      const b=$('#switch-round2'); if(b) b.addEventListener('click', ()=>switchRound(Number(b.dataset.round)));
    } else if(p.preStart && t < p.start){
      el.innerHTML='<div class="card"><p class="eyebrow">計画開始まで '+daysUntil(p.start)+' 日</p><p class="small muted" style="margin:0">試験までの日数に余裕があるため、予定は '+jpDate(p.start)+' から始まります。先取りして進めても構いません。開始日は「予定」タブで変更できます。</p></div>';
    } else if(p.compressed && !store.get('sched',{})[STEPS()[0].n] && todayIndex()===0){
      el.innerHTML='<div class="card"><p class="eyebrow">短縮プラン</p><p class="small muted" style="margin:0">試験までの日数が標準より短いため、ステップを圧縮しています。ノートは「30秒でつかむ」と赤シートの用語を優先し、問題を多めに回してください。</p></div>';
    } else el.innerHTML='';
  }
  function renderHome(){
    const c=course, S=STEPS();
    renderPlanNotice(); renderDeadline();
    const d=S[Math.min(homeStep,S.length-1)]; const checks=store.get('sched',{}); const isNow=S[todayIndex()].n===d.n;
    let steps='';
    if(d.read.length) steps+='<li><span class="t">15分</span><span>ノートを読む：'+d.read.map(id=>'<a href="#" data-ch="'+id+'">'+esc(chapterTitle(id))+'</a>').join('、')+'</span><span><button class="btn small primary" data-ch="'+d.read[0]+'">開く</button></span></li>';
    if(d.set==='mix'){
      steps+='<li><span class="t">15分</span><span>総合ランダムを20問</span><span><button class="btn small primary" data-set="mix">解く</button></span></li>';
      steps+='<li><span class="t">10分</span><span>復習リストを解き切る</span><span><button class="btn small" data-set="wrong">解く</button></span></li>';
    } else if(d.set==='wrong'){
      steps+='<li><span class="t">毎朝</span><span>復習リストを一周する</span><span><button class="btn small primary" data-set="wrong">解く</button></span></li>';
      steps+='<li><span class="t">直前</span><span>「当日の動き方」を読む</span><span></span></li>';
    } else if(d.set){
      const b=bestOf(d.set);
      steps+='<li><span class="t">10分</span><span>問題セット '+esc(d.set)+' を10問'+(b?'<span class="chip '+(b.p>=80?'ok':b.p<70?'aka':'')+'" style="margin-left:6px">'+b.p+'%</span>':'')+'</span><span><button class="btn small primary" data-set="'+esc(d.set)+'">解く</button></span></li>';
      steps+='<li><span class="t">5分</span><span>間違えた問題の解説を読み直す</span><span><button class="btn small" data-set="wrong">復習</button></span></li>';
    }
    const flag = (d.n===S[0].n && !store.get('applied',false) && c.plan.exam && todayStr()<=c.plan.exam.apply.card) ? '<span class="chip warn">まず申込</span>' : '';
    $('#today-card').innerHTML=
      '<div class="row" style="justify-content:space-between;margin-bottom:4px"><span class="daynum">STEP '+String(d.n).padStart(2,'0')+' · '+range(d)+(isNow?' · 今ここ':'')+'</span>'+
      '<span class="row" style="gap:4px"><button class="btn small ghost icon" id="day-prev" aria-label="前のステップ" '+(homeStep===0?'disabled':'')+'><span aria-hidden="true">‹</span></button><button class="btn small ghost icon" id="day-next" aria-label="次のステップ" '+(homeStep===S.length-1?'disabled':'')+'><span aria-hidden="true">›</span></button></span></div>'+
      '<h2 style="font-size:20px;margin-bottom:4px">'+esc(d.title)+(flag?' '+flag:'')+(d.exam?' <span class="chip aka">本番</span>':'')+'</h2>'+
      '<p class="small muted" style="margin:0">'+esc(d.desc)+'</p><ol class="steps">'+steps+'</ol>'+
      '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:700;cursor:pointer"><input type="checkbox" id="today-done" style="width:20px;height:20px;accent-color:var(--accent)" '+(checks[d.n]?'checked':'')+'> このステップを完了にする</label>';
    $('#day-prev').onclick=()=>{ homeStep=Math.max(0,homeStep-1); renderHome(); };
    $('#day-next').onclick=()=>{ homeStep=Math.min(S.length-1,homeStep+1); renderHome(); };
    $('#today-done').onchange=e=>{ setStepDone(d.n, e.target.checked); if(e.target.checked) toast('STEP '+d.n+' 完了！この調子です。'); };
    const showExamDay = daysUntil(c.plan.examDate)<=7 && daysUntil(c.plan.examDate)>=0;
    $('#examday-card').hidden=!showExamDay;
    renderProgress();
  }
  function setStepDone(n, done){ const c2=store.get('sched',{}); if(done) c2[n]=true; else delete c2[n]; store.set('sched',c2); renderHome(); renderSched(); }
  function renderProgress(){
    const S=STEPS(); const checks=store.get('sched',{}); const done=S.filter(d=>checks[d.n]).length;
    if(mem.done!==done || mem.total!==S.length){ mem.done=done; mem.total=S.length; writeLocal(); }
    $('#prog-bar').style.width=Math.round(done/S.length*100)+'%'; $('#prog-bar-wrap').setAttribute('aria-valuenow', String(Math.round(done/S.length*100)));
    const best=store.get('best',{}); const wrong=poolFor('wrong');
    $('#prog-text').textContent=done+' / '+S.length+' ステップ完了 · 復習リスト '+wrong.length+' 問'+(best.exam?' · 模試ベスト '+best.exam.p+'点':'');
    $('#prog-grid').innerHTML=Object.keys(course.sets).map(n=>{ const b=best[n]; const cls=b?(b.p>=80?'good':b.p<70?'weak':''):''; return '<button class="cell '+cls+'" data-set="'+n+'" type="button" title="'+esc(course.sets[n].t)+'"><div class="n">SET '+n+'</div><div class="s">'+(b?b.p+'%':'—')+'</div><div class="go">'+(b?'もう一度 ›':'解く ›')+'</div></button>'; }).join('');
  }
  function renderSched(){
    renderSchedInfo();
    const S=STEPS(); const checks=store.get('sched',{}); const ti=todayIndex();
    $('#sched').innerHTML=S.map((d,i)=>{
      const links=d.read.map(id=>'<button class="btn small" data-ch="'+id+'">'+esc(chapterTitle(id))+'</button>').join('')+(d.set?'<button class="btn small primary" data-set="'+esc(d.set)+'">'+(d.set==='mix'?'総合ランダム':d.set==='wrong'?'復習リスト':'問題セット '+d.set)+'</button>':'');
      return '<li class="day'+(i===ti?' now':'')+(d.exam?' exam':'')+(checks[d.n]?' done':'')+'"><div class="date"><span>'+Number(d.s.slice(5,7))+'月</span><b>'+Number(d.s.slice(8))+'</b><span>'+(d.s===d.e?'':'〜'+md(d.e))+'</span></div><div><p class="ttl">STEP '+d.n+' · '+esc(d.title)+(d.exam?' <span class="chip aka">本番</span>':'')+(i===ti?' <span class="chip acc">今ここ</span>':'')+'</p><p class="dsc">'+esc(d.desc)+'</p><div class="links">'+links+'</div><label><input type="checkbox" data-day="'+d.n+'" aria-label="STEP '+d.n+' '+esc(d.title)+' を完了にする" '+(checks[d.n]?'checked':'')+'> 完了</label></div></li>';
    }).join('');
    $$('#sched input[type=checkbox]').forEach(cb=>cb.addEventListener('change', e=>setStepDone(e.target.dataset.day, e.target.checked)));
  }
  document.addEventListener('click', async e=>{
    const a=e.target.closest('[data-ch]'); if(a && course){ e.preventDefault(); openChapter(a.dataset.ch); return; }
    const s=e.target.closest('[data-set]'); if(s && course){ e.preventDefault(); if(exam.active){ if(!(await ask({title:'模試を中断しますか？', body:'中断した模試は、あとで「問題」タブから再開できます。', ok:'中断する'}))) return; saveExam(); abortExam(); } location.hash='#/c/'+course.id+'/quiz'; renderSetPicker(s.dataset.set); return; }
  });
  let pendingChapter=null;
  function openChapter(id){
    if($('#v-notes').classList.contains('on')){ scrollToChapter(id); return; }
    pendingChapter=id; location.hash='#/c/'+course.id+'/notes';
  }
  function scrollToChapter(id){ const d=$('#'+id); if(!d) return; d.open=true; setTimeout(()=>{ const sm=$('summary', d); if(sm){ sm.setAttribute('tabindex','-1'); try{ sm.focus({preventScroll:true}); }catch(e){} } d.scrollIntoView({behavior: RM.matches?'auto':'smooth', block:'start'}); }, 60); }
  const _showView=showView;
  showView=function(view){ _showView(view); if(view==='notes' && pendingChapter){ const id=pendingChapter; pendingChapter=null; setTimeout(()=>scrollToChapter(id), 30); } };

  /* 日付が変わったら「今ここ」とカウントダウンを更新 */
  let lastDay=todayStr();
  function checkDayRollover(){ const t=todayStr(); if(t!==lastDay){ lastDay=t; if(course){ homeStep=todayIndex(); rerenderAll(); } else renderIndex(); } }
  setInterval(checkDayRollover, 60000);

  /* =================== ノート =================== */
  function renderNotes(){
    const dst=$('#notes'); dst.innerHTML=course.notesHtml||'';
    const src=$('#notes-src', dst); if(src){ while(src.firstChild) dst.appendChild(src.firstChild); src.remove(); }
    $$('summary .arrow', dst).forEach(a=>a.setAttribute('aria-hidden','true'));
    $$('.tw', dst).forEach(t=>{ t.setAttribute('tabindex','0'); t.setAttribute('role','region'); t.setAttribute('aria-label','表（横にスクロールできます）'); });
    syncSheetA11y();
    $('#chapnav').innerHTML=$$('details.ch', dst).map(d=>'<a href="#" data-ch="'+d.id+'">'+esc($('summary .num',d).childNodes[0].textContent.trim())+' '+esc(chapterTitle(d.id))+'</a>').join('');
  }
  const notesRoot=$('#v-notes');
  function sheetOn(){ return notesRoot.classList.contains('sheet-on'); }
  function syncSheetA11y(){ const on=sheetOn(); $$('.k', notesRoot).forEach(k=>{ if(on){ k.setAttribute('role','button'); k.setAttribute('tabindex','0'); k.setAttribute('aria-pressed', String(k.classList.contains('show'))); } else { k.removeAttribute('role'); k.removeAttribute('tabindex'); k.removeAttribute('aria-pressed'); } }); const st=$('#sheet-state'); if(st) st.textContent=on?'ON':'OFF'; $('#sheet-all-show').disabled=$('#sheet-all-hide').disabled=!on; }
  function toggleK(k){ k.classList.toggle('show'); k.setAttribute('aria-pressed', String(k.classList.contains('show'))); }
  function applySheet(){ const sheet=$('#sheet'); const on=!!store.get('sheet', false); sheet.checked=on; notesRoot.classList.toggle('sheet-on', on); syncSheetA11y(); }
  $('#sheet').addEventListener('change', ()=>{ const on=$('#sheet').checked; notesRoot.classList.toggle('sheet-on', on); store.set('sheet', on); $$('.k.show', notesRoot).forEach(k=>k.classList.remove('show')); syncSheetA11y(); toast(on?'赤シート ON。隠れた語句はタップで表示できます。':'赤シート OFF'); });
  notesRoot.addEventListener('click', e=>{ const k=e.target.closest('.k'); if(k && sheetOn()) toggleK(k); });
  notesRoot.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.key===' ') && e.target.classList && e.target.classList.contains('k') && sheetOn()){ e.preventDefault(); toggleK(e.target); } });
  $('#sheet-all-show').addEventListener('click', ()=>$$('.k', notesRoot).forEach(k=>{ k.classList.add('show'); k.setAttribute('aria-pressed','true'); }));
  $('#sheet-all-hide').addEventListener('click', ()=>$$('.k', notesRoot).forEach(k=>{ k.classList.remove('show'); k.setAttribute('aria-pressed','false'); }));

  /* =================== 問題 =================== */
  const quiz={active:false};
  function Q(){ return course.questions; }
  function poolFor(key){
    if(key==='mix') return Q().slice();
    if(key==='wrong'){ const w=store.get('wrong',{}); return Q().filter(q=>w[q.id]); }
    return Q().filter(q=>String(q.d)===String(key));
  }
  function setName(key){ return key==='mix'?'総合ランダム':key==='wrong'?'復習リスト':'セット '+key+'：'+((course.sets[key]||{}).t||''); }
  let pick={key:null, count:10};
  function renderSetPicker(pre){
    abortExam(); quiz.active=false;
    const best=store.get('best',{}); const wrong=poolFor('wrong');
    const todaySet=STEPS()[todayIndex()].set;
    if(pre) pick.key=String(pre); else if(!pick.key) pick.key=String(todaySet||1);
    if(pick.key==='wrong' && !wrong.length) pick.key='mix';
    const cells=Object.keys(course.sets).map(n=>{ const b=best[n]; const cnt=poolFor(n).length; return '<button type="button" class="setbtn'+(pick.key===n?' sel':'')+'" data-pick="'+n+'" aria-pressed="'+(pick.key===n)+'"><span class="n">SET '+n+(String(todaySet)===n?' · 今':'')+'</span><span class="t">'+esc(course.sets[n].t)+'</span><span class="s">'+cnt+'問'+(b?' · ベスト '+b.p+'%':' · 10問から始める')+'</span></button>'; }).join('');
    const saved=loadSavedExam();
    $('#quiz').innerHTML=
      (saved?'<div class="card" style="border-color:var(--accent)"><p class="eyebrow">中断中の模試</p><div class="row" style="justify-content:space-between"><span class="small">解答済 '+saved.ans.filter(a=>a!==null).length+' / '+saved.ids.length+' 問 · 残り '+fmtLeft(saved.end)+'</span><span class="row" style="gap:6px"><button type="button" class="btn small" id="exam-discard">破棄</button><button type="button" class="btn small primary" id="exam-resume">再開する</button></span></div></div>':'')+
      '<div class="card"><p class="eyebrow">セット</p><div class="setgrid">'+cells+
      '<button type="button" class="setbtn wide'+(pick.key==='mix'?' sel':'')+'" data-pick="mix" aria-pressed="'+(pick.key==='mix')+'"><span class="n">MIX</span><span class="t">総合ランダム（全範囲から出題）</span><span class="s">'+Q().length+'問から</span></button>'+
      '<button type="button" class="setbtn wide'+(pick.key==='wrong'?' sel':'')+'" data-pick="wrong" aria-pressed="'+(pick.key==='wrong')+'" '+(wrong.length?'':'disabled')+'><span class="n">REVIEW</span><span class="t">復習リスト（間違えた問題）</span><span class="s">'+(wrong.length?wrong.length+'問':'間違えた問題が自動でここに溜まります')+'</span></button>'+
      '</div></div>'+
      (course.mock?'<div class="card" style="border-color:var(--accent)"><p class="eyebrow">模擬試験</p><h2 style="font-size:18px">模擬試験（本番形式）</h2><p class="small muted" style="margin:0 0 10px">'+esc(course.mock.desc||'')+'</p><div class="row" style="justify-content:space-between"><span class="small mono">'+(course.mock.minutes)+'分 · '+(course.mock.tf+course.mock.single+course.mock.data)+'問'+(best.exam?' · ベスト '+best.exam.p+'点':'')+'</span><button type="button" class="btn primary" id="exam-start">模試を始める</button></div></div>':'')+
      '<div class="card"><p class="eyebrow">出題数</p><div class="row" style="justify-content:space-between"><div class="seg" role="group" aria-label="出題数">'+[10,20,0].map(c=>'<button type="button" data-count="'+c+'" class="'+(pick.count===c?'on':'')+'" aria-pressed="'+(pick.count===c)+'">'+(c===0?'全部':c+'問')+'</button>').join('')+'</div><button type="button" class="btn primary" id="start">開始</button></div><p class="small muted" style="margin:10px 0 0">選択肢は毎回シャッフルされます。間違えた問題は自動で復習リストに入り、正解すると外れます。</p></div>';
    $$('#quiz [data-pick]').forEach(b=>b.addEventListener('click', ()=>{ pick.key=b.dataset.pick; renderSetPicker(); }));
    $$('#quiz [data-count]').forEach(b=>b.addEventListener('click', ()=>{ pick.count=Number(b.dataset.count); renderSetPicker(); }));
    $('#start').addEventListener('click', ()=>startQuiz(pick.key, pick.count));
    const ex=$('#exam-start'); if(ex) ex.addEventListener('click', async()=>{ if(saved && !(await ask({title:'新しい模試を始めますか？', body:'中断中の模試は破棄されます。', ok:'新しく始める', danger:true}))) return; clearSavedExam(); startExam(); });
    const rs=$('#exam-resume'); if(rs) rs.addEventListener('click', resumeExam);
    const dc=$('#exam-discard'); if(dc) dc.addEventListener('click', async()=>{ if(await ask({title:'中断中の模試を破棄しますか？', body:'解答内容は失われます。', ok:'破棄する', danger:true})){ clearSavedExam(); renderSetPicker(); } });
  }

  /* =================== 模擬試験モード =================== */
  const exam={active:false, timer:null}; let gridOpen=false; let warned={};
  function fmtLeft(end){ const left=Math.max(0,end-Date.now()); return String(Math.floor(left/60000)).padStart(2,'0')+':'+String(Math.floor(left%60000/1000)).padStart(2,'0'); }
  function examKey(){ return 'kn_exam_'+uid()+'_'+course.id; }
  function saveExam(){ if(!exam.active) return; try{ sessionStorage.setItem(examKey(), JSON.stringify({ ids:exam.list.map(q=>q.id), ans:exam.ans, order:exam.order, end:exam.end, sec:exam.sec, pos:exam.pos })); }catch(e){} }
  function loadSavedExam(){ try{ const v=sessionStorage.getItem(examKey()); if(!v) return null; const s=JSON.parse(v); if(!s||!Array.isArray(s.ids)||s.end<=Date.now()) { sessionStorage.removeItem(examKey()); return null; } return s; }catch(e){ return null; } }
  function clearSavedExam(){ try{ sessionStorage.removeItem(examKey()); }catch(e){} }
  function abortExam(){ clearInterval(exam.timer); exam.timer=null; exam.active=false; }
  function buildExamList(){
    const cfg=course.mock; const all=Q();
    const tf=shuffle(all.filter(q=>q.f&&!q.ds&&!q.adv)).slice(0,cfg.tf);
    const single=shuffle(all.filter(q=>!q.f&&!q.ds&&!q.adv)).slice(0,cfg.single);
    const dsIds=shuffle(Object.keys(course.datasets||{})); let data=[];
    dsIds.forEach((id,k)=>{ const remain=cfg.data-data.length; if(remain<=0) return; const share=Math.ceil(remain/(dsIds.length-k)); const pool=all.filter(q=>q.ds===id); data=data.concat(shuffle(pool.slice()).slice(0,share).sort((a,b)=>a.idx-b.idx)); });
    return { list: tf.concat(single, data), sec:{tf:tf.length, single:single.length, data:data.length} };
  }
  function startExam(){
    const cfg=course.mock; const b=buildExamList();
    if(!b.list.length){ toast('模試を作成できる問題数が不足しています。'); return; }
    warned={};
    Object.assign(exam,{active:true, list:b.list, pos:0, ans:new Array(b.list.length).fill(null), order:b.list.map(q=>orderFor(q)), end:Date.now()+cfg.minutes*60000, sec:b.sec});
    quiz.active=true; saveExam();
    clearInterval(exam.timer); exam.timer=setInterval(tick, 1000);
    renderExamQ();
  }
  function resumeExam(){
    const s=loadSavedExam(); if(!s){ renderSetPicker(); return; }
    const byId={}; Q().forEach(q=>byId[q.id]=q);
    const list=s.ids.map(id=>byId[id]).filter(Boolean);
    if(list.length!==s.ids.length){ clearSavedExam(); toast('教材が更新されたため、中断中の模試を再開できませんでした。'); renderSetPicker(); return; }
    Object.assign(exam,{active:true, list, pos:Math.min(num(s.pos), list.length-1), ans:s.ans, order:s.order, end:s.end, sec:s.sec});
    quiz.active=true;
    clearInterval(exam.timer); exam.timer=setInterval(tick, 1000);
    renderExamQ();
  }
  function orderFor(q){ const o=q.c.map((_,i)=>i); return q.f?o:shuffle(o); }
  function tick(){ if(!exam.active) return; const el=$('#exam-timer'); const left=Math.max(0, exam.end-Date.now()); if(el){ el.textContent=fmtLeft(exam.end); el.classList.toggle('warn', left<10*60000); } [10,5,1].forEach(m=>{ if(left<=m*60000 && left>0 && !warned[m]){ warned[m]=true; toast('残り'+m+'分です。'); } }); if(left<=0){ clearInterval(exam.timer); toast('時間切れです。採点します。'); finishExam(); } }
  function secName(i){ return i<exam.sec.tf?'Ⅰ 正誤判定':i<exam.sec.tf+exam.sec.single?'Ⅱ 個別問題':'Ⅲ 総合問題'; }
  function renderExamQ(){
    if(!exam.active) return;
    if(exam.end-Date.now()<=0){ tick(); return; }
    const i=exam.pos, q=exam.list[i], order=exam.order[i], answered=exam.ans.filter(a=>a!==null).length;
    $('#quiz').innerHTML=
      '<div class="card"><div class="qhead"><span class="chip aka">模擬試験 · '+secName(i)+'</span><span class="prog"><span id="exam-timer" class="timer" role="timer" aria-label="残り時間"></span><span aria-hidden="true"> · </span><span class="sr">第</span>'+(i+1)+' / '+exam.list.length+'<span class="sr">問</span></span></div>'+
      dsPanel(q)+'<p class="qtext">'+esc(q.q)+'</p>'+
      '<ul class="choices" role="radiogroup" aria-label="選択肢">'+order.map((ci,k)=>'<li><button type="button" class="choice'+(exam.ans[i]===ci?' sel':'')+'" data-ci="'+ci+'" data-l="'+LETTERS[k]+'" role="radio" aria-checked="'+(exam.ans[i]===ci)+'">'+esc(q.c[ci])+'</button></li>').join('')+'</ul>'+
      '<div class="row" style="justify-content:space-between;margin-top:14px"><button type="button" class="btn small" id="ex-prev" '+(i===0?'disabled':'')+'>‹ 前へ</button><span class="small muted mono">解答済 '+answered+'/'+exam.list.length+'</span><button type="button" class="btn small" id="ex-next" '+(i===exam.list.length-1?'disabled':'')+'>次へ ›</button></div>'+
      '<details class="ds" '+(gridOpen?'open':'')+' id="ex-grid-wrap"><summary>問題一覧（解答済 '+answered+' / '+exam.list.length+'）</summary><div class="examgrid" id="ex-grid" role="group" aria-label="問題番号" style="padding:0 10px 10px">'+exam.list.map((_,k)=>'<button type="button" class="'+(exam.ans[k]!==null?'done':'')+(k===i?' cur':'')+'" data-go="'+k+'" aria-label="第'+(k+1)+'問 '+(exam.ans[k]!==null?'解答済':'未解答')+'" '+(k===i?'aria-current="true"':'')+'>'+(k+1)+'</button>').join('')+'</div></details>'+
      '<div class="row" style="justify-content:space-between;margin-top:14px"><button type="button" class="btn ghost small" id="ex-quit">中断</button><button type="button" class="btn primary" id="ex-finish">採点する</button></div></div>';
    tick();
    const qt=$('#quiz .qtext'); if(qt){ qt.setAttribute('tabindex','-1'); try{ qt.focus({preventScroll:true}); }catch(e){} }
    const gw=$('#ex-grid-wrap'); if(gw) gw.addEventListener('toggle', ()=>{ gridOpen=gw.open; });
    $$('#quiz .choice').forEach(b=>b.addEventListener('click', ()=>{ exam.ans[i]=Number(b.dataset.ci); $$('#quiz .choice').forEach(x=>{ x.classList.toggle('sel', x===b); x.setAttribute('aria-checked', String(x===b)); }); const g=$$('#ex-grid button')[i]; if(g) g.classList.add('done'); saveExam(); const next=i+1; setTimeout(()=>{ if(exam.active && exam.pos===i && next<exam.list.length){ exam.pos=next; renderExamQ(); } }, 250); }));
    $('#ex-prev').addEventListener('click', ()=>{ exam.pos--; saveExam(); renderExamQ(); });
    $('#ex-next').addEventListener('click', ()=>{ exam.pos++; saveExam(); renderExamQ(); });
    $$('#ex-grid button').forEach(b=>b.addEventListener('click', ()=>{ exam.pos=Number(b.dataset.go); saveExam(); renderExamQ(); }));
    $('#ex-quit').addEventListener('click', async()=>{ if(await ask({title:'模試を中断しますか？', body:'解答内容は保存され、「問題」タブから再開できます（残り時間は進み続けます）。', ok:'中断する'})){ saveExam(); abortExam(); quiz.active=false; renderSetPicker(); } });
    $('#ex-finish').addEventListener('click', async()=>{ const left=exam.list.length-exam.ans.filter(a=>a!==null).length; if(left>0 && !(await ask({title:'未解答が '+left+' 問あります', body:'未解答は不正解として採点されます。このまま採点しますか？', ok:'採点する'}))) return; finishExam(); });
  }
  function finishExam(){
    clearInterval(exam.timer); exam.timer=null; exam.active=false; quiz.active=false; clearSavedExam();
    const L=exam.list; let c=0; const secC=[0,0,0], secT=[exam.sec.tf, exam.sec.single, exam.sec.data]; const wrongQ=[];
    const now=Date.now(); const wrong=Object.assign({},store.get('wrong',{})), cleared=Object.assign({},store.get('cleared',{}));
    L.forEach((q,i)=>{ const s=i<exam.sec.tf?0:i<exam.sec.tf+exam.sec.single?1:2; if(exam.ans[i]===q.a){ c++; secC[s]++; delete wrong[q.id]; cleared[q.id]=now; } else { wrongQ.push(q); wrong[q.id]=now; } });
    mem.wrong=wrong; mem.cleared=cleared;
    const p=Math.round(c/L.length*100); const pass=p>=70;
    const best=store.get('best',{}); if(!best.exam||p>=best.exam.p) best.exam={p, c, t:L.length, date:todayStr()}; mem.best=best; touch();
    const secNames=['Ⅰ 正誤判定','Ⅱ 個別問題','Ⅲ 総合問題'];
    $('#quiz').innerHTML=
      '<div class="card" style="text-align:center"><p class="eyebrow">模試の結果</p><div class="score">'+p+'<small>点</small></div><p class="mono muted" style="margin:0 0 8px">'+c+' / '+L.length+' 問正解</p>'+
      '<p style="margin:0;font-weight:700;font-size:18px;color:'+(pass?'var(--ok-text)':'var(--aka-text)')+'">'+(pass?'合格ライン（70点）クリア':'あと '+(Math.ceil(L.length*0.7)-c)+' 問で合格ライン')+'</p>'+
      '<div class="tw" style="margin-top:12px"><table><tr><th>大問</th><th>正解</th><th>正答率</th></tr>'+secNames.map((n,i)=>'<tr><td>'+n+'</td><td>'+secC[i]+' / '+secT[i]+'</td><td>'+(secT[i]?Math.round(secC[i]/secT[i]*100):0)+'%</td></tr>').join('')+'</table></div></div>'+
      '<div class="stack">'+(wrongQ.length?'<button type="button" class="btn primary block" id="retry-wrong">間違えた '+wrongQ.length+' 問を解説付きでやり直す</button>':'')+'<button type="button" class="btn block" id="exam-again">もう一度模試を受ける</button><button type="button" class="btn ghost block" id="back">セット選択へ戻る</button></div>'+
      (wrongQ.length?'<div class="card" style="margin-top:14px"><p class="eyebrow">復習</p><h2 style="font-size:18px">間違えた問題</h2>'+wrongQ.map(q=>'<div class="review"><p class="q" style="margin:0 0 4px">'+esc(q.q)+'</p><p style="margin:0 0 4px"><span class="a">正解：'+esc(q.c[q.a])+'</span></p><p class="small muted" style="margin:0">'+esc(q.e)+'</p></div>').join('')+'</div>':'');
    const rw=$('#retry-wrong'); if(rw) rw.addEventListener('click', ()=>{ Object.assign(quiz,{active:true, key:'wrong', retry:true, list:shuffle(wrongQ.slice()), pos:0, correct:0, wrongQ:[]}); renderQuestion(); });
    $('#exam-again').addEventListener('click', startExam);
    $('#back').addEventListener('click', ()=>renderSetPicker());
    renderProgress(); window.scrollTo({top:0}); focusResult();
  }
  function focusResult(){ const s=$('#quiz .score'); if(s){ s.setAttribute('tabindex','-1'); s.setAttribute('role','status'); try{ s.focus({preventScroll:true}); }catch(e){} } }
  function startQuiz(key, count){
    abortExam();
    let pool=shuffle(poolFor(key));
    if(!pool.length){ toast('このセットには問題がありません。'); return; }
    if(count>0) pool=pool.slice(0,count);
    Object.assign(quiz,{active:true, key, retry:false, list:pool, pos:0, correct:0, wrongQ:[]});
    renderQuestion();
  }
  function dsPanel(q){ if(!q.ds||!course.datasets||!course.datasets[q.ds]) return ''; const d=course.datasets[q.ds]; return '<details class="ds" '+(dsOpen[q.ds]===false?'':'open')+' data-ds="'+esc(q.ds)+'"><summary>資料：'+esc(d.title||q.ds)+'（タップで開閉）</summary>'+d.html+'</details>'; }
  const dsOpen={};
  document.addEventListener('toggle', e=>{ const d=e.target; if(d.classList&&d.classList.contains('ds')) dsOpen[d.dataset.ds]=d.open; }, true);
  function renderQuestion(){
    const q=quiz.list[quiz.pos]; const order=orderFor(q);
    $('#quiz').innerHTML=
      '<div class="card"><div class="qhead"><span class="chip acc">'+esc(setName(quiz.key))+(quiz.retry?'（やり直し）':'')+'</span><span class="prog">'+(quiz.pos+1)+' / '+quiz.list.length+' · 正解 '+quiz.correct+'</span></div>'+
      dsPanel(q)+(q.adv?'<span class="chip adv">'+esc(course.advLabel||'発展')+'</span>':'')+
      '<p class="qtext">'+esc(q.q)+'</p>'+
      '<ul class="choices">'+order.map((ci,i)=>'<li><button type="button" class="choice" data-ci="'+ci+'" data-l="'+LETTERS[i]+'">'+esc(q.c[ci])+'</button></li>').join('')+'</ul>'+
      '<div id="verdict" role="status" aria-live="polite" tabindex="-1"></div>'+
      '<div class="row" style="justify-content:space-between;margin-top:14px"><button type="button" class="btn ghost small" id="quit">やめる</button><button type="button" class="btn primary" id="next" style="display:none">'+(quiz.pos+1===quiz.list.length?'結果を見る':'次へ')+'</button></div></div>';
    const qt2=$('#quiz .qtext'); if(qt2){ qt2.setAttribute('tabindex','-1'); try{ qt2.focus({preventScroll:true}); }catch(e){} }
    $$('#quiz .choice').forEach(b=>b.addEventListener('click', ()=>{ if(b.getAttribute('aria-disabled')==='true') return; answer(q, Number(b.dataset.ci), b); }));
    $('#quit').addEventListener('click', async()=>{ if(quiz.pos>0 && !(await ask({title:'ドリルを終了しますか？', body:'ここまでの正誤は復習リストに反映済みです。', ok:'終了する'}))) return; quiz.active=false; renderSetPicker(); });
    $('#next').addEventListener('click', ()=>{ quiz.pos++; if(quiz.pos>=quiz.list.length) renderResult(); else renderQuestion(); window.scrollTo({top:0}); });
  }
  function answer(q, ci, btn){
    const ok = ci===q.a;
    $$('#quiz .choice').forEach(b=>{ b.setAttribute('aria-disabled','true'); b.classList.add('answered'); const c=Number(b.dataset.ci); if(c===q.a) b.classList.add('correct'); else if(b===btn) b.classList.add('wrong'); else b.classList.add('dim'); });
    const wrong=Object.assign({},store.get('wrong',{})), cleared=Object.assign({},store.get('cleared',{})); const now=Date.now();
    if(ok){ quiz.correct++; delete wrong[q.id]; cleared[q.id]=now; } else { quiz.wrongQ.push(q); wrong[q.id]=now; }
    mem.wrong=wrong; mem.cleared=cleared; touch();
    $('#verdict').innerHTML='<div class="verdict '+(ok?'ok':'ng')+'"><b class="h">'+(ok?'正解':'不正解 · 正解は「'+esc(q.c[q.a])+'」')+'</b>'+esc(q.e)+'</div>';
    const n=$('#next'); n.style.display=''; try{ $('#verdict').focus({preventScroll:true}); }catch(e){}
  }
  function renderResult(){
    quiz.active=false;
    const t=quiz.list.length, c=quiz.correct, p=Math.round(c/t*100);
    if(/^\d+$/.test(quiz.key) && !quiz.retry){ const best=store.get('best',{}); const b=best[quiz.key]; if(!b||p>=b.p) best[quiz.key]={p,c,t}; store.set('best',best); }
    const msg = p>=80?'合格ライン超え。この調子です。':p>=70?'ぎりぎり合格圏。間違えた問題の解説で上積みを。':'ノートに戻りましょう。赤シートで隠して「言える」まで。';
    const wrong=poolFor('wrong');
    $('#quiz').innerHTML=
      '<div class="card" style="text-align:center"><p class="eyebrow">結果 · '+esc(setName(quiz.key))+(quiz.retry?'（やり直し）':'')+'</p><div class="score">'+p+'<small>%</small></div><p class="mono muted" style="margin:0 0 6px">'+c+' / '+t+' 問正解</p><p style="margin:0;font-weight:700">'+msg+'</p></div>'+
      '<div class="stack">'+(quiz.wrongQ.length?'<button type="button" class="btn primary block" id="retry-wrong">今回間違えた '+quiz.wrongQ.length+' 問をもう一度</button>':'')+
      '<button type="button" class="btn block" id="retry-same">同じセットをもう一度</button><button type="button" class="btn ghost block" id="back">セット選択へ戻る</button></div>'+
      (quiz.wrongQ.length?'<div class="card" style="margin-top:14px"><p class="eyebrow">復習</p><h2 style="font-size:18px">間違えた問題</h2>'+quiz.wrongQ.map(q=>'<div class="review"><p class="q" style="margin:0 0 4px">'+esc(q.q)+'</p><p style="margin:0 0 4px"><span class="a">正解：'+esc(q.c[q.a])+'</span></p><p class="small muted" style="margin:0">'+esc(q.e)+'</p></div>').join('')+'</div>':'')+
      '<p class="small muted" style="margin-top:12px">復習リストは現在 '+wrong.length+' 問です。</p>';
    const rw=$('#retry-wrong'); if(rw) rw.addEventListener('click', ()=>{ Object.assign(quiz,{active:true, key:quiz.key, retry:true, list:shuffle(quiz.wrongQ.slice()), pos:0, correct:0, wrongQ:[]}); renderQuestion(); });
    $('#retry-same').addEventListener('click', ()=>startQuiz(quiz.key, pick.count));
    $('#back').addEventListener('click', ()=>renderSetPicker());
    renderProgress(); window.scrollTo({top:0}); focusResult();
  }

  /* =================== 設定・アカウント =================== */
  function showSettings(){
    if(course){ leaveCourseUI(); course=null; lastCourseId=null; abortExam(); }
    const el=$('#settings-account');
    if(user){ el.innerHTML='<h3 style="margin-top:0">アカウント</h3><dl class="kv"><dt>名前</dt><dd>'+esc(displayName())+'</dd><dt>メール</dt><dd>'+esc(user.email||'')+'</dd><dt>ログイン方法</dt><dd>Google</dd></dl><div class="row" style="margin-top:12px"><button type="button" class="btn small" id="settings-logout">ログアウト</button></div>'; $('#settings-logout').addEventListener('click', ()=>$('#menu-logout').click()); }
    else el.innerHTML='<h3 style="margin-top:0">アカウント</h3><p class="small muted" style="margin:0">ログインしていません。進捗はこの端末にだけ保存されます。</p>';
    const sel=$('#bk-course'); sel.innerHTML=LIST.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.title)+'</option>').join('');
    try{ const last=localStorage.getItem('kn_last_'+uid()); if(last) sel.value=last; }catch(e){}
    $('#version-line').textContent='検定ノート v'+APP_VERSION;
    $('#bk-code').hidden=true;
    showView('settings');
  }
  function encodeState(cid){ const st=readLocal(cid); const o={}; KEYS.forEach(k=>{ if(st[k]!==undefined && st[k]!==null) o[k]=st[k]; }); o.v=2; return 'KN-'+cid+'-'+btoa(unescape(encodeURIComponent(JSON.stringify(o)))); }
  function decodeState(code){ code=String(code||'').trim(); const m=code.match(/^KN-([a-z0-9_-]+)-(.+)$/); if(!m) throw new Error('format'); return { course:m[1], state:sanitize(JSON.parse(decodeURIComponent(escape(atob(m[2]))))) }; }
  function summarize(st){ const w=Object.keys(st.wrong||{}).length; return 'STEP '+num(st.done)+'/'+num(st.total)+' 完了 · 復習リスト '+w+' 問'+(st.best&&st.best.exam?' · 模試ベスト '+st.best.exam.p+'点':''); }
  $('#bk-export').addEventListener('click', async()=>{
    const cid=$('#bk-course').value; const code=encodeState(cid); const ta=$('#bk-code'); ta.hidden=false; ta.value=code; ta.removeAttribute('aria-hidden');
    let ok=false; try{ await navigator.clipboard.writeText(code); ok=true; }catch(e){}
    toast(ok?'バックアップコードをコピーしました。':'下の欄を長押しして全選択→コピーしてください。');
  });
  $('#bk-download').addEventListener('click', ()=>{
    const cid=$('#bk-course').value; const st=readLocal(cid); delete st._legacyWrong;
    const blob=new Blob([JSON.stringify({ app:SITE_NAME, version:APP_VERSION, course:cid, exportedAt:new Date().toISOString(), state:st }, null, 2)], {type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='kentei-note-'+cid+'-'+todayStr()+'.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $('#bk-import').addEventListener('click', async()=>{
    const cid=$('#bk-course').value; const meta=LIST.find(c=>c.id===cid);
    let parsed=null;
    const ok=await ask({ title:'コードから復元', body:'「'+esc(meta.title)+'」のバックアップコードを貼り付けてください。現在の進捗は置き換えられます。', ok:'復元する', okDisabled:true,
      slot:'<textarea id="bk-in" rows="4" placeholder="KN-'+esc(cid)+'-…" aria-label="バックアップコード"></textarea><p class="small muted" id="bk-preview" style="margin:8px 0 0"></p>',
      onOpen:()=>{ const ta=$('#bk-in'); const pv=$('#bk-preview'); ta.addEventListener('input', ()=>{ try{ const r=decodeState(ta.value); if(r.course!==cid){ pv.textContent='このコードは「'+((LIST.find(c=>c.id===r.course)||{}).title||r.course)+'」用です。'; parsed=null; $('#dlg-ok').disabled=true; return; } parsed=r.state; pv.textContent='読み込む内容：'+summarize(r.state); $('#dlg-ok').disabled=false; }catch(e){ parsed=null; pv.textContent=ta.value.trim()?'コードを読み取れません。':''; $('#dlg-ok').disabled=true; } }); setTimeout(()=>ta.focus(),50); } });
    if(!ok||!parsed) return;
    parsed.updatedAt=Date.now(); writeLocal(cid, parsed);
    if(course&&course.id===cid){ mem=parsed; migrateLegacyIds(); rerenderAll(); }
    if(sb&&user) await pushNow(cid, parsed);
    renderIndex(); toast('進捗を復元しました。');
  });
  $('#reset-course').addEventListener('click', async()=>{
    const cid=$('#bk-course').value; const meta=LIST.find(c=>c.id===cid);
    if(!(await ask({title:'進捗をリセットしますか？', body:'「'+esc(meta.title)+'」の完了チェック・正答率・復習リストを消去します。この操作は取り消せません。', ok:'リセットする', danger:true}))) return;
    const st=readLocal(cid); const fresh=sanitize({ plan:st.plan, applied:st.applied, sheet:st.sheet }); fresh.updatedAt=Date.now(); writeLocal(cid, fresh);
    if(course&&course.id===cid){ mem=fresh; rerenderAll(); }
    if(sb&&user) await pushNow(cid, fresh);
    renderIndex(); toast('進捗をリセットしました。');
  });
  $('#delete-account').addEventListener('click', async()=>{
    if(!sb||!user){ toast('ログインしていません。'); return; }
    const ok=await ask({ title:'アカウントを削除しますか？', body:'アカウントと、保存されているすべての学習データを削除します。この操作は取り消せません。確認のため「削除」と入力してください。', ok:'アカウントを削除', danger:true, okDisabled:true,
      slot:'<input type="text" id="del-confirm" autocomplete="off" placeholder="削除">', onOpen:()=>{ const i=$('#del-confirm'); i.addEventListener('input', ()=>{ $('#dlg-ok').disabled=i.value.trim()!=='削除'; }); setTimeout(()=>i.focus(),50); } });
    if(!ok) return;
    try{
      const { error } = await sb.rpc('delete_own_account');
      if(error) throw error;
      LIST.forEach(c=>{ try{ localStorage.removeItem(lsKey(c.id)); }catch(e){} });
      try{ localStorage.removeItem('kn_last_'+uid()); }catch(e){}
      manualLogout=true; await sb.auth.signOut(); manualLogout=false;
      user=null; resetCourseState(); started=false; renderAccount(); updateGate(); gateStatus('アカウントを削除しました。ご利用ありがとうございました。');
      location.hash='#/';
    }catch(e){ await ask({title:'削除できませんでした', body:'時間をおいて再度お試しください。解決しない場合はお問い合わせください。（'+esc(e.message||e)+'）', ok:'閉じる', cancel:false}); }
  });

  /* =================== 起動 =================== */
  function setTop(){ const h=$('.top'); if(h) document.documentElement.style.setProperty('--toph', h.offsetHeight+'px'); }
  setTop(); window.addEventListener('resize', setTop); window.addEventListener('load', setTop);
  try{ new ResizeObserver(setTop).observe($('.top')); }catch(e){ setTimeout(setTop, 800); }
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(setTop);
  if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost') && SITE.serviceWorker!==false){ window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); }); }
  /* テスト・デバッグ用の公開API（副作用なし） */
  window.KN = Object.freeze({ version: APP_VERSION, merge, sanitize, buildPlan: (c,p)=>buildPlan(c,p) });
  initAuth();
})();
