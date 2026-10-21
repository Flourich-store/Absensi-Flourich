/**
 * api.js
 * Klien API untuk backend Google Apps Script (bagian 6 PRD):
 *   Request  : POST JSON {action, token, data} dengan Content-Type text/plain
 *              (menghindari preflight CORS pada Apps Script)
 *   Response : sukses {ok:true, data} | gagal {ok:false, error:{code, message}}
 *
 * >>> UBAH BACKEND_URL BILA WEB APP DI-DEPLOY ULANG (lihat README bagian B) <<<
 * Nilai ini BUKAN rahasia — hanya alamat endpoint web app.
 */

var BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwbguwykX8068cSwOslBmyumMTmdl5CGE3qGmmwG1IhlqoBn64ebqO12GgQEq3_LbQ/exec';

var TOKEN_KEY = 'absensi_token';
var USER_KEY = 'absensi_user';

/* ---------------------------------------------------------------- */
/* Cache baca singkat                                                */
/* ---------------------------------------------------------------- */
/*
 * Pindah menu tidak perlu menunggu jaringan setiap kali. Action yang hanya
 * membaca data disimpan sebentar (di memori, bukan localStorage) lalu dipakai
 * ulang saat layar yang sama dibuka lagi. Setiap action yang mengubah data —
 * atau action apa pun yang tidak ada di daftar ini — membersihkan seluruh
 * cache, jadi tampilan tidak pernah memakai data yang sudah basi setelah
 * absen/izin/koreksi/karyawan berubah.
 */
var API_CACHE_MS = {
  status_hari_ini: 20000,
  dashboard_hari_ini: 15000,
  izin_saya: 20000,
  riwayat_saya: 60000,
  absensi_list: 30000,
  izin_list: 20000,
  karyawan_list: 60000,
  lokasi_list: 120000,
  rekap_bulanan: 60000,
  log_list: 20000,
  pengaturan_get: 120000,
  libur_list: 120000
};
var apiCache = {};

function apiKunci(action, data) {
  try { return action + '|' + JSON.stringify(data || {}); } catch (e) { return action; }
}
function apiBersihkanCache() { apiCache = {}; }
/** Nilai cache yang masih segar, atau null. Sinkron agar layar bisa tahu lebih dulu. */
function apiTersimpan(action, data) {
  var ms = API_CACHE_MS[action];
  if (!ms) return null;
  var isi = apiCache[apiKunci(action, data)];
  if (!isi || (Date.now() - isi.waktu) > ms) return null;
  return isi.data;
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}
function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
}
function simpanUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) {}
}
function muatUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
}

/**
 * Panggil satu action backend.
 * @param {string} action nama action (bagian 10 PRD)
 * @param {object} data   payload data
 * @returns {Promise<any>} resolve = field `data`, reject = {code, message}
 */
function api(action, data) {
  if (!BACKEND_URL) {
    return Promise.reject({
      code: 'VALIDASI',
      message: 'URL backend belum diisi. Buka file api.js lalu isi nilai BACKEND_URL (lihat README bagian B).'
    });
  }

  var msCache = API_CACHE_MS[action];
  var kunciCache = msCache ? apiKunci(action, data) : null;
  if (kunciCache) {
    var tersimpan = apiTersimpan(action, data);
    if (tersimpan) return Promise.resolve(tersimpan);
  }

  var body = JSON.stringify({
    action: action,
    token: getToken(),
    data: data || {}
  });

  // TAHAP 0 — ukur waktu tiap panggilan API (instrumentasi diagnostik)
  var __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var __label = 'api:' + action;
  if (typeof console !== 'undefined' && console.time && !api.__terpakai) {
    // console.time hanya untuk melacak; label unik per action+urutan
    api.__urut = (api.__urut || 0) + 1;
    __label = 'api:' + action + '#' + api.__urut;
    try { console.time(__label); } catch (e) {}
  }

  var __catat = function (gagal) {
    return function (arg) {
      var ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - __t0);
      if (typeof console !== 'undefined' && console.timeEnd) {
        try { console.timeEnd(__label); } catch (e) {}
      }
      if (typeof console !== 'undefined' && console.log) {
        console.log('[perf] api ' + action + ': ' + ms + ' ms' + (gagal ? ' (gagal)' : '') +
          ' | req ' + body.length + ' B');
      }
      return arg;
    };
  };

  return fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: body
  })
    .then(function (res) {
      // Apps Script menjawab JSON; abaikan Content-Type agar tetap terbaca
      return res.text().then(function (teks) {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[perf] api ' + action + ' respons: ' + teks.length + ' B');
        }
        var json;
        try {
          json = JSON.parse(teks);
        } catch (e) {
          throw {
            code: 'SERVER_ERROR',
            message: 'Respons server bukan JSON. Periksa URL BACKEND_URL dan pastikan web app sudah di-deploy sebagai "Execute as: Me, Access: Anyone".'
          };
        }
        if (json && json.ok) {
          if (kunciCache) apiCache[kunciCache] = { waktu: Date.now(), data: json.data };
          else apiBersihkanCache();   // action pengubah data: cache lama tidak berlaku
          return json.data;
        }
        var err = (json && json.error) || {};
        throw {
          code: err.code || 'SERVER_ERROR',
          message: err.message || 'Terjadi kesalahan di server.'
        };
      });
    })
    .then(__catat(false), function (e) {
      __catat(null);
      if (e && e.code) throw e; // error aplikasi dari respons
      throw {
        code: 'SERVER_ERROR',
        message: 'Tidak bisa terhubung ke server. Periksa koneksi internet dan URL BACKEND_URL, lalu coba lagi.'
      };
    });
}