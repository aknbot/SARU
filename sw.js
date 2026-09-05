/* 検定ノート service worker
   方針: HTML / JS / JSON は network-first（更新をすぐ反映）、失敗時のみキャッシュ。
         フォント・アイコン・CDN は cache-first。Supabase API はキャッシュしない。 */
const VERSION = 'kn-2.0.0';
const CORE = ['./', './index.html', './app.css', './app.js', './config.js', './courses.js', './manifest.json', './assets/icons/icon-192.png', './assets/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;            // API はそのまま
  const sameOrigin = url.origin === self.location.origin;
  const isStatic = /\.(png|svg|woff2?|ttf|ico)$/.test(url.pathname) || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net';
  if (isStatic) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })));
    return;
  }
  if (sameOrigin || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
  }
});
