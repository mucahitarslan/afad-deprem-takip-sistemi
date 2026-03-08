// ============================================================
// map.js — Gerçek Türkiye Haritası + Deprem Katmanı
//
// Harita kaynağı: Wikimedia Commons — Turkey location map.svg
// https://commons.wikimedia.org/wiki/File:Turkey_location_map.svg
//
// Haritanın coğrafi sınırları (equirectangular projeksiyon):
//   West  : 25.668°E   East : 44.834°E
//   North : 42.107°N   South: 35.817°N
// ============================================================

import { magColor } from './utils.js';

// ── Harita görüntüsü ─────────────────────────────────────────
// Wikimedia Commons'tan PNG render (900px genişlik, şeffaf arka plan)
const MAP_IMG_URL = 'https://upload.wikimedia.org/wikipedia/commons/5/52/Turkey_location_map.svg';

// Haritanın coğrafi sınırları (Wikimedia meta verisinden)
const GEO = {
  west:  25.668,
  east:  44.834,
  north: 42.107,
  south: 35.817,
};

// SVG viewport — harita görüntüsüyle aynı en-boy oranı
export const MAP_W = 900;
export const MAP_H = 295; // 900 * (42.107-35.817) / (44.834-25.668) = 295

/**
 * Coğrafi koordinatları SVG piksel koordinatlarına dönüştürür.
 * Equirectangular projeksiyon — Wikimedia haritasıyla birebir eşleşir.
 */
