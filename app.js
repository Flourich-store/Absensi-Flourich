/**
 * app.js — seluruh layar aplikasi absensi (bagian 11 PRD).
 * Desain mobile-first, navigasi tab di bawah, semua teks berbahasa Indonesia.
 *
 * Layar karyawan : Beranda (absen satu layar), Izin, Riwayat, Profil
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

/*
 * Generasi layar. Setiap perpindahan menu menaikkan nomornya.
 * Masalah lama: jawaban jaringan yang datang terlambat menulis ke #content
 * yang sudah dipakai menu lain — menu baru sempat menampilkan data menu
 * sebelumnya. apiLayar() mengikat permintaan ke generasi saat ia dimulai;
 * bila generasi sudah berubah, rantai .then/.catch layar lama dihentikan
 * (promise yang tidak pernah selesai) sehingga tidak ada lagi tulisan nyasar.
 */
var layarGen = 0;

function apiLayar(action, data) {
  var gen = layarGen;
  return api(action, data).then(function (d) {
    if (gen !== layarGen) return new Promise(function () {});
    return d;
  });
}

/**
 * Muat satu panel layar dengan memanfaatkan cache baca (API_CACHE_MS di
 * api.js).
 *
 * Data yang masih segar langsung digambar tanpa spinner — inilah yang membuat
 * berpindah menu terasa seketika: panel tidak pernah "kosong lalu menunggu
 * jaringan" bila isinya sudah ada di memori. Bila belum ada, panel menampilkan
 * status memuat lalu meminta ke server seperti biasa.
 *
 * @param {string} action action baca (harus terdaftar di API_CACHE_MS)
 * @param {object} payload payload permintaan
 * @param {HTMLElement} kotak kontainer panel (null = tanpa status memuat)
 * @param {string} pesan teks status memuat
 * @param {function} gambar menerima data, lalu mengisi kotak
 * @returns {Promise} selesai setelah panel digambar
 */
function muatPanel(action, payload, kotak, pesan, gambar) {
  var tersimpan = apiTersimpan(action, payload || {});
  if (tersimpan) {
    gambar(tersimpan);
    return Promise.resolve(tersimpan);
  }
  if (kotak) kotak.innerHTML = loadingHTML(pesan);
  return apiLayar(action, payload || {}).then(function (data) {
    gambar(data);
    return data;
  });
}

/* ---- Pemanasan cache: menu berikutnya sudah berisi saat diketuk -------- */
/*
 * Setelah sebuah layar tampil, data menu lain diminta di latar belakang supaya
 * saat tab-nya diketuk isinya sudah ada di cache dan langsung tampil tanpa
 * spinner. Hanya action baca (terdaftar di API_CACHE_MS) yang ikut di sini —
 * aksi pengubah data tidak pernah dipanggil otomatis.
 */
var pemanasanJalan = false;
var pemanasanTimer = null;

function daftarPemanasan() {
  var d = new Date();
  var hari = d.getFullYear() + '-' + jam2(d.getMonth() + 1) + '-' + jam2(d.getDate());
  var daftar = [{ action: 'status_hari_ini', data: {} }];
  if (state.user && state.user.role === 'admin') {
    var d7 = new Date(d.getTime() - 6 * 86400000);
    var dari7 = d7.getFullYear() + '-' + jam2(d7.getMonth() + 1) + '-' + jam2(d7.getDate());
    daftar.push({ action: 'dashboard_hari_ini', data: {} });
    daftar.push({ action: 'karyawan_list', data: {} });
    daftar.push({ action: 'lokasi_list', data: {} });
    daftar.push({ action: 'absensi_list', data: { tanggal_mulai: hari, tanggal_selesai: hari } });
    daftar.push({ action: 'izin_list', data: { status: 'Menunggu' } });
    daftar.push({ action: 'pengaturan_get', data: {} });
    daftar.push({ action: 'libur_list', data: {} });
    daftar.push({ action: 'rekap_bulanan', data: { bulan: bulanIni() } });
    daftar.push({ action: 'log_list', data: { tanggal_mulai: dari7, tanggal_selesai: hari } });
  } else {
    daftar.push({ action: 'izin_saya', data: {} });
    daftar.push({ action: 'riwayat_saya', data: { bulan: bulanIni() } });
  }
  return daftar;
}

function panaskanCache() {
  if (pemanasanJalan || !state.user) return;
  var antre = daftarPemanasan().filter(function (a) {
    return !apiTersimpan(a.action, a.data);
  });
  if (!antre.length) return;
  pemanasanJalan = true;
  (function lanjut(i) {
    if (i >= antre.length) { pemanasanJalan = false; return; }
    var a = antre[i];
    var berikut = function () { setTimeout(function () { lanjut(i + 1); }, 200); };
    api(a.action, a.data).then(berikut, function (e) {
      // sesi mati: hentikan pemanasan, layar aktif yang akan mengurus login
      if (errKode(e) === 'TOKEN_INVALID' || errKode(e) === 'AKUN_NONAKTIF') { pemanasanJalan = false; return; }
      berikut();
    });
  })(0);
}

/** Jadwalkan pemanasan cache sekali; pemanggilan beruntun tidak menumpuk. */
function jadwalkanPemanasan() {
  if (pemanasanTimer) clearTimeout(pemanasanTimer);
  pemanasanTimer = setTimeout(function () {
    pemanasanTimer = null;
    panaskanCache();
  }, 500);
}

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
  return '<div class="error-state"><span class="state-ico" aria-hidden="true">' + ikonSvg('peringatan') + '</span><p>' +
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
    if (!btn.dataset.asli) btn.dataset.asli = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span>' +
      '<span>' + esc(teksSibuk || 'Memproses…') + '</span>';
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.asli) btn.innerHTML = btn.dataset.asli;
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
 * Ikon = sprite SVG di index.html (`<symbol id="i-nama">`), dipakai lewat
 * <use href="#i-nama">. Path ikon hanya tersimpan di satu tempat, dimuat
 * sekali bersama HTML, dan app.js cukup menulis satu node <use> per ikon.
 * Bentuk & warnanya diatur aturan .ico di styles.css (currentColor), jadi ikon
 * otomatis mengikuti warna teks/banner/pil. Nama ikon harus ada di sprite —
 * diuji oleh tools/uji_ikon.js.
 */
