# MapLibre GL JS + OpenFreeMap Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Leaflet with MapLibre GL JS + OpenFreeMap tiles (free, no API key) across all map surfaces.

**Architecture:** New `peta.js` module lazy-loads MapLibre from CDN on first map use. Each screen (Lokasi admin, Alur Absen, Daftar Absensi) gets a map via a shared `petaBuat()` factory. Circles use GeoJSON circle layers. Leaflet vendor files removed.

**Tech Stack:** MapLibre GL JS v4.7.1 (CDN, pinned), OpenFreeMap positron style, vanilla JS.

**Spec:** User requirements 1-8 (see conversation).

## Global Constraints
- Do NOT change API contract, sheet names, or columns
- MapLibre version pinned (not @latest)
- Lazy load only — no map code in boot path
- Map failure must NOT block attendance flow
- No large-scale tile caching in service worker

## Tasks

### Task 1: Create `peta.js` — lazy loader + shared map factory
- `muatMapLibre()` — injects CSS + JS from CDN once, returns Promise
- `petaBuat(el, opts)` — creates map instance, returns {peta, tambahLapisan, hancurkan}
- `petaLingkaran(peta, id, lat, lng, radiusM, warna)` — GeoJSON circle layer
- `petaPenanda(peta, id, lat, lng, opts)` — marker (draggable option)
- Error handling: timeout 8s → reject, caller shows fallback message
- Dark mode: detect `prefers-color-scheme`, swap style URL

### Task 2: Update `index.html` — remove Leaflet, add peta.js
- Remove `vendor/leaflet/leaflet.css` and `vendor/leaflet/leaflet.js`
- Add `<script defer src="peta.js">`
- Delete `vendor/leaflet/` directory

### Task 3: Update `app.js` — Lokasi admin screen
- `bukaFormLokasi()`: add map div, draggable pin, radius circle
- Pin drag updates lat/lng inputs; radius input updates circle
- "Pakai Lokasi Saya" button: pans map + moves pin
- Map failure → show "Peta tidak tersedia" message, form still works

### Task 4: Update `app.js` — Alur Absen screen
- Replace Leaflet `gambarPeta()` with MapLibre version
- Show: employee position (blue dot), work location (pin), radius circle, distance badge
- Map failure → hide map section, attendance flow unaffected

### Task 5: Update `app.js` — Daftar Absensi "Lihat Peta"
- Add "Lihat Peta" button per row (when lat/lng available)
- Opens modal with small map showing attendance point
- Uses `lat_masuk`/`lng_masuk`/`lat_pulang`/`lng_pulang` from API response

### Task 6: Update `sw.js` + `styles.css`
- Bump cache version to v17
- Remove Leaflet from SHELL array
- Add peta.js to SHELL
- CSS: map container styles, remove Leaflet-specific rules

### Task 7: Verify + commit + push
- Syntax check all modified files
- Commit and push to GitHub
