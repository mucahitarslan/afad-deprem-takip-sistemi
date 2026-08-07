// ============================================================
// utils.js — Yardımcı fonksiyonlar: zaman, format, cache, normalizasyon
// ============================================================

const CACHE_KEY_PREFIX = 'deprem_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika
const CACHE_MAX_ENTRIES = 20;

/**
 * Büyüklüğe göre renk döndürür.
 */
export function magColor(mag) {
  if (mag < 2.0) return '#4ade80';
  if (mag < 3.0) return '#a3e635';
  if (mag < 4.0) return '#facc15';
  if (mag < 5.0) return '#fb923c';
  if (mag < 6.0) return '#f87171';
  if (mag < 7.0) return '#e11d48';
  return '#7c3aed';
}

/**
 * Büyüklüğe göre etiket döndürür.
 */
export function magLabel(mag) {
  if (mag < 2.0) return 'MİKRO';
  if (mag < 3.0) return 'MİNÖR';
  if (mag < 4.0) return 'HAFİF';
  if (mag < 5.0) return 'ORTA';
  if (mag < 6.0) return 'GÜÇLÜ';
  if (mag < 7.0) return 'BÜYÜK';
  return 'FELAKET';
}

/**
 * API için datetime formatına çevirir: YYYY-MM-DDThh:mm:ss
 */
export function toApiDateTime(dateStr, timeStr = '00:00:00') {
  if (!dateStr) return null;
  return dateStr.includes('T') ? dateStr : `${dateStr}T${timeStr}`;
}

/**
 * Date değerini tarayıcının yerel takviminde YYYY-MM-DD biçimine çevirir.
 */
export function toLocalDateInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Date değerini tarayıcının yerel saatinde HH:mm:ss biçimine çevirir.
 */
export function toLocalTimeInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * AFAD'ın saat dilimi bilgisi içermeyen zamanını UTC olarak ayrıştırır.
 * API sözleşmesi değişirse yalnızca bu fonksiyon güncellenmelidir.
 */
export function parseAfadDate(isoStr) {
  if (!isoStr) return null;

  const normalized = String(isoStr).trim().replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const date = new Date(hasZone ? normalized : `${normalized}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Gösterim için tarih formatı (Europe/Istanbul).
 */
export function formatDisplayDate(isoStr) {
  if (!isoStr) return '—';

  try {
    const date = parseAfadDate(isoStr);
    if (!date) return String(isoStr);

    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(date).replace(',', '');
  } catch {
    return String(isoStr);
  }
}

/**
 * "X dakika önce" formatı.
 */
export function timeAgo(isoStr) {
  if (!isoStr) return '';

  try {
    const date = parseAfadDate(isoStr);
    if (!date) return '';

    const diff = Math.max(0, Date.now() - date.getTime());
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return 'Şimdi';
    if (mins < 60) return `${mins} dk önce`;

    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} sa önce`;

    return `${Math.floor(hrs / 24)} gün önce`;
  } catch {
    return '';
  }
}

/**
 * AFAD yanıtındaki farklı alan adlarını uygulama içi tek bir modele dönüştürür.
 */
