/**
 * app.js — seluruh layar aplikasi absensi (bagian 11 PRD).
 * Desain mobile-first, navigasi tab di bawah, semua teks berbahasa Indonesia.
 *
 * Layar karyawan : Beranda (alur absen 5 langkah), Izin, Riwayat, Profil
 * Layar admin    : Dashboard, Absensi (+koreksi), Persetujuan Izin, Karyawan,
 *                  Lokasi, Izin, Riwayat, Pengaturan (+Libur), Rekap, Log, Profil
 *
 * Aturan tampilan: setiap layar punya pesan loading, error, dan data kosong;
 * tombol kirim dinonaktifkan saat proses berjalan agar tidak terkirim ganda.
 */

'use strict';

/* ================================================================ */
/* TAHAP 0 — Pencatatan waktu (instrumentasi diagnostik sementara).  */
/* Hanya menulis ke console; tidak mengubah perilaku aplikasi.       */
/* ================================================================ */
var __tBoot = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
var __bootSelesai = false;

function __msKini() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** Catat waktu boot -> layar pertama tampil (panggil sekali). */
function __catatBootSelesai() {
  if (__bootSelesai) return;
  __bootSelesai = true;
  // Tahap 1: sembunyikan splash bersamaan dengan layar pertama tampil.
  var splash = $('screen-splash');
  if (splash) splash.hidden = true;
  var ms = Math.round(__msKini() - __tBoot);
  if (typeof console !== 'undefined' && console.timeEnd) {
    try { console.timeEnd('boot'); } catch (e) {}
  }
  if (typeof console !== 'undefined' && console.log) {
    console.log('[perf] boot -> layar pertama: ' + ms + ' ms');
  }
}

/** Catat ukuran berkas aset yang benar-benar dimuat halaman. */
function __catatUkuranAset() {
  if (typeof console === 'undefined' || !console.log) return;
  try {
    var daftar = (performance.getEntriesByType ? performance.getEntriesByType('resource') : []) || [];
    var cari = function (nama) {
      for (var i = 0; i < daftar.length; i++) {
        if (daftar[i].name.indexOf(nama) !== -1) return daftar[i];
      }
      return null;
    };
    var aset = ['app.js', 'api.js', 'styles.css', 'sw.js', 'manifest.json'];
    var total = 0;
    aset.forEach(function (nama) {
      var e = cari(nama);
      if (!e) return;
      var ukuran = e.decodedBodySize || e.encodedBodySize || 0;
      total += ukuran;
      console.log('[perf] aset ' + nama + ': ' + ukuran + ' B (' + Math.round(ukuran / 1024) + ' KB)');
    });
    console.log('[perf] total aset terpantau: ' + total + ' B (' + Math.round(total / 1024) + ' KB)');
  } catch (e) {}
}

/* ================================================================ */
/* State & helper dasar                                              */
/* ================================================================ */

var state = {
  user: null,      // hasil login: {token, role, nama, id_karyawan, wajib_ganti_pin}
  screen: null,
  hariIni: null,   // hasil status_hari_ini
  absen: null      // konteks alur absen
};

var jamTimer = null;
var SCREENS = {};

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var toastTimer = null;
function toast(pesan, jenis) {
  var t = $('toast');
  t.textContent = pesan;
  t.className = 'toast' + (jenis ? ' ' + jenis : '');
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
}

function loadingHTML(pesan) {
  return '<div class="loading-state"><div class="spinner" aria-hidden="true"></div><p>' +
    esc(pesan || 'Memuat…') + '</p></div>';
}
function emptyHTML(ico, pesan) {
  return '<div class="empty-state"><span class="state-ico" aria-hidden="true">' + ico +
    '</span><p>' + esc(pesan) + '</p></div>';
}
function errorHTML(pesan) {
  return '<div class="error-state"><span class="state-ico" aria-hidden="true">⚠️</span><p>' +
    esc(pesan) + '</p><button type="button" class="btn btn-outline btn-sm mt" id="btn-coba-lagi">Coba Lagi</button></div>';
}

/** Pasang handler "Coba Lagi" pada blok error di dalam kontainer. */
function pasangCobaLagi(el, ulang) {
  var b = $('btn-coba-lagi');
  if (b) b.addEventListener('click', ulang);
}

function setBusy(btn, sibuk, teksSibuk) {
  if (!btn) return;
  if (sibuk) {
    if (!btn.dataset.asli) btn.dataset.asli = btn.textContent;
    btn.disabled = true;
    btn.textContent = teksSibuk || 'Memproses…';
  } else {
    btn.disabled = false;
    if (btn.dataset.asli) btn.textContent = btn.dataset.asli;
  }
}

function errPesan(e) { return (e && e.message) || 'Terjadi kesalahan. Coba lagi.'; }
function errKode(e) { return (e && e.code) || 'SERVER_ERROR'; }

/** Tangani sesi habis/akun nonaktif: kembali ke layar login dengan pesan. */
function tanganiErrorSesi(e) {
  var kode = errKode(e);
  if (kode === 'TOKEN_INVALID' || kode === 'AKUN_NONAKTIF') {
    keluarKeLogin(errPesan(e));
    return true;
  }
  return false;
}

function tglIndonesia(d) {
  try {
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return d.toDateString();
  }
}
function jam2(n) { return (n < 10 ? '0' : '') + n; }
function jamSekarang() {
  var d = new Date();
  return jam2(d.getHours()) + ':' + jam2(d.getMinutes()) + ':' + jam2(d.getSeconds());
}
function jamMenitSekarang() {
  var d = new Date();
  return jam2(d.getHours()) + ':' + jam2(d.getMinutes());
}
function bulanIni() {
  var d = new Date();
  return d.getFullYear() + '-' + jam2(d.getMonth() + 1);
}

/* --- Penampilan nilai tanggal/jam dari API ------------------------- */
/* Sel spreadsheet yang terkonversi Date (basis serial 1899) sampai ke
 * sini sebagai ISO "1899-12-30T14:26:48.000Z" — tahun/bulannya ngaco.
 * Fungsi berikut mengembalikannya jadi jam/tanggal lokal yang benar;
 * teks yang sudah benar dilewatkan apa adanya. */
function tampilJam(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  var d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return jam2(d.getHours()) + ':' + jam2(d.getMinutes()) + ':' + jam2(d.getSeconds());
}
function tampilTanggal(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v);
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return s;
  var d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return d.getFullYear() + '-' + jam2(d.getMonth() + 1) + '-' + jam2(d.getDate());
}
function tampilWaktu(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  var d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 19).replace('T', ' ');
  return d.getFullYear() + '-' + jam2(d.getMonth() + 1) + '-' + jam2(d.getDate()) +
    ' ' + jam2(d.getHours()) + ':' + jam2(d.getMinutes()) + ':' + jam2(d.getSeconds());
}
/** Date tengah malam WAKTU LOKAL dari 'yyyy-MM-dd'. new Date('2026-10-20')
 *  diparse sebagai tengah malam UTC sehingga tanggal bisa meleset satu hari
 *  pada zona di barat UTC. Nilai tak terbaca -> hari ini. */
function tanggalLokal(v) {
  var s = tampilTanggal(v);
  var p = /^(\d{4})-(\d{2})-(\d{2})$/.test(s) ? s.split('-') : null;
  if (!p) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function mulaiJam(el) {
  if (jamTimer) clearInterval(jamTimer);
  var kotak = document.getElementById('jam-jalan');
  function detik() {
    if (!document.body.contains(kotak)) { clearInterval(jamTimer); return; }
    kotak.textContent = jamSekarang();
  }
  kotak.textContent = jamSekarang();
  jamTimer = setInterval(detik, 1000);
}

/* ================================================================ */
/* Layar Login                                                       */
/* ================================================================ */

function tampilkanLogin(pesan) {
  $('app').hidden = true;
  $('screen-login').hidden = false;
  $('overlay-absen').hidden = true;
  $('overlay-modal').hidden = true;
  var err = $('login-error');
  if (pesan) { err.textContent = pesan; err.hidden = false; }
  else { err.hidden = true; }
  __catatBootSelesai();   // TAHAP 0
  __catatUkuranAset();    // TAHAP 0
}

function keluarKeLogin(pesan) {
  api('logout', {}).catch(function () {});
  clearToken();
  state.user = null;
  state.hariIni = null;
  if (jamTimer) clearInterval(jamTimer);
  tampilkanLogin(pesan);
}

function kirimLogin(ev) {
  ev.preventDefault();
  var btn = $('btn-login');
  var errEl = $('login-error');
  errEl.hidden = true;
  var username = $('login-username').value.trim();
  var pin = $('login-pin').value.trim();

  if (!username || !pin) {
    errEl.textContent = 'Username dan PIN wajib diisi.';
    errEl.hidden = false;
    return;
  }

  setBusy(btn, true, 'Memeriksa…');
  api('login', { username: username, pin: pin })
    .then(function (data) {
      state.user = data;
      if (data.token) setToken(data.token);
      simpanUser(data);
      $('login-pin').value = '';
      masukAplikasi();
    })
    .catch(function (e) {
      errEl.textContent = errPesan(e);
      errEl.hidden = false;
      $('login-pin').value = '';
      $('login-pin').focus();
    })
    .then(function () { setBusy(btn, false); });
}

/* ================================================================ */
/* Kerangka aplikasi + tab bawah                                    */
/* ================================================================ */

/*
 * Ikon tab = SVG garis (bukan emoji). Emoji dirender font sistem sehingga
 * bentuk & warnanya berbeda-beda per perangkat dan tidak bisa ikut warna
 * tema. SVG di bawah memakai `currentColor`, jadi otomatis jadi indigo saat
 * tab aktif, dan tetap tajam di layar berapa pun DPI-nya.
 */
var IKON = {
  beranda:
    '<path d="M3 9.6 12 3l9 6.6V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>' +
    '<path d="M9.5 22v-7.5h5V22"/>',
  dashboard:
    '<line x1="6" y1="20" x2="6" y2="13"/>' +
    '<line x1="12" y1="20" x2="12" y2="5"/>' +
    '<line x1="18" y1="20" x2="18" y2="9.5"/>',
  absensi:
    '<rect x="3" y="5" width="18" height="17" rx="2.5"/>' +
    '<line x1="8" y1="3" x2="8" y2="7"/>' +
    '<line x1="16" y1="3" x2="16" y2="7"/>' +
    '<line x1="3" y1="10" x2="21" y2="10"/>' +
    '<polyline points="8.6 15 10.8 17.2 15.4 12.6"/>',
  persetujuan:
    '<polyline points="8.5 11.8 11.2 14.5 21.5 4.2"/>' +
    '<path d="M20.5 12.5V19a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 19V5.5A2.5 2.5 0 0 1 5 3h10.5"/>',
  karyawan:
    '<path d="M15.5 21v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21"/>' +
    '<circle cx="8.75" cy="7.4" r="3.9"/>' +
    '<path d="M22 21v-1.8a4 4 0 0 0-3-3.85"/>' +
    '<path d="M15.4 3.7a3.9 3.9 0 0 1 0 7.4"/>',
  lokasi:
    '<path d="M20.5 10.2c0 6.3-8.5 11.8-8.5 11.8S3.5 16.5 3.5 10.2a8.5 8.5 0 0 1 17 0Z"/>' +
    '<circle cx="12" cy="10" r="3"/>',
  izin:
    '<path d="M14 2.6H6.6A2.1 2.1 0 0 0 4.5 4.7v14.6a2.1 2.1 0 0 0 2.1 2.1h10.8a2.1 2.1 0 0 0 2.1-2.1V8.1Z"/>' +
    '<polyline points="13.8 2.6 13.8 8.3 19.5 8.3"/>' +
    '<line x1="8.5" y1="13" x2="15.5" y2="13"/>' +
    '<line x1="8.5" y1="16.8" x2="13.5" y2="16.8"/>',
  riwayat:
    '<circle cx="12" cy="12" r="9"/>' +
    '<polyline points="12 6.6 12 12.4 16.2 14.6"/>',
  // gigi bawaan selebar hampir seluruh kotak; dikecilkan sedikit agar bobot
  // optisnya setara ikon lain
  pengaturan:
    '<g transform="translate(12 12) scale(.93) translate(-12 -12)">' +
    '<circle cx="12" cy="12" r="3.1"/>' +
    '<path d="M19.2 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.94 1.94 0 1 1-3.88 0v-.1a1.6 1.6 0 0 0-1.03-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.94 1.94 0 1 1-2.74-2.74l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a1.94 1.94 0 1 1 0-3.88h.1a1.6 1.6 0 0 0 1.46-1.03 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.94 1.94 0 1 1 2.74-2.74l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a1.94 1.94 0 1 1 3.88 0v.1a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a1.94 1.94 0 1 1 0 3.88h-.1a1.6 1.6 0 0 0-1.46.97Z"/>' +
    '</g>',
  rekap:
    '<rect x="3" y="4.5" width="18" height="15" rx="2.4"/>' +
    '<line x1="3" y1="9.6" x2="21" y2="9.6"/>' +
    '<line x1="9.4" y1="9.6" x2="9.4" y2="19.5"/>' +
    '<line x1="15.2" y1="9.6" x2="15.2" y2="19.5"/>',
  log:
    '<polyline points="21.5 12.5 18 12.5 15.2 20 8.8 4 6 12.5 2.5 12.5"/>',
  profil:
    '<path d="M20 21v-1.8a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"/>' +
    '<circle cx="12" cy="7.3" r="4"/>'
};

/** Bungkus isi ikon jadi <svg> bergaris yang ikut warna teks (currentColor). */
function ikonSvg(nama) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
    (IKON[nama] || IKON.beranda) + '</svg>';
}

