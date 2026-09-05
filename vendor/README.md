# vendor

- `supabase.js` — @supabase/supabase-js **2.115.0** UMD ビルド（MIT License, Supabase Inc.）。
  取得元: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js
  SRI: `sha384-CLZeq1dk8+Uzrs7TVvBUdlFoV5F0DMqgRoeHa8g5wJcuPe5SkVfEvdxB0ZuzlnBQ`

更新するとき:

```sh
curl -o vendor/supabase.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.x.y/dist/umd/supabase.js
openssl dgst -sha384 -binary vendor/supabase.js | openssl base64 -A   # この README の SRI を更新
```

CDN ではなく同一オリジンで配信しているのは、CDN 障害・広告ブロッカー・企業プロキシでログイン機能が落ちないようにするため。
