// ============================================================
// app.js — Ana uygulama mantığı
// ============================================================

import {
  initMap,
  renderQuakes,
  showMapTooltip,
  geoToSvg,
} from './map.js?v=20260726';

import {
  toApiDateTime,
  toLocalDateInput,
  toLocalTimeInput,
  formatDisplayDate,
  timeAgo,
  setCache,
  getCache,
  buildCacheKey,
  buildApiUrl,
  validateParams,
  magColor,
  magLabel,
  normalizeEarthquakes,
  cleanupExpiredCache,
} from './utils.js?v=20260807';

const LIST_PAGE_SIZE = 250;
const MAX_MAP_POINTS = 2000;

const AUTO_REFRESH_BASE_MS = 60 * 1000;
const AUTO_REFRESH_MAX_MS = 5 * 60 * 1000;
const LIVE_END_TOLERANCE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;

// ─── Uygulama Durumu ──────────────────────────────────────
const state = {
  earthquakes: [],
  filtered: [],
  selectedId: null,
  loading: false,
  lastFetch: null,
  visibleLimit: LIST_PAGE_SIZE,

  activeController: null,

  liveMode: false,
  liveWindowMs: null,
  autoRefreshTimer: null,
  refreshFailures: 0,
};

// ─── API & FETCH ──────────────────────────────────────────
// AFAD isteği tarayıcıdan doğrudan yapılmaz.
// Aynı-origin api.php proxy'si validasyon, rate-limit ve server cache uygular.
async function fetchEarthquakes(
  params,
  {
    controller,
    useClientCache = true,
  } = {}
) {
  const cacheKey = buildCacheKey(params);

  if (useClientCache) {
    const cached = getCache(cacheKey);

    if (cached) {
      showStatus('ÖNBELLEK', 'Tarayıcı önbelleğinden yüklendi', 'info');
      return cached;
    }
  }

  const targetUrl = buildApiUrl({ ...params, format: 'json' });
  showStatus('BAĞLANIYOR', 'AFAD verisi alınıyor...', 'info');

  const signal = controller?.signal;

  const timeoutId = setTimeout(() => {
    if (controller && !controller.signal.aborted) {
      controller.abort('timeout');
    }
  }, FETCH_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) {
      const reason = signal.reason;

      if (reason === 'replaced') {
        throw new DOMException('Yeni sorgu başlatıldı.', 'AbortError');
      }

      throw new Error('İstek zaman aşımına uğradı.');
    }

    throw new Error('Sunucu bağlantısı kurulamadı.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const retryAfter = response.headers.get('Retry-After');

    if (response.status === 429 && retryAfter) {
      throw new Error(
        `Çok fazla istek gönderildi. ${retryAfter} saniye sonra tekrar deneyin.`
      );
    }

    throw new Error(
      body?.error || `Sunucu HTTP ${response.status} hatası döndürdü.`
    );
  }

  const data = await response.json();
  const list = Array.isArray(data) ? data : (data.result || data.data || []);

  if (useClientCache) {
    setCache(cacheKey, list);
  }

  return list;
}

// ─── Parametre Toplama ────────────────────────────────────
function collectParams() {
  const valueOf = id =>
    document.getElementById(id)?.value?.trim() || '';

  const params = {};
  const eventId = valueOf('input-eventid');

  if (eventId) {
    params.eventid = eventId;
    return params;
  }

  const startDate = valueOf('input-start-date');
  const startTime = valueOf('input-start-time') || '00:00:00';
  const endDate = valueOf('input-end-date');
  const endTime = valueOf('input-end-time') || '23:59:59';

  if (startDate) params.start = toApiDateTime(startDate, startTime);
  if (endDate) params.end = toApiDateTime(endDate, endTime);

  ['minmag', 'maxmag', 'magtype', 'mindepth', 'maxdepth'].forEach(key => {
    const value = valueOf(`input-${key}`);
    if (value) params[key] = value;
  });

  const mode =
    document.querySelector('input[name="loc-mode"]:checked')?.value || 'none';

  if (mode === 'rect') {
    ['minlat', 'maxlat', 'minlon', 'maxlon'].forEach(key => {
      const value = valueOf(`input-${key}`);
      if (value) params[key] = value;
    });
  }

  if (mode === 'radial') {
    ['lat', 'lon', 'maxrad', 'minrad'].forEach(key => {
      const value = valueOf(`input-${key}`);
      if (value) params[key] = value;
    });
  }

  params.orderby = valueOf('input-orderby') || 'timedesc';
  params.limit = valueOf('input-limit') || '500';

  return params;
}

