/**
 * peta.js — modul peta MapLibre GL JS + OpenFreeMap (gratis, tanpa API key).
 *
 * Pustaka MapLibre disajikan LOKAL dari vendor/maplibre/ (origin yang sama
 * dengan aplikasi), bukan dari CDN luar. Alasan: unpkg/CDN sering lambat atau
 * diblokir di jaringan Indonesia sehingga peta gagal muncul di HP. Dengan
 * disajikan dari github.io, pustaka termuat andal bersama shell PWA.
 *
 * Peta dimuat lazy (hanya saat layar yang butuh peta dibuka). Gaya peta:
 * OpenFreeMap Positron (terang) pada siang hari, Dark (gelap) pada malam
 * hari — pergantian mengikuti jam perangkat, bukan setelan tema perangkat;
 * hanya ubin (gambar peta) yang datang dari jaringan.
 *
 * Penanganan galat: petaBuat() me-reject bila MapLibre gagal dimuat atau
 * gaya belum siap (timeout 12 detik). Pemanggil (app.js) menampilkan pesan
 * singkat tanpa menghalangi proses absen.
 */

'use strict';

/* Lokasi pustaka MapLibre lokal (sudah masuk cache shell di sw.js). */
var PETA_MAPLIBRE_JS = './vendor/maplibre/maplibre-gl.js';
var PETA_MAPLIBRE_CSS = './vendor/maplibre/maplibre-gl.css';

/* Gaya OpenFreeMap: terang (positron) dan gelap. */
var PETA_GAYA_TERANG = 'https://tiles.openfreemap.org/styles/positron';
var PETA_GAYA_GELAP = 'https://tiles.openfreemap.org/styles/dark';

var __maplibreDimuat = null;   // Promise | null — muat sekali saja
var __petaIdCounter = 0;

/**
 * Muat MapLibre GL JS (CSS + JS) dari CDN. Dipanggil sekali; pemanggilan
 * berikutnya memakai promise yang sama.
 * @returns {Promise} resolve saat window.maplibregl tersedia
 */
function muatMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  if (__maplibreDimuat) return __maplibreDimuat;

  __maplibreDimuat = new Promise(function (resolve, reject) {
    var timeout = setTimeout(function () {
      reject(new Error('waktu muat habis (8 detik) — pustaka peta tidak termuat'));
    }, 8000);

    // CSS — dari vendor lokal (same-origin, tanpa SRI/CORS)
    if (!document.querySelector('link[data-maplibre]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PETA_MAPLIBRE_CSS;
      link.setAttribute('data-maplibre', '1');
      document.head.appendChild(link);
    }

    // JS — dari vendor lokal (same-origin, tanpa SRI/CORS)
    if (!document.querySelector('script[data-maplibre]')) {
      var s = document.createElement('script');
      s.src = PETA_MAPLIBRE_JS;
      s.setAttribute('data-maplibre', '1');
      s.onload = function () {
        clearTimeout(timeout);
        if (window.maplibregl) resolve();
        else reject(new Error('berkas termuat tetapi maplibregl tidak tersedia'));
      };
      s.onerror = function () {
        clearTimeout(timeout);
        reject(new Error('pustaka peta gagal dimuat dari penyimpanan lokal'));
      };
      document.head.appendChild(s);
    } else {
      // Sudah ada script tag tapi belum load — poll
      var cek = setInterval(function () {
        if (window.maplibregl) { clearInterval(cek); clearTimeout(timeout); resolve(); }
      }, 200);
      setTimeout(function () { clearInterval(cek); clearTimeout(timeout); reject(new Error('timeout')); }, 8000);
    }
  });
  return __maplibreDimuat;
}

/* Jam pergantian gaya peta (waktu perangkat). Indonesia dekat khatulistiwa:
 * matahari terbit ±06.00 dan terbenam ±18.00 sepanjang tahun, jadi 06.00–18.00
 * = siang (peta terang) dan 18.00–06.00 = malam (peta gelap). */