var TAB_KARYAWAN = [
  { id: 'beranda', label: 'Beranda', ico: 'beranda' },
  { id: 'izin', label: 'Izin', ico: 'izin' },
  { id: 'riwayat', label: 'Riwayat', ico: 'riwayat' },
  { id: 'profil', label: 'Profil', ico: 'profil' }
];

var TAB_ADMIN = [
  { id: 'beranda', label: 'Beranda', ico: 'beranda' },
  { id: 'dashboard', label: 'Dashboard', ico: 'dashboard' },
  { id: 'absensi', label: 'Absensi', ico: 'absensi' },
  { id: 'persetujuan', label: 'Persetujuan', ico: 'persetujuan' },
  { id: 'karyawan', label: 'Karyawan', ico: 'karyawan' },
  { id: 'lokasi', label: 'Lokasi', ico: 'lokasi' },
  { id: 'izin', label: 'Izin', ico: 'izin' },
  { id: 'riwayat', label: 'Riwayat', ico: 'riwayat' },
  { id: 'pengaturan', label: 'Pengaturan', ico: 'pengaturan' },
  { id: 'rekap', label: 'Rekap', ico: 'rekap' },
  { id: 'log', label: 'Log', ico: 'log' },
  { id: 'profil', label: 'Profil', ico: 'profil' }
];

function tabSekarang() {
  return state.user && state.user.role === 'admin' ? TAB_ADMIN : TAB_KARYAWAN;
}

function gambarTabbar() {
  var aktif = state.screen;
  $('tabbar').innerHTML = tabSekarang().map(function (t) {
    return '<button type="button" class="tab' + (t.id === aktif ? ' is-active' : '') +
      '" data-screen="' + t.id + '" aria-current="' + (t.id === aktif ? 'page' : 'false') + '">' +
      '<span class="tab-ico" aria-hidden="true">' + ikonSvg(t.ico) + '</span>' + esc(t.label) + '</button>';
  }).join('');
  Array.prototype.forEach.call($('tabbar').querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { bukaScreen(b.dataset.screen); });
  });
}

// Layar khusus admin (bagian 3 PRD). Backend tetap penjaga keamanan utama —
// guard ini hanya lapisan tampilan agar menu admin tidak pernah terbuka bagi karyawan.
var LAYAR_ADMIN = {
  dashboard: 1, absensi: 1, persetujuan: 1, karyawan: 1,
  lokasi: 1, pengaturan: 1, rekap: 1, log: 1
};

function bukaScreen(id) {
  var s = SCREENS[id] || SCREENS.beranda;
  id = SCREENS[id] ? id : 'beranda';
  if (LAYAR_ADMIN[id] && !(state.user && state.user.role === 'admin')) {
    toast('Menu ini khusus admin.');
    id = 'beranda';
    s = SCREENS.beranda;
  }
  state.screen = id;
  $('topbar-title').textContent = s.title;
  $('topbar-sub').textContent = state.user ? state.user.nama : '';
  $('role-badge').hidden = !(state.user && state.user.role === 'admin');
  $('role-badge').textContent = 'admin';
  gambarTabbar();
  if (jamTimer) { clearInterval(jamTimer); jamTimer = null; }
  var el = $('content');
  el.innerHTML = loadingHTML();
  el.scrollTop = 0;
  window.scrollTo(0, 0);
  s.render(el);
}

function masukAplikasi() {
  $('screen-login').hidden = true;
  $('app').hidden = false;
  var awal = state.user && state.user.role === 'admin' ? 'beranda' : 'beranda';
  bukaScreen(awal);
  __catatBootSelesai();   // TAHAP 0
  __catatUkuranAset();    // TAHAP 0
}

/* ================================================================ */
/* SCREEN: Beranda (karyawan & admin)                                */
/* ================================================================ */

function statusPill(status) {
  switch (status) {
    case 'belum_absen': return { teks: 'Belum Absen', kelas: 'warn' };
    case 'sudah_masuk': return { teks: 'Sudah Absen Masuk', kelas: 'ok' };
    case 'sudah_pulang': return { teks: 'Sudah Absen Pulang', kelas: 'ok' };
    case 'libur': return { teks: 'Hari Libur', kelas: 'mute' };
    case 'izin': return { teks: 'Izin Disetujui', kelas: 'info' };
    default: return { teks: status, kelas: '' };
  }
}

