/**
 * Two fixes for developing and checking the result panel without a node:
 *   FIX_KOELN  strong landmark fix in Cologne, afternoon window from the sun, truth 0.4 km off;
 *   FIX_ALPEN  weak country-level fix in the Eastern Alps, no metadata, two time windows.
 * The sun is computed here (low-precision solar ephemeris, good to a few tenths of a degree), the
 * key frames and reference thumbnails are drawn as SVG so the skyline matches the picture exactly.
 */
import type { Evidence, Fix, Keyframe, SunPathPoint, SunReport, SunState } from '../../../../server/src/datum/contract';

const RAD = Math.PI / 180;

function solar(lat: number, lon: number, ms: number): { az: number; el: number } {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) % 360) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(ha));
  return { az: (az / RAD + 360) % 360, el: el / RAD };
}

function sunState(lat: number, lon: number, at: number): SunState {
  const { az, el } = solar(lat, lon, at);
  return {
    at,
    azimuthDeg: az,
    elevationDeg: el,
    shadowAzimuthDeg: (az + 180) % 360,
    shadowRatio: el > 0.5 ? 1 / Math.tan(el * RAD) : null,
  };
}

/** Sun report for a local date; `utcOffsetH` is the offset of local civil time that day. */
function sunReport(lat: number, lon: number, date: string, utcOffsetH: number, atLocalMin: number | null): SunReport {
  const midnight = Date.parse(`${date}T00:00:00Z`) - utcOffsetH * 3600000;
  const path: SunPathPoint[] = [];
  for (let m = 0; m <= 1440; m += 10) {
    const t = midnight + m * 60000;
    const { az, el } = solar(lat, lon, t);
    path.push({ t, az, el });
  }
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let noon = midnight;
  let best = -90;
  let prev = solar(lat, lon, midnight).el;
  for (let m = 1; m <= 1440; m++) {
    const t = midnight + m * 60000;
    const el = solar(lat, lon, t).el;
    if (prev < -0.833 && el >= -0.833 && sunrise === null) sunrise = t;
    if (prev >= -0.833 && el < -0.833) sunset = t;
    if (el > best) {
      best = el;
      noon = t;
    }
    prev = el;
  }
  return {
    date,
    at: atLocalMin === null ? null : sunState(lat, lon, midnight + atLocalMin * 60000),
    path,
    sunrise,
    sunset,
    solarNoon: noon,
  };
}

// ---------- pictures ----------

const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Deterministic noise. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function polygonFrom(skyline: number[], w: number, h: number, bottom: number): string {
  const n = skyline.length;
  const pts = skyline.map((y, i) => `${((i / (n - 1)) * w).toFixed(1)},${(y * h).toFixed(1)}`);
  return `0,${bottom} ${pts.join(' ')} ${w},${bottom}`;
}

/** Cologne from the Deutz bank, late afternoon, against the light: cathedral, roofs, TV tower. */
function cologneSkyline(n: number): number[] {
  const rand = rng(7);
  const blocks: { x0: number; x1: number; y: number }[] = [];
  for (let x = 0; x < 1; ) {
    const w = 0.018 + rand() * 0.045;
    blocks.push({ x0: x, x1: x + w, y: 0.505 + rand() * 0.06 });
    x += w;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y = blocks.find((b) => x >= b.x0 && x < b.x1)?.y ?? 0.54;
    // nave and choir
    if (x > 0.3 && x < 0.53) y = Math.min(y, 0.365 + Math.max(0, x - 0.5) * 2.2 + Math.max(0, 0.32 - x) * 3);
    // crossing spire
    y = Math.min(y, 0.265 + Math.abs(x - 0.468) * 9);
    // the two towers, seen slightly from the side (one behind the other)
    for (const [c, top] of [
      [0.334, 0.055],
      [0.374, 0.07],
    ] as const) {
      const d = Math.abs(x - c);
      if (d < 0.019) y = Math.min(y, 0.205 + d * 1.4);
      y = Math.min(y, top + d * 8.2);
    }
    // TV tower: shaft, pod, antenna
    if (Math.abs(x - 0.862) < 0.0045) y = Math.min(y, 0.3);
    if (Math.abs(x - 0.862) < 0.012) y = Math.min(y, 0.355);
    if (Math.abs(x - 0.862) < 0.0022) y = Math.min(y, 0.2);
    out.push(Math.round(y * 10000) / 10000);
  }
  return out;
}

