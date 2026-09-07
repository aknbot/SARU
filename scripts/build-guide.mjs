// 公開ガイド（検索・AI 向けの静的ページ）を exams.js / config.js から生成する。
// usage: node scripts/build-guide.mjs   → guide/**, about.html, sitemap.xml, llms.txt を書き出す
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['config.js', 'exams.js']) vm.runInContext(readFileSync(f, 'utf8'), ctx);
const SITE = ctx.window.SITE, EXAMS = ctx.window.EXAMS, LEVELS = ctx.window.LEVELS, PASS = ctx.window.PASS_RATES;
const BASE = (SITE.baseUrl || 'https://aknbot.github.io/SARU/').replace(/\/?$/, '/');
const NAME = SITE.name || '検定ノート';
const TODAY = new Date().toISOString().slice(0, 10);
const OFFICIAL = 'https://www.b-accounting.jp/';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 日付は文字列のまま扱い、曜日だけ UTC で求める（実行環境のタイムゾーンに左右されない） */
const W = '日月火水木金土';
const parts = iso => iso.split('-').map(Number);
const dow = iso => { const [y, m, d] = parts(iso); return W[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const jp = iso => { const [, m, d] = parts(iso); return `${m}月${d}日（${dow(iso)}）`; };
const jpY = iso => { const [y, m, d] = parts(iso); return `${y}年${m}月${d}日（${dow(iso)}）`; };
const yen = n => n.toLocaleString('ja-JP') + '円';
const lastmod = f => { try { return execSync(`git log -1 --format=%cs -- "${f}"`).toString().trim() || TODAY; } catch { return TODAY; } };

/* ---------- 共通の枠 ---------- */
const mark = '<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h5M8 17h6"/></svg></span>';
function page({ path, title, desc, eyebrow, h1, crumbs, body, jsonld = [], updated = TODAY, depth }) {
  const rel = '../'.repeat(depth);
  const url = BASE + path;
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: BASE + c.path })) };
  const ld = [crumbLd, ...jsonld].map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(NAME)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:image" content="${BASE}assets/icons/icon-512.png">
<meta property="article:modified_time" content="${updated}">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="${rel}assets/page.css">
<link rel="icon" href="${rel}assets/icons/icon-192.png">
${ld}
</head>
<body>
<div class="page">
  <header class="top">
    <p class="brand"><a href="${rel}./">${mark}${esc(NAME)}</a></p>
    <nav><a href="${rel}guide/">資格ガイド</a><a href="${rel}about.html">運営者</a><a href="${rel}./">アプリ</a></nav>
  </header>
  <main>
    <p class="crumbs">${crumbs.map((c, i) => i < crumbs.length - 1 ? `<a href="${rel}${c.path}">${esc(c.name)}</a><span>›</span>` : esc(c.name)).join('')}</p>
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1>${esc(h1 || title)}</h1>
    <p class="updated">最終更新：${updated}</p>
${body}
    <div class="cta">
      <p><b>${esc(NAME)}</b>は、試験日から逆算した学習予定・赤シート付きの要点ノート・一問一答・本番形式の模擬試験をひとつにした無料の学習アプリです。Google アカウントですぐ始められます。</p>
      <a class="btn" href="${rel}./">アプリを開く</a>
    </div>
  </main>
  <footer>
    <nav><a href="${rel}guide/">資格ガイド</a><a href="${rel}about.html">運営者</a><a href="${rel}terms.html">利用規約</a><a href="${rel}privacy.html">プライバシーポリシー</a><a href="${rel}tokushoho.html">特定商取引法に基づく表記</a></nav>
    <p>各検定試験の名称は各主催団体の商標または登録商標です（「ビジネス会計検定試験」は大阪商工会議所、「銀行業務検定試験」は銀行業務検定協会）。本サイトは各団体とは関係のない独自の学習教材で、公式テキスト・公式問題集の本文は転載していません。日程・受験料は必ず各主催団体の公式サイトでご確認ください。</p>
  </footer>
</div>
</body>
</html>
`;
}
function faqHtml(items) { return `<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</div>`; }
function faqLd(items) { return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })) }; }
const article = (headline, desc, path, updated) => ({ '@context': 'https://schema.org', '@type': 'Article', headline, description: desc, dateModified: updated, datePublished: '2026-09-07', inLanguage: 'ja', mainEntityOfPage: BASE + path, author: { '@type': 'Organization', name: NAME, url: BASE }, publisher: { '@type': 'Organization', name: NAME, url: BASE } });

const out = [];
function write(path, html) { const dir = path.split('/').slice(0, -1).join('/'); if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(path, html); out.push(path); }

/* ---------- ビジネス会計検定：日程・締切・受験料 ---------- */
const upcoming = EXAMS.filter(e => e.date >= TODAY && e.levels && (e.levels.bk3 || e.levels.bk2 || e.levels.bk1));
const next = upcoming[0];
const levelName = { bk3: '3級', bk2: '2級', bk1: '1級' };
const fee1 = 11550; // 1級（公式サイト 2026-09-05 取得）
function roundTable(e) {
  const lv = Object.keys(e.levels).filter(k => e.levels[k]).map(k => levelName[k]).join('・');
  return `<div class="tw"><table>
