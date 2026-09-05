// ===== サイト設定（ここだけ書き換える） =====
window.SITE = {
  name: '検定ノート',               // サイト名（ヘッダーとタブに表示）
  version: '2.1.1',                 // 更新時に上げる（キャッシュ更新に使う。npm run stamp で index.html / sw.js に反映）
  requireLogin: true,               // true: ログインしないと使えない / false: ログインなしでも使える（端末内保存）
  contactEmail: '',                 // お問い合わせ先メール（空なら「お問い合わせ」リンクを表示しない）
  // Supabase のプロジェクト設定 → Project Settings → API Keys からコピー（publishable key / anon key）
  supabaseUrl: 'https://hwcduscfhzlwjknisnbu.supabase.co',
  supabaseAnonKey: 'sb_publishable_SxK31kHQ-_b2F4mQ8Pq6SQ_ZGKSdaPy'
};