function berandaHTML(h, user) {
  var pill = statusPill(h.status);
  var tombol = '';
  if (h.jenis_absen_berikut === 'masuk') {
    tombol = '<button type="button" class="btn btn-primary btn-big" id="btn-absen-masuk">' +
      'Absen Masuk<span class="btn-sub">Batas toleransi ' + esc(tampilJam(h.jam_masuk)) + ' + ' +
      esc(h.toleransi_menit) + ' menit</span></button>';
  } else if (h.jenis_absen_berikut === 'pulang') {
    tombol = '<button type="button" class="btn btn-success btn-big" id="btn-absen-pulang">' +
      'Absen Pulang<span class="btn-sub">Jam pulang ' + esc(tampilJam(h.jam_pulang)) + '</span></button>';
  } else {
    var alasanTombol = h.status === 'sudah_pulang' ? 'Absen hari ini sudah selesai'
      : (h.status === 'libur' ? 'Tidak ada absen pada hari ini'
      : (h.status === 'izin' ? 'Anda memiliki izin yang disetujui' : 'Absen tidak tersedia'));
    tombol = '<button type="button" class="btn btn-big" disabled>' + esc(alasanTombol) + '</button>';
  }

  var banner = '';
  if (user && (user.wajib_ganti_pin || (h && h.wajib_ganti_pin))) {
    banner = '<div class="banner">🔑 Anda wajib mengganti PIN setelah login. ' +
      '<button type="button" class="btn-text" id="btn-ke-ganti-pin" style="color:inherit;text-decoration:underline">Ganti PIN sekarang</button></div>';
  }
  if (h.status === 'libur') {
    var ket = h.hari_libur ? (h.hari_libur.keterangan || 'Hari libur') : 'Bukan hari kerja';
    banner += '<div class="banner info">👒 Hari libur: ' + esc(ket) + '. Absen tidak diperlukan.</div>';
  }
  if (h.status === 'izin' && h.izin) {
    banner += '<div class="banner info">📗 Izin ' + esc(h.izin.jenis) + ' disetujui (' +
      esc(tampilTanggal(h.izin.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(h.izin.tanggal_selesai)) + ').</div>';
  }

  var detailAbsen = '';
  if (h.absensi) {
    detailAbsen =
      '<div class="card"><p class="card-title">Absensi hari ini</p>' +
      '<div class="kv"><span>Jam masuk</span><b>' + esc(tampilJam(h.absensi.jam_masuk) || '-') + '</b></div>' +
      '<div class="kv"><span>Status</span><b>' + esc(h.absensi.status || '-') + '</b></div>' +
      (h.absensi.alasan_terlambat ? '<div class="kv"><span>Alasan terlambat</span><b>' + esc(h.absensi.alasan_terlambat) + '</b></div>' : '') +
      '<div class="kv"><span>Jam pulang</span><b>' + esc(tampilJam(h.absensi.jam_pulang) || 'Belum Absen Pulang') + '</b></div>' +
      '</div>';
  }

  var lokasiInfo = h.lokasi
    ? '<div class="kv"><span>Lokasi kerja</span><b>' + esc(h.lokasi.nama_lokasi) + '</b></div>' +
      '<div class="kv"><span>Radius</span><b>' + esc(h.lokasi.radius_m) + ' m</b></div>'
    : '<div class="kv"><span>Lokasi kerja</span><b class="muted">Belum diatur — hubungi admin</b></div>';

  return banner +
    '<div class="status-hero">' +
      '<div class="jam" id="jam-jalan">' + esc(h.jam_sekarang || jamSekarang()) + '</div>' +
      '<div class="tanggal">' + esc(tglIndonesia(new Date())) + '</div>' +
      '<div class="status-baris">Halo, ' + esc(user && user.nama ? user.nama : '') + '</div>' +
      '<span class="status-pill ' + pill.kelas + '">' + pill.teks + '</span>' +
    '</div>' +
    tombol +
    '<div class="card mt"><p class="card-title">Hari ini</p>' + lokasiInfo +
      '<div class="kv"><span>Jam kerja</span><b>' + esc(tampilJam(h.jam_masuk)) + ' – ' + esc(tampilJam(h.jam_pulang)) + '</b></div>' +
      '<div class="kv"><span>Akurasi GPS maksimal</span><b>' + esc(h.akurasi_maks_m) + ' m</b></div>' +
    '</div>' +
    detailAbsen;
}

SCREENS.beranda = {
  title: 'Beranda',
  render: function (el) {
    api('status_hari_ini', {})
      .then(function (h) {
        state.hariIni = h;
        state.user.wajib_ganti_pin = h.wajib_ganti_pin;
        el.innerHTML = berandaHTML(h, state.user);
        var bMasuk = $('btn-absen-masuk');
        var bPulang = $('btn-absen-pulang');
        if (bMasuk) bMasuk.addEventListener('click', function () { bukaAlurAbsen('masuk'); });
        if (bPulang) bPulang.addEventListener('click', function () { bukaAlurAbsen('pulang'); });
        var bPin = $('btn-ke-ganti-pin');
        if (bPin) bPin.addEventListener('click', function () { bukaScreen('profil'); });
        mulaiJam(el);
      })
      .catch(function (e) {
        if (tanganiErrorSesi(e)) return;
        el.innerHTML = errorHTML(errPesan(e));
        pasangCobaLagi(el, function () { SCREENS.beranda.render(el); });
      });
  }
};

/* ================================================================ */
/* Alur Absen — layar bertahap 5 langkah (bagian 11 PRD)             */
/* 1) cek lokasi & jarak  2) kamera depan selfie  3) alasan terlambat */
/* 4) konfirmasi + kirim  5) hasil sukses / pesan error              */
/* ================================================================ */

function langkahAbsen() {
  var a = state.absen;
  var daftar = ['Lokasi', 'Kamera'];
  if (a && a.hasil && a.hasil.alasan_wajib && a.jenis === 'masuk') daftar.push('Alasan');
  daftar.push('Kirim', 'Selesai');
  return daftar;
}

function gambarStepper() {
  var daftar = langkahAbsen();
  var a = state.absen;
  // indeks langkah aktif di antara daftar (tanpa memperhitungkan langkah 5 loading)
  $('absen-stepper').innerHTML = daftar.map(function (_, i) {
    return '<span class="' + (i < a.langkah ? 'on' : '') + '"></span>';
  }).join('');
  $('absen-title').textContent = a.jenis === 'masuk' ? 'Absen Masuk' : 'Absen Pulang';
}

function bukaAlurAbsen(jenis) {
  state.absen = { jenis: jenis, langkah: 1, hasil: null, posisi: null, foto: null, fotoKb: 0, alasan: '' };
  $('overlay-absen').hidden = false;
  renderLangkahAbsen();
}
function tutupAlurAbsen() {
  matikanKamera();
  $('overlay-absen').hidden = true;
  state.absen = null;
}

function renderLangkahAbsen() {
  var a = state.absen;
  if (!a) return;
  gambarStepper();
  var body = $('absen-body');
  var foot = $('absen-foot');
  foot.hidden = true;
  foot.innerHTML = '';

  if (a.langkah === 1) renderLangkahLokasi(body, foot);
  else if (a.langkah === 2) renderLangkahKamera(body, foot);
  else if (a.langkah === 3) renderLangkahAlasan(body, foot);
  else if (a.langkah === 4) renderLangkahKonfirmasi(body, foot);
  else if (a.langkah === 5) renderLangkahHasil(body, foot);
}

/* ---- Langkah 1: cek lokasi & jarak ---- */

function renderLangkahLokasi(body, foot) {
  var a = state.absen;
  body.innerHTML =
    '<p class="langkah-label">Langkah 1 — Cek lokasi</p>' +
    '<div id="lokasi-hasil"><div class="loading-state"><div class="spinner"></div>' +
    '<p>Mencari titik GPS… maksimal 15 detik</p></div></div>';
  foot.hidden = false;
  foot.innerHTML = '<button type="button" class="btn btn-ghost btn-block" id="absen-batal">Batal</button>';
  $('absen-batal').addEventListener('click', tutupAlurAbsen);
  mintaLokasi(lanjutPreview);
}

function lanjutPreview(posisi, galat) {
  var a = state.absen;
  if (!a) return;
  var kotak = $('lokasi-hasil');
  if (!kotak) return;
  var foot = $('absen-foot');

  if (galat) {
    kotak.innerHTML =
      '<div class="banner error"><strong>Lokasi tidak bisa dibaca.</strong><br>' + esc(galat.pesan) + '</div>' +
      '<div class="card"><p class="card-title">Cara mengaktifkan</p>' +
      '<ol class="small muted" style="padding-left:18px;margin:0">' +
      '<li>Buka pengaturan peramban/situs ini (ikon gembok di bilah alamat).</li>' +
      '<li>Pilih <b>Izin lokasi → Izinkan</b>.</li>' +
      '<li>Pastikan GPS perangkat menyala (Mode Lokasi aktif).</li>' +
      '<li>Kembali ke halaman ini lalu tekan Coba Lagi.</li></ol></div>';
    foot.innerHTML =
      '<div class="btn-row"><button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
      '<button type="button" class="btn btn-primary" id="absen-ulang-lokasi">Coba Lagi</button></div>';
    $('absen-batal').addEventListener('click', tutupAlurAbsen);
    $('absen-ulang-lokasi').addEventListener('click', function () { renderLangkahLokasi(body, foot); });
    return;
  }

  a.posisi = posisi; // dipakai ulang saat konfirmasi
  api('preview_absen', {
    jenis: a.jenis,
    lat: posisi.lat,
    lng: posisi.lng,
    akurasi: posisi.akurasi
  }).then(function (hasil) {
    a.hasil = hasil;
    var b;
    if (hasil.valid) {
      b = '<div class="card"><p class="card-title">📍 ' + esc(hasil.lokasi ? hasil.lokasi.nama_lokasi : 'Lokasi kerja') + '</p>' +
        '<div class="kv"><span>Jarak Anda ke lokasi</span><b class="jarak-besar">' + hasil.jarak_m + ' m</b></div>' +
        '<div class="kv"><span>Radius absen</span><b>' + hasil.radius_m + ' m</b></div>' +
        '<div class="kv"><span>Akurasi GPS</span><b>' + hasil.akurasi + ' m (maks ' + hasil.akurasi_maks_m + ' m)</b></div>' +
        '</div>' +
        (hasil.terlambat
          ? '<div class="banner">⏰ Anda terlambat — alasan keterlambatan wajib diisi pada langkah berikutnya.</div>'
          : '<div class="banner info">✅ Lokasi valid. Anda dapat melanjutkan ke selfie.</div>');
    } else {
      b = '<div class="banner error"><strong>' + esc(kodeJudul(hasil.code)) + '</strong><br>' + esc(hasil.pesan) + '</div>';
      if (hasil.jarak_m !== null && hasil.radius_m !== null) {
        b += '<div class="card"><div class="kv"><span>Jarak Anda</span><b>' + hasil.jarak_m + ' m</b></div>' +
          '<div class="kv"><span>Radius absen</span><b>' + hasil.radius_m + ' m</b></div></div>';
      }
    }
    kotak.innerHTML = b;
    foot.hidden = false;
    var label = hasil.valid ? 'Lanjut ke Selfie' : 'Coba Lagi';
    foot.innerHTML =
      '<div class="btn-row"><button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
      '<button type="button" class="btn ' + (hasil.valid ? 'btn-primary' : 'btn-outline') + '" id="absen-lanjut">' +
      label + '</button></div>';
    $('absen-batal').addEventListener('click', tutupAlurAbsen);
    $('absen-lanjut').addEventListener('click', function () {
      if (hasil.valid) {
        // selfie wajib diambil segar tiap absen
        state.absen.foto = null;
        state.absen.langkah = hasil.alasan_wajib && state.absen.jenis === 'masuk' ? 2 : 2;
        renderLangkahAbsen();
      } else {
        renderLangkahLokasi(body, foot); // ulangi ambil lokasi
      }
    });
  }).catch(function (e) {
    if (tanganiErrorSesi(e)) return;
    kotak.innerHTML = errorHTML(errPesan(e));
    foot.hidden = false;
    foot.innerHTML =
      '<div class="btn-row"><button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
      '<button type="button" class="btn btn-outline" id="absen-ulang-lokasi">Coba Lagi</button></div>';
    $('absen-batal').addEventListener('click', tutupAlurAbsen);
    $('absen-ulang-lokasi').addEventListener('click', function () { renderLangkahLokasi(body, foot); });
  });
}

function kodeJudul(kode) {
  switch (kode) {
    case 'DI_LUAR_RADIUS': return 'Di luar radius lokasi kerja.';
    case 'AKURASI_BURUK': return 'Akurasi GPS buruk.';
    case 'SUDAH_ABSEN': return 'Anda sudah absen.';
    case 'BELUM_ABSEN_MASUK': return 'Belum absen masuk.';
    case 'HARI_LIBUR': return 'Hari ini bukan hari kerja.';
    case 'SEDANG_IZIN': return 'Anda sedang izin.';
    default: return 'Absen tidak dapat dilanjutkan.';
  }
}

function mintaLokasi(cb) {
  if (!navigator.geolocation) {
    cb(null, { code: 0, pesan: 'Perangkat tidak mendukung GPS. Absen tidak bisa dilanjutkan.' });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      cb({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        akurasi: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : 0
      }, null);
    },
    function (err) {
      var pesan;
      if (err.code === 1) {
        pesan = 'Izin lokasi ditolak oleh perangkat. Absen tidak bisa dilanjutkan sebelum izin lokasi diaktifkan.';
      } else if (err.code === 3) {
        pesan = 'Waktu mengambil lokasi habis (batas 15 detik). Pindah ke ruang terbuka lalu coba lagi.';
      } else {
        pesan = 'Lokasi tidak tersedia. Aktifkan GPS/Mode Lokasi perangkat lalu coba lagi.';
      }
      cb(null, { code: err.code, pesan: pesan });
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function fileURL(stream) {
  try { return URL.createObjectURL(stream); } catch (e) { return null; }
}

/* ---- Langkah 2: kamera depan untuk selfie ---- */

var UKURAN_SISI_FOTO = 640;   // sesuai default foto_lebar_maks_px (bagian 7)
var KUALITAS_FOTO = 0.7;      // sesuai default foto_kualitas

function renderLangkahKamera(body, foot) {
  body.innerHTML =
    '<p class="langkah-label">Langkah 2 — Ambil selfie</p>' +
    '<div id="kamera-area"><div class="loading-state"><div class="spinner"></div>' +
    '<p>Membuka kamera depan…</p></div></div>' +
    '<p class="info-foto">Kamera depan otomatis — tidak ada pilihan galeri, ' +
    'foto harus diambil sekarang.</p>';
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
    '<button type="button" class="btn btn-primary" id="btn-ambil-foto" disabled>Ambil Foto</button>' +
    '</div>';
  $('absen-batal').addEventListener('click', tutupAlurAbsen);
  $('btn-ambil-foto').addEventListener('click', ambilFoto);
  mulaiKamera();
}

function mulaiKamera() {
  var area = $('kamera-area');
  if (!area) return;
  area.innerHTML =
    '<div class="kamera-viewport"><video id="kam-video" class="mirror" autoplay playsinline muted>' +
    '</video><div class="kamera-grid"></div></div>';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    galatKamera('Perangkat/peramban tidak mendukung kamera. Absen tidak bisa dilanjutkan.');
    return;
  }
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false
  }).then(function (stream) {
    if (!state.absen || !$('kamera-area')) { // overlay sudah ditutup
      stream.getTracks().forEach(function (t) { t.stop(); });
      return;
    }
    state.absen.stream = stream;
    var video = $('kam-video');
    video.srcObject = stream;
    var tombol = $('btn-ambil-foto');
    if (tombol) tombol.disabled = false;
  }).catch(function (err) {
    var pesan;
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      pesan = 'Izin kamera ditolak. Absen tidak bisa dilanjutkan sebelum izin kamera diaktifkan.';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
      pesan = 'Kamera depan tidak ditemukan di perangkat ini.';
    } else {
      pesan = 'Kamera tidak bisa dibuka. (' + (err && err.name ? err.name : 'galat') + ')';
    }
    galatKamera(pesan);
  });
}

function galatKamera(pesan) {
  var area = $('kamera-area');
  if (!area) return;
  area.innerHTML =
    '<div class="banner error"><strong>Kamera bermasalah.</strong><br>' + esc(pesan) + '</div>' +
    '<div class="card"><p class="card-title">Cara mengaktifkan</p>' +
    '<ol class="small muted" style="padding-left:18px;margin:0">' +
    '<li>Buka pengaturan peramban/situs ini (ikon gembok di bilah alamat).</li>' +
    '<li>Pilih <b>Kamera → Izinkan</b> (pilih kamera depan bila diminta).</li>' +
    '<li>Jika memakai iOS: Pengaturan &gt; Safari &gt; Kamera &gt; Izinkan.</li>' +
    '<li>Kembali lalu tekan Coba Lagi.</li></ol></div>';
  var foot = $('absen-foot');
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row"><button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
    '<button type="button" class="btn btn-outline" id="absen-ulang-kamera">Coba Lagi</button></div>';
  $('absen-batal').addEventListener('click', tutupAlurAbsen);
  $('absen-ulang-kamera').addEventListener('click', function () { renderLangkahKamera($('absen-body'), foot); });
}

function matikanKamera() {
  if (state.absen && state.absen.stream) {
    state.absen.stream.getTracks().forEach(function (t) { t.stop(); });
    state.absen.stream = null;
  }
}

/** Ambil frame dari video, kompres di perangkat ke JPEG. */
function ambilFoto() {
  var a = state.absen;
  var video = $('kam-video');
  if (!a || !video || !video.videoWidth) return;

  var lebar = video.videoWidth, tinggi = video.videoHeight;
  var skala = Math.min(1, UKURAN_SISI_FOTO / Math.max(lebar, tinggi));
  var canvas = document.createElement('canvas');
  canvas.width = Math.round(lebar * skala);
  canvas.height = Math.round(tinggi * skala);
  var ctx = canvas.getContext('2d');
  // video dimirror utk tampilan; disimpan apa adanya tanpa cermin
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/jpeg', KUALITAS_FOTO);
  } catch (e) {
    galatKamera('Gagal memproses gambar dari kamera.');
    return;
  }

  a.foto = dataUrl;
  a.fotoKb = Math.max(1, Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3 / 4 / 1024));
  matikanKamera();

  var area = $('kamera-area');
  area.innerHTML =
    '<div class="kamera-viewport"><img class="mirror" src="' + dataUrl + '" alt="Hasil selfie"></div>' +
    '<p class="info-foto">Ukuran foto ± ' + a.fotoKb + ' KB. Puas? Lanjut atau ambil ulang.</p>';

  var foot = $('absen-foot');
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-outline" id="absen-ulang-foto">Ulangi</button>' +
    '<button type="button" class="btn btn-primary" id="absen-lanjut-foto">Lanjut</button>' +
    '</div>';
  $('absen-ulang-foto').addEventListener('click', function () { renderLangkahKamera(area, foot); });
  $('absen-lanjut-foto').addEventListener('click', function () {
    state.absen.langkah = (state.absen.hasil && state.absen.hasil.alasan_wajib && state.absen.jenis === 'masuk') ? 3 : 4;
    renderLangkahAbsen();
  });
}