<tbody>
<tr><th scope="row">試験日</th><td><b>${jpY(e.date)}</b></td></tr>
<tr><th scope="row">実施する級</th><td>${lv}</td></tr>
<tr><th scope="row">申込期間（一般）</th><td>${e.applyFrom ? jpY(e.applyFrom) + ' 〜 ' : ''}コンビニ店頭決済 <b>${jp(e.apply.conv)}</b> まで／クレジットカード決済 <b>${jp(e.apply.card)}</b> まで</td></tr>
<tr><th scope="row">受験票の発送</th><td>${jp(e.ticket)}${e.ticketAsk ? `（届かない場合の問合せ：${jp(e.ticketAsk[0])}・${jp(e.ticketAsk[1])}）` : ''}</td></tr>
<tr><th scope="row">成績照会・合格発表</th><td>${jp(e.result)}${e.cert ? `／合格証書の発送 ${jp(e.cert)}` : ''}</td></tr>
</tbody></table></div>`;
}
const eventsLd = upcoming.flatMap(e => Object.keys(e.levels).filter(k => e.levels[k]).map(k => {
  const lv = LEVELS[k]; const start = lv && lv.gather ? `${e.date}T${lv.gather}:00+09:00` : e.date;
  return { '@context': 'https://schema.org', '@type': 'Event', name: `第${e.round}回 ビジネス会計検定試験 ${levelName[k]}`, startDate: start, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', location: { '@type': 'Place', name: '全国17都市の会場（札幌・仙台・さいたま・東京・横浜・新潟・金沢・静岡・名古屋・京都・大阪・神戸・岡山・広島・山口・松山・福岡）', address: { '@type': 'PostalAddress', addressCountry: 'JP' } }, organizer: { '@type': 'Organization', name: '大阪商工会議所', url: OFFICIAL }, offers: { '@type': 'Offer', price: lv ? lv.fee : fee1, priceCurrency: 'JPY', url: OFFICIAL, availability: 'https://schema.org/InStock', validThrough: e.apply.card }, description: `申込締切：コンビニ払い ${e.apply.conv}、クレジットカード払い ${e.apply.card}。` };
}));
const schedFaq = [
  [`第${next.round}回ビジネス会計検定の申込締切はいつですか？`, `コンビニ店頭決済は${jpY(next.apply.conv)}、クレジットカード決済は${jpY(next.apply.card)}が締切です。締切後の申込や取消、返金はできません。`],
  ['受験料はいくらですか？', `3級 ${yen(LEVELS.bk3.fee)}、2級 ${yen(LEVELS.bk2.fee)}、1級 ${yen(fee1)}（いずれも税込）です。2級と3級、1級と2級は併願できます。`],
  ['試験は何時から始まりますか？', `3級は${LEVELS.bk3.gather}集合、2級は${LEVELS.bk2.gather}集合で、集合後に約30分の説明があり、試験時間は2時間です。2級が午前、3級が午後なので併願できます。`],
  ['受験票が届かないときは？', `受験票は試験の約3週間前に発送されます。届かない場合は、公式サイトが案内する問合せ期間（第${next.round}回は${next.ticketAsk ? jp(next.ticketAsk[0]) + '・' + jp(next.ticketAsk[1]) : '受験票発送後の指定日'}）に検定試験センターへ連絡します。`],
  ['当日の持ち物は？', '受験票、顔写真付きの身分証明書（原本。スマートフォンの電子証明書は不可）、HB または B の黒鉛筆かシャープペン、消しゴム、電卓またはそろばん（四則演算機能のみのもの。日数・時間計算、換算、税計算、無音の検算機能は可）。腕時計は任意で通信機能のないもの。']
];
{
  const path = 'guide/business-accounting/schedule.html';
  const title = `ビジネス会計検定 第${next.round}回の日程・申込締切・受験料${upcoming[1] ? `（第${upcoming[1].round}回も）` : ''}`;
  const desc = `ビジネス会計検定試験の次回日程は${jpY(next.date)}。申込締切はコンビニ払い${jp(next.apply.conv)}、クレジットカード払い${jp(next.apply.card)}。受験料は3級${yen(LEVELS.bk3.fee)}・2級${yen(LEVELS.bk2.fee)}。受験票の発送日、合格発表日、持ち物までまとめました。`;
  const body = `
    <p class="answer"><b>次回は第${next.round}回、${jpY(next.date)}。</b>申込はコンビニ払いが${jp(next.apply.conv)}、クレジットカード払いが${jp(next.apply.card)}まで。受験料は3級 ${yen(LEVELS.bk3.fee)}、2級 ${yen(LEVELS.bk2.fee)}。<span class="count" id="cd"></span></p>
    <p class="src">出典：大阪商工会議所「ビジネス会計検定試験」受験要項（${TODAY} 時点）。日程は変更されることがあるので、申込前に<a href="${OFFICIAL}" target="_blank" rel="noopener">公式サイト</a>で確認してください。</p>