function parseFormDateTime(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function determineLiveWindow(params) {
  if (params.eventid || !params.start || !params.end) {
    return { liveMode: false, windowMs: null };
  }

  const start = parseFormDateTime(params.start);
  const end = parseFormDateTime(params.end);

  if (!start || !end) {
    return { liveMode: false, windowMs: null };
  }

  const distanceFromNow = Math.abs(Date.now() - end.getTime());
  const windowMs = end.getTime() - start.getTime();

  return {
    liveMode:
      distanceFromNow <= LIVE_END_TOLERANCE_MS &&
      Number.isFinite(windowMs) &&
      windowMs > 0,
    windowMs: windowMs > 0 ? windowMs : null,
  };
}

function refreshLiveDateRange() {
  if (!state.liveMode || !state.liveWindowMs) return;

  const now = new Date();
  const start = new Date(now.getTime() - state.liveWindowMs);

  const startDate = document.getElementById('input-start-date');
  const startTime = document.getElementById('input-start-time');
  const endDate = document.getElementById('input-end-date');
  const endTime = document.getElementById('input-end-time');

  if (startDate) startDate.value = toLocalDateInput(start);
  if (startTime) startTime.value = toLocalTimeInput(start);
  if (endDate) endDate.value = toLocalDateInput(now);
  if (endTime) endTime.value = toLocalTimeInput(now);
}

// ─── Otomatik Canlı Yenileme ──────────────────────────────
function clearAutoRefreshTimer() {
  if (state.autoRefreshTimer) {
    clearTimeout(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
}

function currentRefreshDelay() {
  if (state.refreshFailures <= 0) return AUTO_REFRESH_BASE_MS;

  const delay =
    AUTO_REFRESH_BASE_MS * Math.pow(2, Math.min(state.refreshFailures, 3));

  return Math.min(delay, AUTO_REFRESH_MAX_MS);
}

function scheduleNextRefresh() {
  clearAutoRefreshTimer();

  if (!state.liveMode) return;

  const delay = currentRefreshDelay();

  state.autoRefreshTimer = setTimeout(async () => {
    if (!state.liveMode) return;

    if (document.visibilityState !== 'visible') {
      scheduleNextRefresh();
      return;
    }

    if (state.loading) {
      scheduleNextRefresh();
      return;
    }

    await doSearch({ auto: true });
  }, delay);
}

function setupVisibilityHandling() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.liveMode) return;

    const elapsed = state.lastFetch
      ? Date.now() - state.lastFetch.getTime()
      : Infinity;

    if (elapsed >= AUTO_REFRESH_BASE_MS && !state.loading) {
      doSearch({ auto: true });
    } else {
      scheduleNextRefresh();
    }
  });
}