/* ---- Langkah 3: alasan keterlambat (wajib jika terlambat) ---- */

function renderLangkahAlasan(body, foot) {
  body.innerHTML =
    '<p class="langkah-label">Langkah 3 — Alasan keterlambat</p>' +
    '<div class="banner">⏰ Anda terlambat. Alasan keterlambatan <strong>wajib diisi</strong> ' +
    '(minimal 5 karakter) sebelum absen bisa dikirim.</div>' +
    '<label class="field"><span>Alasan keterlambatan</span>' +
    '<textarea id="alasan-input" maxlength="500" placeholder="contoh: Macet di jalan tol" ' +
    'aria-describedby="alasan-hint"></textarea>' +
    '<div class="field-hint" id="alasan-hint"><span id="alasan-hitung">0</span>/500 karakter — minimal 5</div></label>';
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-ghost" id="absen-kembali">Kembali</button>' +
    '<button type="button" class="btn btn-primary" id="absen-lanjut-alasan" disabled>Lanjut</button>' +
    '</div>';
  $('absen-kembali').addEventListener('click', function () { state.absen.langkah = 2; renderLangkahAbsen(); });
  var input = $('alasan-input');
  var tombol = $('absen-lanjut-alasan');
  input.value = state.absen.alasan || '';
  function cek() {
    $('alasan-hitung').textContent = String(input.value.length);
    tombol.disabled = input.value.trim().length < 5;
  }
  input.addEventListener('input', cek);
  cek();
  tombol.addEventListener('click', function () {
    state.absen.alasan = input.value.trim();
    state.absen.langkah = 4;
    renderLangkahAbsen();
  });
}

/* ---- Langkah 4: konfirmasi & kirim ---- */

function renderLangkahKonfirmasi(body, foot) {
  var a = state.absen;
  var h = a.hasil;
  var kembaliKe = (h && h.alasan_wajib && a.jenis === 'masuk') ? 3 : 2;
  body.innerHTML =
    '<p class="langkah-label">Langkah 4 — Konfirmasi</p>' +
    '<div class="card">' +
      '<div class="kv"><span>Jenis</span><b>' + (a.jenis === 'masuk' ? 'Absen Masuk' : 'Absen Pulang') + '</b></div>' +
      '<div class="kv"><span>Tanggal</span><b>' + esc(tglIndonesia(new Date())) + '</b></div>' +
      '<div class="kv"><span>Jam (server)</span><b>' + esc(jamMenitSekarang()) + '</b></div>' +
      '<div class="kv"><span>Jarak ke lokasi</span><b>' + (h ? h.jarak_m : '-') + ' m (radius ' + (h ? h.radius_m : '-') + ' m)</b></div>' +
      '<div class="kv"><span>Akurasi GPS</span><b>' + (a.posisi ? Math.round(a.posisi.akurasi) : '-') + ' m (foto ± ' + a.fotoKb + ' KB)</b></div>' +
      (a.jenis === 'masuk' ? '<div class="kv"><span>Status</span><b>' + (h && h.terlambat ? 'Terlambat' : 'Hadir') + '</b></div>' : '') +
      (a.alasan ? '<div class="kv"><span>Alasan terlambat</span><b>' + esc(a.alasan) + '</b></div>' : '') +
    '</div>' +
    '<div id="kirim-pesan"></div>' +
    '<p class="small muted center">Periksa data sebelum dikirim.</p>';
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-ghost" id="absen-kembali">Kembali</button>' +
    '<button type="button" class="btn btn-primary" id="btn-kirim-absen">Kirim Absensi</button>' +
    '</div>';
  $('absen-kembali').addEventListener('click', function () { state.absen.langkah = kembaliKe; renderLangkahAbsen(); });
  $('btn-kirim-absen').addEventListener('click', kirimAbsen);
}

function kirimAbsen(ev) {
  var a = state.absen;
  if (!a) return;
  var btn = ev.currentTarget;
  if (!a.foto) {
    $('kirim-pesan').innerHTML = '<div class="banner error">Foto selfie belum diambil. Kembali ke langkah kamera.</div>';
    return;
  }
  var payload = {
    lat: a.posisi.lat,
    lng: a.posisi.lng,
    akurasi: a.posisi.akurasi,
    foto_base64: a.foto
  };
  if (a.jenis === 'masuk') payload.alasan_terlambat = a.alasan || '';

  setBusy(btn, true, 'Mengirim…');
  api(a.jenis === 'masuk' ? 'absen_masuk' : 'absen_pulang', payload)
    .then(function (data) {
      a.kirimSukses = data;
      a.kirimGagal = null;
      a.langkah = 5;
      renderLangkahAbsen();
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      a.kirimSukses = null;
      a.kirimGagal = errPesan(e);
      a.kirimKode = errKode(e);
      a.langkah = 5;
      renderLangkahAbsen();
    })
    .then(function () { setBusy(btn, false); });
}

/* ---- Langkah 5: hasil sukses atau pesan error ---- */

function renderLangkahHasil(body, foot) {
  var a = state.absen;
  if (a.kirimSukses) {
    var d = a.kirimSukses;
    body.innerHTML =
      '<div class="status-hero" style="border-color:#86efac">' +
        '<div class="status-pill ok" style="font-size:15px">✔ ' +
        (a.jenis === 'masuk' ? 'Absen Masuk Berhasil' : 'Absen Pulang Berhasil') + '</div>' +
        '<div class="status-baris">' + esc(tglIndonesia(new Date())) + '</div>' +
      '</div>' +
      '<div class="card">' +
        (a.jenis === 'masuk'
          ? '<div class="kv"><span>Jam masuk</span><b>' + esc(tampilJam(d.jam_masuk) || '') + '</b></div>' +
            '<div class="kv"><span>Status</span><b>' + esc(d.status || '') + '</b></div>' +
            (d.alasan_terlambat ? '<div class="kv"><span>Alasan</span><b>' + esc(d.alasan_terlambat) + '</b></div>' : '')
          : '<div class="kv"><span>Jam pulang</span><b>' + esc(tampilJam(d.jam_pulang) || '') + '</b></div>') +
        '<div class="kv"><span>Jarak tercatat</span><b>' + esc(d.jarak_m) + ' m</b></div>' +
        '<div class="kv"><span>Foto</span><b>Tersimpan di Drive ✓</b></div>' +
      '</div>';
    foot.hidden = false;
    foot.innerHTML = '<button type="button" class="btn btn-primary btn-block" id="absen-selesai">Selesai</button>';
    $('absen-selesai').addEventListener('click', function () {
      tutupAlurAbsen();
      bukaScreen('beranda');
    });
    return;
  }

  // gagal — tampilkan pesan error, tanpa data setengah jadi
  body.innerHTML =
    '<div class="banner error"><strong>❌ Absen ' + (a.jenis === 'masuk' ? 'masuk' : 'pulang') + ' gagal.</strong><br>' +
    esc(a.kirimGagal || 'Terjadi kesalahan.') + '</div>' +
    (a.kirimKode === 'DI_LUAR_RADIUS' || a.kirimKode === 'AKURASI_BURUK'
      ? '<div class="card small muted">Pindah lebih dekat ke lokasi kerja / ke tempat terbuka agar GPS akurat, ' +
        'lalu ulangi absen dari langkah lokasi dan selfie baru.</div>'
      : '<div class="card small muted">Tidak ada data absensi yang tersimpan. Anda bisa mengulang absen dari awal.</div>');
  foot.hidden = false;
  foot.innerHTML =
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-ghost" id="absen-tutup">Tutup</button>' +
    '<button type="button" class="btn btn-primary" id="absen-ulang">Coba Lagi</button>' +
    '</div>';
  $('absen-tutup').addEventListener('click', tutupAlurAbsen);
  $('absen-ulang').addEventListener('click', function () {
    state.absen = { jenis: a.jenis, langkah: 1, hasil: null, posisi: null, foto: null, fotoKb: 0, alasan: '' };
    renderLangkahAbsen();
  });
}

/* ================================================================ */
/* SCREEN: Izin (karyawan & admin) — F5                               */
/* ================================================================ */

function badgeIzin(status) {
  var kelas = { Menunggu: 'menunggu', Disetujui: 'disetujui', Ditolak: 'gagal', Dibatalkan: 'libur' }[status] || '';
  return '<span class="badge ' + kelas + '">' + esc(status) + '</span>';
}

SCREENS.izin = {
  title: 'Izin',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><p class="card-title">Ajukan Izin</p>' +
      '<form id="form-izin" novalidate>' +
        '<label class="field"><span>Jenis</span><select id="izin-jenis">' +
          '<option>Sakit</option><option>Izin</option><option>Cuti</option><option>Dinas Luar</option>' +
        '</select></label>' +
        '<label class="field"><span>Tanggal mulai</span>' +
          '<input type="date" id="izin-mulai" required></label>' +
        '<label class="field"><span>Tanggal selesai</span>' +
          '<input type="date" id="izin-selesai" required></label>' +
        '<label class="field"><span>Alasan</span>' +
          '<textarea id="izin-alasan" maxlength="500" placeholder="Jelaskan singkat alasannya" required></textarea></label>' +
        '<p class="form-error" id="izin-error" hidden></p>' +
        '<button type="submit" class="btn btn-primary btn-block" id="btn-izin-kirim">Kirim Pengajuan</button>' +
      '</form></div>' +
      '<p class="card-title">Izin Saya</p>' +
      '<div id="izin-daftar">' + loadingHTML('Memuat daftar izin…') + '</div>';

    $('form-izin').addEventListener('submit', kirimIzin);
    muatDaftarIzin();
  }
};

function kirimIzin(ev) {
  ev.preventDefault();
  var errEl = $('izin-error');
  errEl.hidden = true;
  var jenis = $('izin-jenis').value;
  var mulai = $('izin-mulai').value;
  var selesai = $('izin-selesai').value;
  var alasan = $('izin-alasan').value.trim();

  if (!mulai || !selesai) {
    errEl.textContent = 'Tanggal mulai dan selesai wajib diisi.'; errEl.hidden = false; return;
  }
  if (selesai < mulai) {
    errEl.textContent = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'; errEl.hidden = false; return;
  }
  if (alasan.length < 1) {
    errEl.textContent = 'Alasan wajib diisi.'; errEl.hidden = false; return;
  }
  var hariIni = new Date();
  var hariIniStr = hariIni.getFullYear() + '-' + jam2(hariIni.getMonth() + 1) + '-' + jam2(hariIni.getDate());
  if (mulai < hariIniStr) {
    errEl.textContent = 'Tanggal mulai tidak boleh sebelum hari ini.'; errEl.hidden = false; return;
  }

  var btn = $('btn-izin-kirim');
  setBusy(btn, true, 'Mengirim…');
  api('izin_ajukan', { jenis: jenis, tanggal_mulai: mulai, tanggal_selesai: selesai, alasan: alasan })
    .then(function () {
      toast('Pengajuan izin terkirim — menunggu persetujuan admin.', 'ok');
      $('izin-alasan').value = '';
      $('izin-mulai').value = '';
      $('izin-selesai').value = '';
      muatDaftarIzin();
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      errEl.textContent = errPesan(e); errEl.hidden = false;
    })
    .then(function () { setBusy(btn, false); });
}