${upcoming.map(e => `    <h2>第${e.round}回（${jpY(e.date)}）</h2>\n${roundTable(e)}`).join('\n')}
    <h2>受験料・集合時刻・試験時間</h2>
    <div class="tw"><table>
<thead><tr><th>級</th><th>受験料（税込）</th><th>集合</th><th>試験時間</th></tr></thead>
<tbody>
<tr><th scope="row">3級</th><td class="n">${yen(LEVELS.bk3.fee)}</td><td>${LEVELS.bk3.gather}</td><td>${LEVELS.bk3.minutes / 60}時間</td></tr>
<tr><th scope="row">2級</th><td class="n">${yen(LEVELS.bk2.fee)}</td><td>${LEVELS.bk2.gather}</td><td>${LEVELS.bk2.minutes / 60}時間</td></tr>
<tr><th scope="row">1級</th><td class="n">${yen(fee1)}</td><td>13:30</td><td>2時間30分</td></tr>
</tbody></table></div>
    <p>集合後に約30分の説明があります。2級は午前、3級・1級は午後なので、2級と3級、1級と2級の併願ができます。受験料の払込後は取消・変更・返金・次回への振替はできません。</p>
    <h2>受験地</h2>
    <p>札幌、仙台、さいたま、東京、横浜、新潟、金沢、静岡、名古屋、京都、大阪、神戸、岡山、広島、山口、松山、福岡の17都市。会場は受験票で通知されます。</p>
    <h2>申込から当日までの流れ</h2>
    <ol>
      <li>公式サイトの「受験申込」から申し込む（コンビニ店頭決済かクレジットカード決済）。</li>
      <li>試験の約3週間前に受験票が届く。届かなければ指定日に検定試験センターへ問い合わせる。</li>
      <li>当日は集合時刻の前に会場へ。持ち物は受験票・身分証明書・筆記用具・電卓。</li>
      <li>約1か月後に WEB で成績を照会。合格証書は郵送。</li>
    </ol>
    <h2>よくある質問</h2>
${faqHtml(schedFaq)}
    <script>(function(){var d=new Date('${next.apply.card}T23:59:59+09:00'),n=new Date(),el=document.getElementById('cd');if(!el)return;var days=Math.ceil((d-n)/864e5);if(days>=0)el.innerHTML='クレジットカード払いの締切まであと<b>'+days+'</b>日';else{var t=new Date('${next.date}T00:00:00+09:00');var x=Math.ceil((t-n)/864e5);if(x>=0)el.innerHTML='試験日まであと<b>'+x+'</b>日';}})();</script>`;
  const crumbs = [{ name: NAME, path: '' }, { name: '資格ガイド', path: 'guide/' }, { name: 'ビジネス会計検定', path: 'guide/business-accounting/' }, { name: '日程・申込締切・受験料', path }];
  write(path, page({ path, title, desc, eyebrow: 'ビジネス会計検定試験', crumbs, body, depth: 2, jsonld: [article(title, desc, path, TODAY), faqLd(schedFaq), ...eventsLd] }));
}

/* ---------- ビジネス会計検定：合格率 ---------- */
{
  const path = 'guide/business-accounting/pass-rate.html';
  const rounds = [...new Set([...PASS.bk3, ...PASS.bk2].map(r => r[0]))].sort((a, b) => b - a);
  const find = (lv, r) => { const x = (PASS[lv] || []).find(p => p[0] === r); return x ? x[1] : null; };
  const avg = lv => { const v = PASS[lv].map(x => x[1]); return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); };
  const roundDate = { 38: '2026年3月', 37: '2025年10月', 36: '2025年3月', 35: '2024年10月', 34: '2024年3月', 33: '2023年10月' };
  const title = 'ビジネス会計検定の合格率（3級・2級）の推移と難易度';
  const desc = `ビジネス会計検定の合格率は直近6回の平均で3級 ${avg('bk3')}%、2級 ${avg('bk2')}%（第38回は3級 ${find('bk3', 38)}%・2級 ${find('bk2', 38)}%・1級 25.6%）。回ごとの推移と、合格点70点に対する勉強時間の目安をまとめました。`;
  const faq = [
    ['ビジネス会計検定3級の合格率は？', `直近6回（第33〜38回）の平均は${avg('bk3')}%です。回によって${Math.min(...PASS.bk3.map(x => x[1]))}%から${Math.max(...PASS.bk3.map(x => x[1]))}%まで幅があります。`],
    ['ビジネス会計検定2級の合格率は？', `直近6回の平均は${avg('bk2')}%で、3級より20ポイント前後低くなります。第38回（2026年3月）は${find('bk2', 38)}%でした。`],
    ['合格点は何点ですか？', '各級とも100点満点で70点以上が合格です。マークシート方式で、相対評価ではありません。'],
    ['どのくらい勉強すれば受かりますか？', '個人差がありますが、公式テキストを一通り読んで問題を回す前提で、3級は30〜50時間、2級は100時間前後が目安とされることが多いです。2級は連結財務諸表と財務分析の計算が中心で、電卓に慣れる時間が必要です。']
  ];
  const body = `
    <p class="answer"><b>3級は6割前後、2級は4割台。</b>直近6回の平均は3級 ${avg('bk3')}%、2級 ${avg('bk2')}%。合格点は各級とも100点満点中70点で、相対評価ではないので周りの出来に左右されません。</p>
    <p class="src">出典：大阪商工会議所「試験結果・受験者データ」（${TODAY} 時点）。</p>
    <h2>回ごとの合格率</h2>
    <div class="tw"><table>