// ─── Arama ────────────────────────────────────────────────
export async function doSearch({ auto = false } = {}) {
  if (auto && !state.liveMode) return;
  if (auto && state.loading) return;

  if (auto) {
    refreshLiveDateRange();
  }

  const params = collectParams();
  const errors = validateParams(params);

  if (errors.length > 0) {
    if (!auto) showError(errors.join(' '));
    return;
  }

  if (!auto) {
    const live = determineLiveWindow(params);
    state.liveMode = live.liveMode;
    state.liveWindowMs = live.windowMs;
    state.refreshFailures = 0;
  }

  if (state.activeController) {
    state.activeController.abort('replaced');
  }

  const controller = new AbortController();
  state.activeController = controller;

  setLoading(true);
  clearError();

  try {
    // Canlı sorgularda browser cache kullanılmaz.
    // Tazelik, api.php üzerindeki kısa süreli ortak server cache ile sağlanır.
    const useClientCache = !state.liveMode;

    const raw = await fetchEarthquakes(params, {
      controller,
      useClientCache,
    });

    if (controller.signal.aborted) return;

    const list = normalizeEarthquakes(
      Array.isArray(raw) ? raw : (raw.result || raw.data || [])
    );

    state.earthquakes = list;
    state.lastFetch = new Date();
    state.visibleLimit = LIST_PAGE_SIZE;
    state.refreshFailures = 0;

    applyClientFilter();
    renderAll();

    const liveSuffix = state.liveMode
      ? ' • otomatik yenileme açık'
      : '';

    showStatus(
      auto ? 'GÜNCELLENDİ' : 'HAZIR',
      `${list.length} deprem bulundu${liveSuffix}`,
      'success'
    );

    const usedLimit = parseInt(params.limit, 10) || 500;

    if (list.length >= usedLimit) {
      showLimitWarning(usedLimit, list.length);
    } else {
      clearLimitWarning();
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;

    console.error(error);

    if (auto) {
      state.refreshFailures += 1;

      const nextMinutes = Math.round(currentRefreshDelay() / 60000);
      showError(
        `Canlı güncelleme başarısız: ${error.message} ` +
        `Mevcut veriler korunuyor. Yaklaşık ${nextMinutes} dk sonra tekrar denenecek.`
      );
    } else {
      showError(`Hata: ${error.message}`);
    }
  } finally {
    if (state.activeController === controller) {
      state.activeController = null;
      setLoading(false);
    }

    if (state.liveMode) {
      scheduleNextRefresh();
    } else {
      clearAutoRefreshTimer();
    }
  }
}

// ─── İstemci Tarafı Filtre ────────────────────────────────
function applyClientFilter() {
  const minMag =
    parseFloat(document.getElementById('filter-minmag')?.value) || 0;

  state.filtered = state.earthquakes.filter(
    eq => Number(eq.magnitude ?? 0) >= minMag
  );
}

// ─── Render ───────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderList();
  renderMap();
}

function renderStats() {
  const mags = state.filtered
    .map(eq => Number(eq.magnitude))
    .filter(Number.isFinite);

  setEl('stat-total', state.filtered.length);
  setEl('stat-total-list', state.filtered.length);
  setEl('stat-max', mags.length ? Math.max(...mags).toFixed(1) : '—');
  setEl(
    'stat-avg',
    mags.length
      ? (mags.reduce((sum, value) => sum + value, 0) / mags.length).toFixed(2)
      : '—'
  );
  setEl('stat-big', mags.filter(value => value >= 4.0).length);
  setEl(
    'stat-time',
    state.lastFetch
      ? state.lastFetch.toLocaleTimeString('tr-TR')
      : '—'
  );
}

function renderMap() {
  renderQuakes(
    selectMapQuakes(state.filtered),
    (eq, x, y) => {
      const mag = Number(eq.magnitude ?? 0);

      showMapTooltip(
        [
          `M ${mag.toFixed(1)} — ${magLabel(mag)}`,
          `📍 ${eq.location || 'Bilinmiyor'}`,
          `🕐 ${formatDisplayDate(eq.date)}`,
          `⬇ Derinlik: ${
            Number.isFinite(eq.depth) ? `${eq.depth} km` : '—'
          }`,
        ].join('\n'),
        x,
        y
      );
    },
    eq => {
      state.selectedId = eq.eventID || eq.id;
      highlightListItem(state.selectedId);
      scrollToListItem(state.selectedId);
    }
  );
}