function muatDaftarIzin() {
  var kotak = $('izin-daftar');
  if (!kotak) return;
  kotak.innerHTML = loadingHTML('Memuat daftar izin…');
  api('izin_saya', {})
    .then(function (data) {
      var daftar = (data && data.daftar) || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML('📭', 'Belum ada izin yang Anda ajukan.');
        return;
      }
      kotak.innerHTML = daftar.map(function (r) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
          '<div class="row-meta">📅 ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + '</div>' +
          '<div class="row-meta">' + esc(r.alasan) + '</div>' +
          (r.status === 'Menunggu' ?
            '<div class="btn-row"><button type="button" class="btn btn-outline btn-sm" data-batal="' + esc(r.id_izin) + '">Batalkan</button></div>' : '') +
          (r.catatan_admin ? '<div class="row-meta">Catatan admin: ' + esc(r.catatan_admin) + '</div>' : '') +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-batal]'), function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Batalkan izin ini?')) return;
          var id = b.dataset.batal;
          setBusy(b, true, 'Membatalkan…');
          api('izin_batal', { id_izin: id })
            .then(function () { toast('Izin dibatalkan.', 'ok'); muatDaftarIzin(); })
            .catch(function (e) {
              if (tanganiErrorSesi(e)) return;
              toast(errPesan(e), 'err');
              setBusy(b, false);
            });
        });
      });
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatDaftarIzin);
    });
}

/* ================================================================ */
/* SCREEN: Riwayat — absensi + izin milik sendiri per bulan (F6)      */
/* ================================================================ */

SCREENS.riwayat = {
  title: 'Riwayat',
  render: function (el) {
    el.innerHTML =
      '<div class="filter-bar">' +
        '<label class="field full"><span>Bulan</span><input type="month" id="riw-bulan" value="' + bulanIni() + '"></label>' +
        '<button type="button" class="btn btn-primary" id="btn-riw">Tampilkan</button>' +
      '</div>' +
      '<div id="riw-hasil">' + loadingHTML('Memuat riwayat…') + '</div>';
    $('btn-riw').addEventListener('click', muatRiwayat);
    muatRiwayat();
  }
};

function muatRiwayat() {
  var kotak = $('riw-hasil');
  var bulan = $('riw-bulan').value || bulanIni();
  kotak.innerHTML = loadingHTML('Memuat riwayat…');
  api('riwayat_saya', { bulan: bulan })
    .then(function (data) {
      var absen = (data && data.absensi) || [];
      var izin = (data && data.izin) || [];
      var html = '';

      html += '<p class="card-title">Absensi ' + esc(bulan) + '</p>';
      if (!absen.length) {
        html += emptyHTML('🗓️', 'Tidak ada data absensi pada bulan ini.');
      } else {
        html += absen.map(function (r) {
          var st = r.status === 'Terlambat' ? 'terlambat' : 'hadir';
          return '<div class="row-item">' +
            '<div class="row-head"><span class="row-name">' + esc(tampilTanggal(r.tanggal)) + '</span>' +
            '<span class="badge ' + st + '">' + esc(r.status) + '</span></div>' +
            '<div class="row-meta">Masuk ' + esc(tampilJam(r.jam_masuk) || '—') +
            ' · Pulang ' + esc(tampilJam(r.jam_pulang) || 'Belum Absen Pulang') + '</div>' +
            (r.alasan_terlambat ? '<div class="row-meta">Alasan: ' + esc(r.alasan_terlambat) + '</div>' : '') +
            (r.dikoreksi ? '<div class="row-meta">✏️ Dikoreksi admin</div>' : '') +
          '</div>';
        }).join('');
      }

      html += '<p class="card-title mt">Izin</p>';
      if (!izin.length) {
        html += emptyHTML('📭', 'Tidak ada izin pada bulan ini.');
      } else {
        html += izin.map(function (r) {
          return '<div class="row-item">' +
            '<div class="row-head"><span class="row-name">' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
            '<div class="row-meta">📅 ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + ' — ' + esc(r.alasan) + '</div>' +
          '</div>';
        }).join('');
      }

      kotak.innerHTML = html;
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatRiwayat);
    });
}

/* ================================================================ */
/* SCREEN: Profil — nama, ganti PIN, keluar (dana wajib ganti PIN)    */
/* ================================================================ */

SCREENS.profil = {
  title: 'Profil',
  render: function (el) {
    var u = state.user || {};
    var inisial = (u.nama || '?').trim().charAt(0).toUpperCase();
    var wajib = !!u.wajib_ganti_pin;
    el.innerHTML =
      '<div class="profil-head">' +
        '<div class="avatar">' + esc(inisial) + '</div>' +
        '<div><div style="font-weight:700">' + esc(u.nama || '') + '</div>' +
        '<div class="small muted">' + esc(u.id_karyawan || '') + ' · role ' + esc(u.role || '') + '</div></div>' +
      '</div>' +
      (wajib ? '<div class="banner">🔑 PIN masih PIN sementara. Anda <strong>wajib mengganti PIN</strong> sekarang.</div>' : '') +
      '<div class="card' + (wajib ? ' ganti-pin-aktif' : '') + '"><p class="card-title">Ganti PIN</p>' +
      '<form id="form-ganti-pin" novalidate>' +
        '<label class="field"><span>PIN lama</span>' +
          '<input type="password" inputmode="numeric" id="pin-lama" maxlength="12" required></label>' +
        '<label class="field"><span>PIN baru (angka)</span>' +
          '<input type="password" inputmode="numeric" id="pin-baru" maxlength="12" required></label>' +
        '<label class="field"><span>Ulangi PIN baru</span>' +
          '<input type="password" inputmode="numeric" id="pin-baru2" maxlength="12" required></label>' +
        '<p class="form-error" id="pin-error" hidden></p>' +
        '<button type="submit" class="btn btn-primary btn-block" id="btn-ganti-pin">Simpan PIN Baru</button>' +
      '</form></div>' +
      '<div class="card"><p class="card-title">Sesi</p>' +
      '<button type="button" class="btn btn-danger btn-block" id="btn-keluar">Keluar</button></div>';

    $('form-ganti-pin').addEventListener('submit', kirimGantiPin);
    $('btn-keluar').addEventListener('click', function () {
      if (confirm('Keluar dari akun ini?')) keluarKeLogin();
    });
    if (wajib) setTimeout(function () { var f = $('pin-lama'); if (f) f.focus(); }, 250);
  }
};

function kirimGantiPin(ev) {
  ev.preventDefault();
  var errEl = $('pin-error');
  errEl.hidden = true;
  var lama = $('pin-lama').value.trim();
  var baru = $('pin-baru').value.trim();
  var baru2 = $('pin-baru2').value.trim();
  if (!lama || !baru || !baru2) { errEl.textContent = 'Semua field PIN wajib diisi.'; errEl.hidden = false; return; }
  if (baru !== baru2) { errEl.textContent = 'Ulangi PIN baru tidak sama.'; errEl.hidden = false; return; }
  if (!/^\d+$/.test(baru)) { errEl.textContent = 'PIN baru harus berupa angka.'; errEl.hidden = false; return; }

  var btn = $('btn-ganti-pin');
  setBusy(btn, true, 'Menyimpan…');
  api('ganti_pin', { pin_lama: lama, pin_baru: baru })
    .then(function () {
      state.user.wajib_ganti_pin = false;
      simpanUser(state.user);
      toast('PIN berhasil diganti.', 'ok');
      bukaScreen('profil');
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      errEl.textContent = errPesan(e); errEl.hidden = false;
      setBusy(btn, false);
    });
}

/* ================================================================ */
/* Modal umum                                                       */
/* ================================================================ */

function bukaModal(judul, html, onMount) {
  $('modal-title').textContent = judul;
  $('modal-body').innerHTML = html;
  $('overlay-modal').hidden = false;
  if (typeof onMount === 'function') onMount($('modal-body'));
}
function tutupModal() {
  $('overlay-modal').hidden = true;
  $('modal-body').innerHTML = '';
}

function badgeStatusAbsen(status) {
  var kelas = status === 'Terlambat' ? 'terlambat'
    : status === 'Hadir' ? 'hadir'
    : status === 'Izin' ? 'izin'
    : status === 'Belum Absen' ? 'menunggu'
    : status === 'Libur' ? '' : '';
  return '<span class="badge ' + kelas + '">' + esc(status) + '</span>';
}

/* ================================================================ */
/* SCREEN: Dashboard (admin) — F10                                   */
/* ================================================================ */

