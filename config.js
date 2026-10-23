/**
 * config.js — konfigurasi publik aplikasi (bukan rahasia server).
 *
 * KUNCI GOOGLE MAPS
 * -----------------
 * KEPUTUSAN PROYEK: kunci ini SENGAJA dikosongkan. Peta absen memakai peta
 * gratis Leaflet + CARTO Voyager yang tampilannya sudah menyerupai Google
 * Maps, tanpa tagihan dan tanpa kartu. Mengisinya hanya perlu bila suatu saat
 * ingin data peta Google (nama jalan/gang Indonesia lebih lengkap).
 * Isi GOOGLE_MAPS_API_KEY dengan kunci "Maps JavaScript API" milik Anda.
 * Kunci ini memang terlihat oleh browser (semua kunci peta begitu), jadi
 * WAJIB dibatasi di Google Cloud Console:
 *
 *   1. Application restrictions  -> HTTP referrers
 *        https://flourich-store.github.io/*
 *        http://localhost:*\/*
 *        http://127.0.0.1:*\/*
 *      (tambahkan domain lain bila nanti dipasang di domain sendiri)
 *   2. API restrictions          -> hanya "Maps JavaScript API"
 *   3. Quotas                    -> batas harian per API + budget alert
 *
 * Bila kunci dibiarkan kosong, ditolak (referrer/pembatasan salah), atau
 * kuota habis, aplikasi TIDAK berhenti: peta absen otomatis memakai peta
 * cadangan Leaflet + ubin CARTO Voyager yang sudah tersimpan di perangkat.
 *
 * Catatan: berkas ini ikut disajikan GitHub Pages. Jangan pernah menaruh
 * rahasia server (token, service account, private key) di sini.
 */

var GOOGLE_MAPS_API_KEY = '';
