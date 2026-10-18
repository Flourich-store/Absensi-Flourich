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

  var body = JSON.stringify({
    action: action,
    token: getToken(),
    data: data || {}
  });

  return fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: body
  })
    .then(function (res) {
      // Apps Script menjawab JSON; abaikan Content-Type agar tetap terbaca
      return res.text().then(function (teks) {
        var json;
        try {
          json = JSON.parse(teks);
        } catch (e) {
          throw {
            code: 'SERVER_ERROR',
            message: 'Respons server bukan JSON. Periksa URL BACKEND_URL dan pastikan web app sudah di-deploy sebagai "Execute as: Me, Access: Anyone".'
          };
        }
        if (json && json.ok) return json.data;
        var err = (json && json.error) || {};
        throw {
          code: err.code || 'SERVER_ERROR',
          message: err.message || 'Terjadi kesalahan di server.'
        };
      });
    })
    .catch(function (e) {
      if (e && e.code) throw e; // error aplikasi dari respons
      throw {
        code: 'SERVER_ERROR',
        message: 'Tidak bisa terhubung ke server. Periksa koneksi internet dan URL BACKEND_URL, lalu coba lagi.'
      };
    });
}