SCREENS.dashboard = {
  title: 'Dashboard',
  render: function (el) {
    el.innerHTML = loadingHTML('Memuat dashboard hari ini…');
    api('dashboard_hari_ini', {})
      .then(function (d) {
        var j = d.jumlah;
        var html =
          '<div class="banner info">' + esc(tglIndonesia(tanggalLokal(d.tanggal))) + ' · pukul ' + esc(d.jam_sekarang) +
          (d.hari_libur ? ' · 🕶 libur: ' + esc(d.hari_libur.keterangan || 'Hari libur') : (d.hari_kerja ? '' : ' · bukan hari kerja')) + '</div>' +
          '<div class="stat-grid">' +
            '<div class="stat hadir"><b>' + j.hadir + '</b><span>Hadir</span></div>' +
            '<div class="stat terlambat"><b>' + j.terlambat + '</b><span>Terlambat</span></div>' +
            '<div class="stat izin"><b>' + j.izin + '</b><span>Izin</span></div>' +
            '<div class="stat belum"><b>' + j.belum_absen + '</b><span>Belum Absen</span></div>' +
          '</div>';
        if (!d.karyawan.length) {
          html += emptyHTML('👥', 'Belum ada karyawan. Tambahkan lewat menu Karyawan.');
        } else {
          html += '<div class="table-wrap"><table class="data"><thead><tr>' +
            '<th>Nama</th><th>Status</th><th>Masuk</th><th>Pulang</th><th>Keterangan</th>' +
            '</tr></thead><tbody>' +
            d.karyawan.map(function (k) {
              return '<tr><td>' + esc(k.nama) + '<br><span class="small muted">' + esc(k.jabatan || k.id_karyawan) + '</span></td>' +
                '<td>' + badgeStatusAbsen(k.status) + '</td>' +
                '<td>' + esc(tampilJam(k.jam_masuk) || '—') + '</td>' +
                '<td>' + esc(tampilJam(k.jam_pulang) || '—') + '</td>' +
                '<td class="wrap small">' + esc(k.keterangan || '') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table></div>';
        }
        html += '<p class="small muted mt">Catatan: "Belum Absen Pulang" berarti data absen masuk tersimpan tetapi jam pulang masih kosong — lengkapi lewat menu Absensi → Koreksi.</p>';
        el.innerHTML = html;
      })
      .catch(function (e) {
        if (tanganiErrorSesi(e)) return;
        el.innerHTML = errorHTML(errPesan(e));
        pasangCobaLagi(el, function () { SCREENS.dashboard.render(el); });
      });
  }
};

/* ================================================================ */
/* SCREEN: Absensi (admin) — filter, lihat foto, koreksi — F8        */
/* ================================================================ */

var absensiState = { daftar: [], pilihanKaryawan: [] };

SCREENS.absensi = {
  title: 'Absensi',
  render: function (el) {
    var hariIni = new Date();
    var str = hariIni.getFullYear() + '-' + jam2(hariIni.getMonth() + 1) + '-' + jam2(hariIni.getDate());
    el.innerHTML =
      '<div class="filter-bar">' +
        '<label class="field"><span>Tanggal mulai</span><input type="date" id="abs-dari" value="' + str + '"></label>' +
        '<label class="field"><span>Tanggal sampai</span><input type="date" id="abs-sampai" value="' + str + '"></label>' +
        '<label class="field full"><span>Karyawan</span><select id="abs-karyawan"><option value="">Semua karyawan</option></select></label>' +
        '<button type="button" class="btn btn-primary" id="btn-abs-tampil">Tampilkan</button>' +
      '</div>' +
      '<div id="abs-hasil">' + loadingHTML('Memuat daftar absensi…') + '</div>';
    $('btn-abs-tampil').addEventListener('click', muatAbsensi);

    // isi dropdown karyawan
    api('karyawan_list', {})
      .then(function (data) {
        absensiState.pilihanKaryawan = data.daftar || [];
        var sel = $('abs-karyawan');
        if (!sel) return;
        sel.innerHTML = '<option value="">Semua karyawan</option>' + absensiState.pilihanKaryawan.map(function (k) {
          return '<option value="' + esc(k.id_karyawan) + '">' + esc(k.nama) + '</option>';
        }).join('');
      })
      .catch(function (e) { if (!tanganiErrorSesi(e)) toast(errPesan(e), 'err'); });

    muatAbsensi();
  }
};

function muatAbsensi() {
  var kotak = $('abs-hasil');
  if (!kotak) return;
  var dari = $('abs-dari').value, sampai = $('abs-sampai').value, kid = $('abs-karyawan').value;
  if (!dari || !sampai) { toast('Isi rentang tanggal terlebih dahulu.', 'err'); return; }
  kotak.innerHTML = loadingHTML('Memuat daftar absensi…');

  var payload = { tanggal_mulai: dari, tanggal_selesai: sampai };
  if (kid) payload.id_karyawan = kid;

  api('absensi_list', payload)
    .then(function (data) {
      absensiState.daftar = data.daftar || [];
      renderAbsensi(kotak);
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatAbsensi);
    });
}

function renderAbsensi(kotak) {
  var daftar = absensiState.daftar;
  if (!daftar.length) {
    kotak.innerHTML = emptyHTML('🗓️', 'Tidak ada data absensi pada rentang tanggal ini.');
    return;
  }
  kotak.innerHTML = daftar.map(function (r) {
    var foto = '';
    if (r.link_foto_masuk) foto += '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + esc(r.link_foto_masuk) + '">📷 Foto Masuk</a> ';
    if (r.link_foto_pulang) foto += '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + esc(r.link_foto_pulang) + '">📷 Foto Pulang</a>';
    if (!foto) foto = '<span class="small muted">—</span>';
    return '<div class="row-item">' +
      '<div class="row-head"><span class="row-name">' + esc(tampilTanggal(r.tanggal)) + ' · ' + esc(r.nama) + '</span>' + badgeStatusAbsen(r.status) + '</div>' +
      '<div class="row-meta">Masuk ' + esc(tampilJam(r.jam_masuk) || '—') +
      ' · Pulang ' + esc(tampilJam(r.jam_pulang) || 'Belum Absen Pulang') +
      (r.jarak_masuk_m !== null ? ' · jarak ' + r.jarak_masuk_m + ' m' : '') + '</div>' +
      (r.alasan_terlambat ? '<div class="row-meta">Alasan terlambat: ' + esc(r.alasan_terlambat) + '</div>' : '') +
      (r.dikoreksi ? '<div class="row-meta">✏️ Dikoreksi — ' + esc(r.catatan_koreksi) + '</div>' : '') +
      '<div class="btn-row">' + foto + '</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-primary btn-sm" data-koreksi="' + esc(r.id_absen) + '">Koreksi</button>' +
      '</div>' +
    '</div>';
  }).join('');

  Array.prototype.forEach.call(kotak.querySelectorAll('[data-koreksi]'), function (b) {
    b.addEventListener('click', function () {
      var rec = absensiState.daftar.filter(function (x) { return x.id_absen === b.dataset.koreksi; })[0];
      if (rec) bukaKoreksi(rec);
    });
  });
}

function bukaKoreksi(r) {
  var html =
    '<p class="small muted">' + esc(tampilTanggal(r.tanggal)) + ' · ' + esc(r.nama) + ' (' + esc(r.id_karyawan) + ')</p>' +
    '<form id="form-koreksi" novalidate>' +
      '<label class="field"><span>Jam masuk (HH:mm)</span><input type="text" id="kor-masuk" value="' + esc(tampilJam(r.jam_masuk) || '') + '" inputmode="numeric" required></label>' +
      '<label class="field"><span>Jam pulang (HH:mm, kosongkan bila belum pulang)</span><input type="text" id="kor-pulang" value="' + esc(tampilJam(r.jam_pulang) || '') + '" inputmode="numeric"></label>' +
      '<label class="field"><span>Status</span><select id="kor-status">' +
        '<option value="Hadir"' + (r.status === 'Hadir' ? ' selected' : '') + '>Hadir</option>' +
        '<option value="Terlambat"' + (r.status === 'Terlambat' ? ' selected' : '') + '>Terlambat</option>' +
      '</select></label>' +
      '<label class="field"><span>Alasan keterlambat</span><textarea id="kor-alasan" maxlength="500">' + esc(r.alasan_terlambat || '') + '</textarea></label>' +
      '<label class="field"><span>Catatan koreksi (wajib)</span>' +
      '<textarea id="kor-catatan" maxlength="500" placeholder="contoh: Lupa absen pulang, dikonfirmasi via WA" required></textarea></label>' +
      '<p class="form-error" id="kor-error" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="btn-kor-simpan">Simpan Koreksi</button>' +
    '</form>';
  bukaModal('Koreksi Absensi', html, function () {
    $('form-koreksi').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('kor-error');
      err.hidden = true;
      var catatan = $('kor-catatan').value.trim();
      if (!catatan) { err.textContent = 'Catatan koreksi wajib diisi.'; err.hidden = false; return; }
      var payload = {
        id_absen: r.id_absen,
        jam_masuk: $('kor-masuk').value.trim(),
        jam_pulang: $('kor-pulang').value.trim(),
        status: $('kor-status').value,
        alasan_terlambat: $('kor-alasan').value.trim(),
        catatan_koreksi: catatan
      };
      var btn = $('btn-kor-simpan');
      setBusy(btn, true, 'Menyimpan…');
      api('absensi_koreksi', payload)
        .then(function () {
          toast('Koreksi tersimpan dan tercatat di log.', 'ok');
          tutupModal();
          muatAbsensi();
        })
        .catch(function (e) {
          if (tanganiErrorSesi(e)) return;
          err.textContent = errPesan(e); err.hidden = false;
          setBusy(btn, false);
        });
    });
  });
}

/* ================================================================ */
/* SCREEN: Persetujuan Izin (admin) — F9                              */
/* ================================================================ */

SCREENS.persetujuan = {
  title: 'Persetujuan Izin',
  render: function (el) {
    el.innerHTML =
      '<div class="filter-bar">' +
        '<label class="field full"><span>Status</span><select id="izn-filter">' +
          '<option value="Menunggu">Menunggu</option>' +
          '<option value="">Semua status</option>' +
          '<option value="Disetujui">Disetujui</option>' +
          '<option value="Ditolak">Ditolak</option>' +
          '<option value="Dibatalkan">Dibatalkan</option>' +
        '</select></label>' +
        '<button type="button" class="btn btn-primary" id="btn-izn-tampil">Tampilkan</button>' +
      '</div>' +
      '<div id="izn-hasil">' + loadingHTML('Memuat izin…') + '</div>';
    $('btn-izn-tampil').addEventListener('click', muatPersetujuan);
    muatPersetujuan();
  }
};

function muatPersetujuan() {
  var kotak = $('izn-hasil');
  if (!kotak) return;
  var status = $('izn-filter').value;
  kotak.innerHTML = loadingHTML('Memuat izin…');
  var payload = status ? { status: status } : {};
  api('izin_list', payload)
    .then(function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML('✅', status === 'Menunggu' ? 'Tidak ada izin yang menunggu persetujuan.' : 'Tidak ada izin dengan filter ini.');
        return;
      }
      kotak.innerHTML = daftar.map(function (r) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(r.nama) + ' · ' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
          '<div class="row-meta">📅 ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + '</div>' +
          '<div class="row-meta">' + esc(r.alasan) + '</div>' +
          (r.catatan_admin ? '<div class="row-meta">Catatan: ' + esc(r.catatan_admin) + '</div>' : '') +
          (r.status === 'Menunggu' ?
            '<div class="btn-row">' +
            '<button type="button" class="btn btn-success btn-sm" data-setujui="' + esc(r.id_izin) + '">Setujui</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-tolak="' + esc(r.id_izin) + '">Tolak</button>' +
            '</div>' : '') +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-setujui]'), function (b) {
        b.addEventListener('click', function () { bukaProsesIzin(b.dataset.setujui, 'Disetujui'); });
      });
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-tolak]'), function (b) {
        b.addEventListener('click', function () { bukaProsesIzin(b.dataset.tolak, 'Ditolak'); });
      });
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatPersetujuan);
    });
}

function bukaProsesIzin(id, keputusan) {
  var html =
    '<p>Keputusan: <strong>' + (keputusan === 'Disetujui' ? '✅ Disetujui' : '❌ Ditolak') + '</strong></p>' +
    '<label class="field"><span>Catatan admin (opsional)</span>' +
    '<textarea id="pr-catatan" maxlength="500" placeholder="' + (keputusan === 'Ditolak' ? 'Tuliskan alasan penolakan' : 'Catatan tambahan bila ada') + '"></textarea></label>' +
    '<button type="button" class="btn ' + (keputusan === 'Disetujui' ? 'btn-success' : 'btn-danger') +
    ' btn-block" id="btn-pr-simpan">Simpan Keputusan</button>';
  bukaModal('Proses Izin', html, function () {
    $('btn-pr-simpan').addEventListener('click', function () {
      var btn = this;
      setBusy(btn, true, 'Menyimpan…');
      api('izin_proses', { id_izin: id, keputusan: keputusan, catatan_admin: $('pr-catatan').value.trim() })
        .then(function () {
          toast('Izin ' + keputusan.toLowerCase() + '.', 'ok');
          tutupModal();
          muatPersetujuan();
        })
        .catch(function (e) {
          if (tanganiErrorSesi(e)) return;
          toast(errPesan(e), 'err');
          setBusy(btn, false);
        });
    });
  });
}

/* ================================================================ */
/* SCREEN: Karyawan (admin CRUD) — F7                                 */
/* ================================================================ */

var dataKaryawan = [];
var dataLokasiUntukForm = [];

SCREENS.karyawan = {
  title: 'Karyawan',
  render: function (el) {
    el.innerHTML =
      '<button type="button" class="btn btn-primary btn-block" id="btn-kar-tambah" style="margin-bottom:12px">+ Tambah Karyawan</button>' +
      '<div id="kar-hasil">' + loadingHTML('Memuat daftar karyawan…') + '</div>';
    $('btn-kar-tambah').addEventListener('click', function () { bukaFormKaryawan(null); });
    muatKaryawan();
  }
};

function muatKaryawan() {
  var kotak = $('kar-hasil');
  if (!kotak) return;
  kotak.innerHTML = loadingHTML('Memuat daftar karyawan…');
  Promise.all([api('karyawan_list', {}), api('lokasi_list', {})])
    .then(function (hasil) {
      dataKaryawan = hasil[0].daftar || [];
      dataLokasiUntukForm = (hasil[1].daftar || []).filter(function (l) { return l.status_aktif; });
      if (!dataKaryawan.length) {
        kotak.innerHTML = emptyHTML('👥', 'Belum ada karyawan. Tekan Tambah Karyawan.');
        return;
      }
      kotak.innerHTML = dataKaryawan.map(function (k) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(k.nama) + '</span>' +
          '<span class="badge ' + (k.status_aktif ? 'aktif' : 'nonaktif') + '">' +
          (k.status_aktif ? 'Aktif' : 'Nonaktif') + '</span></div>' +
          '<div class="row-meta">@' + esc(k.username) + ' · ' + esc(k.jabatan || '—') + ' · role ' + esc(k.role) + '</div>' +
          '<div class="row-meta">' + esc(k.id_karyawan) + ' · lokasi ' + esc(k.nama_lokasi || k.id_lokasi || '—') + '</div>' +
          (k.wajib_ganti_pin ? '<div class="row-meta">🔑 Wajib ganti PIN (belum login ganti)</div>' : '') +
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-outline btn-sm" data-ubah="' + esc(k.id_karyawan) + '">Ubah</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-reset="' + esc(k.id_karyawan) + '">Reset PIN</button>' +
            (k.status_aktif ? '<button type="button" class="btn btn-danger btn-sm" data-nonaktif="' + esc(k.id_karyawan) + '">Nonaktifkan</button>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      Array.prototype.forEach.call(kotak.querySelectorAll('[data-ubah]'), function (b) {
        b.addEventListener('click', function () {
          var k = dataKaryawan.filter(function (x) { return x.id_karyawan === b.dataset.ubah; })[0];
          if (k) bukaFormKaryawan(k);
        });
      });
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-reset]'), function (b) {
        b.addEventListener('click', function () { resetPinKaryawan(b.dataset.reset); });
      });
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-nonaktif]'), function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Nonaktifkan karyawan ini? Ia tidak bisa login lagi.')) return;
          setBusy(b, true, '…');
          api('karyawan_hapus', { id: b.dataset.nonaktif })
            .then(function () { toast('Karyawan dinonaktifkan.', 'ok'); muatKaryawan(); })
            .catch(function (e) { if (!tanganiErrorSesi(e)) { toast(errPesan(e), 'err'); setBusy(b, false); } });
        });
      });
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatKaryawan);
    });
}