function cologneImage(skyline: number[]): string {
  const w = 1280;
  const h = 720;
  const rand = rng(11);
  let glints = '';
  for (let i = 0; i < 70; i++) {
    const y = 0.63 + rand() * 0.16;
    const x = rand() * w;
    const len = 8 + rand() * 46 * (y - 0.6) * 6;
    glints += `<line x1="${x.toFixed(0)}" y1="${(y * h).toFixed(0)}" x2="${(x + len).toFixed(0)}" y2="${(y * h).toFixed(0)}" stroke="#8a8a8a" stroke-opacity="${(0.25 + rand() * 0.4).toFixed(2)}" stroke-width="1.5"/>`;
  }
  let hangers = '';
  for (let x = 700; x <= 1270; x += 14) {
    const span = x < 890 ? [700, 890] : x < 1080 ? [890, 1080] : [1080, 1270];
    const f = (x - (span[0] as number)) / ((span[1] as number) - (span[0] as number));
    const top = 0.592 * h - Math.sin(f * Math.PI) * 0.072 * h;
    hangers += `<line x1="${x}" y1="${top.toFixed(1)}" x2="${x}" y2="${(0.6 * h).toFixed(1)}" stroke="#151515" stroke-width="1.6"/>`;
  }
  const arches = [700, 890, 1080]
    .map((x0) => `<path d="M${x0} ${0.6 * h} Q ${x0 + 95} ${0.452 * h} ${x0 + 190} ${0.6 * h}" fill="none" stroke="#141414" stroke-width="7"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f6f6f"/><stop offset="0.55" stop-color="#b9b9b9"/><stop offset="1" stop-color="#d4d4d4"/></linearGradient>
<radialGradient id="g" cx="0.3" cy="-0.25" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a4a"/><stop offset="1" stop-color="#222"/></linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<polygon points="${polygonFrom(skyline, w, h, 0.61 * h)}" fill="#1c1c1c"/>
<rect y="${0.6 * h}" width="${w}" height="${0.2 * h}" fill="url(#r)"/>
${glints}
<rect x="690" y="${0.594 * h}" width="590" height="7" fill="#121212"/>
${arches}${hangers}
<path d="M0 ${0.8 * h} L${w} ${0.78 * h} L${w} ${h} L0 ${h}Z" fill="#101010"/>
<line x1="0" y1="${0.775 * h}" x2="${w}" y2="${0.755 * h}" stroke="#2a2a2a" stroke-width="2"/>
</svg>`;
  return svgUrl(svg);
}

/** Limestone ridges with a meadow in front. */
function alpsSkyline(n: number): number[] {
  const peaks: [number, number, number][] = [
    [0.06, 0.33, 1.3],
    [0.21, 0.24, 1.6],
    [0.35, 0.29, 1.2],
    [0.5, 0.16, 1.9],
    [0.6, 0.23, 1.5],
    [0.77, 0.19, 1.7],
    [0.94, 0.3, 1.2],
  ];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y = 0.47;
    for (const [x0, y0, s] of peaks) y = Math.min(y, y0 + s * Math.abs(x - x0));
    y += 0.006 * Math.sin(x * 97) + 0.004 * Math.sin(x * 263 + 1);
    out.push(Math.round(y * 10000) / 10000);
  }
  return out;
}

