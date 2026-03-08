// ============================================================
// app.js — Ana uygulama mantığı
// ============================================================

import { initMap, renderQuakes, showMapTooltip } from './map.js';
import {
  toApiDateTime, formatDisplayDate, timeAgo,
  setCache, getCache, buildCacheKey,
  buildApiUrl, validateParams, magColor, magLabel
} from './utils.js';

// ─── Uygulama Durumu ──────────────────────────────────────
const state = {
  earthquakes: [],
  filtered: [],
  selectedId: null,
  loading: false,
  lastFetch: null,
};


// ─── API & FETCH ──────────────────────────────────────────
// servisnet.afad.gov.tr CORS başlığı döndürür, direkt erişilebilir.

async function fetchEarthquakes(params) {
  const cacheKey = buildCacheKey(params);
  const cached   = getCache(cacheKey);
  if (cached) { showStatus('Önbellek', 'Önbellekten yüklendi', 'info'); return cached; }

  const targetUrl = buildApiUrl({ ...params, format: 'json' });
  showStatus('BAĞLANIYOR', 'servisnet.afad.gov.tr...', 'info');

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const resp  = await fetch(targetUrl, { signal: ctrl.signal });
  clearTimeout(timer);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const list = Array.isArray(data) ? data : (data.result || data.data || []);
  setCache(cacheKey, list);
  return list;
}

// ─── Parametre Toplama ────────────────────────────────────
function collectParams() {
  const v = id => document.getElementById(id)?.value?.trim() || '';
  const params = {};

  const eventId = v('input-eventid');
  if (eventId) { params.eventid = eventId; return params; }

  const startDate = v('input-start-date'), startTime = v('input-start-time') || '00:00:00';
  const endDate   = v('input-end-date'),   endTime   = v('input-end-time')   || '23:59:59';
  if (startDate) params.start = toApiDateTime(startDate, startTime);
  if (endDate)   params.end   = toApiDateTime(endDate, endTime);

  ['minmag','maxmag','magtype','mindepth','maxdepth'].forEach(k => {
    const val = v('input-' + k); if (val) params[k] = val;
  });

  const mode = document.querySelector('input[name="loc-mode"]:checked')?.value || 'none';
  if (mode === 'rect')   ['minlat','maxlat','minlon','maxlon'].forEach(k => { const val = v('input-'+k); if (val) params[k] = val; });
  if (mode === 'radial') ['lat','lon','maxrad','minrad'].forEach(k => { const val = v('input-'+k); if (val) params[k] = val; });

  params.orderby = v('input-orderby') || 'timedesc';
  params.limit   = v('input-limit')   || '500';
  return params;
}

