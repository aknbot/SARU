// ===== サイト設定（ここだけ書き換える） =====
window.SITE = {
  name: '検定ノート',               // サイト名（ヘッダーとタブに表示）
  version: '2.4.1',                 // 更新時に上げる（キャッシュ更新に使う。npm run stamp で index.html / sw.js に反映）
  requireLogin: true,               // true: ログインしないと使えない / false: ログインなしでも使える（端末内保存）
  allowGuest: false,                // true: トップに「ログインせずに始める」を出す（端末内保存。あとでログインすると引き継ぐ）。requireLogin が true のときだけ意味を持つ
  analyticsToken: '',               // Cloudflare Web Analytics のトークン（空なら読み込まない。Cookie を使わない解析）
  contactEmail: '',                 // お問い合わせ先メール（空なら「お問い合わせ」リンクを表示しない）
  // Supabase のプロジェクト設定 → Project Settings → API Keys からコピー（publishable key / anon key）
  supabaseUrl: 'https://hwcduscfhzlwjknisnbu.supabase.co',
  supabaseAnonKey: 'sb_publishable_SxK31kHQ-_b2F4mQ8Pq6SQ_ZGKSdaPy'
};
