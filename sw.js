/* Service worker: офлайн-оболочка. Запросы к Supabase (другой origin) не кешируются. */
var VERSION = 'gc-v2';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css', 'vendor/supabase.js', 'js/config.js', 'js/util.js', 'js/demo.js', 'js/remote.js', 'js/app.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // stale-while-revalidate для оболочки; навигация — офлайн-фолбэк на index.html
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined); });
    return hit || net;
  }));
});