var PETA_GELAP_DARI_JAM = 18;
var PETA_GELAP_SAMPAI_JAM = 6;

/**
 * Peta bergaya gelap HANYA pada malam hari; siang hari selalu terang
 * sesuai permintaan — tidak peduli setelan tema perangkat.
 */
function petaGelap() {
  var jam = new Date().getHours();
  return jam >= PETA_GELAP_DARI_JAM || jam < PETA_GELAP_SAMPAI_JAM;
}

/** URL gaya sesuai mode perangkat. */
function petaGaya() { return petaGelap() ? PETA_GAYA_GELAP : PETA_GAYA_TERANG; }

/**
 * Buat peta baru di elemen kontainer.
 *
 * @param {HTMLElement} el  kontainer peta (harus punya tinggi)
 * @param {object} opts     {lat, lng, zoom, interaktif}
 * @returns {Promise<{peta: maplibregl.Map, lapisan: function, hancurkan: function}>}
 */
function petaBuat(el, opts) {
  opts = opts || {};
  var lat = opts.lat != null ? opts.lat : 0;
  var lng = opts.lng != null ? opts.lng : 0;
  var zoom = opts.zoom != null ? opts.zoom : 15;

  return muatMapLibre().then(function () {
    var peta = new maplibregl.Map({
      container: el,
      style: petaGaya(),
      center: [lng, lat],
      zoom: zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      interactive: opts.interaktif !== false
    });

    // Tambah kontrol zoom (kanan bawah). Posisi MapLibre memakai hubung:
    // 'bottom-right', bukan 'bottomright' gaya Leaflet — nilai lain membuat
    // addControl melempar galat dan peta gagal total.
    // Peta absen (interaktif:false) TANPA tombol +/-: hasil zoom otomatis ke
    // lokasi harus bertahan, tidak bisa ditinggalkan lewat tombol maupun gestur.
    if (opts.interaktif !== false) {
      peta.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    }

    // Tambah kontrol atribusi (kiri bawah)
    peta.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    var sudahHancur = false;

    /**
     * Tambah/hapus lapisan lingkaran (radius) via GeoJSON circle.
     * @param {string} id         unique layer id
     * @param {number} lat
     * @param {number} lng
     * @param {number} radiusM    radius dalam meter
     * @param {string} warna      warna fill (#hex)
     * @param {number} opacity    fill-opacity (0-1)
     */
    function lapisanLingkaran(id, lat, lng, radiusM, warna, opacity) {
      if (sudahHancur) return;
      hapusLapisan(id);
      var coords = lingkaranKoordinat(lng, lat, radiusM, 64);
      peta.addSource(id, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
      });
      peta.addLayer({
        id: id + '-isi',
        type: 'fill',
        source: id,
        paint: { 'fill-color': warna, 'fill-opacity': opacity != null ? opacity : 0.12 }
      });
      peta.addLayer({
        id: id + '-garis',
        type: 'line',
        source: id,
        paint: { 'line-color': warna, 'line-width': 2, 'line-opacity': 0.9 }
      });
    }

    /**
     * Tambah/hapus penanda (marker).
     * @param {string} id
     * @param {number} lat
     * @param {number} lng
     * @param {object} o  {warna, jenis:'pin'|'titik', draggable, onDrag}
     */
    function lapisanPenanda(id, lat, lng, o) {
      if (sudahHancur) return;
      hapusPenanda(id);
      o = o || {};
      var el2 = document.createElement('div');
      el2.className = 'pml-marker' + (o.jenis === 'titik' ? ' pml-titik' : ' pml-pin');
      if (o.warna) el2.style.setProperty('--warna', o.warna);
      if (o.jenis === 'titik') {
        el2.innerHTML = '<span class="pml-halo"></span><span class="pml-dot"></span>';
      } else {
        el2.innerHTML = '<svg viewBox="0 0 24 36" width="26" height="39"><path d="M12 0C5.37 0 0 5.37 0 12c0 8.4 12 24 12 24s12-15.6 12-24C24 5.37 18.63 0 12 0z" fill="' + (o.warna || '#1b7a43') + '"/><circle cx="12" cy="12" r="4.6" fill="#fff"/></svg>';
      }
      var mk = new maplibregl.Marker({ element: el2, draggable: !!o.draggable, anchor: o.jenis === 'titik' ? 'center' : 'bottom' })
        .setLngLat([lng, lat])
        .addTo(peta);
      if (o.draggable && o.onDrag) {
        mk.on('drag', function () { o.onDrag(mk.getLngLat().lat, mk.getLngLat().lng); });
        mk.on('dragend', function () { if (o.onDragEnd) o.onDragEnd(mk.getLngLat().lat, mk.getLngLat().lng); });
      }
      __penanda[id] = mk;
    }

    function hapusLapisan(id) {
      try {
        if (peta.getLayer(id + '-isi')) peta.removeLayer(id + '-isi');
        if (peta.getLayer(id + '-garis')) peta.removeLayer(id + '-garis');
        if (peta.getSource(id)) peta.removeSource(id);
      } catch (e) {}
    }

    function hapusPenanda(id) {
      if (__penanda[id]) { __penanda[id].remove(); delete __penanda[id]; }
    }

    function hancurkan() {
      if (sudahHancur) return;
      sudahHancur = true;
      try { peta.remove(); } catch (e) {}
    }

    var handle = { peta: peta, lapisanLingkaran: lapisanLingkaran, lapisanPenanda: lapisanPenanda, hapusLapisan: hapusLapisan, hapusPenanda: hapusPenanda, hancurkan: hancurkan };

    // Janji hanya resolve SETELAH gaya siap menerima addSource/addLayer.
    // Bila resolve lebih awal, pemanggil memanggil lapisanLingkaran() lalu
    // melempar "Style is not done loading" dan peta gagal total.
    //
    // Gerbangnya diuji LANGSUNG (probe addSource+removeSource) karena
    // isStyleLoaded() tidak sejalan dengan kesiapan addSource, sedangkan
    // event 'load' baru menyusul setelah seluruh ubin (bisa >4 detik).
    function gayaSiap() {
      try {
        peta.addSource('__probe', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
        });
        peta.removeSource('__probe');
        return true;
      } catch (e) { return false; }
    }

    return new Promise(function (resolve, reject) {
      var sudahSelesai = false;
      function beres(ok, alasan) {
        if (sudahSelesai) return;
        sudahSelesai = true;
        clearTimeout(timer); clearInterval(poll);
        if (ok) resolve(handle);
        else { hancurkan(); reject(new Error(alasan)); }
      }
      if (gayaSiap()) { beres(true); return; }
      var timer = setTimeout(function () {
        beres(false, 'gaya peta gagal dimuat (jaringan ke server ubin)');
      }, 12000);
      var poll = setInterval(function () {
        if (gayaSiap()) beres(true);
      }, 200);
    });
  });
}

/* Penanda aktif per peta instance — disimpan sederhana di module scope. */
var __penanda = {};

/**
 * Hitung koordinat lingkaran (approx) di sekitar titik.
 * @returns {Array} array [lng,lat] sebanyak steps+1 (tutup lingkaran)
 */
function lingkaranKoordinat(lng, lat, radiusM, steps) {
  var coords = [];
  var dLat = radiusM / 111320;   // meter per derajat latitude
  for (var i = 0; i <= steps; i++) {
    var theta = (i / steps) * 2 * Math.PI;
    var dLng = dLat / Math.cos(lat * Math.PI / 180);
    coords.push([lng + dLng * Math.sin(theta), lat + dLat * Math.cos(theta)]);
  }
  return coords;
}

/**
 * Format jarak untuk ditampilkan.
 */
function labelJarakPeta(m) {
  if (m == null || !isFinite(m)) return '-';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1).replace('.', ',') + ' km';
}