export function geoToSvg(lat, lon) {
  const x = ((lon - GEO.west)  / (GEO.east  - GEO.west))  * MAP_W;
  const y = ((GEO.north - lat) / (GEO.north - GEO.south)) * MAP_H;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

// ── 81 İl merkezi ────────────────────────────────────────────
const CITIES = [
  { name: 'İstanbul',       lat: 41.013, lon: 28.948, major: true  },
  { name: 'Ankara',         lat: 39.920, lon: 32.854, major: true  },
  { name: 'İzmir',          lat: 38.423, lon: 27.143, major: true  },
  { name: 'Bursa',          lat: 40.183, lon: 29.061, major: true  },
  { name: 'Antalya',        lat: 36.897, lon: 30.713, major: true  },
  { name: 'Konya',          lat: 37.871, lon: 32.493, major: true  },
  { name: 'Adana',          lat: 37.000, lon: 35.321, major: true  },
  { name: 'Gaziantep',      lat: 37.066, lon: 37.383, major: true  },
  { name: 'Kocaeli',        lat: 40.765, lon: 29.940, major: true  },
  { name: 'Mersin',         lat: 36.812, lon: 34.641, major: true  },
  { name: 'Diyarbakır',     lat: 37.910, lon: 40.230, major: true  },
  { name: 'Hatay',          lat: 36.202, lon: 36.160, major: true  },
  { name: 'Manisa',         lat: 38.619, lon: 27.429, major: true  },
  { name: 'Kayseri',        lat: 38.732, lon: 35.487, major: true  },
  { name: 'Samsun',         lat: 41.286, lon: 36.330, major: true  },
  { name: 'Balıkesir',      lat: 39.649, lon: 27.885, major: true  },
  { name: 'Kahramanmaraş',  lat: 37.585, lon: 36.937, major: true  },
  { name: 'Van',            lat: 38.494, lon: 43.380, major: true  },
  { name: 'Adıyaman',       lat: 37.764, lon: 38.277 },
  { name: 'Afyonkarahisar', lat: 38.757, lon: 30.540 },
  { name: 'Ağrı',           lat: 39.719, lon: 43.051 },
  { name: 'Aksaray',        lat: 38.368, lon: 34.037 },
  { name: 'Amasya',         lat: 40.655, lon: 35.833 },
  { name: 'Ardahan',        lat: 41.111, lon: 42.702 },
  { name: 'Artvin',         lat: 41.182, lon: 41.819 },
  { name: 'Aydın',          lat: 37.856, lon: 27.845 },
  { name: 'Bartın',         lat: 41.635, lon: 32.338 },
  { name: 'Batman',         lat: 37.881, lon: 41.132 },
  { name: 'Bayburt',        lat: 40.255, lon: 40.224 },
  { name: 'Bilecik',        lat: 40.142, lon: 29.979 },
  { name: 'Bingöl',         lat: 38.885, lon: 40.498 },
  { name: 'Bitlis',         lat: 38.401, lon: 42.107 },
  { name: 'Bolu',           lat: 40.576, lon: 31.579 },
  { name: 'Burdur',         lat: 37.720, lon: 30.291 },
  { name: 'Çanakkale',      lat: 40.155, lon: 26.414 },
  { name: 'Çankırı',        lat: 40.600, lon: 33.614 },
  { name: 'Çorum',          lat: 40.549, lon: 34.955 },
  { name: 'Denizli',        lat: 37.774, lon: 29.086 },
  { name: 'Düzce',          lat: 40.844, lon: 31.157 },
  { name: 'Edirne',         lat: 41.677, lon: 26.556 },
  { name: 'Elazığ',         lat: 38.674, lon: 39.223 },
  { name: 'Erzincan',       lat: 39.750, lon: 39.491 },
  { name: 'Erzurum',        lat: 39.905, lon: 41.268 },
  { name: 'Eskişehir',      lat: 39.776, lon: 30.521 },
  { name: 'Giresun',        lat: 40.912, lon: 38.387 },
  { name: 'Gümüşhane',      lat: 40.461, lon: 39.481 },
  { name: 'Hakkari',        lat: 37.574, lon: 43.741 },
  { name: 'Iğdır',          lat: 39.888, lon: 44.005 },
  { name: 'Isparta',        lat: 37.764, lon: 30.556 },
  { name: 'Karabük',        lat: 41.205, lon: 32.622 },
  { name: 'Karaman',        lat: 37.175, lon: 33.215 },
  { name: 'Kars',           lat: 40.608, lon: 43.095 },
  { name: 'Kastamonu',      lat: 41.376, lon: 33.775 },
  { name: 'Kırıkkale',      lat: 39.847, lon: 33.506 },
  { name: 'Kırklareli',     lat: 41.735, lon: 27.225 },
  { name: 'Kırşehir',       lat: 39.145, lon: 34.160 },
  { name: 'Kilis',          lat: 36.718, lon: 37.121 },
  { name: 'Kütahya',        lat: 39.424, lon: 29.983 },
  { name: 'Malatya',        lat: 38.355, lon: 38.309 },
  { name: 'Mardin',         lat: 37.313, lon: 40.736 },
  { name: 'Muğla',          lat: 37.215, lon: 28.364 },
  { name: 'Muş',            lat: 38.946, lon: 41.749 },
  { name: 'Nevşehir',       lat: 38.625, lon: 34.724 },
  { name: 'Niğde',          lat: 37.966, lon: 34.679 },
  { name: 'Ordu',           lat: 40.984, lon: 37.879 },
  { name: 'Osmaniye',       lat: 37.074, lon: 36.246 },
  { name: 'Rize',           lat: 41.021, lon: 40.523 },
  { name: 'Sakarya',        lat: 40.696, lon: 30.435 },
  { name: 'Sinop',          lat: 42.023, lon: 35.153 },
  { name: 'Şırnak',         lat: 37.418, lon: 42.492 },
  { name: 'Siirt',          lat: 37.929, lon: 41.946 },
  { name: 'Sivas',          lat: 39.748, lon: 37.016 },
  { name: 'Şanlıurfa',      lat: 37.159, lon: 38.796 },
  { name: 'Tekirdağ',       lat: 40.978, lon: 27.515 },
  { name: 'Tokat',          lat: 40.313, lon: 36.554 },
  { name: 'Trabzon',        lat: 41.002, lon: 39.716 },
  { name: 'Tunceli',        lat: 39.108, lon: 39.548 },
  { name: 'Uşak',           lat: 38.682, lon: 29.408 },
  { name: 'Yalova',         lat: 40.655, lon: 29.277 },
  { name: 'Yozgat',         lat: 39.820, lon: 34.808 },
  { name: 'Zonguldak',      lat: 41.456, lon: 31.798 },
];

// ── Harita başlat ────────────────────────────────────────────
export function initMap(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('id', 'map-svg');
  svg.style.cssText = 'width:100%;height:100%;display:block;position:absolute;top:0;left:0;';

  // ── Defs: glow filtresi ──────────────────────────────────
  const defs = document.createElementNS(ns, 'defs');

  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', 'glow');
  filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
  const feBlur = document.createElementNS(ns, 'feGaussianBlur');
  feBlur.setAttribute('stdDeviation', '2.5');
  feBlur.setAttribute('result', 'coloredBlur');
  const feMerge = document.createElementNS(ns, 'feMerge');
  [document.createElementNS(ns, 'feMergeNode'), document.createElementNS(ns, 'feMergeNode')]
    .forEach((n, i) => { if (i === 0) n.setAttribute('in', 'coloredBlur'); else n.setAttribute('in', 'SourceGraphic'); feMerge.appendChild(n); });
  filter.appendChild(feBlur);
  filter.appendChild(feMerge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // ── Arka plan ────────────────────────────────────────────
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', MAP_W);
  bg.setAttribute('height', MAP_H);
  bg.setAttribute('fill', '#06090f');
  svg.appendChild(bg);

  // ── Wikimedia Turkey harita görüntüsü ────────────────────
  // Equirectangular, GEO sınırlarıyla tam örtüşür
  const img = document.createElementNS(ns, 'image');
  img.setAttribute('href', MAP_IMG_URL);
  img.setAttribute('x', '0');
  img.setAttribute('y', '0');
  img.setAttribute('width', MAP_W);
  img.setAttribute('height', MAP_H);
  img.setAttribute('preserveAspectRatio', 'none'); // geo eşleşmesi için stretch yok
  img.setAttribute('opacity', '0.85');

  svg.appendChild(img);

  // ── Renk tonu bindirmesi (karanlık tema uyumu) ───────────
  const tint = document.createElementNS(ns, 'rect');
  tint.setAttribute('width', MAP_W);
  tint.setAttribute('height', MAP_H);
  tint.setAttribute('fill', 'rgba(6,9,15,0.38)');
  svg.appendChild(tint);

  // ── Grid çizgileri ───────────────────────────────────────
  const grid = document.createElementNS(ns, 'g');
  for (let lat = 37; lat <= 42; lat++) {
    const { y } = geoToSvg(lat, GEO.west);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', y);
    line.setAttribute('x2', MAP_W); line.setAttribute('y2', y);
    line.setAttribute('stroke', 'rgba(245,158,11,0.07)');
    line.setAttribute('stroke-width', '0.5');
    grid.appendChild(line);
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', 3); lbl.setAttribute('y', y - 2);
    lbl.setAttribute('fill', 'rgba(245,158,11,0.25)');
    lbl.setAttribute('font-size', '7'); lbl.setAttribute('font-family', 'monospace');
    lbl.textContent = `${lat}°`;
    grid.appendChild(lbl);
  }
  for (let lon = 27; lon <= 44; lon += 2) {
    const { x } = geoToSvg(GEO.north, lon);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', 0);
    line.setAttribute('x2', x); line.setAttribute('y2', MAP_H);
    line.setAttribute('stroke', 'rgba(245,158,11,0.07)');
    line.setAttribute('stroke-width', '0.5');
    grid.appendChild(line);
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', x + 2); lbl.setAttribute('y', MAP_H - 3);
    lbl.setAttribute('fill', 'rgba(245,158,11,0.25)');
    lbl.setAttribute('font-size', '7'); lbl.setAttribute('font-family', 'monospace');
    lbl.textContent = `${lon}°`;
    grid.appendChild(lbl);
  }
  svg.appendChild(grid);

  // ── Şehir işaretleri ─────────────────────────────────────
  const cityGroup = document.createElementNS(ns, 'g');
  cityGroup.setAttribute('id', 'map-cities');

  CITIES.forEach(city => {
    const { x, y } = geoToSvg(city.lat, city.lon);
    const major = !!city.major;

    if (major) {
      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', '4');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', 'rgba(203,213,225,0.4)');
      ring.setAttribute('stroke-width', '0.8');
      cityGroup.appendChild(ring);
    }

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('r', major ? '2.5' : '1.5');
    dot.setAttribute('fill', major ? 'rgba(226,232,240,0.9)' : 'rgba(148,163,184,0.6)');
    cityGroup.appendChild(dot);

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', x + (major ? 5 : 3));
    lbl.setAttribute('y', y + 3);
    lbl.setAttribute('fill', major ? 'rgba(226,232,240,0.8)' : 'rgba(100,116,139,0.7)');
    lbl.setAttribute('font-size', major ? '8' : '6');
    lbl.setAttribute('font-family', 'monospace');
    lbl.setAttribute('font-weight', major ? 'bold' : 'normal');
    lbl.textContent = city.name;
    cityGroup.appendChild(lbl);
  });
  svg.appendChild(cityGroup);

  // ── Deprem noktaları katmanı ─────────────────────────────
  const quakeGroup = document.createElementNS(ns, 'g');
  quakeGroup.setAttribute('id', 'quake-layer');
  svg.appendChild(quakeGroup);

  // ── Tooltip ──────────────────────────────────────────────
  const tooltip = document.createElementNS(ns, 'g');
  tooltip.setAttribute('id', 'map-tooltip');
  tooltip.setAttribute('visibility', 'hidden');
  tooltip.setAttribute('pointer-events', 'none');

  const ttBg = document.createElementNS(ns, 'rect');
  ttBg.setAttribute('id', 'tt-bg');
  ttBg.setAttribute('rx', '4');
  ttBg.setAttribute('fill', 'rgba(6,9,15,0.95)');
  ttBg.setAttribute('stroke', 'rgba(245,158,11,0.6)');
  ttBg.setAttribute('stroke-width', '1');

  const ttText = document.createElementNS(ns, 'text');
  ttText.setAttribute('id', 'tt-text');
  ttText.setAttribute('fill', '#f1f5f9');
  ttText.setAttribute('font-size', '10');
  ttText.setAttribute('font-family', 'monospace');

  tooltip.appendChild(ttBg);
  tooltip.appendChild(ttText);
  svg.appendChild(tooltip);

  container.appendChild(svg);
  return svg;
}

// ── Deprem noktalarını haritaya çiz ──────────────────────────
export function renderQuakes(earthquakes, onHover, onClick) {
  const layer = document.getElementById('quake-layer');
  if (!layer) return;
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  const ns = 'http://www.w3.org/2000/svg';
  const sorted = [...earthquakes].sort((a, b) =>
    (parseFloat(a.magnitude || a.mag || 0)) - (parseFloat(b.magnitude || b.mag || 0))
  );

  sorted.forEach((eq, idx) => {
    const lat = parseFloat(eq.latitude  || eq.lat);
    const lon = parseFloat(eq.longitude || eq.lon);
    const mag = parseFloat(eq.magnitude || eq.mag || 0);
    if (isNaN(lat) || isNaN(lon)) return;

    const { x, y } = geoToSvg(lat, lon);
    const color = magColor(mag);
    const r = Math.max(3, Math.min(16, mag * 2.2));

    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'quake-point');
    g.style.cursor = 'pointer';

    // Pulse halkası (M≥4.0)
    if (mag >= 4.0) {
      const pulse = document.createElementNS(ns, 'circle');
      pulse.setAttribute('cx', x); pulse.setAttribute('cy', y);
      pulse.setAttribute('r', r + 5);
      pulse.setAttribute('fill', 'none');
      pulse.setAttribute('stroke', color);
      pulse.setAttribute('stroke-width', '1');
      pulse.setAttribute('opacity', '0.35');
      pulse.setAttribute('class', 'quake-pulse');
      g.appendChild(pulse);
    }

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('r', r);
    dot.setAttribute('fill', color);
    dot.setAttribute('fill-opacity', '0.78');
    dot.setAttribute('stroke', color);
    dot.setAttribute('stroke-width', mag >= 5 ? '1.5' : '0.5');
    if (mag >= 4.0) dot.setAttribute('filter', 'url(#glow)');
    g.appendChild(dot);

    if (mag >= 4.0) {
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', x); lbl.setAttribute('y', y + 3);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('fill', '#fff');
      lbl.setAttribute('font-size', Math.max(7, r * 0.75));
      lbl.setAttribute('font-family', 'monospace');
      lbl.setAttribute('font-weight', 'bold');
      lbl.setAttribute('pointer-events', 'none');
      lbl.textContent = mag.toFixed(1);
      g.appendChild(lbl);
    }

    g.addEventListener('mouseenter', () => {
      dot.setAttribute('fill-opacity', '1');
      onHover && onHover(eq, x, y);
    });
    g.addEventListener('mouseleave', () => {
      dot.setAttribute('fill-opacity', '0.78');
      hideTooltip();
    });
    g.addEventListener('click', () => onClick && onClick(eq));

    layer.appendChild(g);
  });
}