<thead><tr><th>回</th><th>実施</th><th>3級</th><th>2級</th></tr></thead>
<tbody>
${rounds.map(r => `<tr><th scope="row">第${r}回</th><td>${roundDate[r] || ''}</td><td class="n">${find('bk3', r) ?? '—'}%</td><td class="n">${find('bk2', r) ?? '—'}%</td></tr>`).join('\n')}
<tr><th scope="row">平均</th><td></td><td class="n"><b>${avg('bk3')}%</b></td><td class="n"><b>${avg('bk2')}%</b></td></tr>
</tbody></table></div>
    <p>1級は第38回（2026年3月）が25.6%でした（1級は年1回、3月のみ実施）。</p>
    <h2>読み方</h2>
    <p>3級は回によって50%台から70%台まで動きます。難易度の振れというより、財務諸表分析の計算問題（総合問題）の出来に左右されやすい試験です。用語を覚えただけでは総合問題で失点し、そこで合否が分かれます。</p>
    <p>2級は連結財務諸表の資料から空欄を推定し、指標を計算する総合問題が配点の半分以上を占めます。合格率が4割台で安定しているのは、この総合問題を時間内に解き切れるかどうかが毎回の分かれ目になっているためです。</p>
    <h2>合格に必要な勉強量の目安</h2>
    <div class="tw"><table>
<thead><tr><th>級</th><th>時間の目安</th><th>中心になる勉強</th></tr></thead>
<tbody>
<tr><th scope="row">3級</th><td>30〜50時間</td><td>財務諸表の科目の置き場所、5つの利益、安全性・収益性の指標を「式で言える」まで。</td></tr>
<tr><th scope="row">2級</th><td>100時間前後</td><td>連結・包括利益・注記の知識に加え、資料問題を電卓で時間内に解く練習。</td></tr>
</tbody></table></div>
    <p class="src">時間の目安は一般に言われる水準で、公式の数字ではありません。</p>
    <h2>よくある質問</h2>
${faqHtml(faq)}`;
  const crumbs = [{ name: NAME, path: '' }, { name: '資格ガイド', path: 'guide/' }, { name: 'ビジネス会計検定', path: 'guide/business-accounting/' }, { name: '合格率と難易度', path }];
  write(path, page({ path, title, desc, eyebrow: 'ビジネス会計検定試験', crumbs, body, depth: 2, jsonld: [article(title, desc, path, TODAY), faqLd(faq)] }));
}

/* ---------- ビジネス会計検定：試験の概要 ---------- */
{
  const path = 'guide/business-accounting/index.html';
  const title = 'ビジネス会計検定とは？3級と2級の違い・出題形式・勉強時間';
  const desc = 'ビジネス会計検定試験は大阪商工会議所が主催する、財務諸表を「読む」力の検定。3級は個別財務諸表の読み方と分析の基礎、2級は連結財務諸表・包括利益・注記と応用的な分析。出題形式、合格点、受験料、勉強時間の目安、次回日程を1ページで。';
  const faq = [
    ['簿記との違いは？', '簿記は財務諸表を「作る」技術、ビジネス会計検定は出来上がった財務諸表を「読んで分析する」力を問います。仕訳は出ません。経理以外の営業・企画・管理職や、投資や与信で決算書を読む人向けの試験です。'],
    ['3級と2級のどちらから受けるべき？', '会計にほとんど触れていないなら3級から。簿記3級程度の知識があるか、決算書を読む機会があるなら2級から受ける人も多いです。2級と3級は同じ日に併願できます。'],
    ['試験は年に何回ありますか？', '3級・2級は年2回（3月と10月）、1級は年1回（3月）です。'],
    ['公式テキスト以外に何が必要ですか？', '公式テキストと公式過去問題集が中心です。3級は公式テキスト第5版、2級は第6版が最新（2026年時点）。本サイトのアプリは、公式テキストの章立てに沿った要点ノートと一問一答、本番形式の模擬試験で、これらの補助として使えます。']
  ];
  const body = `
    <p class="answer"><b>財務諸表を「読む」力の検定です。</b>大阪商工会議所が主催し、3級・2級は年2回（3月・10月）、1級は年1回（3月）。マークシート方式で、100点満点中70点以上が合格。次回は第${next.round}回、${jpY(next.date)}です。</p>
    <h2>3級と2級の違い</h2>
    <div class="tw"><table>