export function selectMapQuakes(
  earthquakes,
  maxPoints = MAX_MAP_POINTS
) {
  if (earthquakes.length <= maxPoints) return earthquakes;

  const strong = earthquakes.filter(
    eq => Number(eq.magnitude ?? 0) >= 4
  );

  const strongSet = new Set(strong);
  const remaining = earthquakes.filter(eq => !strongSet.has(eq));
  const available = Math.max(0, maxPoints - strong.length);
  const step = available > 0 ? remaining.length / available : Infinity;
  const sampled = [];

  for (let index = 0; index < available; index += 1) {
    const item = remaining[Math.floor(index * step)];
    if (item) sampled.push(item);
  }

  return strong.length >= maxPoints
    ? [...strong]
        .sort(
          (a, b) =>
            Number(b.magnitude ?? 0) - Number(a.magnitude ?? 0)
        )
        .slice(0, maxPoints)
    : strong.concat(sampled);
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

  const fragment = document.createDocumentFragment();
  const visible = state.filtered.slice(0, state.visibleLimit);

  visible.forEach((eq, index) => {
    const id = eq.eventID || eq.id || `quake-${index}`;
    const mag = Number(eq.magnitude ?? 0);
    const color = magColor(mag);
    const depth = Number.isFinite(eq.depth)
      ? `${eq.depth.toFixed(0)} km`
      : '—';
    const location = eq.location || 'Bilinmiyor';

    const item = document.createElement('div');
    item.className = 'quake-item';
    item.dataset.id = String(id);

    if (String(state.selectedId) === String(id)) {
      item.classList.add('selected');
    }

    item.innerHTML = `
      <div class="qi-mag" style="color:${color};border-color:${color}30">
        <span class="qi-mag-val">${mag.toFixed(1)}</span>
        <span class="qi-mag-type">${magLabel(mag)}</span>
      </div>
      <div class="qi-info">
        <div class="qi-loc">${escapeHtml(location)}</div>
        <div class="qi-meta">
          <span class="qi-date">${formatDisplayDate(eq.date)}</span>
          <span class="qi-ago">${timeAgo(eq.date)}</span>
        </div>
        <div class="qi-depth">
          <span class="qi-tag">⬇ ${depth}</span>
          ${
            eq.magType
              ? `<span class="qi-tag">${escapeHtml(eq.magType)}</span>`
              : ''
          }
          <span class="qi-tag qi-id">#${escapeHtml(id)}</span>
        </div>
      </div>
      <div class="qi-bar" style="background:${color}"></div>
    `;

    item.addEventListener('click', () => {
      state.selectedId = String(id);

      document.querySelectorAll('.quake-item').forEach(element => {
        element.classList.remove('selected');
      });

      item.classList.add('selected');

      const lat = Number(eq.latitude);
      const lon = Number(eq.longitude);

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const { x, y } = geoToSvg(lat, lon);

        showMapTooltip(
          [
            `M ${mag.toFixed(1)} — ${magLabel(mag)}`,
            `📍 ${location}`,
            `🕐 ${formatDisplayDate(eq.date)}`,
            `⬇ Derinlik: ${
              Number.isFinite(eq.depth) ? `${eq.depth} km` : '—'
            }`,
          ].join('\n'),
          x,
          y
        );
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    fragment.appendChild(item);
  });

  listEl.innerHTML = '';
  listEl.appendChild(fragment);

  if (visible.length < state.filtered.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'list-load-more';
    more.textContent =
      `DAHA FAZLA GÖSTER (${visible.length}/${state.filtered.length})`;

    more.addEventListener('click', () => {
      state.visibleLimit += LIST_PAGE_SIZE;
      renderList();
    });

    listEl.appendChild(more);
  }
}

function highlightListItem(id) {
  document.querySelectorAll('.quake-item').forEach(element => {
    element.classList.toggle(
      'selected',
      element.dataset.id === String(id)
    );
  });
}

function scrollToListItem(id) {
  const safeId =
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(String(id))
      : String(id).replace(/["\\]/g, '\\$&');

  document
    .querySelector(`.quake-item[data-id="${safeId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── UI Yardımcıları ──────────────────────────────────────
function setLoading(value) {
  state.loading = value;

  const button = document.getElementById('btn-search');
  const spinner = document.getElementById('loading-spinner');

  if (button) {
    button.disabled = value;
    button.textContent = value ? 'SORGULANYOR...' : 'SORGULA';
  }

  if (spinner) {
    spinner.style.display = value ? 'flex' : 'none';
  }
}

function showError(message) {
  const element = document.getElementById('error-banner');
  if (!element) return;

  element.textContent = `⚠ ${message}`;
  element.style.display = 'block';
}

function clearError() {
  const element = document.getElementById('error-banner');
  if (element) element.style.display = 'none';
}

function showLimitWarning(limit, count) {
  let element = document.getElementById('limit-warning');

  if (!element) {
    element = document.createElement('div');
    element.id = 'limit-warning';
    element.className = 'limit-warning';

    const limitInput = document.getElementById('input-limit');
    limitInput
      ?.closest('.form-group')
      ?.insertAdjacentElement('beforebegin', element);
  }

  element.innerHTML = `
    ⚠ <strong>${count} deprem</strong> çekildi fakat bu limit değerinize
    (<strong>${limit}</strong>) eşit — daha fazla deprem mevcut olabilir.
    Tüm sonuçları görmek için limiti artırın.
    <button class="limit-bump-btn" id="btn-bump-limit">Limiti 2× Artır</button>
  `;

  element.style.display = 'block';

  document
    .getElementById('btn-bump-limit')
    ?.addEventListener('click', () => {
      const input = document.getElementById('input-limit');

      if (input) {
        input.value = String(Math.min(25000, limit * 2));
        clearLimitWarning();
        doSearch();
      }
    });
}

function clearLimitWarning() {
  const element = document.getElementById('limit-warning');
  if (element) element.style.display = 'none';
}

function showStatus(label, message, type = 'info') {
  const element = document.getElementById('status-bar');
  if (!element) return;

  element.className = `status-bar status-${type}`;
  element.innerHTML =
    `<span class="status-label">${escapeHtml(label)}</span>` +
    `<span class="status-msg">${escapeHtml(message)}</span>`;
}

function setEl(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── CSV İhracat ──────────────────────────────────────────
function csvCell(value) {
  let text = String(value ?? '');

  // Excel/LibreOffice formula injection koruması.
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!state.filtered.length) return;

  const headers = [
    'EventID',
    'Tarih',
    'Büyüklük',
    'Tip',
    'Derinlik(km)',
    'Enlem',
    'Boylam',
    'Konum',
  ];

  const rows = state.filtered.map(eq => [
    eq.eventID || '',
    eq.date || '',
    eq.magnitude ?? '',
    eq.magType || '',
    eq.depth ?? '',
    eq.latitude ?? '',
    eq.longitude ?? '',
    eq.location || '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');

  const blob = new Blob(
    ['\uFEFF' + csv],
    { type: 'text/csv;charset=utf-8;' }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `depremler_${toLocalDateInput(new Date())}.csv`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Form Mantığı ─────────────────────────────────────────
function setupFormLogic() {
  document
    .getElementById('input-eventid')
    ?.addEventListener('input', event => {
      const hasEventId = event.target.value.trim() !== '';

      document
        .querySelectorAll('.non-eventid-input')
        .forEach(element => {
          const controls = element.matches('input, select, button')
            ? [element]
            : element.querySelectorAll('input, select, button');

          controls.forEach(control => {
            control.disabled = hasEventId;
          });

          element
            .closest?.('.form-group')
            ?.classList.toggle('disabled', hasEventId);
        });

      if (hasEventId) {
        state.liveMode = false;
        state.liveWindowMs = null;
        clearAutoRefreshTimer();
      }
    });

  document
    .querySelectorAll('input[name="loc-mode"]')
    .forEach(radio => {
      radio.addEventListener('change', () => {
        const selected =
          document.querySelector('input[name="loc-mode"]:checked')?.value ||
          'none';

        document
          .getElementById('panel-rect')
          ?.classList.toggle('hidden', selected !== 'rect');

        document
          .getElementById('panel-radial')
          ?.classList.toggle('hidden', selected !== 'radial');
      });
    });

  const slider = document.getElementById('filter-minmag');
  const sliderValue = document.getElementById('filter-minmag-val');

  slider?.addEventListener('input', () => {
    slider.style.setProperty(
      '--range-pct',
      `${Number(slider.value) / 8 * 100}%`
    );

    if (sliderValue) {
      sliderValue.textContent = Number(slider.value).toFixed(1);
    }

    state.visibleLimit = LIST_PAGE_SIZE;
    applyClientFilter();
    renderAll();
  });

  if (slider) {
    slider.style.setProperty(
      '--range-pct',
      `${Number(slider.value) / 8 * 100}%`
    );
  }

  document.querySelectorAll('[data-quickdate]').forEach(button => {
    button.addEventListener('click', () => {
      const days = Number(button.dataset.quickdate || 0);
      const now = new Date();
      const past = new Date(now.getTime() - days * 86400000);

      const startDate = document.getElementById('input-start-date');
      const startTime = document.getElementById('input-start-time');
      const endDate = document.getElementById('input-end-date');
      const endTime = document.getElementById('input-end-time');

      if (startDate) startDate.value = toLocalDateInput(past);
      if (startTime) startTime.value = toLocalTimeInput(past);
      if (endDate) endDate.value = toLocalDateInput(now);
      if (endTime) endTime.value = toLocalTimeInput(now);
    });
  });

  document
    .getElementById('btn-search')
    ?.addEventListener('click', () => doSearch());

  document
    .getElementById('btn-clear')
    ?.addEventListener('click', () => {
      state.activeController?.abort('replaced');
      state.activeController = null;

      state.earthquakes = [];
      state.filtered = [];
      state.selectedId = null;
      state.visibleLimit = LIST_PAGE_SIZE;
      state.lastFetch = null;
      state.liveMode = false;
      state.liveWindowMs = null;
      state.refreshFailures = 0;

      clearAutoRefreshTimer();
      setLoading(false);
      renderAll();
      clearError();
      clearLimitWarning();

      showStatus('TEMİZLENDİ', 'Veriler temizlendi', 'info');
    });

  document
    .getElementById('btn-export')
    ?.addEventListener('click', exportCsv);

  document
    .getElementById('input-eventid')
    ?.addEventListener('keydown', event => {
      if (event.key === 'Enter') doSearch();
    });
}

// ─── Saat ─────────────────────────────────────────────────
function startClock() {
  const element = document.getElementById('live-clock');
  if (!element) return;

  const tick = () => {
    element.textContent =
      new Date().toLocaleTimeString('tr-TR');
  };

  tick();
  setInterval(tick, 1000);
}

// ─── Init ─────────────────────────────────────────────────
export function init() {
  initMap('map-container');
  setupFormLogic();
  setupVisibilityHandling();
  startClock();
  cleanupExpiredCache();

  const now = new Date();
  const past = new Date(now.getTime() - 7 * 86400000);

  const startDate = document.getElementById('input-start-date');
  const startTime = document.getElementById('input-start-time');
  const endDate = document.getElementById('input-end-date');
  const endTime = document.getElementById('input-end-time');

  if (startDate) startDate.value = toLocalDateInput(past);
  if (startTime) startTime.value = '00:00:00';
  if (endDate) endDate.value = toLocalDateInput(now);
  if (endTime) endTime.value = toLocalTimeInput(now);

  doSearch();
}