function ikonSvg(nama, kelas) {
  return '<svg class="' + (kelas || 'ico') + '" aria-hidden="true" focusable="false">' +
    '<use href="#i-' + nama + '"></use></svg>';
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
  layarGen++;                      // batalkan semua render layar sebelumnya
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
  jadwalkanPemanasan();   // siapkan data menu lain agar pindah tab tanpa jeda
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
  var admin = !!(user && user.role === 'admin');
  var pill = admin ? { teks: 'Administrator', kelas: 'info' } : statusPill(h.status);
  var tombol = '';
  if (admin) {
    // Administrator mengelola absensi karyawan, bukan melakukan absensi sendiri.
    tombol =
      '<div class="banner info">' + ikonSvg('kunci') + ' Akun administrator tidak melakukan absensi. ' +
      'Absensi karyawan dipantau lewat menu Dashboard dan Absensi.</div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-primary" id="btn-ke-dashboard">Dashboard hari ini</button>' +
        '<button type="button" class="btn btn-outline" id="btn-ke-absensi">Daftar absensi</button>' +
      '</div>';
  } else if (h.jenis_absen_berikut === 'masuk') {
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
    banner = '<div class="banner">' + ikonSvg('kunci') + ' Anda wajib mengganti PIN setelah login. ' +
      '<button type="button" class="btn-text" id="btn-ke-ganti-pin" style="color:inherit;text-decoration:underline">Ganti PIN sekarang</button></div>';
  }
  if (h.status === 'libur') {
    var ket = h.hari_libur ? (h.hari_libur.keterangan || 'Hari libur') : 'Bukan hari kerja';
    banner += '<div class="banner info">' + ikonSvg('libur') + ' Hari libur: ' + esc(ket) + '. Absen tidak diperlukan.</div>';
  }
  if (h.status === 'izin' && h.izin) {
    banner += '<div class="banner info">' + ikonSvg('centang-lingkar') + ' Izin ' + esc(h.izin.jenis) + ' disetujui (' +
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
    (admin ? '' :
      '<div class="card mt"><p class="card-title">Hari ini</p>' + lokasiInfo +
        '<div class="kv"><span>Jam kerja</span><b>' + esc(tampilJam(h.jam_masuk)) + ' – ' + esc(tampilJam(h.jam_pulang)) + '</b></div>' +
        '<div class="kv"><span>Akurasi GPS maksimal</span><b>' + esc(h.akurasi_maks_m) + ' m</b></div>' +
      '</div>' +
      detailAbsen);
}

SCREENS.beranda = {
  title: 'Beranda',
  render: function (el) {
    muatPanel('status_hari_ini', {}, el, 'Memuat beranda…', function (h) {
        state.hariIni = h;
        state.user.wajib_ganti_pin = h.wajib_ganti_pin;
        el.innerHTML = berandaHTML(h, state.user);
        var bMasuk = $('btn-absen-masuk');
        var bPulang = $('btn-absen-pulang');
        if (bMasuk) bMasuk.addEventListener('click', function () { bukaAlurAbsen('masuk'); });
        if (bPulang) bPulang.addEventListener('click', function () { bukaAlurAbsen('pulang'); });
        var bPin = $('btn-ke-ganti-pin');
        if (bPin) bPin.addEventListener('click', function () { bukaScreen('profil'); });
        var bDash = $('btn-ke-dashboard');
        if (bDash) bDash.addEventListener('click', function () { bukaScreen('dashboard'); });
        var bAbs = $('btn-ke-absensi');
        if (bAbs) bAbs.addEventListener('click', function () { bukaScreen('absensi'); });
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
/* Alur Absen — SATU layar (peta, selfie, kirim)                     */
/*                                                                   */
/* Alur 5 langkah diganti satu layar: peta area absen di atas, kartu  */
/* selfie + ringkasan di tengah, satu tombol Kirim di bawah. Semua    */
/* syarat PRD tetap berlaku dan diperiksa sebelum kirim:              */
/*   - lokasi GPS harus valid di dalam radius (hasil preview server)  */
/*   - selfie wajib diambil saat itu (kamera depan, tanpa galeri)     */
/*   - alasan keterlambatan wajib bila lewat toleransi                */
/* Penolakan tetap diputuskan server; layar hanya menyembunyikan      */
/* tombol Kirim selama syarat belum lengkap.                          */
/* ================================================================ */

var PETA_MIN_ZOOM = 3;
/*
 * Ubin peta: gaya CARTO Voyager — palet pastel, jalan putih, blok bangunan
 * abu muda, dan air biru muda, yaitu gaya kartografi yang dipakai Google Maps.
 * Dipilih karena tampilannya paling dekat dengan Google Maps tanpa perlu
 * kunci API/billing (ubin Google Maps tidak boleh dipakai langsung oleh
 * aplikasi pihak ketiga). Ubin tetap butuh jaringan; Leaflet-nya lokal.
 */
var PETA_TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
var PETA_ATRIBUSI = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
var PETA_BIRU = '#1a73e8';      // biru titik posisi pengguna, seperti Google Maps
var petaAbsen = null;   // { peta: L.Map, lapisan: L.LayerGroup }
var absenJamTimer = null;

function petaSiap() {
  return typeof L !== 'undefined' && L && typeof L.map === 'function';
}

function angkaAtauNull(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function hancurkanPeta() {
  if (petaAbsen && petaAbsen.peta) {
    try { petaAbsen.peta.remove(); } catch (e) {}
  }
  petaAbsen = null;
  var bungkus = $('peta-bungkus');
  if (bungkus) bungkus.hidden = true;
}

function labelJarak(m) {
  var n = angkaAtauNull(m);
  if (n === null) return '-';
  if (n < 1000) return Math.round(n) + ' m';
  return (n / 1000).toFixed(1).replace('.', ',') + ' km';
}

/**
 * Penanda peta bergaya Google Maps:
 *  - 'kantor' -> pin tetes air (teardrop) berwarna, ujungnya menunjuk koordinat
 *  - 'saya'   -> titik biru dengan cincin putih + halo lembut
 */
function titikPeta(warna, jenis) {
  if (jenis === 'kantor') {
    return L.divIcon({
      className: 'peta-marker peta-marker-pin',
      html: '<svg class="peta-pin" viewBox="0 0 24 36" aria-hidden="true">' +
        '<path d="M12 0C5.37 0 0 5.37 0 12c0 8.4 12 24 12 24s12-15.6 12-24C24 5.37 18.63 0 12 0z" fill="' + warna + '"/>' +
        '<circle cx="12" cy="12" r="4.6" fill="#fff"/></svg>',
      iconSize: [26, 39],
      iconAnchor: [13, 38]
    });
  }
  return L.divIcon({
    className: 'peta-marker',
    html: '<span class="peta-halo"></span>' +
      '<span class="peta-titik saya" style="--warna:' + warna + '"></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

/**
 * Gambar (atau perbarui) peta area absen.
 *
 * Peta memakai Leaflet + ubin CARTO Voyager: gaya kartografi yang menyerupai
 * Google Maps. Leaflet disajikan dari perangkat (vendor/), ubin dari jaringan.
 * Tidak ada layanan peta berbayar, tidak ada kunci API, dan tidak ada kartu
 * yang perlu ditempel — cukup jaringan untuk mengunduh ubin.
 *
 * @param {object} posisi  {lat,lng,akurasi} hasil GPS pengguna
 * @param {object} lokasi  {latitude,longitude,radius_m,nama_lokasi} lokasi kerja
 * @param {object} hasil   hasil preview_absen (opsional; null = belum divalidasi)
 */
function gambarPeta(posisi, lokasi, hasil) {
  var bungkus = $('peta-bungkus');
  var el = $('peta-lokasi');
  if (!bungkus || !el) return;

  var latLokasi = lokasi ? angkaAtauNull(lokasi.latitude) : null;
  var lngLokasi = lokasi ? angkaAtauNull(lokasi.longitude) : null;
  if (!petaSiap() || !posisi || latLokasi === null || lngLokasi === null) {
    hancurkanPeta();
    return;
  }

  var radius = angkaAtauNull(hasil && hasil.radius_m) || angkaAtauNull(lokasi.radius_m) || 100;
  var jarak = hasil ? angkaAtauNull(hasil.jarak_m) : null;
  var valid = hasil ? !!hasil.valid : null;          // null = belum divalidasi server
  var warna = valid === false ? '#f0544f' : '#1b7a43';

  bungkus.hidden = false;

  if (!petaAbsen) {
    el.innerHTML = '';
    var p = L.map(el, {
      zoomControl: false,
      scrollWheelZoom: false,   // gulir halaman tidak "tertahan" peta di ponsel
      attributionControl: true,
      minZoom: PETA_MIN_ZOOM
    });
    // Tombol +/− di kanan bawah dan atribusi di kiri bawah, seperti Google Maps.
    L.control.zoom({ position: 'bottomright' }).addTo(p);
    if (p.attributionControl) p.attributionControl.setPosition('bottomleft');
    L.tileLayer(PETA_TILE, {
      maxZoom: 20,
      subdomains: 'abcd',
      detectRetina: true,
      attribution: PETA_ATRIBUSI
    }).addTo(p);
    petaAbsen = { peta: p, lapisan: L.layerGroup().addTo(p) };
  }

  var lap = petaAbsen.lapisan;
  lap.clearLayers();

  // area absen resmi
  L.circle([latLokasi, lngLokasi], {
    radius: radius, color: warna, weight: 2, opacity: .9,
    fillColor: warna, fillOpacity: .12, interactive: false
  }).addTo(lap);
  L.marker([latLokasi, lngLokasi], {
    icon: titikPeta(warna, 'kantor'), interactive: false, keyboard: false
  }).addTo(lap);

  // garis ukur antara posisi pengguna dan pusat area
  if (jarak !== null && jarak > 0) {
    L.polyline([[posisi.lat, posisi.lng], [latLokasi, lngLokasi]], {
      color: warna, weight: 2, opacity: .75, dashArray: '5 7', interactive: false
    }).addTo(lap);
  }

  // jarak ditulis sebagai lencana di sudut peta: pada jarak pendek titik dan
  // pusat hanya beberapa piksel terpisah, label di tengah garis jadi tumpang
  // tindih dengan titik pengguna.
  var lencana = $('peta-badge');
  if (lencana) {
    lencana.hidden = jarak === null;
    lencana.className = 'peta-badge' + (valid === false ? ' di-luar' : '');
    if (jarak !== null) lencana.textContent = 'Jarak ' + labelJarak(jarak);
  }

  // posisi pengguna + lingkaran akurasi GPS (biru Google Maps)
  if (posisi.akurasi > 0) {
    L.circle([posisi.lat, posisi.lng], {
      radius: Math.min(posisi.akurasi, 5000), color: PETA_BIRU, weight: 1, opacity: .35,
      fillColor: PETA_BIRU, fillOpacity: .12, interactive: false
    }).addTo(lap);
  }
  L.marker([posisi.lat, posisi.lng], {
    icon: titikPeta(PETA_BIRU, 'saya'), interactive: false, keyboard: false
  }).addTo(lap);

  // bingkai: pusat + tepi lingkaran + posisi pengguna
  var batas = L.latLng(latLokasi, lngLokasi).toBounds(radius * 2.4);
  batas.extend([posisi.lat, posisi.lng]);
  petaAbsen.peta.fitBounds(batas, { padding: [16, 16], maxZoom: 17 });

  // kontainer bisa baru berukuran setelah overlay tampil
  setTimeout(function () {
    if (petaAbsen && petaAbsen.peta) petaAbsen.peta.invalidateSize();
  }, 60);

  var ket = $('peta-ket');
  if (ket) {
    ket.innerHTML = ikonSvg('bumi') + ' <span>Lingkaran absen ' + esc(Math.round(radius)) + ' m' +
      (valid === false ? ' — posisi Anda di luar area' : ' · titik biru posisi Anda') + '</span>';
  }
}

function kodeJudul(kode) {
  switch (kode) {
    case 'DI_LUAR_RADIUS': return 'Di luar radius lokasi kerja';
    case 'AKURASI_BURUK': return 'Akurasi GPS buruk';
    case 'SUDAH_ABSEN': return 'Anda sudah absen';
    case 'BELUM_ABSEN_MASUK': return 'Belum absen masuk';
    case 'HARI_LIBUR': return 'Hari ini bukan hari kerja';
    case 'SEDANG_IZIN': return 'Anda sedang izin';
    default: return 'Absen tidak dapat dilanjutkan';
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

/* ---- Buka / tutup layar absen ------------------------------------ */

function bukaAlurAbsen(jenis) {
  // Administrator mengelola absensi, bukan melakukan absensi.
  if (state.user && state.user.role === 'admin') {
    toast('Akun administrator tidak melakukan absensi.');
    return;
  }
  state.absen = {
    jenis: jenis,
    posisi: null,
    hasil: null,
    galatLokasi: null,
    memuat: true,
    foto: null,
    fotoKb: 0,
    alasan: '',
    kamera: false,
    mengirim: false,
    sukses: null,
    gagal: null,
    gagalKode: null
  };
  $('overlay-absen').hidden = false;
  $('absen-title').textContent = jenis === 'masuk' ? 'Absen Masuk' : 'Absen Pulang';
  gambarAbsen();
  muatLokasiAbsen();
}

function tutupAlurAbsen() {
  matikanKamera();
  hancurkanPeta();
  if (absenJamTimer) { clearInterval(absenJamTimer); absenJamTimer = null; }
  $('overlay-absen').hidden = true;
  state.absen = null;
}

/* ---- Kerangka layar (dibangun sekali) ---------------------------- */

function gambarAbsen() {
  var a = state.absen;
  if (!a) return;

  $('absen-body').innerHTML =
    '<section class="peta-bungkus" id="peta-bungkus" hidden>' +
      '<div class="peta" id="peta-lokasi" role="img" ' +
        'aria-label="Peta lokasi kerja, area absen, dan posisi Anda"></div>' +
      '<span class="peta-badge" id="peta-badge" hidden></span>' +
      '<p class="peta-ket small muted" id="peta-ket"></p>' +
    '</section>' +
    '<div class="absen-status" id="absen-status" role="status"></div>' +
    '<div class="absen-kamera" id="absen-kamera" hidden></div>' +
    '<div class="absen-kartu">' +
      '<button type="button" class="absen-foto" id="absen-foto" aria-label="Ambil selfie"></button>' +
      '<div class="absen-meta">' +
        '<div class="absen-jenis" id="absen-jenis"></div>' +
        '<div class="absen-baris"><span>Tanggal dan jam</span><b class="absen-waktu" id="absen-waktu"></b></div>' +
        '<div class="absen-baris" id="absen-baris-tambahan" hidden><span id="absen-label-tambahan"></span>' +
          '<b id="absen-tambahan"></b></div>' +
        '<div class="absen-baris"><span>Jarak ke lokasi</span><b id="absen-jarak">—</b></div>' +
      '</div>' +
    '</div>' +
    '<div class="absen-alasan" id="absen-alasan" hidden>' +
      '<label class="field"><span>Alasan keterlambatan (wajib)</span>' +
      '<textarea id="absen-alasan-input" maxlength="500" ' +
        'placeholder="contoh: Macet di jalan tol" aria-describedby="absen-alasan-hint"></textarea>' +
      '<div class="field-hint" id="absen-alasan-hint"><span id="absen-alasan-hitung">0</span>/500 — minimal 5 karakter</div>' +
      '</label>' +
    '</div>' +
    '<div id="absen-pesan"></div>';

  var foot = $('absen-foot');
  foot.hidden = false;
  foot.innerHTML =
    '<div class="absen-aksi">' +
      '<button type="button" class="btn btn-ghost" id="absen-batal">Batal</button>' +
      '<button type="button" class="btn btn-primary btn-kirim-absen" id="btn-kirim-absen" disabled>' +
        ikonSvg('kirim') + '<span>Kirim</span>' +
      '</button>' +
    '</div>';

  $('absen-batal').addEventListener('click', tutupAlurAbsen);
  $('btn-kirim-absen').addEventListener('click', kirimAbsen);

  // Tombol foto: tanpa foto -> buka kamera; sudah ada foto -> ulangi.
  $('absen-foto').addEventListener('click', function () {
    var s = state.absen;
    if (!s || s.kamera || s.sukses || s.mengirim) return;
    if (s.foto) { s.foto = null; s.fotoKb = 0; perbaruiAbsen(); }
    bukaKamera();
  });

  var input = $('absen-alasan-input');
  input.value = a.alasan || '';
  input.addEventListener('input', function () {
    if (!state.absen) return;
    state.absen.alasan = input.value;
    $('absen-alasan-hitung').textContent = String(input.value.length);
    perbaruiAbsen();
  });

  perbaruiAbsen();
  mulaiJamAbsen();
}

/** Tombol "Coba Lagi"/"Perbarui" pada blok status selalu dipasang ulang. */
function pasangUlangLokasi() {
  var b = $('absen-ulang-lokasi');
  if (b) b.addEventListener('click', muatLokasiAbsen);
}

function alasanCukup(a) {
  if (!a.hasil || !a.hasil.alasan_wajib || a.jenis !== 'masuk') return true;
  return String(a.alasan || '').trim().length >= 5;
}

function siapKirim(a) {
  return !!(a && !a.mengirim && !a.sukses && a.posisi && a.hasil && a.hasil.valid && a.foto && alasanCukup(a));
}

/** Segarkan seluruh bagian layar dari state.absen. */
function perbaruiAbsen() {
  var a = state.absen;
  var status = $('absen-status');
  if (!a || !status || a.sukses) return;

  var h = a.hasil;
  var valid = !!(h && h.valid);

  // --- status lokasi
  if (a.memuat) {
    status.className = 'absen-status is-memuat';
    status.innerHTML = '<span class="spinner spinner-sm" aria-hidden="true"></span>' +
      '<div><b>Mengambil lokasi GPS…</b><br><span>Pastikan Mode Lokasi aktif.</span></div>';
  } else if (a.galatLokasi) {
    status.className = 'absen-status is-err';
    status.innerHTML = ikonSvg('peringatan') +
      '<div><b>Lokasi tidak terbaca</b><br><span>' + esc(a.galatLokasi) + '</span></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="absen-ulang-lokasi">Coba Lagi</button>';
    pasangUlangLokasi();
  } else if (h && !h.valid) {
    status.className = 'absen-status is-err';
    status.innerHTML = ikonSvg('silang-lingkar') +
      '<div><b>' + esc(kodeJudul(h.code)) + '</b><br><span>' + esc(h.pesan) + '</span></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="absen-ulang-lokasi">Coba Lagi</button>';
    pasangUlangLokasi();
  } else if (h) {
    status.className = 'absen-status is-ok';
    status.innerHTML = ikonSvg('centang-lingkar') +
      '<div><b>Di dalam area absen</b><br><span>' + esc(labelJarak(h.jarak_m)) + ' dari pusat · akurasi GPS ' +
      esc(h.akurasi) + ' m</span></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="absen-ulang-lokasi">Perbarui</button>';
    pasangUlangLokasi();
  }

  // --- foto selfie
  var foto = $('absen-foto');
  if (foto) {
    if (a.foto) {
      foto.className = 'absen-foto is-isi';
      foto.innerHTML = '<img class="absen-foto-img" src="' + a.foto + '" alt="Selfie absensi">' +
        '<span class="absen-foto-edit" aria-hidden="true">' + ikonSvg('pensil') + '</span>';
      foto.setAttribute('aria-label', 'Ulangi selfie');
    } else {
      foto.className = 'absen-foto';
      foto.innerHTML = '<span class="absen-foto-ikon" aria-hidden="true">' + ikonSvg('kamera') + '</span>' +
        '<span class="absen-foto-label">Selfie</span>';
      foto.setAttribute('aria-label', 'Ambil selfie');
    }
  }

  // --- ringkasan
  var jenisTeks = a.jenis === 'masuk' ? 'Absen Masuk' : 'Absen Pulang';
  $('absen-jenis').textContent = jenisTeks;
  $('absen-jarak').textContent = h ? labelJarak(h.jarak_m) : '—';

  var tambahan = $('absen-baris-tambahan');
  var hari = state.hariIni || {};
  if (a.jenis === 'masuk' && hari.jam_masuk) {
    $('absen-label-tambahan').textContent = 'Batas jam masuk';
    $('absen-tambahan').textContent = tampilJam(hari.jam_masuk) + ' + ' + (hari.toleransi_menit || 0) + ' mnt';
    tambahan.hidden = false;
  } else if (a.jenis === 'pulang' && hari.absensi && hari.absensi.jam_masuk) {
    $('absen-label-tambahan').textContent = 'Durasi kehadiran';
    $('absen-tambahan').textContent = durasiHadir(hari.absensi.jam_masuk) || '—';
    tambahan.hidden = false;
  } else {
    tambahan.hidden = true;
  }

  // --- alasan keterlambatan (muncul hanya bila server mewajibkannya)
  var alasan = $('absen-alasan');
  var wajibAlasan = !!(h && h.alasan_wajib && a.jenis === 'masuk');
  alasan.hidden = !wajibAlasan;

  // --- pesan kegagalan kirim
  var pesan = $('absen-pesan');
  pesan.innerHTML = a.gagal
    ? '<div class="banner error"><strong>Absen ' + (a.jenis === 'masuk' ? 'masuk' : 'pulang') +
      ' gagal.</strong><br>' + esc(a.gagal) + '</div>'
    : '';

  // --- tombol kirim
  var tombol = $('btn-kirim-absen');
  if (tombol) {
    tombol.disabled = !siapKirim(a);
    tombol.innerHTML = ikonSvg('kirim') + '<span>' + (a.mengirim ? 'Mengirim…' : 'Kirim') + '</span>';
  }

  perbaruiWaktuAbsen();
}

function perbaruiWaktuAbsen() {
  var a = state.absen;
  var e = $('absen-waktu');
  if (!a || !e) return;
  e.textContent = tanggalSingkat(new Date()) + ' | ' + jamSekarang();
  if (a.jenis === 'pulang') {
    var t = $('absen-tambahan');
    var hari = state.hariIni || {};
    if (t && hari.absensi && hari.absensi.jam_masuk) t.textContent = durasiHadir(hari.absensi.jam_masuk) || '—';
  }
}

function mulaiJamAbsen() {
  if (absenJamTimer) clearInterval(absenJamTimer);
  absenJamTimer = setInterval(perbaruiWaktuAbsen, 1000);
}

function tanggalSingkat(d) {
  try {
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) {
    return String(d.getDate()) + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }
}

/** "08:04:00" -> "1 jam 32 menit" (durasi sejak jam masuk). */
function durasiHadir(jamMasuk) {
  var s = tampilJam(jamMasuk);
  var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || ''));
  if (!m) return '';
  var d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] || 0), 0);
  var menit = Math.floor((Date.now() - d.getTime()) / 60000);
  if (!isFinite(menit) || menit < 0) return '';
  return Math.floor(menit / 60) + ' jam ' + (menit % 60) + ' menit';
}

/* ---- Lokasi: GPS lalu validasi server ---------------------------- */

function muatLokasiAbsen() {
  var a = state.absen;
  if (!a || a.sukses) return;
  a.memuat = true;
  a.hasil = null;
  a.galatLokasi = null;
  a.posisi = null;
  perbaruiAbsen();

  mintaLokasi(function (posisi, galat) {
    if (state.absen !== a) return;          // layar sudah ditutup / dibuka ulang
    if (galat) {
      a.memuat = false;
      a.galatLokasi = galat.pesan;
      hancurkanPeta();
      perbaruiAbsen();
      return;
    }
    a.posisi = posisi;
    var lokasiAwal = state.hariIni && state.hariIni.lokasi ? state.hariIni.lokasi : null;
    gambarPeta(posisi, lokasiAwal, null);   // tampil segera, tanpa menunggu server
    api('preview_absen', {
      jenis: a.jenis,
      lat: posisi.lat,
      lng: posisi.lng,
      akurasi: posisi.akurasi
    }).then(function (hasil) {
      if (state.absen !== a) return;
      a.hasil = hasil;
      a.memuat = false;
      a.galatLokasi = null;
      gambarPeta(posisi, hasil.lokasi || lokasiAwal, hasil);
      perbaruiAbsen();
    }).catch(function (e) {
      if (state.absen !== a) return;
      if (tanganiErrorSesi(e)) return;
      a.memuat = false;
      a.galatLokasi = errPesan(e);
      perbaruiAbsen();
    });
  });
}

/* ---- Kamera selfie (inline di layar yang sama) ------------------- */

var UKURAN_SISI_FOTO = 640;   // sesuai default foto_lebar_maks_px (bagian 7)
var KUALITAS_FOTO = 0.7;      // sesuai default foto_kualitas
var facingModeAktif = 'user';   // 'user' = depan (selfie), 'environment' = belakang

function bukaKamera() {
  var a = state.absen;
  if (!a) return;
  a.kamera = true;
  var kotak = $('absen-kamera');
  if (!kotak) return;
  kotak.hidden = false;  kotak.innerHTML =
    '<div class="absen-kamera-tampil" id="absen-kamera-tampil">' +
      // Cermin HANYA untuk kamera depan (selfie). Kamera belakang tampil apa
      // adanya, supaya pratinjau saat memfoto = kenyataan di sekitar Anda.
      '<video id="kam-video"' + (facingModeAktif === 'user' ? ' class="mirror"' : '') +
        ' autoplay playsinline muted></video>' +
      '<div class="kamera-grid" aria-hidden="true"></div>' +
      '<div class="kamera-mode-toggle" role="group" aria-label="Pilih kamera">' +
        '<button type="button" class="mode-opsi' + (facingModeAktif === 'user' ? ' mode-aktif' : '') + '" id="kamera-mode-depan">Depan</button>' +
        '<button type="button" class="mode-opsi' + (facingModeAktif === 'environment' ? ' mode-aktif' : '') + '" id="kamera-mode-belakang">Belakang</button>' +
      '</div>' +
    '</div>' +
    '<div class="absen-kamera-aksi">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="kamera-batal">Tutup kamera</button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="btn-ambil-foto" disabled>' +
        ikonSvg('kamera') + ' Ambil</button>' +
    '</div>';
  $('kamera-batal').addEventListener('click', tutupKamera);
  $('btn-ambil-foto').addEventListener('click', ambilFoto);
  // Toggle mode kamera: kedua opsi selalu tampil & bisa ditekan
  $('kamera-mode-depan').addEventListener('click', function () { if (facingModeAktif !== 'user') { facingModeAktif = 'user'; mulaiKamera(); } });
  $('kamera-mode-belakang').addEventListener('click', function () { if (facingModeAktif !== 'environment') { facingModeAktif = 'environment'; mulaiKamera(); } });
  mulaiKamera();
}



function tutupKamera() {
  matikanKamera();
  if (!state.absen) return;
  state.absen.kamera = false;
  var kotak = $('absen-kamera');
  if (kotak) { kotak.hidden = true; kotak.innerHTML = ''; }
  perbaruiAbsen();
}

function mulaiKamera() {
  var tampil = $('absen-kamera-tampil');
  if (!tampil) return;

  matikanKamera();   // lepas kamera sebelumnya saat ganti Depan/Belakang

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    galatKamera('Perangkat/peramban tidak mendukung kamera. Absen tidak bisa dilanjutkan.');
    return;
  }
  var facingMode = facingModeAktif === 'user' ? 'user' : 'environment';
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false
  }).then(function (stream) {
    if (!state.absen || !$('absen-kamera-tampil')) { // layar sudah berubah      stream.getTracks().forEach(function (t) { t.stop(); });      return;    }
    state.absen.stream = stream;
    var video = $('kam-video');
    if (video) {
      // Cermin hanya untuk kamera depan; kamera belakang tidak dicerminkan.
      // Kelas dipasang SEBELUM stream tampil agar tidak ada kedipan terbalik.
      video.classList.toggle('mirror', facingMode === 'user');
      video.srcObject = stream;
    }
    var tombol = $('btn-ambil-foto');
    if (tombol) tombol.disabled = false;
    // Tandai mode kamera aktif — kedua opsi tetap tampil agar bisa dipilih
    var modeDepan = $('kamera-mode-depan');
    var modeBelakang = $('kamera-mode-belakang');
    if (modeDepan) modeDepan.classList.toggle('mode-aktif', facingMode === 'user');
    if (modeBelakang) modeBelakang.classList.toggle('mode-aktif', facingMode === 'environment');
  }).catch(function (err) {
    var pesan;
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      pesan = 'Izin kamera ditolak. Absen tidak bisa dilanjutkan sebelum izin kamera diaktifkan.';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
      pesan = facingMode === 'environment' ? 'Kamera belakang tidak ditemukan di perangkat ini.' : 'Kamera depan tidak ditemukan di perangkat ini.';
    } else {
      pesan = 'Kamera tidak bisa dibuka. (' + (err && err.name ? err.name : 'galat') + ')';
    }
    galatKamera(pesan);
  });
}


function galatKamera(pesan) {
  var kotak = $('absen-kamera');
  if (!kotak) return;
  kotak.hidden = false;
  kotak.innerHTML =
    '<div class="banner error"><strong>Kamera bermasalah.</strong><br>' + esc(pesan) + '</div>' +
    '<div class="card small muted">Buka pengaturan situs (ikon gembok) → <b>Kamera → Izinkan</b>, ' +
    'lalu tekan Coba Lagi. Di iOS: Pengaturan &gt; Safari &gt; Kamera.</div>' +
    '<div class="btn-row"><button type="button" class="btn btn-outline btn-sm" id="kamera-batal">Tutup</button>' +
    '<button type="button" class="btn btn-primary btn-sm" id="kamera-ulang">Coba Lagi</button></div>';
  $('kamera-batal').addEventListener('click', tutupKamera);
  $('kamera-ulang').addEventListener('click', function () { bukaKamera(); });
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
  // Pratinjau kamera depan dicerminkan lewat CSS, tetapi frame yang disimpan
  // selalu apa adanya (tidak dicerminkan): hasil kamera belakang sama persis
  // dengan pratinjaunya, dan selfie tersimpan tanpa cermin.
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
  a.kamera = false;
  matikanKamera();
  var kotak = $('absen-kamera');
  if (kotak) { kotak.hidden = true; kotak.innerHTML = ''; }
  perbaruiAbsen();
}

/* ---- Kirim ------------------------------------------------------- */

function kirimAbsen() {
  var a = state.absen;
  if (!a || a.mengirim || a.sukses) return;

  var pesan = $('absen-pesan');
  function tolak(teks) {
    if (pesan) pesan.innerHTML = '<div class="banner error">' + esc(teks) + '</div>';
  }

  if (!a.posisi) { tolak('Lokasi belum terbaca. Tekan Perbarui pada status lokasi.'); return; }
  if (!a.hasil || !a.hasil.valid) { tolak('Anda belum berada di dalam area absen.'); return; }
  if (!a.foto) { tolak('Selfie belum diambil. Ketuk lingkaran Selfie untuk membuka kamera.'); return; }
  if (!alasanCukup(a)) { tolak('Alasan keterlambatan wajib diisi minimal 5 karakter.'); return; }

  var payload = {
    lat: a.posisi.lat,
    lng: a.posisi.lng,
    akurasi: a.posisi.akurasi,
    foto_base64: a.foto
  };
  if (a.jenis === 'masuk') payload.alasan_terlambat = String(a.alasan || '').trim();

  a.mengirim = true;
  a.gagal = null;
  perbaruiAbsen();
  var tombol = $('btn-kirim-absen');
  if (tombol) tombol.disabled = true;

  api(a.jenis === 'masuk' ? 'absen_masuk' : 'absen_pulang', payload)
    .then(function (data) {
      if (!state.absen) return;
      state.absen.mengirim = false;
      state.absen.sukses = data;
      state.absen.foto = null;           // jangan simpan base64 di memori lebih lama
      tampilSuksesAbsen();
    })
    .catch(function (e) {
      if (!state.absen) return;
      if (tanganiErrorSesi(e)) return;
      state.absen.mengirim = false;
      state.absen.gagal = errPesan(e);
      state.absen.gagalKode = errKode(e);
      perbaruiAbsen();
    });
}

function tampilSuksesAbsen() {
  var a = state.absen;
  if (!a) return;
  var d = a.sukses || {};
  matikanKamera();
  hancurkanPeta();
  if (absenJamTimer) { clearInterval(absenJamTimer); absenJamTimer = null; }

  var rincian = a.jenis === 'masuk'
    ? '<div class="kv"><span>Jam masuk</span><b>' + esc(tampilJam(d.jam_masuk) || '') + '</b></div>' +
      '<div class="kv"><span>Status</span><b>' + esc(d.status || '') + '</b></div>' +
      (d.alasan_terlambat ? '<div class="kv"><span>Alasan</span><b>' + esc(d.alasan_terlambat) + '</b></div>' : '')
    : '<div class="kv"><span>Jam pulang</span><b>' + esc(tampilJam(d.jam_pulang) || '') + '</b></div>';

  $('absen-body').innerHTML =
    '<div class="absen-sukses">' +
      '<span class="absen-sukses-ikon" aria-hidden="true">' + ikonSvg('centang-lingkar') + '</span>' +
      '<h3>Absen ' + (a.jenis === 'masuk' ? 'masuk' : 'pulang') + ' tercatat</h3>' +
      '<p class="small muted">' + esc(tglIndonesia(new Date())) + '</p>' +
    '</div>' +
    '<div class="card">' + rincian +
      '<div class="kv"><span>Jarak tercatat</span><b>' + esc(labelJarak(d.jarak_m)) + '</b></div>' +
      '<div class="kv"><span>Foto</span><b>Tersimpan di Drive</b></div>' +
    '</div>';

  var foot = $('absen-foot');
  foot.hidden = false;
  foot.innerHTML = '<button type="button" class="btn btn-primary btn-block" id="absen-selesai">Selesai</button>';
  $('absen-selesai').addEventListener('click', function () {
    tutupAlurAbsen();
    bukaScreen('beranda');
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
  muatPanel('izin_saya', {}, kotak, 'Memuat daftar izin…', function (data) {
      var daftar = (data && data.daftar) || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('kotak-kosong'), 'Belum ada izin yang Anda ajukan.');
        return;
      }
      kotak.innerHTML = daftar.map(function (r) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
          '<div class="row-meta">' + ikonSvg('kalender') + ' ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + '</div>' +
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
  muatPanel('riwayat_saya', { bulan: bulan }, kotak, 'Memuat riwayat…', function (data) {
      var absen = (data && data.absensi) || [];
      var izin = (data && data.izin) || [];
      var html = '';

      html += '<p class="card-title">Absensi ' + esc(bulan) + '</p>';
      if (!absen.length) {
        html += emptyHTML(ikonSvg('absensi'), 'Tidak ada data absensi pada bulan ini.');
      } else {
        html += absen.map(function (r) {
          var st = r.status === 'Terlambat' ? 'terlambat' : 'hadir';
          return '<div class="row-item">' +
            '<div class="row-head"><span class="row-name">' + esc(tampilTanggal(r.tanggal)) + '</span>' +
            '<span class="badge ' + st + '">' + esc(r.status) + '</span></div>' +
            '<div class="row-meta">Masuk ' + esc(tampilJam(r.jam_masuk) || '—') +
            ' · Pulang ' + esc(tampilJam(r.jam_pulang) || 'Belum Absen Pulang') + '</div>' +
            (r.alasan_terlambat ? '<div class="row-meta">Alasan: ' + esc(r.alasan_terlambat) + '</div>' : '') +
            (r.dikoreksi ? '<div class="row-meta">' + ikonSvg('pensil') + ' Dikoreksi admin</div>' : '') +
          '</div>';
        }).join('');
      }

      html += '<p class="card-title mt">Izin</p>';
      if (!izin.length) {
        html += emptyHTML(ikonSvg('kotak-kosong'), 'Tidak ada izin pada bulan ini.');
      } else {
        html += izin.map(function (r) {
          return '<div class="row-item">' +
            '<div class="row-head"><span class="row-name">' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
            '<div class="row-meta">' + ikonSvg('kalender') + ' ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + ' — ' + esc(r.alasan) + '</div>' +
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
      (wajib ? '<div class="banner">' + ikonSvg('kunci') + ' PIN masih PIN sementara. Anda <strong>wajib mengganti PIN</strong> sekarang.</div>' : '') +
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
    muatPanel('dashboard_hari_ini', {}, el, 'Memuat dashboard hari ini…', function (d) {
        var j = d.jumlah;
        var html =
          '<div class="banner info">' + esc(tglIndonesia(tanggalLokal(d.tanggal))) + ' · pukul ' + esc(d.jam_sekarang) +
          (d.hari_libur ? ' · ' + ikonSvg('libur') + ' libur: ' + esc(d.hari_libur.keterangan || 'Hari libur') : (d.hari_kerja ? '' : ' · bukan hari kerja')) + '</div>' +
          '<div class="stat-grid">' +
            '<div class="stat hadir"><b>' + j.hadir + '</b><span>Hadir</span></div>' +
            '<div class="stat terlambat"><b>' + j.terlambat + '</b><span>Terlambat</span></div>' +
            '<div class="stat izin"><b>' + j.izin + '</b><span>Izin</span></div>' +
            '<div class="stat belum"><b>' + j.belum_absen + '</b><span>Belum Absen</span></div>' +
          '</div>';
        if (!d.karyawan.length) {
          html += emptyHTML(ikonSvg('karyawan'), 'Belum ada karyawan. Tambahkan lewat menu Karyawan.');
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

    // isi dropdown karyawan (langsung dari cache bila sudah tersedia)
    muatPanel('karyawan_list', {}, null, '', function (data) {
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
  var payload = { tanggal_mulai: dari, tanggal_selesai: sampai };
  if (kid) payload.id_karyawan = kid;

  muatPanel('absensi_list', payload, kotak, 'Memuat daftar absensi…', function (data) {
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
    kotak.innerHTML = emptyHTML(ikonSvg('absensi'), 'Tidak ada data absensi pada rentang tanggal ini.');
    return;
  }
  kotak.innerHTML = daftar.map(function (r) {
    var foto = '';
    if (r.link_foto_masuk) foto += '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + esc(r.link_foto_masuk) + '">' + ikonSvg('kamera') + ' Foto Masuk</a> ';
    if (r.link_foto_pulang) foto += '<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="' + esc(r.link_foto_pulang) + '">' + ikonSvg('kamera') + ' Foto Pulang</a>';
    if (!foto) foto = '<span class="small muted">—</span>';
    return '<div class="row-item">' +
      '<div class="row-head"><span class="row-name">' + esc(tampilTanggal(r.tanggal)) + ' · ' + esc(r.nama) + '</span>' + badgeStatusAbsen(r.status) + '</div>' +
      '<div class="row-meta">Masuk ' + esc(tampilJam(r.jam_masuk) || '—') +
      ' · Pulang ' + esc(tampilJam(r.jam_pulang) || 'Belum Absen Pulang') +
      (r.jarak_masuk_m !== null ? ' · jarak ' + r.jarak_masuk_m + ' m' : '') + '</div>' +
      (r.alasan_terlambat ? '<div class="row-meta">Alasan terlambat: ' + esc(r.alasan_terlambat) + '</div>' : '') +
      (r.dikoreksi ? '<div class="row-meta">' + ikonSvg('pensil') + ' Dikoreksi — ' + esc(r.catatan_koreksi) + '</div>' : '') +
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
  var payload = status ? { status: status } : {};
  muatPanel('izin_list', payload, kotak, 'Memuat izin…', function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('persetujuan'), status === 'Menunggu' ? 'Tidak ada izin yang menunggu persetujuan.' : 'Tidak ada izin dengan filter ini.');
        return;
      }
      kotak.innerHTML = daftar.map(function (r) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(r.nama) + ' · ' + esc(r.jenis) + '</span>' + badgeIzin(r.status) + '</div>' +
          '<div class="row-meta">' + ikonSvg('kalender') + ' ' + esc(tampilTanggal(r.tanggal_mulai)) + ' s/d ' + esc(tampilTanggal(r.tanggal_selesai)) + '</div>' +
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
    '<p>Keputusan: <strong>' + (keputusan === 'Disetujui' ? ikonSvg('centang-lingkar') + ' Disetujui' : ikonSvg('silang-lingkar') + ' Ditolak') + '</strong></p>' +
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
  var ka = apiTersimpan('karyawan_list', {});
  var lo = apiTersimpan('lokasi_list', {});
  var sumber = (ka && lo) ? Promise.resolve([ka, lo]) : null;
  if (!sumber) kotak.innerHTML = loadingHTML('Memuat daftar karyawan…');
  (sumber || Promise.all([apiLayar('karyawan_list', {}), apiLayar('lokasi_list', {})]))
    .then(function (hasil) {
      dataKaryawan = hasil[0].daftar || [];
      dataLokasiUntukForm = (hasil[1].daftar || []).filter(function (l) { return l.status_aktif; });
      if (!dataKaryawan.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('karyawan'), 'Belum ada karyawan. Tekan Tambah Karyawan.');
        return;
      }
      kotak.innerHTML = dataKaryawan.map(function (k) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(k.nama) + '</span>' +
          '<span class="badge ' + (k.status_aktif ? 'aktif' : 'nonaktif') + '">' +
          (k.status_aktif ? 'Aktif' : 'Nonaktif') + '</span></div>' +
          '<div class="row-meta">@' + esc(k.username) + ' · ' + esc(k.jabatan || '—') + ' · role ' + esc(k.role) + '</div>' +
          '<div class="row-meta">' + esc(k.id_karyawan) + ' · lokasi ' + esc(k.nama_lokasi || k.id_lokasi || '—') + '</div>' +
          (k.wajib_ganti_pin ? '<div class="row-meta">' + ikonSvg('kunci') + ' Wajib ganti PIN (belum login ganti)</div>' : '') +
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
        '<div class="banner">' + ikonSvg('kunci') + ' <strong>PIN sementara untuk ' + esc(d.nama) + ':</strong></div>' +
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
  muatPanel('lokasi_list', {}, kotak, 'Memuat lokasi…', function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('lokasi'), 'Belum ada lokasi. Tekan Tambah Lokasi lalu isi koordinat (atau Pakai Lokasi Saya).');
        return;
      }
      kotak.innerHTML = daftar.map(function (l) {
        return '<div class="row-item">' +
          '<div class="row-head"><span class="row-name">' + esc(l.nama_lokasi) + '</span>' +
          '<span class="badge ' + (l.status_aktif ? 'aktif' : 'nonaktif') + '">' + (l.status_aktif ? 'Aktif' : 'Nonaktif') + '</span></div>' +
          '<div class="row-meta">' + ikonSvg('bumi') + ' ' + l.latitude + ', ' + l.longitude + ' · radius ' + l.radius_m + ' m</div>' +
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
      '<button type="button" class="btn btn-outline btn-block" id="lok-pakai">' + ikonSvg('lokasi') + ' Pakai Lokasi Saya</button>' +
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
    var pg = apiTersimpan('pengaturan_get', {});
    var lb = apiTersimpan('libur_list', {});
    var sumber = (pg && lb) ? Promise.resolve([pg, lb]) : null;
    if (!sumber) el.innerHTML = loadingHTML('Memuat pengaturan…');
    (sumber || Promise.all([apiLayar('pengaturan_get', {}), apiLayar('libur_list', {})]))
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
            return '<div class="kv"><span>' + ikonSvg('kalender') + ' ' + esc(tampilTanggal(r.tanggal)) + ' — ' + esc(r.keterangan) + '</span>' +
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
        '<button type="button" class="btn btn-outline" id="btn-rek-csv" disabled>' + ikonSvg('unduh') + ' Ekspor CSV</button>' +
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
  muatPanel('rekap_bulanan', { bulan: bulan }, kotak, 'Memuat rekap bulanan…', function (data) {
      rekapTerakhir = data;
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('rekap'), 'Belum ada data karyawan untuk rekap.');
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
  muatPanel('log_list', { tanggal_mulai: $('log-dari').value, tanggal_selesai: $('log-sampai').value },
    kotak, 'Memuat log…', function (data) {
      var daftar = data.daftar || [];
      if (!daftar.length) {
        kotak.innerHTML = emptyHTML(ikonSvg('log'), 'Tidak ada aktivitas pada rentang tanggal ini.');
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