// ── Tooltip göster / gizle ───────────────────────────────────
export function showMapTooltip(text, x, y) {
  const tooltip = document.getElementById('map-tooltip');
  const ttBg    = document.getElementById('tt-bg');
  const ttText  = document.getElementById('tt-text');
  if (!tooltip || !ttBg || !ttText) return;

  while (ttText.firstChild) ttText.removeChild(ttText.firstChild);

  const ns = 'http://www.w3.org/2000/svg';
  const lines  = text.split('\n');
  const lineH  = 14;
  const padX   = 8;
  const maxLen = Math.max(...lines.map(l => l.length));
  const w = maxLen * 6.0 + padX * 2;
  const h = lines.length * lineH + padX;

  let tx = x + 14, ty = y - 10;
  if (tx + w > MAP_W - 4) tx = x - w - 14;
  if (ty < 4)             ty = y + 14;
  if (ty + h > MAP_H - 4) ty = MAP_H - h - 4;

  ttBg.setAttribute('x', tx); ttBg.setAttribute('y', ty);
  ttBg.setAttribute('width', w); ttBg.setAttribute('height', h);

  lines.forEach((line, i) => {
    const tspan = document.createElementNS(ns, 'tspan');
    tspan.setAttribute('x', tx + padX);
    tspan.setAttribute('dy', i === 0 ? lineH : lineH);
    tspan.textContent = line;
    ttText.appendChild(tspan);
  });

  ttText.setAttribute('x', tx + padX);
  ttText.setAttribute('y', ty);
  tooltip.setAttribute('visibility', 'visible');
}

export function hideTooltip() {
  const t = document.getElementById('map-tooltip');
  if (t) t.setAttribute('visibility', 'hidden');
}