<thead><tr><th></th><th>3級</th><th>2級</th></tr></thead>
<tbody>
<tr><th scope="row">対象</th><td>財務諸表を初めて読む人。個別財務諸表が中心</td><td>連結財務諸表を読み、分析に使える人</td></tr>
<tr><th scope="row">主な範囲</th><td>財務諸表の体系、貸借対照表・損益計算書・キャッシュ・フロー計算書の読み方、安全性・収益性・成長性・1株当たり分析の基礎</td><td>企業会計の制度、連結財務諸表、包括利益、株主資本等変動計算書、附属明細表と注記、財務諸表分析（回転期間・セグメント・損益分岐点・株価指標など）</td></tr>
<tr><th scope="row">出題形式</th><td>正誤判定・個別問題・総合問題（資料から計算）</td><td>同左。総合問題は連結の資料から空欄推定と指標計算</td></tr>
<tr><th scope="row">試験時間</th><td>2時間（${LEVELS.bk3.gather}集合）</td><td>2時間（${LEVELS.bk2.gather}集合）</td></tr>
<tr><th scope="row">受験料</th><td class="n">${yen(LEVELS.bk3.fee)}</td><td class="n">${yen(LEVELS.bk2.fee)}</td></tr>
<tr><th scope="row">合格率（直近6回平均）</th><td class="n">${(PASS.bk3.reduce((a, b) => a + b[1], 0) / PASS.bk3.length).toFixed(1)}%</td><td class="n">${(PASS.bk2.reduce((a, b) => a + b[1], 0) / PASS.bk2.length).toFixed(1)}%</td></tr>
<tr><th scope="row">勉強時間の目安</th><td>30〜50時間</td><td>100時間前後</td></tr>
</tbody></table></div>
    <h2>出題形式と合格点</h2>
    <p>各級とも100点満点、70点以上で合格。マークシートの択一式で、大問は「正誤判定」「個別問題（知識と計算）」「総合問題（財務諸表の資料から空欄を推定し、指標を計算して読み取る）」の3つに分かれます。総合問題が配点の大半を占めるので、指標の式を覚えるだけでなく、電卓で時間内に解く練習が要ります。</p>
    <h2>次回の日程</h2>
${roundTable(next)}
    <p><a href="schedule.html">申込締切・受験票・合格発表を含む日程の詳細 ›</a>　<a href="pass-rate.html">回ごとの合格率 ›</a></p>
    <h2>勉強の進め方</h2>
    <ol>
      <li><b>公式テキストを章ごとに読む。</b>3級は5章、2級は9章。用語と計算式は赤シートで隠して言えるまで。</li>
      <li><b>一問一答で置き場所と式を固める。</b>「減損損失は特別損失」「当座比率の分子は当座資産」のような、選択肢で入れ替えられる論点を潰す。</li>
      <li><b>総合問題を時間を計って解く。</b>公式過去問題集の総合問題と、本番形式の模擬試験。2級は連結の資料を80分で解き切る練習。</li>
      <li><b>試験日から逆算した予定を立てる。</b>申込締切、受験票、当日の持ち物まで含めて、やることを日ごとに決める。</li>
    </ol>
    <h2>よくある質問</h2>
