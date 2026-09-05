# SARU — 検定ノート

ビジネス会計検定 3級 / 2級の学習アプリ。静的サイト（GitHub Pages）＋ Supabase（Google ログイン・進捗同期）で動く。

- 要点ノート（赤シート）、一問一答、資料問題、本番形式の模擬試験、試験日から逆算した学習予定
- Google でログインして使う（`config.js` の `requireLogin: true`）。進捗はキー単位でマージ同期され、複数端末で使える
- 試験回（日程・締切・受験料）は `exams.js` のマスタから自動反映。回が変わっても教材は書き換えない
- 「ビジネス会計検定試験」は大阪商工会議所の登録商標。本サービスは同会議所とは無関係の学習教材

## ファイル構成

```
index.html            マークアップ（ランディング / アプリ本体 / ダイアログ）
app.css               スタイル
app.js                エンジン（認証・同期・予定生成・ノート・問題・模試・設定）
config.js             サイト設定（サイト名・version・requireLogin・連絡先・Supabase の URL と key）← ここだけ書き換える
exams.js              試験回マスタ（試験日・申込締切・受験票・合格発表・集合時刻・受験料・合格率）
courses.js            コース一覧
courses/<id>/         各コースの中身
  course.js             ステップ構成（相対日数）・テーマ色・使い方・当日の動き方
  questions.js          一問一答（{d, f, q, c, a, e}）
  datasets.js           資料問題（財務諸表の表 + 設問）
  notes.html            ノート本文
  legacy.js             旧版（問題IDが配列index）からの復習リスト移行表。編集不要
vendor/supabase.js    supabase-js 2.115.0（同一オリジンで配信。CDN 障害の影響を受けない。更新手順は vendor/README.md）
terms.html / privacy.html / tokushoho.html   利用規約・プライバシーポリシー・特定商取引法に基づく表記（assets/page.css）
404.html              GitHub Pages 用
manifest.webmanifest / sw.js / assets/icons/   PWA（ホーム画面追加・オフライン閲覧）
supabase/schema.sql   progress テーブル・RLS・updated_at トリガー・アカウント削除関数
tests/smoke.mjs       Playwright スモークテスト（`npm test`）
scripts/stamp-version.mjs   config.js の version を index.html / sw.js に反映（`npm run stamp`）
.github/workflows/ci.yml    push ごとに構文チェックとスモークテスト
```

## 公開手順（GitHub Pages）

1. リポジトリを public にする（無料プランでは private で Pages を使えない）
2. **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / `/ (root)` → Save
3. `https://<ユーザー名>.github.io/SARU/` で開ける

`.nojekyll` があるので Jekyll は走らない。

## Supabase の設定

### 1. プロジェクトとテーブル

1. https://supabase.com で New project（リージョンは Tokyo）
2. **SQL Editor** に `supabase/schema.sql` を貼って Run
   - `progress` テーブル、本人しか読み書きできない RLS、`updated_at` のサーバー時刻トリガー、`delete_own_account()`（本人のアカウント削除）が作られる
   - 既に旧版のテーブルがある場合も、そのまま再実行してよい（`if not exists` / `drop … if exists` / `create or replace` で何度でも安全）
   - 変更後は SQL Editor で再実行するだけで反映される（`progress_guard` トリガーと `delete_own_account()` もここで作られる）

### 2. Google ログイン

1. Google Cloud Console → Google Auth Platform
   - ブランディング: アプリ名、サポートメール、**承認済みドメイン**に `<project-ref>.supabase.co` と `<ユーザー名>.github.io`
   - ホームページ: `https://<ユーザー名>.github.io/SARU/`
   - **プライバシーポリシー: `https://<ユーザー名>.github.io/SARU/privacy.html`**
   - **利用規約: `https://<ユーザー名>.github.io/SARU/terms.html`**
   - 対象: 外部 → **アプリを公開**（本番）
   - クライアント: ウェブアプリケーション。承認済みリダイレクト URI に Supabase の Callback URL（`https://<project-ref>.supabase.co/auth/v1/callback`）
2. Supabase → Authentication → Sign In / Providers → Google を Enable、Client ID / Secret を貼る
3. Authentication → URL Configuration → Site URL に `https://<ユーザー名>.github.io/SARU/`、Redirect URLs に `https://<ユーザー名>.github.io/SARU/` と `https://<ユーザー名>.github.io/SARU/*`

### 3. config.js

Project Settings → API Keys の **Project URL** と **publishable key**（`sb_publishable_…`。旧 anon key でも可）を `config.js` に入れる。publishable key は公開前提のキー。**secret / service_role キーは絶対に置かない**。

## 更新のしかた

1. 教材やコードを直す
2. `config.js` の `version` を上げて `npm run stamp`（index.html の `?v=` と sw.js のキャッシュ名が更新され、利用者のブラウザに確実に新版が届く）
3. `npm test` でスモークテストを通す（初回は `npm install` で Playwright を入れる）
4. `main` に push

## 教材の書き方

- 問題は `questions.js` の配列に足す。**問題文（`q`）のハッシュが ID になる**ので、途中に挿入・並べ替えをしても復習リストはずれない。問題文を書き換えると別問題扱いになる（復習リストから外れる）
- `f:1` は正誤判定（選択肢の順を固定）。`adv:true` を付けると「発展」バッジが出て模試からは除外される
- 資料問題は `datasets.js` の `__DS`（表）と `__DSQ`（設問、`ds:'A'`）
- ステップは `course.js` の `steps`。`days`（日数）で書く。旧形式の `s`/`e`（絶対日付）も長さだけ使われる。実際の日付は「受験する回」と「開始日」から自動で組む
- 試験回を足すときは `exams.js` に 1 件追加（公式サイトで必ず確認）

## 法務ページの仕上げ

`terms.html` / `privacy.html` / `tokushoho.html` の `<span class="ph">【…】</span>` を事業者情報に置き換える（事業者名・住所・連絡先・管轄裁判所・Supabase のリージョン）。`config.js` の `contactEmail` を入れると「お問い合わせ」リンクが出る。

## 有料化する前に必要なこと（未実装）

- **決済**（Stripe 等）と、権利を持つユーザーだけ教材を読めるようにする仕組み。現状は教材ファイル（`courses/`）が GitHub Pages 上に公開されているため、URL を直接叩けば誰でも取得できる。有料化時は教材を Supabase（RLS 付きテーブル）や署名付き URL に移す
- `tokushoho.html` の価格・支払方法・返金条件を確定する

## 公開 URL を変えるとき

`index.html` の `og:url` / `og:image` / `canonical`、`robots.txt` と `sitemap.xml` の URL は `https://aknbot.github.io/SARU/` を直書きしている。独自ドメインに移すときは置換する。

## ローカルで確認する

```sh
npm run serve      # http://localhost:8000/
npm test           # スモークテスト（要 npm install）
```

`file://` では動かない（fetch と Service Worker のため）。
