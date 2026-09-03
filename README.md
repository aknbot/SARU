# SARU — 検定ノート

サルでも受かる検定対策。ビジネス会計検定 3級 / 2級の学習サイト（静的サイト、GitHub Pages で公開）。

- 進捗はブラウザの localStorage に保存される（ログイン不要で使える）
- Google でログインすると Supabase に同期され、スマホ・PC 間で進捗を共有できる

## ファイル構成

```
index.html          エンジン本体（HTML / CSS / JS）
config.js           サイト設定（サイト名・Supabase の URL と anon key）← ここだけ書き換える
courses.js          トップページに並ぶコース一覧
courses/<id>/       各コースの中身
  course.js           ステップ構成・テーマ色・試験日
  questions.js        一問一答
  datasets.js         資料問題（任意）
  notes.html          ノート本文
supabase/schema.sql 進捗テーブルと RLS ポリシー
```

## 1. GitHub Pages で公開する

1. GitHub のリポジトリ → **Settings → Pages**
2. **Build and deployment → Source** を `Deploy from a branch` にする
3. **Branch** を `main`、フォルダを `/ (root)` にして Save
4. 数十秒〜数分待つと `https://<ユーザー名>.github.io/SARU/` で開ける

`.nojekyll` を置いてあるので Jekyll の変換は走らず、ファイルがそのまま配信される。
この時点でログイン以外の機能はすべて動く。

## 2. Supabase を設定する（Google ログインで進捗同期）

### 2-1. プロジェクト作成

1. https://supabase.com にサインアップ → **New project**
2. リージョンは `Northeast Asia (Tokyo)` が近い。DB パスワードは控えておく（サイトからは使わない）

### 2-2. テーブル作成

1. ダッシュボード左メニュー **SQL Editor** → New query
2. `supabase/schema.sql` の中身を貼り付けて **Run**

`progress` テーブルと「自分の行しか読み書きできない」RLS ポリシーが作られる。

### 2-3. Google ログインを有効にする

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクトを作成（or 既存を選択）
2. **APIs & Services → OAuth consent screen** を設定（External、アプリ名と連絡先メールだけで OK）
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: `Web application`
   - Authorized JavaScript origins: `https://<ユーザー名>.github.io`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
     （`<project-ref>` は Supabase の Project Settings → General に表示される Reference ID）
4. 発行された **Client ID / Client Secret** をコピー
5. Supabase ダッシュボード → **Authentication → Sign In / Providers → Google** を Enable にして、Client ID と Client Secret を貼り付けて Save

### 2-4. リダイレクト先を許可する

Supabase ダッシュボード → **Authentication → URL Configuration**

- **Site URL**: `https://<ユーザー名>.github.io/SARU/`
- **Redirect URLs** に追加: `https://<ユーザー名>.github.io/SARU/`

ローカルでも試すなら `http://localhost:8000/` なども追加しておく。

### 2-5. config.js に貼り付ける

Supabase ダッシュボード → **Project Settings → API** から

- **Project URL** → `supabaseUrl`
- **anon public** キー → `supabaseAnonKey`

を `config.js` にコピーして commit / push する。

```js
window.SITE = {
  name: '検定ノート',
  supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...'
};
```

anon key は公開して問題ないキー（RLS で守る前提のもの）。**service_role キーは絶対に貼らない**こと。

設定前は「ログイン機能は未設定」と表示され、端末内保存だけで動く。設定後はアカウント欄に「Googleでログイン」ボタンが出る。

## ローカルで確認する

`file://` では courses/ の読み込みが失敗するので、簡易サーバーで開く。

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```

## コースを追加する

1. `courses/<id>/` に `course.js` / `questions.js` / `notes.html`（任意で `datasets.js`）を置く
2. `courses.js` の `COURSE_LIST` に 1 行追加する
