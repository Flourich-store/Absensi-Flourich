/**
 * peta.js — modul peta MapLibre GL JS + OpenFreeMap (gratis, tanpa API key).
 *
 * MapLibre dimuat lazy (hanya saat layar yang butuh peta dibuka) dari CDN
 * dengan versi dipin. Gaya peta: OpenFreeMap Positron (terang) / Dark (gelap)
 * otomatis mengikuti preferensi perangkat.
 *
 * Tidak ada ubin yang di-cache besar-besaran di service worker — ubin hanya
 * di-cache browser secara normal (HTTP cache).
 *
 * Penanganan galat: petaBuat() me-reject bila MapLibre gagal dimuat dalam
 * 8 detik atau style tidak tersedia. Pemanggil (app.js) menampilkan pesan
 * singkat tanpa menghalangi proses absen.
 */

'use strict';

/* Versi MapLibre GL JS yang dipin (jangan @latest). */
var PETA_MAPLIBRE_V = '4.7.1';
var PETA_CDN = 'https://unpkg.com/maplibre-gl@' + PETA_MAPLIBRE_V + '/dist/';

/*
 * SRI (Subresource Integrity) — hash sha384 dihitung langsung dari berkas
 * yang disajikan unpkg CDN per tanggal 24 Okt 2026:
 *   maplibre-gl.js  803086 bytes
 *   maplibre-gl.css  65534 bytes
 * Bila unpkg menyajikan berkas berbeda (mis. versi berubah), atribut integrity
 * akan MENOLAK pemuatan — perbarui hash di sini bila itu terjadi.
 */
var PETA_SRI_JS  = 'sha384-4982801ba72095130dd1156f84d781634af715828d389b739f0034bfb079569f6daf7d71007b190b40ea910fe96439a3';
var PETA_SRI_CSS = 'sha384-3229ced26365899defc29a6e3ce52719afa2abad7da5f3212d55177c2e0b1f0482bc5f47fba3ff28ee10eea04e615e55';

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
      reject(new Error('MapLibre gagal dimuat (timeout).'));
    }, 8000);

    // CSS — dengan SRI integrity
    if (!document.querySelector('link[data-maplibre]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PETA_CDN + 'maplibre-gl.css';
      link.integrity = PETA_SRI_CSS;
      link.crossOrigin = 'anonymous';
      link.setAttribute('data-maplibre', '1');
      document.head.appendChild(link);
    }

    // JS — dengan SRI integrity
    if (!document.querySelector('script[data-maplibre]')) {
      var s = document.createElement('script');
      s.src = PETA_CDN + 'maplibre-gl.js';
      s.integrity = PETA_SRI_JS;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-maplibre', '1');
      s.onload = function () {
        clearTimeout(timeout);
        if (window.maplibregl) resolve();
        else reject(new Error('MapLibre tidak tersedia setelah dimuat.'));
      };
      s.onerror = function () {
        clearTimeout(timeout);
        reject(new Error('Gagal mengunduh MapLibre dari CDN.'));
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

/** Deteksi mode gelap perangkat. */
function petaGelap() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
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

    // Tambah kontrol zoom
    peta.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottomright');

    // Tambah kontrol atribusi (sudut kiri bawah)
    peta.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottomleft');

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

    return { peta: peta, lapisanLingkaran: lapisanLingkaran, lapisanPenanda: lapisanPenanda, hapusLapisan: hapusLapisan, hapusPenanda: hapusPenanda, hancurkan: hancurkan };
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
