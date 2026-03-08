// ============================================================
// utils.js — Yardımcı fonksiyonlar: zaman, format, cache
// ============================================================

const CACHE_KEY_PREFIX = 'deprem_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika

/**
 * Büyüklüğe göre renk döndürür
 */
export function magColor(mag) {
  if (mag < 2.0) return '#4ade80';   // yeşil — mikro
  if (mag < 3.0) return '#a3e635';   // açık yeşil — minör
  if (mag < 4.0) return '#facc15';   // sarı — hafif
  if (mag < 5.0) return '#fb923c';   // turuncu — orta
  if (mag < 6.0) return '#f87171';   // kırmızı — güçlü
  if (mag < 7.0) return '#e11d48';   // koyu kırmızı — büyük
  return '#7c3aed';                   // mor — büyük felaket
}

/**
 * Büyüklüğe göre etiket döndürür
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
  const d = dateStr.includes('T') ? dateStr : `${dateStr}T${timeStr}`;
  return d;
}

/**
 * Gösterim için tarih formatı
 */
export function formatDisplayDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return isoStr;
  }
}

/**
 * "X dakika önce" formatı
 */
export function timeAgo(isoStr) {
  if (!isoStr) return '';
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
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
 * Debounce — kullanıcı yazmayı bitirince tetikler
 */
export function debounce(fn, delay = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * localStorage cache'e yazar (TTL'li)
 */
export function setCache(key, data) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({
      ts: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Cache yazma hatası:', e);
  }
}

/**
 * localStorage cache'den okur, TTL geçmişse null döner
 */
export function getCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Cache anahtarı oluşturur (parametre objesinden)
 */
export function buildCacheKey(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * API URL oluşturur
 */
export function buildApiUrl(params) {
  const base = 'api.php';
  const filtered = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined);
  const qs = filtered.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${base}?${qs}`;
}

/**
 * API parametrelerini doğrular
 */
export function validateParams(params) {
  const errors = [];

  // eventid varsa diğerlerine bakma
  if (params.eventid) return errors;

  // Zaman zorunlu
  if (!params.start) errors.push('Başlangıç tarihi zorunludur.');
  if (!params.end) errors.push('Bitiş tarihi zorunludur.');

  // Dikdörtgen + radyal aynı anda olmaz
  const hasRect = params.minlat || params.maxlat || params.minlon || params.maxlon;
  const hasRadial = params.lat || params.lon || params.maxrad;
  if (hasRect && hasRadial) {
    errors.push('Dikdörtgen ve radyal sınırlar aynı anda kullanılamaz.');
  }

  // Radyal için zorunlular
  if (hasRadial) {
    if (!params.lat) errors.push('Radyal: Merkez enlem (lat) zorunlu.');
    if (!params.lon) errors.push('Radyal: Merkez boylam (lon) zorunlu.');
    if (!params.maxrad) errors.push('Radyal: Maksimum mesafe (maxrad) zorunlu.');
  }

  return errors;
}