${faqHtml(faq)}`;
  const crumbs = [{ name: NAME, path: '' }, { name: '資格ガイド', path: 'guide/' }, { name: 'ビジネス会計検定', path }];
  write(path, page({ path, title, desc, eyebrow: 'ビジネス会計検定試験', crumbs, body, depth: 2, jsonld: [article(title, desc, path, TODAY), faqLd(faq)] }));
}

/* ---------- 銀行業務検定 財務3級：概要と日程 ---------- */
const ZM = EXAMS.filter(e => e.levels && e.levels.zm3);
const zmNext = ZM.find(e => e.date >= TODAY);
const CBT = ctx.window.CBT && ctx.window.CBT.zm3;
const KHK = 'https://www.khk.co.jp/exam/';
{
  const path = 'guide/ginko-zaimu3/index.html';
  const title = '銀行業務検定 財務3級とは？出題形式・合格率・CBTと会場の違い・勉強時間';
  const desc = `銀行業務検定試験 財務3級は五答択一50問（財務諸表30問・財務分析20問）、120分、60点以上で合格。受験料5,500円。会場試験は年2回（7月・12月）、CBTはテストセンターで通年。${zmNext ? `次回の会場試験は${jpY(zmNext.date)}。` : ''}出題範囲・合格率・勉強時間の目安を1ページで。`;
  const faq = [
    ['財務3級の合格率は？', '主催団体が公表した直近の例では第161回（2025年3月）が27.6%でした。銀行業務検定の中では合格率が低めの種目で、財務分析の計算問題で差がつきます。'],
    ['CBTと会場試験はどちらがよい？', '出題範囲・難易度・受験料（5,500円）は同じです。CBTは全国のテストセンターで通年（4月下旬〜翌3月末）、好きな日に受験でき、結果が終了直後に分かります。会場試験は年2回（7月・12月）で、団体受験や電卓の持込を重視する人向けです。CBTでは電卓を持ち込めず、画面上の電卓を使います。'],
    ['どのくらい勉強すれば受かりますか？', '財務の知識がない状態からなら50時間程度、簿記3級やビジネス会計検定の知識があれば20〜30時間が目安です。公式の問題解説集を2周し、財務分析の計算式を式で言えるようにするのが近道です。'],
    ['公式テキスト以外に何が必要？', '経済法令研究会の「公式テキスト 財務3級」（2,750円）と「財務3級 問題解説集」（2,970円）が中心です。本サイトの財務3級コースは、この2冊の範囲を10章の要点ノートと一問一答、本番形式の模試にしたもので、補助として使えます。']
  ];
  const body = `
    <p class="answer"><b>金融機関の職員向けに、取引先の決算書を読む力を測る検定です。</b>五答択一50問（財務諸表30問・財務分析20問）、120分、100点満点中60点以上で合格。受験料は5,500円。会場試験は年2回（7月・12月）、CBTはテストセンターで通年受験できます。${zmNext ? `次回の会場試験は第${zmNext.round}回、${jpY(zmNext.date)}です。` : ''}</p>
    <p class="src">出典：銀行業務検定協会・経済法令研究会・CBT-Solutions の各公式ページ（${TODAY} 時点）。</p>
    <h2>出題形式</h2>
    <div class="tw"><table><tbody>
<tr><th scope="row">形式</th><td>五答択一式 50問（各2点）。マークシート（会場）またはコンピュータ（CBT）</td></tr>
<tr><th scope="row">科目構成</th><td>(1) 財務諸表 30問　(2) 財務分析 20問</td></tr>
<tr><th scope="row">試験時間</th><td>120分（会場は開始後60分・終了前10分の退席不可）</td></tr>
<tr><th scope="row">合格基準</th><td>100点満点中60点以上（試験委員会で最終決定）</td></tr>
<tr><th scope="row">受験料</th><td class="n">5,500円（税込）。会場・CBT 共通</td></tr>
<tr><th scope="row">電卓</th><td>会場は持込可（金融計算・関数・メモ機能付きは不可）。CBT は持込不可で、画面上の電卓を使う</td></tr>
</tbody></table></div>
    <h2>出題範囲</h2>
    <div class="tw"><table>
<thead><tr><th>編</th><th>主な項目（公式テキストの目次より）</th></tr></thead>
<tbody>
<tr><th scope="row">第1編 財務諸表（30問）</th><td>計算書類、企業会計原則、貸借対照表、流動・固定の分類基準、流動性配列法、受取手形、有価証券、棚卸資産、有形固定資産、減価償却 ほか（負債・純資産、損益計算書、キャッシュ・フロー計算書、連結）</td></tr>
<tr><th scope="row">第2編 財務分析（20問）</th><td>総資本経常利益率、売上高経常利益率、総資本回転率、売上債権回転率・回転期間、棚卸資産回転率・回転期間、損益分岐点分析、損益分岐点売上高、目標売上高、損益分岐点比率と安全余裕率、売上総利益の増減分析 ほか（安全性、生産性、資金運用表）</td></tr>
</tbody></table></div>
    <h2>会場試験と CBT の違い</h2>
    <div class="tw"><table>