// ─── Arama ────────────────────────────────────────────────
export async function doSearch() {
  const params = collectParams();
  const errors = validateParams(params);
  if (errors.length > 0) { showError(errors.join(' ')); return; }

  setLoading(true); clearError();
  try {
    const raw  = await fetchEarthquakes(params);
    const list = Array.isArray(raw) ? raw : (raw.result || raw.data || []);
    state.earthquakes = list;
    state.lastFetch   = new Date();
    applyClientFilter();
    renderAll();
    showStatus('HAZIR', `${list.length} deprem bulundu`, 'success');
  } catch (err) {
    console.error(err);
    showError(`Hata: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// ─── İstemci Tarafı Filtre ────────────────────────────────
function applyClientFilter() {
  const minMag = parseFloat(document.getElementById('filter-minmag')?.value) || 0;
  state.filtered = state.earthquakes.filter(eq =>
    parseFloat(eq.magnitude || eq.mag || 0) >= minMag
  );
}

// ─── Render ───────────────────────────────────────────────
function renderAll() { renderStats(); renderList(); renderMap(); }

function renderStats() {
  const mags = state.filtered.map(e => parseFloat(e.magnitude || e.mag || 0));
  setEl('stat-total', state.filtered.length);
  setEl('stat-max',   mags.length ? Math.max(...mags).toFixed(1) : '—');
  setEl('stat-avg',   mags.length ? (mags.reduce((a,b)=>a+b,0)/mags.length).toFixed(2) : '—');
  setEl('stat-big',   mags.filter(m=>m>=4.0).length);
  setEl('stat-time',  state.lastFetch ? state.lastFetch.toLocaleTimeString('tr-TR') : '—');
}

function renderMap() {
  renderQuakes(state.filtered,
    (eq, x, y) => {
      const mag = parseFloat(eq.magnitude || eq.mag || 0);
      showMapTooltip([
        `M ${mag.toFixed(1)} — ${magLabel(mag)}`,
        `📍 ${eq.location || eq.district || 'Bilinmiyor'}`,
        `🕐 ${formatDisplayDate(eq.date || eq.eventDate)}`,
        `⬇ Derinlik: ${eq.depth ? eq.depth+' km' : '—'}`,
      ].join('\n'), x, y);
    },
    (eq) => {
      state.selectedId = eq.eventID || eq.id;
      highlightListItem(state.selectedId);
      scrollToListItem(state.selectedId);
    }
  );
}

function renderList() {
  const listEl = document.getElementById('quake-list');
  if (!listEl) return;

  if (!state.filtered.length) {
    listEl.innerHTML = `<div class="list-empty">
      <span class="empty-icon">◎</span>
      <p>Deprem verisi bulunamadı</p>
      <small>Filtreleri ayarlayıp "SORGULA" butonuna basın</small>
    </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  state.filtered.forEach(eq => {
    const id    = eq.eventID || eq.id || Math.random();
    const mag   = parseFloat(eq.magnitude || eq.mag || 0);
    const color = magColor(mag);
    const depth = eq.depth ? `${parseFloat(eq.depth).toFixed(0)} km` : '—';
    const loc   = eq.location || eq.district || eq.place || 'Bilinmiyor';

    const item = document.createElement('div');
    item.className = 'quake-item';
    item.dataset.id = id;
    if (String(state.selectedId) === String(id)) item.classList.add('selected');

    item.innerHTML = `
      <div class="qi-mag" style="color:${color};border-color:${color}30">
        <span class="qi-mag-val">${mag.toFixed(1)}</span>
        <span class="qi-mag-type">${magLabel(mag)}</span>
      </div>
      <div class="qi-info">
        <div class="qi-loc">${escapeHtml(loc)}</div>
        <div class="qi-meta">
          <span class="qi-date">${formatDisplayDate(eq.date || eq.eventDate)}</span>
          <span class="qi-ago">${timeAgo(eq.date || eq.eventDate)}</span>
        </div>
        <div class="qi-depth">
          <span class="qi-tag">⬇ ${depth}</span>
          ${eq.magType ? `<span class="qi-tag">${eq.magType}</span>` : ''}
          <span class="qi-tag qi-id">#${id}</span>
        </div>
      </div>
      <div class="qi-bar" style="background:${color}"></div>
    `;
    item.addEventListener('click', () => {
      state.selectedId = String(id);
      document.querySelectorAll('.quake-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
    });
    frag.appendChild(item);
  });
  listEl.innerHTML = '';
  listEl.appendChild(frag);
}

function highlightListItem(id) {
  document.querySelectorAll('.quake-item').forEach(el =>
    el.classList.toggle('selected', el.dataset.id === String(id))
  );
}
function scrollToListItem(id) {
  document.querySelector(`.quake-item[data-id="${id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── UI Yardımcıları ──────────────────────────────────────
function setLoading(val) {
  const btn = document.getElementById('btn-search');
  const sp  = document.getElementById('loading-spinner');
  if (btn) { btn.disabled = val; btn.textContent = val ? 'SORGULANYOR...' : 'SORGULA'; }
  if (sp)  sp.style.display = val ? 'flex' : 'none';
}
function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) { el.innerHTML = '⚠ ' + msg; el.style.display = 'block'; }
}
function clearError() {
  const el = document.getElementById('error-banner'); if (el) el.style.display = 'none';
}
function showStatus(label, msg, type = 'info') {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.className = `status-bar status-${type}`;
  el.innerHTML = `<span class="status-label">${label}</span><span class="status-msg">${msg}</span>`;
}
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── CSV İhracat ──────────────────────────────────────────
function exportCsv() {
  if (!state.filtered.length) return;
  const headers = ['EventID','Tarih','Büyüklük','Tip','Derinlik(km)','Enlem','Boylam','Konum'];
  const rows = state.filtered.map(eq => [
    eq.eventID||eq.id||'', eq.date||eq.eventDate||'',
    eq.magnitude||eq.mag||'', eq.magType||'', eq.depth||'',
    eq.latitude||eq.lat||'', eq.longitude||eq.lon||'',
    (eq.location||eq.district||'').replace(/,/g,';'),
  ]);
  const csv = [headers,...rows].map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download = `depremler_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── Form Mantığı ─────────────────────────────────────────
function setupFormLogic() {
  document.getElementById('input-eventid')?.addEventListener('input', e => {
    const has = e.target.value.trim() !== '';
    document.querySelectorAll('.non-eventid-input').forEach(el => {
      el.disabled = has;
      el.closest?.('.form-group')?.classList.toggle('disabled', has);
    });
  });

  document.querySelectorAll('input[name="loc-mode"]').forEach(r =>
    r.addEventListener('change', () => {
      document.getElementById('panel-rect')?.classList.toggle('hidden', r.value !== 'rect');
      document.getElementById('panel-radial')?.classList.toggle('hidden', r.value !== 'radial');
    })
  );

  const slider    = document.getElementById('filter-minmag');
  const sliderVal = document.getElementById('filter-minmag-val');
  slider?.addEventListener('input', () => {
    sliderVal.textContent = parseFloat(slider.value).toFixed(1);
    applyClientFilter(); renderAll();
  });

  document.querySelectorAll('[data-quickdate]').forEach(btn =>
    btn.addEventListener('click', () => {
      const now = new Date(), past = new Date(now - btn.dataset.quickdate * 86400000);
      document.getElementById('input-start-date').value = past.toISOString().slice(0,10);
      document.getElementById('input-start-time').value = past.toTimeString().slice(0,8);
      document.getElementById('input-end-date').value   = now.toISOString().slice(0,10);
      document.getElementById('input-end-time').value   = now.toTimeString().slice(0,8);
    })
  );

  document.getElementById('btn-search')?.addEventListener('click', () => doSearch());
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    state.earthquakes = []; state.filtered = []; state.selectedId = null;
    renderAll(); clearError(); showStatus('TEMİZLENDİ','Veriler temizlendi','info');
  });
  document.getElementById('btn-export')?.addEventListener('click', exportCsv);
  document.getElementById('input-eventid')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
}

// ─── Saat ─────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const tick = () => el.textContent = new Date().toLocaleTimeString('tr-TR');
  tick(); setInterval(tick, 1000);
}

// ─── Init ─────────────────────────────────────────────────
export function init() {
  initMap('map-container');
  setupFormLogic();
  startClock();

  const now  = new Date();
  const past = new Date(now - 7 * 86400000);
  document.getElementById('input-start-date').value = past.toISOString().slice(0,10);
  document.getElementById('input-start-time').value = '00:00:00';
  document.getElementById('input-end-date').value   = now.toISOString().slice(0,10);
  document.getElementById('input-end-time').value   = now.toTimeString().slice(0,8);

  doSearch();
}