function alpsImage(skyline: number[]): string {
  const w = 1280;
  const h = 720;
  const near = skyline.map((y, i) => Math.max(y + 0.1, 0.5 + 0.05 * Math.sin(i / 19) + 0.02 * Math.sin(i / 5.3)));
  const rand = rng(5);
  let trees = '';
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const base = (0.74 + rand() * 0.2) * h;
    const s = 14 + rand() * 26;
    trees += `<path d="M${x.toFixed(0)} ${(base - s * 2.4).toFixed(0)} L${(x + s / 2).toFixed(0)} ${base.toFixed(0)} L${(x - s / 2).toFixed(0)} ${base.toFixed(0)}Z" fill="#111"/>`;
  }
  let snow = '';
  for (let i = 0; i < skyline.length - 1; i += 3) {
    const y = skyline[i] as number;
    if (y < 0.26) {
      const x = (i / (skyline.length - 1)) * w;
      snow += `<line x1="${x.toFixed(0)}" y1="${(y * h + 6).toFixed(0)}" x2="${(x + 4).toFixed(0)}" y2="${(y * h + 26 + rand() * 30).toFixed(0)}" stroke="#9a9a9a" stroke-width="2" stroke-opacity="0.7"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d8d8d"/><stop offset="1" stop-color="#d6d6d6"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>
<polygon points="${polygonFrom(skyline, w, h, h)}" fill="#5a5a5a"/>
${snow}
<polygon points="${polygonFrom(near, w, h, h)}" fill="#333"/>
<path d="M0 ${0.7 * h} C ${0.3 * w} ${0.62 * h}, ${0.6 * w} ${0.74 * h}, ${w} ${0.66 * h} L${w} ${h} L0 ${h}Z" fill="#242424"/>
${trees}
</svg>`;
  return svgUrl(svg);
}

function thumb(body: string, sky = '#9b9b9b'): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="${sky}"/>${body}</svg>`,
  );
}

const THUMB_DOM = thumb(
  '<path d="M96 180V70l14-12 6-44 6 44 14 12v110zM184 180V70l14-12 6-44 6 44 14 12v110z" fill="#1d1d1d"/><path d="M136 180V96h48v84z" fill="#262626"/><path d="M146 180v-40a14 14 0 0 1 28 0v40z" fill="#0d0d0d"/><rect y="164" width="320" height="16" fill="#2b2b2b"/>',
);
const THUMB_BRIDGE = thumb(
  '<rect y="112" width="320" height="68" fill="#3a3a3a"/><path d="M0 112Q53 70 107 112Q160 70 213 112Q266 70 320 112" fill="none" stroke="#151515" stroke-width="5"/><rect y="110" width="320" height="6" fill="#151515"/><path d="M190 110V40l6-6 6 6v70z" fill="#1d1d1d"/>',
  '#b0b0b0',
);
const THUMB_ZUGSPITZE = thumb('<path d="M0 120L70 70L118 92L170 28L214 74L262 56L320 98V180H0z" fill="#4e4e4e"/><path d="M164 36h14v-8h-14z" fill="#1a1a1a"/><path d="M0 150L320 132V180H0z" fill="#2a2a2a"/>', '#a8a8a8');
const THUMB_DACHSTEIN = thumb('<path d="M0 104L60 60L92 70L150 40L240 46L290 80L320 74V180H0z" fill="#555"/><path d="M0 140C120 120 200 150 320 128V180H0z" fill="#2c2c2c"/>', '#b4b4b4');

// ---------- Cologne ----------

const KOELN = { lat: 50.93962, lon: 6.96921 };
const KOELN_SKYLINE = cologneSkyline(320);
const KOELN_FRAME: Keyframe = { frame: 120, time: 4.8, imageUrl: cologneImage(KOELN_SKYLINE), spaceUrl: null, skyline: KOELN_SKYLINE };

const koelnProfile = Array.from({ length: 360 }, (_, az) => {
  // Flat Rhine valley: Bergisches Land to the east, Ville ridge to the west, Siebengebirge to the south-east.
  const v = 0.32 + 0.22 * Math.sin((az + 10) * RAD * 2) + 0.12 * Math.sin(az * RAD * 7 + 0.6) + 0.5 * Math.exp(-(((az - 135) / 9) ** 2));
  return Math.round(Math.max(0.05, v) * 100) / 100;
});

const KOELN_EVIDENCE: Evidence[] = [
  {
    kind: 'landmark',
    label: 'Referenzbild: Kölner Dom (0,82)',
    detail: 'Chor und beide Türme in 9 von 12 Schlüsselbildern wiedererkannt; die Perspektive legt den Standort auf das Deutzer Ufer.',
    weight: 0.46,
    frame: 120,
    refImage: THUMB_DOM,
    refLabel: 'Kölner Dom, Westfassade',
    refLat: 50.94133,
    refLon: 6.95812,
    similarity: 0.82,
  },
  {
    kind: 'landmark',
    label: 'Referenzbild: Hohenzollernbrücke (0,71)',
    detail: 'Drei Bogen der Eisenbahnbrücke rechts im Bild; bestätigt die Blickrichtung nach Westnordwest.',
    weight: 0.18,
    frame: 210,
    refImage: THUMB_BRIDGE,
    refLabel: 'Hohenzollernbrücke, Köln',
    refLat: 50.94113,
    refLon: 6.96546,
    similarity: 0.71,
  },
  {
    kind: 'sun',
    label: 'Sonnenhöhe 33–41° aus Schattenlänge',
    detail: 'Schatten der Laternen auf der Promenade: Länge 1,2 bis 1,5 × Höhe, Richtung 82°. Die Vormittagslösung zeigte die Schatten nach Westen.',
    weight: 0.12,
    frame: 164,
  },
  {
    kind: 'text',
    label: 'Schrift: „Rheinboulevard“',
    detail: 'Wegweiser am linken Bildrand, lateinische Schrift, deutsche Rechtschreibung.',
    weight: 0.08,
    frame: 88,
  },
  {
    kind: 'filename',
    label: 'Datum im Dateinamen: 17.06.2018',
    detail: '„Koeln_2018-06-17.mp4“, Muster JJJJ-MM-TT; passt zur Jahreszeit im Bild.',
    weight: 0.06,
  },
  {
    kind: 'region',
    label: 'Regionsschätzung: Deutschland (0,93)',
    detail: 'Abgleich mit Landschafts- und Stadtbildvorlagen; Rheinland vor Benelux.',
    weight: 0.06,
  },
  {
    kind: 'season',
    label: 'Sommer: volles Laub, hoher Sonnenbogen',
    detail: 'Bäume am Ufer belaubt, keine Herbstfärbung.',
    weight: 0.04,
    frame: 40,
  },
  {
    kind: 'metadata',
    label: 'Keine Orts- und Zeitangaben in der Datei',
    detail: 'Container ohne GPS- und Aufnahmezeitfelder; vermutlich über einen Messenger weitergegeben.',
    weight: 0,
  },
];

export const FIX_KOELN: Fix = {
  videoId: 'v-koeln-2018-06-17',
  status: 'ready',
  error: null,
  computedAt: Date.UTC(2026, 10, 18, 13, 3, 12),
  elapsedMs: 4180,
  location: {
    ...KOELN,
    radiusKm: 0.6,
    confidence: 0.86,
    method: 'landmark',
    label: 'Rheinboulevard Deutz, gegenüber dem Kölner Dom',
    country: 'DE',
    countryName: 'Deutschland',
  },
  candidates: [
    { lat: 50.93962, lon: 6.96921, label: 'Rheinboulevard Deutz, Köln', country: 'DE', score: 0.71, radiusKm: 0.6 },
    { lat: 50.94113, lon: 6.96546, label: 'Hohenzollernbrücke, Köln', country: 'DE', score: 0.12, radiusKm: 0.4 },
    { lat: 50.9583, lon: 6.979, label: 'Rheinufer Mülheim, Köln', country: 'DE', score: 0.06, radiusKm: 1.2 },
    { lat: 51.2277, lon: 6.7735, label: 'Altstadt, Düsseldorf', country: 'DE', score: 0.03, radiusKm: 2.5 },
    { lat: 51.2203, lon: 4.4015, label: 'Onze-Lieve-Vrouwekathedraal, Antwerpen', country: 'BE', score: 0.02, radiusKm: 1.5 },
  ],
  countries: [
    { iso: 'DE', name: 'Deutschland', p: 0.93 },
    { iso: 'NL', name: 'Niederlande', p: 0.03 },
    { iso: 'BE', name: 'Belgien', p: 0.02 },
    { iso: 'AT', name: 'Österreich', p: 0.01 },
    { iso: 'CH', name: 'Schweiz', p: 0.006 },
    { iso: 'LU', name: 'Luxemburg', p: 0.004 },
  ],
  time: {
    method: 'sun',
    utc: null,
    date: '2018-06-17',
    dateSource: 'filename',
    monthRange: null,
    timezone: 'Europe/Berlin',
    windows: [
      { startMin: 1015, endMin: 1085, label: 'Nachmittag', probability: 0.79 },
      { startMin: 545, endMin: 610, label: 'Vormittag', probability: 0.13 },
    ],
    sunElevationBand: [33, 41],
    phase: 'day',
    confidence: 0.74,
    notes: [
      'Sonnenhöhe 33–41° aus der Schattenlänge (Bild 164).',
      'Schatten zeigen nach 82° bei Blick 284°: Sonne im Westen, also Nachmittag.',
      'Datum aus dem Dateinamen, Zeitzone aus dem Ort (Sommerzeit).',
    ],
  },
  sun: sunReport(KOELN.lat, KOELN.lon, '2018-06-17', 2, 1050),
  heading: { deg: 284, fovDeg: 62, method: 'landmark', confidence: 0.81 },
  horizon: { matched: false, errorDeg: null, profile: koelnProfile },
  evidence: KOELN_EVIDENCE,
  keyframes: [KOELN_FRAME],
  truth: { lat: 50.94187, lon: 6.97338, label: 'Kennedy-Ufer, Köln-Deutz', errorKm: 0.38, source: 'GPS-Spur der Referenzaufnahme' },
};

// ---------- Alps ----------

const ALPEN = { lat: 47.38, lon: 11.62 };
const ALPEN_SKYLINE = alpsSkyline(320);
const ALPEN_FRAME: Keyframe = { frame: 36, time: 1.4, imageUrl: alpsImage(ALPEN_SKYLINE), spaceUrl: null, skyline: ALPEN_SKYLINE };

const alpenProfile = Array.from({ length: 360 }, (_, az) => {
  const v = 4.2 + 2.1 * Math.sin(az * RAD * 3 + 0.4) + 1.3 * Math.sin(az * RAD * 7 + 1.9) + 0.6 * Math.sin(az * RAD * 17);
  return Math.round(Math.max(0.8, v) * 100) / 100;
});

export const FIX_ALPEN: Fix = {
  videoId: 'v-alpen-weitergeleitet',
  status: 'ready',
  error: null,
  computedAt: Date.UTC(2026, 10, 18, 13, 9, 40),
  elapsedMs: 11930,
  location: {
    ...ALPEN,
    radiusKm: 140,
    confidence: 0.31,
    method: 'region',
    label: 'Nördliche Kalkalpen, Tirol',
    country: 'AT',
    countryName: 'Österreich',
  },
  candidates: [
    { lat: 47.38, lon: 11.62, label: 'Nördliche Kalkalpen, Tirol', country: 'AT', score: 0.29, radiusKm: 140 },
    { lat: 46.62, lon: 7.9, label: 'Berner Oberland', country: 'CH', score: 0.17, radiusKm: 120 },
    { lat: 47.49, lon: 11.1, label: 'Werdenfelser Land, Bayern', country: 'DE', score: 0.14, radiusKm: 90 },
    { lat: 46.55, lon: 11.85, label: 'Dolomiten, Südtirol', country: 'IT', score: 0.11, radiusKm: 110 },
    { lat: 46.38, lon: 13.84, label: 'Julische Alpen', country: 'SI', score: 0.05, radiusKm: 80 },
  ],
  countries: [
    { iso: 'AT', name: 'Österreich', p: 0.38 },
    { iso: 'CH', name: 'Schweiz', p: 0.22 },
    { iso: 'DE', name: 'Deutschland', p: 0.17 },
    { iso: 'IT', name: 'Italien', p: 0.13 },
    { iso: 'SI', name: 'Slowenien', p: 0.05 },
    { iso: 'FR', name: 'Frankreich', p: 0.03 },
    { iso: 'LI', name: 'Liechtenstein', p: 0.02 },
  ],
  time: {
    method: 'sun',
    utc: null,
    date: null,
    dateSource: 'season',
    monthRange: [5, 8],
    timezone: 'Europe/Vienna',
    windows: [
      { startMin: 575, endMin: 660, label: 'Vormittag', probability: 0.46 },
      { startMin: 900, endMin: 1000, label: 'Nachmittag', probability: 0.41 },
    ],
    sunElevationBand: [42, 52],
    phase: 'day',
    confidence: 0.34,
    notes: [
      'Keine Zeitangabe in der Datei, kein Datum im Dateinamen.',
      'Sonnenhöhe 42–52° aus dem Schattenkontrast; ohne Blickrichtung bleiben Vor- und Nachmittag fast gleich wahrscheinlich.',
      'Monate aus der Vegetation: Almen grün, Schnee nur in Rinnen über 2 600 m. Sonnenbahn für den 1. Juli.',
    ],
  },
  sun: sunReport(ALPEN.lat, ALPEN.lon, '2026-07-01', 2, 617),
  heading: null,
  horizon: { matched: false, errorDeg: 2.8, profile: alpenProfile },
  evidence: [
    {
      kind: 'region',
      label: 'Regionsschätzung: Ostalpen (0,58)',
      detail: 'Kalkgestein, Latschen und Almwirtschaft; Österreich vor der Schweiz und Bayern.',
      weight: 0.38,
    },
    {
      kind: 'season',
      label: 'Sommer: grüne Almen, Altschnee nur in Rinnen',
      detail: 'Vegetation und Schneegrenze sprechen für Mai bis August.',
      weight: 0.21,
      frame: 36,
    },
    {
      kind: 'sun',
      label: 'Sonnenhöhe 42–52° aus dem Schattenkontrast',
      detail: 'Kurze, harte Schatten der Bäume; ohne Blickrichtung keine Aussage über Vor- oder Nachmittag.',
      weight: 0.14,
      frame: 52,
    },
    {
      kind: 'landmark',
      label: 'Referenzbild: Zugspitze, Westgrat (0,41)',
      detail: 'Schwache Übereinstimmung der Gratlinie; reicht nicht für eine Ortung.',
      weight: 0.12,
      frame: 36,
      refImage: THUMB_ZUGSPITZE,
      refLabel: 'Zugspitze von Ehrwald',
      refLat: 47.42115,
      refLon: 10.98633,
      similarity: 0.41,
    },
    {
      kind: 'landmark',
      label: 'Referenzbild: Dachstein-Südwand (0,37)',
      detail: 'Ähnliche Felswand, aber andere Gipfelfolge.',
      weight: 0.07,
      frame: 80,
      refImage: THUMB_DACHSTEIN,
      refLabel: 'Dachstein-Südwand, Ramsau',
      refLat: 47.47513,
      refLon: 13.6064,
    },
    {
      kind: 'horizon',
      label: 'Horizontabgleich ohne Treffer',
      detail: 'Bester Abgleich mit dem Geländehorizont am Schätzort: mittlerer Fehler 2,8°, zu groß für eine Ortung.',
      weight: 0.05,
      frame: 36,
    },
    {
      kind: 'text',
      label: 'Keine lesbare Schrift',
      detail: 'Ein Wegweiser im Hintergrund ist zu klein für die Texterkennung.',
      weight: 0.03,
      frame: 112,
    },
    {
      kind: 'metadata',
      label: 'Metadaten fehlen',
      detail: 'Die Datei wurde neu kodiert; weder Aufnahmezeit noch GPS vorhanden.',
      weight: 0,
    },
  ],
  keyframes: [ALPEN_FRAME],
  truth: null,
};

/** The Cologne fix as if the camera had written its clock into the file. */
export const FIX_KOELN_METADATA: Fix = {
  ...FIX_KOELN,
  videoId: 'v-koeln-metadaten',
  time: {
    ...FIX_KOELN.time,
    method: 'metadata',
    utc: Date.UTC(2018, 5, 17, 15, 26, 4),
    dateSource: 'metadata',
    windows: [{ startMin: 1046, endMin: 1047, label: 'Aufnahmezeit', probability: 1 }],
    confidence: 0.98,
    notes: ['Aufnahmezeit aus dem Container (creation_time, UTC), in Ortszeit umgerechnet.'],
  },
  sun: sunReport(KOELN.lat, KOELN.lon, '2018-06-17', 2, 1046 + 4 / 60),
};

export const FIX_PENDING: Fix = { ...FIX_ALPEN, videoId: 'v-wartet', status: 'pending', location: null };
export const FIX_RUNNING: Fix = { ...FIX_ALPEN, videoId: 'v-laeuft', status: 'running', location: null };
export const FIX_ERROR: Fix = {
  ...FIX_ALPEN,
  videoId: 'v-fehler',
  status: 'error',
  location: null,
  error: 'Video nicht lesbar: kein Videostrom gefunden (ffprobe).',
};

/** Cologne at night: a window across midnight, the sun below the horizon. */
export const FIX_KOELN_NACHT: Fix = {
  ...FIX_KOELN,
  videoId: 'v-koeln-nacht',
  time: {
    ...FIX_KOELN.time,
    windows: [{ startMin: 1370, endMin: 250, label: 'Nacht', probability: 0.88 }],
    sunElevationBand: null,
    phase: 'night',
    confidence: 0.52,
    notes: ['Himmel ohne Restlicht, Straßenbeleuchtung an: Sonne tiefer als −6°.'],
  },
  sun: sunReport(KOELN.lat, KOELN.lon, '2018-06-17', 2, 60),
};

/** Nothing to go on: no place, no time, no sky. */
export const FIX_LEER: Fix = {
  ...FIX_ALPEN,
  videoId: 'v-leer',
  location: null,
  candidates: [],
  countries: [],
  evidence: [],
  heading: null,
  horizon: null,
  sun: null,
  keyframes: [{ ...ALPEN_FRAME, skyline: null }],
  time: {
    method: 'none',
    utc: null,
    date: null,
    dateSource: 'none',
    monthRange: null,
    timezone: null,
    windows: [],
    sunElevationBand: null,
    phase: 'unknown',
    confidence: 0,
    notes: ['Kein Sonnenstand messbar: Innenaufnahme ohne Fenster.'],
  },
};