<thead><tr><th></th><th>全国一斉公開試験（会場）</th><th>CBT（テストセンター）</th></tr></thead>
<tbody>
<tr><th scope="row">実施</th><td>年2回（7月・12月）。13:30〜15:30</td><td>${CBT ? `${jpY(CBT.from)}〜${jpY(CBT.to)}の好きな日` : '通年'}</td></tr>
<tr><th scope="row">申込</th><td>${zmNext ? `第${zmNext.round}回は${jpY(zmNext.applyFrom)}〜${jpY(zmNext.apply.until)}` : '試験の約2か月前に受付'}（経済法令研究会）</td><td>${CBT ? `${jpY(CBT.applyFrom)}〜${jpY(CBT.applyTo)}` : '通年'}。申込日の3日目以降を予約（CBT-Solutions）</td></tr>
<tr><th scope="row">受験票</th><td>郵送</td><td>なし（予約確認メールとマイページ）</td></tr>
<tr><th scope="row">持ち物</th><td>受験票、鉛筆・シャープペン、消しゴム、電卓</td><td>本人確認書類のみ</td></tr>
<tr><th scope="row">結果</th><td>約3日後に正解発表、約1か月後に成績通知</td><td>終了直後に画面表示</td></tr>
</tbody></table></div>
    <h2>合格率</h2>
    <p>主催団体が公表した直近の例では、第161回（2025年3月）の合格率は27.6%でした。銀行業務検定の3級種目の中では低めで、財務分析（計算）で点を落とす人が多い試験です。回ごとの合格率は協会の「事務局報」に掲載されます。</p>
    <h2>勉強の進め方</h2>
    <ol>
      <li><b>受験方式と受験日を先に決める。</b>CBT なら自分で日を決められるので、逆算した予定が立てやすい。</li>
      <li><b>財務諸表（30問）は置き場所と原則・例外。</b>流動・固定の分類、有価証券の4分類、引当金の要件、利益の5区分を一問一答で固める。</li>
      <li><b>財務分析（20問）は式を体に入れる。</b>総資本経常利益率の分解、回転期間、損益分岐点、資金運用表を電卓で解く。</li>
      <li><b>問題解説集を時間を計って2周。</b>本番形式の模試で60点を安定して超えたら受験する。</li>
    </ol>
    <h2>よくある質問</h2>
${faqHtml(faq)}`;
  const crumbs = [{ name: NAME, path: '' }, { name: '資格ガイド', path: 'guide/' }, { name: '銀行業務検定 財務3級', path }];
  const events = ZM.filter(e => e.date >= TODAY).map(e => ({ '@context': 'https://schema.org', '@type': 'Event', name: `第${e.round}回 銀行業務検定試験 財務3級`, startDate: `${e.date}T13:30:00+09:00`, endDate: `${e.date}T15:30:00+09:00`, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', location: { '@type': 'Place', name: '全国の試験会場', address: { '@type': 'PostalAddress', addressCountry: 'JP' } }, organizer: { '@type': 'Organization', name: '銀行業務検定協会', url: 'https://www.kenteishiken.gr.jp/' }, offers: { '@type': 'Offer', price: LEVELS.zm3.fee, priceCurrency: 'JPY', url: KHK, availability: 'https://schema.org/InStock', validFrom: e.applyFrom, validThrough: e.apply.until }, description: `申込受付 ${e.applyFrom}〜${e.apply.until}。五答択一50問・120分・60点以上で合格。` }));
  write(path, page({ path, title, desc, eyebrow: '銀行業務検定試験', crumbs, body, depth: 2, jsonld: [article(title, desc, path, TODAY), faqLd(faq), ...events] }));
}

/* ---------- ガイドの入口 ---------- */
{
  const path = 'guide/index.html';
  const title = '資格ガイド';
  const desc = '会社で受けることになる検定試験の日程・申込締切・受験料・合格率・出題形式を、公式情報に基づいて試験ごとにまとめています。';
  const body = `
    <p class="lead">学校に通うほどではないが、会社で受けることになる検定試験。その日程・締切・受験料・合格率・出題形式を、公式サイトの情報に基づいて試験ごとにまとめています。</p>
    <h2>ビジネス会計検定試験</h2>
    <ul class="list">
      <li><b>試験の概要</b><span>3級と2級の違い、出題形式、合格点、勉強時間の目安</span><a class="go" href="business-accounting/">読む ›</a></li>
      <li><b>日程・申込締切・受験料</b><span>第${next.round}回${upcoming[1] ? `・第${upcoming[1].round}回` : ''}の申込期間、受験票、合格発表、持ち物</span><a class="go" href="business-accounting/schedule.html">読む ›</a></li>
      <li><b>合格率と難易度</b><span>回ごとの合格率の推移と、合格に必要な勉強量</span><a class="go" href="business-accounting/pass-rate.html">読む ›</a></li>
    </ul>
    <h2>銀行業務検定試験</h2>
    <ul class="list">
      <li><b>財務3級の概要・日程・合格率</b><span>出題形式、CBTと会場の違い、${zmNext ? `第${zmNext.round}回（${jp(zmNext.date)}）の申込期間` : '次回日程'}、勉強時間の目安</span><a class="go" href="ginko-zaimu3/">読む ›</a></li>
    </ul>
    <p class="src">同じように「会社で受ける」検定を順に足していきます。</p>`;
  const crumbs = [{ name: NAME, path: '' }, { name: '資格ガイド', path }];
  write(path, page({ path, title, desc, eyebrow: 'Guide', crumbs, body, depth: 1, jsonld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: BASE + path, inLanguage: 'ja' }] }));
}

/* ---------- 運営者 ---------- */
{
  const path = 'about.html';
  const title = '運営者情報';
  const desc = `${NAME}の運営者、教材の作り方と根拠、更新の方針、お問い合わせ先。`;
  const body = `
    <p class="lead">${esc(NAME)}は、公式テキストと直近の出題に照らして作った要点ノート・一問一答・模擬試験と、試験日から逆算した学習予定を提供する学習アプリです。個人が運営しています。</p>
    <h2>運営者</h2>
    <div class="tw"><table><tbody>