function bukaFormKaryawan(k) {
  var baru = !k;
  var html =
    '<form id="form-karyawan" novalidate>' +
      (baru ? '' : '<input type="hidden" id="kar-id" value="' + esc(k.id_karyawan) + '">') +
      '<label class="field"><span>Nama lengkap</span><input type="text" id="kar-nama" maxlength="100" value="' + esc(baru ? '' : k.nama) + '" required></label>' +
      '<label class="field"><span>Username (unik)</span><input type="text" id="kar-username" maxlength="40" autocapitalize="none" value="' + esc(baru ? '' : k.username) + '" required></label>' +
      '<label class="field"><span>Jabatan</span><input type="text" id="kar-jabatan" maxlength="100" value="' + esc(baru ? '' : (k.jabatan || '')) + '"></label>' +
      '<label class="field"><span>Role</span><select id="kar-role">' +
        '<option value="karyawan"' + (!baru && k.role === 'karyawan' ? ' selected' : '') + '>Karyawan</option>' +
        '<option value="admin"' + (!baru && k.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
      '</select></label>' +
      '<label class="field"><span>Lokasi kerja</span><select id="kar-lokasi" required>' +
        dataLokasiUntukForm.map(function (l) {
          var terpilih = !baru && k.id_lokasi === l.id_lokasi ? ' selected' : '';
          return '<option value="' + esc(l.id_lokasi) + '"' + terpilih + '>' + esc(l.nama_lokasi) + '</option>';
        }).join('') +
      '</select></label>' +
      (baru
        ? '<label class="field"><span>PIN awal (angka, nanti diganti saat login pertama)</span>' +
          '<input type="text" inputmode="numeric" id="kar-pin" maxlength="12" required></label>'
        : '<p class="small muted">Untuk mengubah PIN karyawan ini, gunakan tombol Reset PIN.</p>') +
      '<p class="form-error" id="kar-error" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="btn-kar-simpan">' + (baru ? 'Tambah Karyawan' : 'Simpan Perubahan') + '</button>' +
    '</form>';

  bukaModal(baru ? 'Tambah Karyawan' : 'Ubah Karyawan', html, function () {
    $('form-karyawan').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('kar-error');
      err.hidden = true;
      var payload = {
        nama: $('kar-nama').value.trim(),
        username: $('kar-username').value.trim(),
        jabatan: $('kar-jabatan').value.trim(),
        role: $('kar-role').value,
        id_lokasi: $('kar-lokasi').value
      };
      if (baru) {
        var pin = $('kar-pin').value.trim();
        if (!/^\d+$/.test(pin)) { err.textContent = 'PIN harus berupa angka.'; err.hidden = false; return; }
        payload.pin = pin;
      } else {
        payload.id_karyawan = $('kar-id').value;
      }
      var btn = $('btn-kar-simpan');
      setBusy(btn, true, 'Menyimpan…');
      api('karyawan_simpan', payload)
        .then(function () {
          toast(baru ? 'Karyawan ditambahkan.' : 'Perubahan disimpan.', 'ok');
          tutupModal();
          muatKaryawan();
        })
        .catch(function (e) {
          if (tanganiErrorSesi(e)) return;
          err.textContent = errPesan(e); err.hidden = false;
          setBusy(btn, false);
        });
    });
  });
}

function resetPinKaryawan(id) {
  if (!confirm('Reset PIN karyawan ini? PIN lama hangus dan ia keluar dari semua sesi.')) return;
  api('karyawan_reset_pin', { id_karyawan: id })
    .then(function (d) {
      var html =
        '<div class="banner">🔑 <strong>PIN sementara untuk ' + esc(d.nama) + ':</strong></div>' +
        '<p class="center" style="font-size:30px;font-weight:800;letter-spacing:6px">' + esc(d.pin) + '</p>' +
        '<p class="small muted center">PIN ini <strong>hanya ditampilkan sekali</strong>. ' +
        'Sampaikan ke karyawan; ia wajib mengganti PIN setelah login pertama.</p>' +
        '<button type="button" class="btn btn-primary btn-block" id="btn-pin-ok">Saya sudah mencatat</button>';
      bukaModal('Reset PIN Berhasil', html, function () {
        $('btn-pin-ok').addEventListener('click', function () { tutupModal(); muatKaryawan(); });
      });
    })
    .catch(function (e) { if (!tanganiErrorSesi(e)) toast(errPesan(e), 'err'); });
}

/* ================================================================ */
/* SCREEN: Lokasi (admin CRUD) — F7                                  */
/* ================================================================ */
SCREENS.lokasi = {
  title: 'Lokasi',
  render: function (el) {
    el.innerHTML =
      '<button type="button" class="btn btn-primary btn-block" id="btn-lok-tambah" style="margin-bottom:12px">+ Tambah Lokasi</button>' +
      '<div id="lok-hasil">' + loadingHTML('Memuat lokasi…') + '</div>';
    $('btn-lok-tambah').addEventListener('click', function () { bukaFormLokasi(null); });
    muatLokasi();
  }
};

function muatLokasi() {
  var kotak = $('lok-hasil');
  if (!kotak) return;
  kotak.innerHTML = loadingHTML('Memuat lokasi…');
  api('lokasi_list', {})
    .then(function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML('📍', 'Belum ada lokasi. Tekan Tambah Lokasi lalu isi koordinat (atau Pakai Lokasi Saya).');
        return;
      }
      kotak.innerHTML = daftar.map(function (l) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(l.nama_lokasi) + '</span>' +
          '<span class="badge ' + (l.status_aktif ? 'aktif' : 'nonaktif') + '">' + (l.status_aktif ? 'Aktif' : 'Nonaktif') + '</span></div>' +
          '<div class="row-meta">🌐 ' + l.latitude + ', ' + l.longitude + ' · radius ' + l.radius_m + ' m</div>' +
          '<div class="row-meta">' + l.karyawan_aktif + ' karyawan aktif</div>' +
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-outline btn-sm" data-lok-ubah="' + esc(l.id_lokasi) + '">Ubah</button>' +
            (l.status_aktif ? '<button type="button" class="btn btn-danger btn-sm" data-lok-matikan="' + esc(l.id_lokasi) + '">Nonaktifkan</button>' : '') +
          '</div>' +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-lok-ubah]'), function (b) {
        b.addEventListener('click', function () {
          var l = daftar.filter(function (x) { return x.id_lokasi === b.dataset.lokUbah; })[0];
          if (l) bukaFormLokasi(l);
        });
      });
      Array.prototype.forEach.call(kotak.querySelectorAll('[data-lok-matikan]'), function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Nonaktifkan lokasi ini?')) return;
          api('lokasi_hapus', { id: b.dataset.lokMatikan })
            .then(function () { toast('Lokasi dinonaktifkan.', 'ok'); muatLokasi(); })
            .catch(function (e) { if (!tanganiErrorSesi(e)) toast(errPesan(e), 'err'); });
        });
      });
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatLokasi);
    });
}

function bukaFormLokasi(l) {
  var baru = !l;
  var html =
    '<form id="form-lokasi" novalidate>' +
      (baru ? '' : '<input type="hidden" id="lok-id" value="' + esc(l.id_lokasi) + '">') +
      '<label class="field"><span>Nama lokasi</span><input type="text" id="lok-nama" maxlength="100" value="' + esc(baru ? '' : l.nama_lokasi) + '" required></label>' +
      '<label class="field"><span>Latitude</span><input type="text" inputmode="decimal" id="lok-lat" value="' + esc(baru ? '' : l.latitude) + '" required></label>' +
      '<label class="field"><span>Longitude</span><input type="text" inputmode="decimal" id="lok-lng" value="' + esc(baru ? '' : l.longitude) + '" required></label>' +
      '<button type="button" class="btn btn-outline btn-block" id="lok-pakai">📍 Pakai Lokasi Saya</button>' +
      '<label class="field mt"><span>Radius (meter)</span><input type="number" id="lok-radius" min="10" max="10000" value="' + esc(baru ? '100' : l.radius_m) + '" required></label>' +
      '<p class="form-error" id="lok-error" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="btn-lok-simpan">' + (baru ? 'Tambah Lokasi' : 'Simpan Perubahan') + '</button>' +
    '</form>';
  bukaModal(baru ? 'Tambah Lokasi' : 'Ubah Lokasi', html, function () {
    $('lok-pakai').addEventListener('click', function () {
      var b = this;
      setBusy(b, true, 'Membaca GPS…');
      mintaLokasi(function (pos, galat) {
        setBusy(b, false);
        if (galat) { toast(galat.pesan, 'err'); return; }
        $('lok-lat').value = Math.round(pos.lat * 1e6) / 1e6;
        $('lok-lng').value = Math.round(pos.lng * 1e6) / 1e6;
        toast('Koordinat dari GPS terisi (akurasi ± ' + Math.round(pos.akurasi) + ' m).', 'ok');
      });
    });
    $('form-lokasi').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('lok-error');
      err.hidden = true;
      var payload = {
        nama_lokasi: $('lok-nama').value.trim(),
        latitude: $('lok-lat').value.trim(),
        longitude: $('lok-lng').value.trim(),
        radius_m: $('lok-radius').value
      };
      if (!baru) payload.id_lokasi = $('lok-id').value;
      var btn = $('btn-lok-simpan');
      setBusy(btn, true, 'Menyimpan…');
      api('lokasi_simpan', payload)
        .then(function () {
          toast(baru ? 'Lokasi ditambahkan.' : 'Perubahan disimpan.', 'ok');
          tutupModal();
          muatLokasi();
        })
        .catch(function (e) {
          if (tanganiErrorSesi(e)) return;
          err.textContent = errPesan(e); err.hidden = false;
          setBusy(btn, false);
        });
    });
  });
}

/* ================================================================ */
/* SCREEN: Pengaturan + daftar hari libur (admin) — F7, F11          */
/* ================================================================ */

var UNITAS_PENGATURAN = {
  jam_masuk: { label: 'Jam masuk', tipe: 'time', wajib: true },
  jam_pulang: { label: 'Jam pulang', tipe: 'time', wajib: true },
  toleransi_menit: { label: 'Toleransi keterlambatan (menit)', tipe: 'number', wajib: true },
  hari_kerja: { label: 'Hari kerja (1=Senin … 7=Minggu)', tipe: 'text', wajib: true },
  radius_default_m: { label: 'Radius default lokasi baru (m)', tipe: 'number', wajib: true },
  akurasi_maks_m: { label: 'Akurasi GPS maksimal (m)', tipe: 'number', wajib: true },
  foto_lebar_maks_px: { label: 'Sisi terpanjang foto (px)', tipe: 'number' },
  foto_kualitas: { label: 'Kualitas foto JPEG (0.1–1)', tipe: 'number' },
  zona_waktu: { label: 'Zona waktu server', tipe: 'text' },
  sesi_jam: { label: 'Masa berlaku sesi (jam)', tipe: 'number' },
  pin_panjang: { label: 'Panjang PIN (digit)', tipe: 'number' },
  maks_gagal_login: { label: 'Batas gagal login', tipe: 'number' },
  kunci_menit: { label: 'Lama akun terkunci (menit)', tipe: 'number' },
  id_folder_foto: { label: 'ID folder foto Drive', tipe: 'text' }
};
var WajibUI = ['jam_masuk', 'jam_pulang', 'toleransi_menit', 'hari_kerja', 'radius_default_m', 'akurasi_maks_m'];

