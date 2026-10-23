/**
 * sw.js — service worker minimum.
 * Hanya untuk keandalan muat & instalasi PWA (jaringan lebih dulu, cadangan
 * cache untuk berkas statis). Data absensi SELALU lewat jaringan;
 * "mode offline" di luar cakupan (bagian 5 PRD).
 */

var CACHE = 'absensi-shell-v16'; // Tahap 16: Esri Street Map + toggle Satellite
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './fonts/plus-jakarta-sans-latin.woff2',
  './fonts/plus-jakarta-sans-latin-ext.woff2',
  './api.js',
  './app.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // API selalu POST: biarkan lewat jaringan
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      var salin = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, salin); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (ada) {
        return ada || caches.match('./index.html');
      });
    })
  );
});