<tr><th scope="row">運営者</th><td><span class="ph">【運営者名（屋号）】</span></td></tr>
<tr><th scope="row">所在地</th><td>請求があれば遅滞なく開示します。</td></tr>
<tr><th scope="row">お問い合わせ</th><td>${SITE.contactEmail ? `<a href="mailto:${esc(SITE.contactEmail)}">${esc(SITE.contactEmail)}</a>` : '<span class="ph">【メールアドレス】</span>'}</td></tr>
</tbody></table></div>
    <h2>教材の作り方と根拠</h2>
    <ul>
      <li>要点ノートは、公式テキストの章・節の見出しに沿って論点を網羅するように作っています。公式テキスト・公式過去問題集の本文は転載していません。</li>
      <li>試験のたびに、公表される解答と解説を読み、初めて出た論点をノートと問題に足しています。公式テキストの改版と正誤表も確認しています。</li>
      <li>日程・受験料・合格率は主催団体の公式サイトから取得し、取得日をページに記載しています。</li>
      <li>数値例は独自に作成したもので、実在の企業の数値ではありません。</li>
    </ul>
    <h2>本サービスの位置づけ</h2>
    <p>各検定試験の主催団体とは関係のない、独自の学習教材です。「ビジネス会計検定試験」は大阪商工会議所の登録商標です。合格を保証するものではなく、学習の補助としてお使いください。</p>
    <h2>個人情報とデータ</h2>
    <p>Google アカウントでログインすると、メールアドレス・表示名・プロフィール画像と学習の進捗を保存します。詳しくは<a href="privacy.html">プライバシーポリシー</a>をご覧ください。アカウントはアプリ内からいつでも削除できます。</p>`;
  const crumbs = [{ name: NAME, path: '' }, { name: '運営者情報', path }];
  write(path, page({ path, title, desc, eyebrow: 'About', crumbs, body, depth: 0, jsonld: [{ '@context': 'https://schema.org', '@type': 'AboutPage', name: title, url: BASE + path, inLanguage: 'ja', about: { '@type': 'Organization', name: NAME, url: BASE } }] }));
}

/* ---------- sitemap / llms.txt ---------- */
{
  const pages = ['', 'about.html', 'guide/index.html', 'guide/business-accounting/index.html', 'guide/business-accounting/schedule.html', 'guide/business-accounting/pass-rate.html', 'guide/ginko-zaimu3/index.html', 'terms.html', 'privacy.html', 'tokushoho.html'];
  const norm = p => p.replace(/index\.html$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `  <url><loc>${BASE + norm(p)}</loc><lastmod>${out.includes(p) ? TODAY : lastmod(p || 'index.html')}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  writeFileSync('sitemap.xml', xml);
  writeFileSync('llms.txt', `# ${NAME}

> 会社で受けることになる検定試験（ビジネス会計検定、銀行業務検定 財務3級）の学習アプリと、日程・締切・受験料・合格率の公開ガイド。主催団体とは関係のない独自教材。

## 公開ガイド（日付・数値は主催団体の公式サイトから取得。取得日を各ページに記載）

- [ビジネス会計検定とは・3級と2級の違い](${BASE}guide/business-accounting/)
- [第${next.round}回の日程・申込締切・受験料](${BASE}guide/business-accounting/schedule.html)
- [合格率の推移と難易度](${BASE}guide/business-accounting/pass-rate.html)
- [銀行業務検定 財務3級の概要・日程・合格率](${BASE}guide/ginko-zaimu3/)
- [運営者情報](${BASE}about.html)

## アプリ

- [${NAME}（要 Google ログイン）](${BASE})
`);
}
console.log('wrote', out.length, 'pages + sitemap.xml + llms.txt');