export function normalizeEarthquake(raw = {}) {
  const numberOrNull = value => {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const textOrEmpty = value =>
    value === null || value === undefined ? '' : String(value).trim();

  const eventID = textOrEmpty(
    raw.eventID ?? raw.eventId ?? raw.eventid ?? raw.id
  );

  return {
    eventID,
    id: eventID,
    date: textOrEmpty(raw.date ?? raw.eventDate ?? raw.eventdate),
    magnitude: numberOrNull(raw.magnitude ?? raw.mag),
    magType: textOrEmpty(raw.magType ?? raw.magtype),
    depth: numberOrNull(raw.depth),
    latitude: numberOrNull(raw.latitude ?? raw.lat),
    longitude: numberOrNull(raw.longitude ?? raw.lon ?? raw.lng),
    location: textOrEmpty(
      raw.location ?? raw.district ?? raw.place ?? raw.title
    ) || 'Bilinmiyor',
  };
}

/**
 * AFAD yanıtını normalize eder ve geçersiz kayıtları güvenli biçimde ayıklar.
 */
export function normalizeEarthquakes(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map(normalizeEarthquake)
    .filter(eq =>
      eq.eventID ||
      eq.date ||
      eq.magnitude !== null ||
      (eq.latitude !== null && eq.longitude !== null)
    );
}

/**
 * Debounce — kullanıcı yazmayı bitirince tetikler.
 */
export function debounce(fn, delay = 500) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Süresi geçmiş cache kayıtlarını temizler ve toplam kayıt sayısını sınırlar.
 */
export function cleanupExpiredCache(maxEntries = CACHE_MAX_ENTRIES) {
  try {
    const now = Date.now();
    const entries = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (!storageKey?.startsWith(CACHE_KEY_PREFIX)) continue;

      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey));
        const ts = Number(parsed?.ts || 0);

        if (!ts || now - ts > CACHE_TTL_MS) {
          localStorage.removeItem(storageKey);
          i -= 1;
          continue;
        }

        entries.push({ storageKey, ts });
      } catch {
        localStorage.removeItem(storageKey);
        i -= 1;
      }
    }

    entries
      .sort((a, b) => b.ts - a.ts)
      .slice(maxEntries)
      .forEach(entry => localStorage.removeItem(entry.storageKey));
  } catch {
    // localStorage kapalıysa uygulama cache olmadan çalışmaya devam eder.
  }
}

/**
 * localStorage cache'e yazar (TTL'li).
 */
export function setCache(key, data) {
  try {
    cleanupExpiredCache();

    localStorage.setItem(
      CACHE_KEY_PREFIX + key,
      JSON.stringify({
        ts: Date.now(),
        data,
      })
    );

    cleanupExpiredCache();
  } catch (error) {
    console.warn('Cache yazma hatası:', error);
  }
}

/**
 * localStorage cache'den okur, TTL geçmişse null döner.
 */
export function getCache(key) {
  try {
    const storageKey = CACHE_KEY_PREFIX + key;
    const raw = localStorage.getItem(storageKey);

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts || 0);

    if (!ts || Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }

    return parsed.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Cache anahtarı oluşturur.
 */
export function buildCacheKey(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/**
 * Aynı-origin PHP proxy URL'sini oluşturur.
 */
export function buildApiUrl(params) {
  const base = 'api.php';

  const query = Object.entries(params)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');

  return query ? `${base}?${query}` : base;
}

/**
 * API parametrelerini doğrular.
 */
export function validateParams(params) {
  const errors = [];

  if (params.eventid) return errors;

  if (!params.start) errors.push('Başlangıç tarihi zorunludur.');
  if (!params.end) errors.push('Bitiş tarihi zorunludur.');

  if (params.start && params.end && params.start > params.end) {
    errors.push('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  }

  const hasRect = Boolean(
    params.minlat || params.maxlat || params.minlon || params.maxlon
  );

  const hasRadial = Boolean(
    params.lat || params.lon || params.maxrad || params.minrad
  );

  if (hasRect && hasRadial) {
    errors.push('Dikdörtgen ve radyal sınırlar aynı anda kullanılamaz.');
  }

  if (hasRect) {
    if (!params.minlat) errors.push('Dikdörtgen: Minimum enlem zorunlu.');
    if (!params.maxlat) errors.push('Dikdörtgen: Maksimum enlem zorunlu.');
    if (!params.minlon) errors.push('Dikdörtgen: Minimum boylam zorunlu.');
    if (!params.maxlon) errors.push('Dikdörtgen: Maksimum boylam zorunlu.');
  }

  if (hasRadial) {
    if (!params.lat) errors.push('Radyal: Merkez enlem (lat) zorunlu.');
    if (!params.lon) errors.push('Radyal: Merkez boylam (lon) zorunlu.');
    if (!params.maxrad) errors.push('Radyal: Maksimum mesafe (maxrad) zorunlu.');
  }

  return errors;
}
