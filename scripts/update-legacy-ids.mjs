// 問題文を書き換えたときに courses/<id>/legacy.js（旧 index → 安定ID）を追従させる。
// usage: node scripts/update-legacy-ids.mjs bk3 [baseCommit]   （既定の baseCommit は旧版 3ed4941）
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import vm from 'node:vm';
const id = process.argv[2]; const base = process.argv[3] || '3ed4941';
if (!id) { console.error('usage: node scripts/update-legacy-ids.mjs <courseId> [baseCommit]'); process.exit(1); }
function fnv(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h.toString(16).padStart(8,'0'); }
function loadQs(qsrc, dsrc){ const ctx={window:{}}; ctx.window.__Q=[]; ctx.window.__DS=null; ctx.window.__DSQ=null; vm.createContext(ctx); vm.runInContext(qsrc,ctx); try{ vm.runInContext(dsrc,ctx);}catch{} let qs=ctx.window.__Q.slice(); if(ctx.window.__DS){ Object.keys(ctx.window.__DSQ||{}).forEach(k=>{ qs=qs.concat(ctx.window.__DSQ[k]); }); } return qs; }
const old = loadQs(execSync(`git show ${base}:courses/${id}/questions.js`).toString(), execSync(`git show ${base}:courses/${id}/datasets.js`).toString());
const nw = loadQs(readFileSync(`courses/${id}/questions.js`,'utf8'), readFileSync(`courses/${id}/datasets.js`,'utf8'));
const cur = (()=>{ try{ const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(readFileSync(`courses/${id}/legacy.js`,'utf8'),ctx); return ctx.window.__LEGACY[id]; }catch{ return []; } })();
const newIds = new Set(nw.map(q=>id+'-'+fnv(q.q)));
const legacy = old.map((q,i)=>{
  if (cur[i] && newIds.has(cur[i])) return cur[i];
  const h=id+'-'+fnv(q.q); if(newIds.has(h)) return h;
  const cand=nw.filter(n=>String(n.d)===String(q.d) && JSON.stringify(n.c)===JSON.stringify(q.c) && (n.ds||'')===(q.ds||''));
  if(cand.length===1){ console.log('remapped', i, '->', cand[0].q.slice(0,40)); return id+'-'+fnv(cand[0].q); }
  console.warn('UNMAPPED (復習リストから外れます)', i, q.q.slice(0,40)); return h;
});
writeFileSync(`courses/${id}/legacy.js`, `/* 旧バージョン（問題IDが配列インデックスだった頃）の index → 安定ID 対応表。復習リストの移行にだけ使う。編集不要（scripts/update-legacy-ids.mjs で更新）。 */\nwindow.__LEGACY = window.__LEGACY || {};\nwindow.__LEGACY.${id} = ${JSON.stringify(legacy)};\n`);
console.log(id, 'old', old.length, 'new', nw.length);