SCREENS.pengaturan = {
  title: 'Pengaturan',
  render: function (el) {
    el.innerHTML = loadingHTML('Memuat pengaturan…');
    Promise.all([api('pengaturan_get', {}), api('libur_list', {})])
      .then(function (hasil) {
        gambarPengaturan(el, hasil[0].pengaturan || {}, hasil[1].daftar || []);
      })
      .catch(function (e) {
        if (tanganiErrorSesi(e)) return;
        el.innerHTML = errorHTML(errPesan(e));
        pasangCobaLagi(el, function () { SCREENS.pengaturan.render(el); });
      });
  }
};

function gambarPengaturan(el, s, libur) {
  function input(key) {
    var meta = UNITAS_PENGATURAN[key];
    if (!meta) return '';
    var val = s[key] === undefined ? '' : s[key];
    return '<label class="field"><span>' + esc(meta.label) + '</span>' +
      '<input type="' + meta.tipe + (meta.tipe === 'number' ? ' step="any"' : '') +
      ' data-kunci="' + key + '" value="' + esc(val) + '"></label>';
  }

  el.innerHTML =
    '<div class="card"><p class="card-title">Jam Kerja &amp; Parameter Absensi</p>' +
    '<form id="form-pengaturan" novalidate>' +
      WajibUI.map(input).join('') +
      '<fieldset class="lanjutan"><legend>Pengaturan lanjutan</legend>' +
        Object.keys(UNITAS_PENGATURAN).filter(function (k) { return WajibUI.indexOf(k) < 0; })
          .map(input).join('') +
      '</fieldset>' +
      '<p class="form-error" id="set-error" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block" id="btn-set-simpan">Simpan Pengaturan</button>' +
      '<p class="small muted mt">Perubahan hanya berlaku untuk absensi berikutnya; data lama tidak berubah.</p>' +
    '</form></div>' +
    '<div class="card"><p class="card-title">Daftar Hari Libur</p>' +
      '<form id="form-libur" novalidate style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<label class="field"><span>Tanggal</span><input type="date" id="libur-tanggal" required></label>' +
        '<label class="field"><span>Keterangan</span><input type="text" id="libur-ket" maxlength="200" placeholder="contoh: Hari Raya" required></label>' +
        '<p class="form-error" id="libur-error" hidden style="grid-column:1/-1"></p>' +
        '<button type="submit" class="btn btn-primary" style="grid-column:1/-1">Tambah / Ubah Libur</button>' +
      '</form>' +
      '<div id="libur-daftar" class="mt">' +
      (libur.length
        ? libur.map(function (r) {
            return '<div class="kv"><span>📅 ' + esc(tampilTanggal(r.tanggal)) + ' — ' + esc(r.keterangan) + '</span>' +
              '<button type="button" class="btn btn-danger btn-sm" data-libur-hapus="' + esc(r.tanggal) + '">Hapus</button></div>';
          }).join('')
        : '<p class="small muted">Belum ada hari libur.</p>') +
      '</div>' +
    '</div>';

  $('form-pengaturan').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('set-error');
    err.hidden = true;
    var payload = {};
    Array.prototype.forEach.call(this.querySelectorAll('[data-kunci]'), function (input) {
      payload[input.dataset.kunci] = input.value.trim();
    });
    var btn = $('btn-set-simpan');
    setBusy(btn, true, 'Menyimpan…');
    api('pengaturan_simpan', payload)
      .then(function () {
        toast('Pengaturan tersimpan.', 'ok');
        bukaScreen('pengaturan');
      })
      .catch(function (e) {
        if (tanganiErrorSesi(e)) return;
        err.textContent = errPesan(e); err.hidden = false;
        setBusy(btn, false);
      });
  });

  $('form-libur').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('libur-error');
    err.hidden = true;
    var tgl = $('libur-tanggal').value;
    var ket = $('libur-ket').value.trim();
    if (!tgl || !ket) { err.textContent = 'Tanggal dan keterangan wajib diisi.'; err.hidden = false; return; }
    api('libur_simpan', { tanggal: tgl, keterangan: ket })
      .then(function () { toast('Hari libur disimpan.', 'ok'); bukaScreen('pengaturan'); })
      .catch(function (e) { if (!tanganiErrorSesi(e)) { err.textContent = errPesan(e); err.hidden = false; } });
  });

  Array.prototype.forEach.call(el.querySelectorAll('[data-libur-hapus]'), function (b) {
    b.addEventListener('click', function () {
      if (!confirm('Hapus permanen libur ' + b.dataset.liburHapus + '?')) return;
      api('libur_hapus', { tanggal: b.dataset.liburHapus })
        .then(function () { toast('Hari libur dihapus.', 'ok'); bukaScreen('pengaturan'); })
        .catch(function (e) { if (!tanganiErrorSesi(e)) toast(errPesan(e), 'err'); });
    });
  });
}

/* ================================================================ */
/* SCREEN: Rekap bulanan + ekspor CSV di sisi klien (F10)             */
/* ================================================================ */

var rekapTerakhir = null;

SCREENS.rekap = {
  title: 'Rekap',
  render: function (el) {
    el.innerHTML =
      '<div class="filter-bar">' +
        '<label class="field full"><span>Bulan</span><input type="month" id="rek-bulan" value="' + bulanIni() + '"></label>' +
        '<button type="button" class="btn btn-primary" id="btn-rek-tampil">Tampilkan</button>' +
        '<button type="button" class="btn btn-outline" id="btn-rek-csv" disabled>⬇ Ekspor CSV</button>' +
      '</div>' +
      '<div id="rek-hasil">' + loadingHTML('Memuat rekap…') + '</div>';
    $('btn-rek-tampil').addEventListener('click', muatRekap);
    $('btn-rek-csv').addEventListener('click', eksporRekapCSV);
    muatRekap();
  }
};

function muatRekap() {
  var kotak = $('rek-hasil');
  var btnCsv = $('btn-rek-csv');
  var bulan = $('rek-bulan').value || bulanIni();
  btnCsv.disabled = true;
  rekapTerakhir = null;
  kotak.innerHTML = loadingHTML('Memuat rekap bulanan…');
  api('rekap_bulanan', { bulan: bulan })
    .then(function (data) {
      rekapTerakhir = data;
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML('📑', 'Belum ada data karyawan untuk rekap.');
        return;
      }
      kotak.innerHTML =
        '<p class="small muted">Bulan ' + esc(data.bulan) + ' — ' + data.jumlah_hari_kerja +
        ' hari kerja (tanpa libur), ' + data.hari_kerja_terlewat + ' sudah berlalu.</p>' +
        '<div class="table-wrap"><table class="data"><thead><tr>' +
          '<th>Karyawan</th><th>Hari Kerja</th><th>Hadir</th><th>Terlambat</th><th>Izin</th><th>Alpa</th><th>Belum Pulang</th>' +
        '</tr></thead><tbody>' +
        daftar.map(function (r) {
          return '<tr><td>' + esc(r.nama) + (r.status_aktif ? '' : ' <span class="badge nonaktif">Nonaktif</span>') + '</td>' +
            '<td>' + r.hari_kerja + '</td><td>' + r.hadir + '</td><td>' + r.terlambat + '</td>' +
            '<td>' + r.izin + '</td><td>' + (r.alpa > 0 ? '<b style="color:var(--merah)">' + r.alpa + '</b>' : '0') + '</td>' +
            '<td>' + r.belum_absen_pulang + '</td></tr>';
        }).join('') + '</tbody></table></div>' +        '<p class="small muted mt">Definisi: <b>Hadir</b> = seluruh absensi bulan ini, termasuk yang terlambat; ' +
            '<b>Terlambat</b> = bagian dari Hadir; ' +
            '<b>Alpa</b> = hari kerja yang sudah lewat, bukan libur, tanpa absensi dan tanpa izin Disetujui. ' +
            '<b>Belum Pulang</b> = baris absensi bulan ini tanpa jam pulang.</p>';
      btnCsv.disabled = false;
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatRekap);
    });
}

function csvSel(s) {
  var v = String(s === null || s === undefined ? '' : s);
  return '"' + v.replace(/"/g, '""') + '"';
}

function eksporRekapCSV() {
  if (!rekapTerakhir) return;
  var baris = [['ID', 'Nama', 'Jabatan', 'Hari Kerja', 'Hadir', 'Terlambat', 'Izin', 'Alpa', 'Belum Absen Pulang']];
  rekapTerakhir.daftar.forEach(function (r) {
    baris.push([r.id_karyawan, r.nama, r.jabatan || '', r.hari_kerja, r.hadir, r.terlambat, r.izin, r.alpa, r.belum_absen_pulang]);
  });
  var csv = '\uFEFF' + baris.map(function (b) { return b.map(csvSel).join(';'); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'rekap-absensi-' + rekapTerakhir.bulan + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  toast('CSV rekap ' + rekapTerakhir.bulan + ' diunduh.', 'ok');
}

/* ================================================================ */
/* SCREEN: Log audit (admin) — F12                                   */
/* ================================================================ */

SCREENS.log = {
  title: 'Log',
  render: function (el) {
    var d = new Date();
    var akhir = d.getFullYear() + '-' + jam2(d.getMonth() + 1) + '-' + jam2(d.getDate());
    var d2 = new Date(d.getTime() - 6 * 86400000);
    var awal = d2.getFullYear() + '-' + jam2(d2.getMonth() + 1) + '-' + jam2(d2.getDate());
    el.innerHTML =
      '<div class="filter-bar">' +
        '<label class="field"><span>Dari</span><input type="date" id="log-dari" value="' + awal + '"></label>' +
        '<label class="field"><span>Sampai</span><input type="date" id="log-sampai" value="' + akhir + '"></label>' +
        '<button type="button" class="btn btn-primary" id="btn-log-tampil">Tampilkan</button>' +
      '</div>' +
      '<div id="log-hasil">' + loadingHTML('Memuat log…') + '</div>';
    $('btn-log-tampil').addEventListener('click', muatLog);
    muatLog();
  }
};

function muatLog() {
  var kotak = $('log-hasil');
  if (!kotak) return;
  kotak.innerHTML = loadingHTML('Memuat log…');
  api('log_list', { tanggal_mulai: $('log-dari').value, tanggal_selesai: $('log-sampai').value })
    .then(function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML('📜', 'Tidak ada aktivitas pada rentang tanggal ini.');
        return;
      }
      kotak.innerHTML = daftar.map(function (r) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name small">' + esc(tampilWaktu(r.waktu)) + '</span>' +
          '<span class="badge">' + esc(r.aksi) + '</span></div>' +
          '<div class="row-meta">' + esc(r.nama) + ' (' + esc(r.id_pengguna) + ')</div>' +
          '<div class="row-meta">' + esc(r.detail) + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (e) {
      if (tanganiErrorSesi(e)) return;
      kotak.innerHTML = errorHTML(errPesan(e));
      pasangCobaLagi(kotak, muatLog);
    });
}

/* ================================================================ */
/* Boot aplikasi                                                     */
/* ================================================================ */

function pulihkanSesi() {
  var simpanan = muatUser();
  var token = getToken();
  if (!token || !simpanan || !simpanan.role) {
    clearToken();
    tampilkanLogin();
    return;
  }
  // Tahap 1 — sesi optimistis: aplikasi langsung dirender dari data lokal;
  // validasi token ke server berjalan di latar belakang lewat pemuatan
  // Beranda (status_hari_ini). Layar login tidak pernah berkedip saat
  // refresh selama sesi masih ada; bila token mati, tanganiErrorSesi di
  // render Beranda mengembalikan pengguna ke layar login dengan pesan server.
  // Efek samping: satu panggilan status_hari_ini duplikat per boot ikut hilang.
  state.user = simpanan;
  state.hariIni = null;
  masukAplikasi();
}

function boot() {
  $('form-login').addEventListener('submit', kirimLogin);
  $('absen-close').addEventListener('click', tutupAlurAbsen);
  $('modal-close').addEventListener('click', tutupModal);
  $('overlay-modal').addEventListener('click', function (ev) {
    if (ev.target === $('overlay-modal')) tutupModal();
  });

  // service worker hanya untuk pemasangan & keandalan muat (bukan mode offline absen)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  if (typeof console !== 'undefined' && console.time) {
    try { console.time('boot'); } catch (e) {}
  }

  pulihkanSesi();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}