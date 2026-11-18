/**
 * DATUM reference dataset: test videos with known position and a reference gallery of landmark
 * images, both taken from Wikidata / Wikimedia Commons.
 *
 *   npx tsx src/scripts/datum/fetchDataset.ts                 videos and gallery
 *   npx tsx src/scripts/datum/fetchDataset.ts --videos-only   test videos only
 *   npx tsx src/scripts/datum/fetchDataset.ts --gallery-only  reference gallery only
 *   npx tsx src/scripts/datum/fetchDataset.ts --check         verify that every listed file exists
 *   npx tsx src/scripts/datum/fetchDataset.ts --reselect      query Wikidata again instead of
 *                                                             reusing the stored selection
 *   --select-only                                             write the manifest, cut no clips
 *   --gallery-minutes=N                                       stop gallery downloads after N minutes
 *
 * Output (relative to the repository root):
 *   datasets/datum/manifest.json        selection of test videos with ground truth (committed)
 *   datasets/datum/gallery.json         reference images that were downloaded (committed)
 *   datasets/datum/clips/<id>.mp4       12-second H.264 clips (git-ignored)
 *   datasets/datum/gallery/<Qid>.jpg    330 px reference thumbnails (git-ignored)
 *
 * The run is idempotent: finished files are kept, and the selection stored in the manifest and in
 * gallery/candidates.json is reused unless --reselect is given. Only Wikidata SPARQL and
 * upload.wikimedia.org are needed; licence templates are read from the raw file page wikitext
 * (commons.wikimedia.org/w/index.php?action=raw) when reachable, otherwise left null.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ---------------------------------------------------------------------------------------------
// Paths, flags, constants

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const DATA_DIR = path.join(ROOT, 'datasets', 'datum');
const CLIPS_DIR = path.join(DATA_DIR, 'clips');
const GALLERY_DIR = path.join(DATA_DIR, 'gallery');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const GALLERY_PATH = path.join(DATA_DIR, 'gallery.json');
const POOL_PATH = path.join(CLIPS_DIR, 'selection-pool.json');
const CANDIDATES_PATH = path.join(GALLERY_DIR, 'candidates.json');
const SPARQL_CACHE_DIR = path.join(GALLERY_DIR, '.sparql-cache');

const ARGS = new Set(process.argv.slice(2));
const FLAG_CHECK = ARGS.has('--check');
const FLAG_VIDEOS_ONLY = ARGS.has('--videos-only');
const FLAG_GALLERY_ONLY = ARGS.has('--gallery-only');
const FLAG_RESELECT = ARGS.has('--reselect');
const FLAG_SELECT_ONLY = ARGS.has('--select-only');
const GALLERY_MINUTES = Number(
  process.argv.find((a) => a.startsWith('--gallery-minutes='))?.split('=')[1] ?? '60',
);

const USER_AGENT = 'DatumDatasetBuild/0.1 (offline dataset preparation)';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

const TEST_VIDEO_COUNT = 60;
const CLIP_SECONDS = 12;
const MIN_SOURCE_SECONDS = 10;
const CLIP_BUDGET_BYTES = 150 * 1024 * 1024;
const THUMB_WIDTH = 330;
const GALLERY_CONCURRENCY = 6;

/** Quotas for the test set, by continent (DE counted separately from the rest of Europe). */
const QUOTAS: Record<string, number> = { DE: 16, EU: 19, NA: 7, SA: 5, AS: 7, AF: 4, OC: 2 };

/**
 * Items that passed the automatic filters but turned out unsuitable after looking at the footage
 * (indoor, title cards, archive film, unrelated content). Kept here so a re-selection skips them.
 */
const EXCLUDED_VIDEO_ITEMS = new Set<string>([
  'Q131397', // Venus of Willendorf: museum object, coordinate is the find spot
  'Q165414', // Haithabu: animated documentary
  'Q819439', // Reichsparteitagsgelände: 1945 newsreel
  'Q22720', // Speyerer Dom: documentary
  'Q668341', // Magdeburger Dom: computer reconstruction
  'Q565067', // Kloster Disibodenberg: computer reconstruction
  'Q22907580', // Palace of Domitian: computer reconstruction
  'Q1886615', // Mala Rijeka viaduct: dark train interior
  'Q2453110', // Pivdennyi bridge: filmed through a car window
  'Q4972306', // Broadstone station: archive engravings
  'Q771404', // San Francisco-Oakland Bay Bridge: satellite time-lapse
  'Q2404214', // San Francisco monastery, Lima: documentary title card
  'Q838359', // Imam Ali mosque: slideshow of a still image
  'Q11095941', // Liziba station: driver's cab interior
  'Q16895397', // Mount Buffalo: rendered terrain flight
  'Q5431292', // Faithful Word Baptist Church: interior tour
]);

// ---------------------------------------------------------------------------------------------
// Types

interface ManifestVideo {
  id: string;
  file: string;
  title: string;
  label: string;
  wikidata: string;
  lat: number;
  lon: number;
  country: string | null;
  countryLabel: string | null;
  continent: string;
  instanceOf: string;
  commonsFile: string;
  sourceUrl: string;
  mediaUrl: string;
  dateFromName: string | null;
  clipStart: number;
  clipDuration: number;
  durationSec: number;
  license: string | null;
  author: string | null;
}

interface Manifest {
  version: 1;
  createdAt: string;
  source: string;
  videos: ManifestVideo[];
}

interface GalleryCandidate {
  id: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  commonsFile: string;
  hasVideo: boolean;
  group: string;
}

interface GalleryImage {
  id: string;
  file: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  wikidata: string;
  commonsFile: string;
  hasVideo: boolean;
  testItem: boolean;
}

interface CountryInfo {
  iso: string;
  label: string;
  current: boolean;
}

interface VideoItem {
  qid: string;
  labelDe: string | null;
  labelEn: string | null;
  lat: number;
  lon: number;
  classes: Map<string, string>;
  countries: Set<string>;
  videos: Set<string>;
  images: Set<string>;
  sitelinks: number;
}

interface PoolEntry {
  qid: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  countryLabel: string | null;
  continent: string;
  instanceOf: string;
  commonsFile: string;
  score: number;
  sitelinks: number;
}

type SparqlRow = Record<string, { value: string } | undefined>;

// ---------------------------------------------------------------------------------------------
// Small helpers

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function exists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmp, file);
}

function qidOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/** Commons file name (underscores) from a Special:FilePath URI. */
function commonsNameOf(uri: string): string {
  const raw = uri.slice(uri.lastIndexOf('/') + 1);
  return decodeURIComponent(raw).replace(/ /g, '_');
}

function parsePoint(wkt: string): { lat: number; lon: number } | null {
  // Coordinates on other globes carry a leading <globe> IRI.
  if (!wkt.startsWith('Point(')) return null;
  const m = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(wkt);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function commonsPaths(name: string): { hashDir: string; encoded: string } {
  const n = name.replace(/ /g, '_');
  const h = createHash('md5').update(n, 'utf8').digest('hex');
  return { hashDir: `${h[0]}/${h.slice(0, 2)}`, encoded: encodeURIComponent(n) };
}

function originalUrl(name: string): string {
  const { hashDir, encoded } = commonsPaths(name);
  return `${COMMONS}/${hashDir}/${encoded}`;
}

function transcodeUrl(name: string, height: 480 | 360): string {
  const { hashDir, encoded } = commonsPaths(name);
  return `${COMMONS}/transcoded/${hashDir}/${encoded}/${encoded}.${height}p.vp9.webm`;
}

function thumbUrls(name: string): string[] {
  const { hashDir, encoded } = commonsPaths(name);
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const base = `${COMMONS}/thumb/${hashDir}/${encoded}`;
  if (ext === 'tif' || ext === 'tiff') {
    return [`${base}/${THUMB_WIDTH}px-${encoded}.jpg`, `${base}/lossy-page1-${THUMB_WIDTH}px-${encoded}.jpg`];
  }
  return [`${base}/${THUMB_WIDTH}px-${encoded}`];
}

const RASTER_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff']);

function isRaster(name: string): boolean {
  return RASTER_EXT.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase());
}

/** ASCII slug: German umlauts transliterated, other diacritics stripped. */
function slugify(text: string, max = 32): string {
  const ascii = text
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii.length <= max) return ascii || 'item';
  const cut = ascii.slice(0, max);
  const dash = cut.lastIndexOf('-');
  return (dash > 12 ? cut.slice(0, dash) : cut).replace(/-+$/g, '');
}

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, jan: 1, februar: 2, february: 2, feb: 2, 'märz': 3, maerz: 3, march: 3, mar: 3,
  april: 4, apr: 4, mai: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, october: 10, oct: 10, okt: 10, november: 11, nov: 11,
  dezember: 12, december: 12, dec: 12, dez: 12,
};

function validDate(y: number, m: number, d: number): string | null {
  const now = new Date();
  if (y < 1900 || y > now.getUTCFullYear() || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getTime() > now.getTime()) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Recording date written in a file name: 2018-06-17, 2018_06_17, 20180617, 17.06.2018, 17. Juni 2018. */
export function dateFromFileName(name: string): string | null {
  const s = name.replace(/_/g, ' ');
  let m = /(?<!\d)((?:19|20)\d{2})[-. ](\d{2})[-. ](\d{2})(?!\d)/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/.exec(s);
  if (m) {
    const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return d;
  }
  m = /(?<!\d)(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})(?!\d)/.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /(?<!\d)(\d{1,2})\.? ?([A-Za-zä]+) ((?:19|20)\d{2})(?!\d)/.exec(s);
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    if (month) return validDate(Number(m[3]), month, Number(m[1]));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Continents

const CONTINENT_LISTS: Record<string, string> = {
  EU: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  NA: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT UM US VC VG VI',
  SA: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  OC: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TL TO TV VU WF WS',
};
const CONTINENT_OF = new Map<string, string>();
for (const [continent, list] of Object.entries(CONTINENT_LISTS)) {
  for (const iso of list.split(' ')) CONTINENT_OF.set(iso, continent);
}

function continentOf(iso: string | null, lat: number, lon: number): string {
  if (iso === 'RU') return lon > 60 ? 'AS' : 'EU';
  if (iso === 'TR') return lon < 29.9 && lat > 40.6 ? 'EU' : 'AS';
  const byCountry = iso ? CONTINENT_OF.get(iso) ?? 'AS' : null;
  // Overseas territories of European states (South Georgia, Réunion, …) fall back to coordinates.
  const inEuropeBox = lat > 34 && lat < 72 && lon > -32 && lon < 70;
  if (byCountry && (byCountry !== 'EU' || inEuropeBox)) return byCountry;
  // No country (sea, Antarctica, disputed): rough boxes.
  if (lat < -60) return 'AN';
  if (lon > -30 && lon < 60 && lat > 35) return 'EU';
  if (lon > -30 && lon < 55) return 'AF';
  if (lon <= -30) return lat > 13 ? 'NA' : 'SA';
  if (lat < -10 && lon > 110) return 'OC';
  return 'AS';
}

// ---------------------------------------------------------------------------------------------
// Wikidata SPARQL

async function sparql(query: string, label: string, attempts = 4): Promise<SparqlRow[]> {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(SPARQL_URL, {
        method: 'POST',
        body: new URLSearchParams({ query, format: 'json' }),
        headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(90_000),
      });
      if (response.status === 429) {
        const wait = Number(response.headers.get('retry-after') ?? '30');
        lastError = 'HTTP 429';
        await sleep(Math.min(120, Math.max(5, wait)) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { results: { bindings: SparqlRow[] } };
      return json.results.bindings;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      log(`    SPARQL ${label}: ${lastError} (attempt ${attempt}/${attempts})`);
      if (attempt < attempts) await sleep(3000 * attempt);
    }
  }
  throw new Error(`SPARQL ${label} failed: ${lastError}`);
}

/**
 * Cached query (gallery queries only; the cache lives in the git-ignored gallery folder). Results
 * younger than a day are reused even with --reselect, so a re-selection after changing targets
 * does not repeat dozens of queries.
 */
async function sparqlCached(query: string, label: string, attempts = 3): Promise<SparqlRow[]> {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const file = path.join(SPARQL_CACHE_DIR, `${key}.json`);
  const age = await fs.stat(file).then((st) => Date.now() - st.mtimeMs, () => Infinity);
  if (!FLAG_RESELECT || age < 24 * 3600_000) {
    const cached = await readJson<SparqlRow[]>(file);
    if (cached) return cached;
  }
  const rows = await sparql(query, label, attempts);
  await writeJson(file, rows);
  await sleep(1000);
  return rows;
}

async function loadCountries(): Promise<Map<string, CountryInfo>> {
  const rows = await sparql(
    `SELECT ?c ?iso ?de ?en ?end WHERE {
      ?c wdt:P297 ?iso .
      OPTIONAL { ?c rdfs:label ?de FILTER(LANG(?de) = "de") }
      OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?c wdt:P576 ?end }
    }`,
    'countries',
  );
  const map = new Map<string, CountryInfo>();
  for (const row of rows) {
    const qid = qidOf(row.c?.value ?? '');
    const iso = row.iso?.value;
    if (!qid || !iso) continue;
    const prev = map.get(qid);
    const current = !row.end;
    if (prev && !(current && !prev.current)) continue;
    map.set(qid, { iso, label: row.de?.value ?? row.en?.value ?? iso, current });
  }
  return map;
}

function pickCountry(qids: Iterable<string>, countries: Map<string, CountryInfo>): CountryInfo | null {
  let fallback: CountryInfo | null = null;
  for (const qid of qids) {
    const info = countries.get(qid);
    if (!info) continue;
    if (info.current) return info;
    fallback ??= info;
  }
  return fallback;
}

async function loadVideoItems(): Promise<Map<string, VideoItem>> {
  const rows = await sparql(
    `SELECT ?item ?video ?coord ?labelDe ?labelEn ?class ?classLabel ?country ?image ?sl WHERE {
      ?item wdt:P10 ?video ; wdt:P625 ?coord .
      FILTER(CONTAINS(LCASE(STR(?video)), ".webm"))
      OPTIONAL { ?item rdfs:label ?labelDe FILTER(LANG(?labelDe) = "de") }
      OPTIONAL { ?item rdfs:label ?labelEn FILTER(LANG(?labelEn) = "en") }
      OPTIONAL { ?item wdt:P31 ?class . OPTIONAL { ?class rdfs:label ?classLabel FILTER(LANG(?classLabel) = "en") } }
      OPTIONAL { ?item wdt:P17 ?country }
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wikibase:sitelinks ?sl }
    }`,
    'video items',
  );
  const items = new Map<string, VideoItem>();
  for (const row of rows) {
    const qid = qidOf(row.item?.value ?? '');
    const point = parsePoint(row.coord?.value ?? '');
    if (!qid || !point) continue;
    let item = items.get(qid);
    if (!item) {
      item = {
        qid, labelDe: null, labelEn: null, ...point, classes: new Map(), countries: new Set(),
        videos: new Set(), images: new Set(), sitelinks: 0,
      };
      items.set(qid, item);
    }
    if (row.labelDe) item.labelDe = row.labelDe.value;
    if (row.labelEn) item.labelEn = row.labelEn.value;
    if (row.class) item.classes.set(qidOf(row.class.value), row.classLabel?.value ?? qidOf(row.class.value));
    if (row.country) item.countries.add(qidOf(row.country.value));
    if (row.video) item.videos.add(commonsNameOf(row.video.value));
    if (row.image) item.images.add(commonsNameOf(row.image.value));
    if (row.sl) item.sitelinks = Math.max(item.sitelinks, Number(row.sl.value));
  }
  return items;
}

function labelOf(de: string | null | undefined, en: string | null | undefined, iso: string | null, qid: string): string {
  const germanFirst = iso === 'DE' || iso === 'AT' || iso === 'CH' || iso === 'LI' || iso === 'LU';
  if (germanFirst) return de ?? en ?? qid;
  return en ?? de ?? qid;
}

// ---------------------------------------------------------------------------------------------
// Test video selection

/** Classes that never mark where footage was shot: events, languages, large areas, interiors. */
const HARD_EXCLUDE_CLASS =
  /\b(language|dialect|oration|speech|address|protest|demonstration|rally|shooting|murder|massacre|attack|airstrike|strike|battle|war crime|earthquake|flood|wildfire|disaster|accident|crash|assassination|operation|event|festival|fair|parade|election|ceremony|party|anniversary|remembrance|performance|concert|conference|season|edition|riot|pandemic|country|sovereign state|federated state|province|oblast|governorate|prefecture|metropolis|megacity|big city|largest city|capital|global city|city-state|mountain range|national park|concentration camp|underground station|metro station|subway station|u-bahn station|radio station|power station|television station|research|light installation|website|organi[sz]ation|company|corporation|airport|aerodrome|spaceport|tunnel|mine|cave|amusement ride|roller coaster|locomotive|artefact|artifact|painting|bell|school|gymnasium|hospital|university|planetarium|exhibition|prison|weapon|natural region|archipelago|ocean|musical instrument)\b/i;

/** Large or vague areas: excluded unless the same class also names a structure (bridge over valley). */
const SOFT_EXCLUDE_CLASS =
  /\b(state|region|department|canton|county|banner|township|island|river|stream|brook|creek|massif|ridge|sea|gulf|bay|fjord|strait|lake|reservoir|protected area|nature reserve|naturschutzgebiet|biosphere|special area|site of community importance|forest|desert|valley|glacier|canal|railway line|road|highway|motorway|territory|landscape|plain|plateau|peninsula|delta|basin|quarry|brewery|ship|aircraft|vehicle|bus stop|playground|pond|garden|cemetery|zoo|military|velodrome|interchange|junction)\b/i;

/** Outdoor structures with a well-defined position. */
const TIER_A =
  /\b(bridge|viaduct|tower|church|cathedral|basilica|chapel|mosque|temple|shrine|pagoda|monastery|abbey|castle|palace|ch[aâ]teau|fortress|fort|citadel|gate|square|plaza|monument|memorial|statue|sculpture|fountain|lighthouse|railway station|train station|central station|station|harbou?r|port|pier|dam|weir|barrage|skyscraper|building|town hall|city hall|opera house|theatre|theater|stadium|arena|landmark|windmill|ruin|ruins|archaeological site|amphitheatre|pyramid|arch|waterfall|ferris wheel|clock|promenade|beach|market|street)\b/i;

/** Small settlements and districts: position is a few kilometres wide at most. */
const TIER_B = /\b(ortsteil|neighbou?rhood|quarter|village|hamlet|town|human settlement|locality|borough|district|suburb|municipality|commune|hill|mountain|summit|volcano|park)\b/i;

/** File names that point to documentaries, archive films, interviews, interiors or non-camera footage. */
const BAD_NAME =
  /(wikitongues|google timelapse|terrax|redub|histoire|história|historia|explosion|speaks|unveiling|visitez|carnage|timelapse|time-lapse|newsreel|geschichte|history|rekonstruktion|reconstruction|animation|terra x|\(cc by|interview|speaking|lecture|vortrag|onride|on-ride|\bpov\b|landing|takeoff|cockpit|lichtinstallation|glocke|glocken|bell|bells|geläut|läuten|orgel|organ|interior|innen|inside|indoor|trailer|music|song|hymn|dokumentation|documentary|\bdoku\b|sprengung|demolition|abriss|teil \d+ (der|die|das)|part \d+ of|slideshow|rundflug|360|panorama 360|night|nacht|abend|evening|fireworks|feuerwerk|\bmuseum\b|exhibition|ausstellung|news|report|presentation|präsentation|ceremony|zeremonie|parade|festival|concert|konzert)/i;

const GOOD_NAME = /(daily drone|übersicht|overview|schwenk|walk|rundgang|tour|view|ansicht|blick|street|straße|platz|square|bridge|brücke|station|bahnhof|lub 20)/i;

function scoreVideoItem(item: VideoItem, video: string): { score: number; instanceOf: string } | null {
  if (EXCLUDED_VIDEO_ITEMS.has(item.qid)) return null;
  const classLabels = [...item.classes.values()];
  if (classLabels.length === 0) return null;
  // Port cities and county seats are cities, not harbours or seats of something small.
  const cleaned = classLabels.map((c) =>
    c.replace(/\bport city\b/i, 'city').replace(/\bcounty seat\b/i, 'town').replace(/\bwar memorial\b/i, 'memorial'));
  if (cleaned.some((c) => HARD_EXCLUDE_CLASS.test(c) || (SOFT_EXCLUDE_CLASS.test(c) && !TIER_A.test(c)))) return null;
  // Prefer a specific structure (bridge, church) over generic classes (street, building).
  const generic = /\b(street|building|landmark|market|square|promenade|built structure|architectural structure)\b/i;
  const tierA = cleaned.find((c) => TIER_A.test(c) && !generic.test(c)) ?? cleaned.find((c) => TIER_A.test(c));
  const tierB = cleaned.find((c) => TIER_B.test(c));
  if (!tierA && !tierB) return null;
  const name = video.replace(/_/g, ' ');
  if (BAD_NAME.test(name)) return null;
  let score = tierA ? 3 : 2;
  if (GOOD_NAME.test(name)) score += 0.5;
  if (/museum|art museum/i.test(classLabels.join(','))) score -= 1;
  score += Math.min(1, Math.log10(1 + item.sitelinks) / 2);
  return { score, instanceOf: tierA ?? tierB ?? cleaned[0] ?? '' };
}

interface ProbeResult {
  url: string;
  duration: number;
  width: number;
  height: number;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
  });
}

async function ffprobeUrl(url: string): Promise<ProbeResult | null> {
  const result = await run('ffprobe', [
    '-v', 'error', '-user_agent', USER_AGENT, '-rw_timeout', '20000000',
    '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', url,
  ], 40_000);
  if (result.code !== 0) return null;
  try {
    const json = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
    };
    const video = json.streams?.find((s) => s.codec_type === 'video');
    const duration = Number(json.format?.duration ?? video?.duration ?? NaN);
    if (!video || !Number.isFinite(duration)) return null;
    return { url, duration, width: video.width ?? 0, height: video.height ?? 0 };
  } catch {
    return null;
  }
}

async function probeVideo(name: string): Promise<ProbeResult | null> {
  for (const url of [transcodeUrl(name, 480), transcodeUrl(name, 360), originalUrl(name)]) {
    const probe = await ffprobeUrl(url);
    if (probe) return probe;
  }
  return null;
}

function clipWindow(duration: number): { start: number; length: number } {
  const start = Math.round(Math.min(4, duration * 0.15) * 10) / 10;
  const length = Math.round(Math.min(CLIP_SECONDS, duration - start - 0.2) * 10) / 10;
  return { start, length };
}

function makeId(iso: string | null, label: string, taken: Set<string>): string {
  const base = `${(iso ?? 'xx').toLowerCase()}-${slugify(label, 30)}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

function videoTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Licence and author from the raw wikitext of the file page, null when not reachable. */
async function fetchLicence(name: string): Promise<{ license: string | null; author: string | null }> {
  const url = `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(`File:${name}`)}&action=raw`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) return { license: null, author: null };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseLicence(await response.text());
    } catch {
      await sleep(1500);
    }
  }
  return { license: null, author: null };
}

export function parseLicence(text: string): { license: string | null; author: string | null } {
  const lower = text.toLowerCase();
  let license: string | null = null;
  const cc = /\b(cc[- ]by[- ]sa|cc[- ]by)[- ](\d\.\d)(?:[- ]([a-z]{2,3}))?\b/.exec(lower);
  if (cc) {
    const kind = /sa$/.test(cc[1] ?? '') ? 'CC BY-SA' : 'CC BY';
    license = `${kind} ${cc[2]}${cc[3] ? ` ${cc[3].toUpperCase()}` : ''}`;
  } else if (/\bcc-by-sa-all\b/.test(lower)) {
    license = 'CC BY-SA (all versions)';
  } else if (/\{\{\s*cc-gobierno de chile/.test(lower)) {
    license = 'CC BY 3.0 CL';
  } else if (/\{\{\s*(cc-zero|cc0)/.test(lower) || /\|\s*cc-zero/.test(lower)) {
    license = 'CC0 1.0';
  } else if (/\{\{\s*youtube cc-by/.test(lower)) {
    license = 'CC BY 3.0';
  } else if (/\{\{\s*pd-/.test(lower) || /\|\s*pd-/.test(lower)) {
    license = 'Public domain';
  } else if (/\bgfdl\b/.test(lower)) {
    license = 'GFDL';
  } else if (/\{\{\s*(fal|free art license)/.test(lower)) {
    license = 'Free Art License';
  }
  let author: string | null = null;
  const m = /^\s*\|\s*author\s*=\s*(.+)$/im.exec(text);
  if (m?.[1]) {
    author = m[1]
      .replace(/\{\{\s*user:([^/|}]+)[^}]*\}\}/gi, 'User:$1')
      .replace(/\{\{\s*creator:([^|}]+)[^}]*\}\}/gi, '$1')
      .replace(/\{\{\s*own\s*\}\}/gi, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
      .replace(/\[https?:\/\/[^\]]+\]/g, '')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/'''?/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (!author) author = null;
  }
  return { license, author };
}

async function buildPool(items: Map<string, VideoItem>, countries: Map<string, CountryInfo>): Promise<PoolEntry[]> {
  const pool: PoolEntry[] = [];
  const seenVideos = new Set<string>();
  for (const item of items.values()) {
    if (![...item.images].some(isRaster)) continue; // the gallery must hold an image of the item
    const country = pickCountry(item.countries, countries);
    const iso = country?.iso ?? null;
    let best: { video: string; score: number; instanceOf: string } | null = null;
    for (const video of [...item.videos].sort()) {
      const scored = scoreVideoItem(item, video);
      if (scored && (!best || scored.score > best.score)) best = { video, ...scored };
    }
    if (!best || seenVideos.has(best.video)) continue;
    seenVideos.add(best.video);
    pool.push({
      qid: item.qid,
      label: labelOf(item.labelDe, item.labelEn, iso, item.qid),
      lat: item.lat,
      lon: item.lon,
      country: iso,
      countryLabel: country?.label ?? null,
      continent: iso === 'DE' ? 'DE' : continentOf(iso, item.lat, item.lon),
      instanceOf: best.instanceOf,
      commonsFile: best.video,
      score: Math.round(best.score * 1000) / 1000,
      sitelinks: item.sitelinks,
    });
  }
  pool.sort((a, b) => b.score - a.score || b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
  return pool;
}

/**
 * Greedy choice per continent with diversity rules: at most 3 test videos per country outside
 * Germany (4 for the US), and at most 2 within 15 km of each other.
 */
async function chooseVideos(pool: PoolEntry[], previous: ManifestVideo[]): Promise<ManifestVideo[]> {
  const chosen: ManifestVideo[] = [];
  const taken = new Set<string>();
  const perCountry = new Map<string, number>();
  const tried = new Set<string>();

  const fits = (entry: PoolEntry): boolean => {
    const countryCap = entry.country === 'DE' ? 99 : entry.country === 'US' ? 4 : 3;
    if ((perCountry.get(entry.country ?? '?') ?? 0) >= countryCap) return false;
    if (chosen.filter((c) => c.instanceOf === entry.instanceOf).length >= 4) return false;
    const near = chosen.filter((c) => haversineKm(c, entry) < 15).length;
    return near < 2;
  };

  const accept = async (entry: PoolEntry): Promise<boolean> => {
    tried.add(entry.qid);
    const probe = await probeVideo(entry.commonsFile);
    if (!probe || probe.duration < MIN_SOURCE_SECONDS || Math.min(probe.width, probe.height) < 240) {
      log(`    - ${entry.qid} ${entry.label}: ${probe ? `unsuitable (${probe.duration.toFixed(0)} s, ${probe.width}x${probe.height})` : 'not reachable'}`);
      return false;
    }
    const window = clipWindow(probe.duration);
    const id = makeId(entry.country, entry.label, taken);
    chosen.push({
      id,
      file: `clips/${id}.mp4`,
      title: videoTitle(entry.commonsFile),
      label: entry.label,
      wikidata: entry.qid,
      lat: entry.lat,
      lon: entry.lon,
      country: entry.country,
      countryLabel: entry.countryLabel,
      continent: entry.continent === 'DE' ? 'EU' : entry.continent,
      instanceOf: entry.instanceOf,
      commonsFile: entry.commonsFile,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(entry.commonsFile)}`,
      mediaUrl: probe.url,
      dateFromName: dateFromFileName(entry.commonsFile),
      clipStart: window.start,
      clipDuration: window.length,
      durationSec: Math.round(probe.duration * 100) / 100,
      license: null,
      author: null,
    });
    perCountry.set(entry.country ?? '?', (perCountry.get(entry.country ?? '?') ?? 0) + 1);
    log(`    + ${id}  (${entry.qid}, ${entry.instanceOf}, ${probe.duration.toFixed(0)} s, ${probe.width}x${probe.height})`);
    return true;
  };

  // Keep previously chosen videos (when topping up a manifest after a failed clip).
  for (const video of previous) {
    taken.add(video.id);
    chosen.push(video);
    tried.add(video.wikidata);
    perCountry.set(video.country ?? '?', (perCountry.get(video.country ?? '?') ?? 0) + 1);
  }

  const counts = (group: string): number =>
    chosen.filter((c) => (c.country === 'DE' ? 'DE' : c.continent) === group).length;

  for (const [group, quota] of Object.entries(QUOTAS)) {
    log(`  ${group}: ${quota} Videos`);
    for (const entry of pool) {
      if (counts(group) >= quota) break;
      if (entry.continent !== group || tried.has(entry.qid) || !fits(entry)) continue;
      await accept(entry);
    }
  }
  // Top up from any continent if a quota could not be met.
  for (const entry of pool) {
    if (chosen.length >= TEST_VIDEO_COUNT) break;
    if (tried.has(entry.qid) || !fits(entry)) continue;
    await accept(entry);
  }
  return chosen;
}

async function cutClip(video: ManifestVideo): Promise<boolean> {
  const target = path.join(DATA_DIR, video.file);
  if (await exists(target)) return true;
  const partial = `${target}.part`;
  const sources = [...new Set([video.mediaUrl, transcodeUrl(video.commonsFile, 480), transcodeUrl(video.commonsFile, 360), originalUrl(video.commonsFile)])];
  for (const source of sources) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-user_agent', USER_AGENT, '-rw_timeout', '30000000',
        '-ss', String(video.clipStart), '-i', source, '-t', String(video.clipDuration),
        '-map', '0:v:0', '-an', '-sn', '-dn',
        '-vf', "scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
        '-fpsmax', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '28',
        '-movflags', '+faststart', '-f', 'mp4', partial,
      ], 300_000);
      if (result.code === 0 && (await exists(partial))) {
        await fs.rename(partial, target);
        return true;
      }
      log(`    ${video.id}: ffmpeg failed (${result.stderr.trim().split('\n').pop() ?? result.code})`);
      await fs.rm(partial, { force: true });
      await sleep(2000 * attempt);
    }
  }
  return false;
}

async function clipDurationOf(file: string): Promise<number | null> {
  const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 20_000);
  const d = Number(result.stdout.trim());
  return result.code === 0 && Number.isFinite(d) ? Math.round(d * 100) / 100 : null;
}

async function totalBytes(dir: string, ext: string): Promise<number> {
  let sum = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith(ext)) continue;
      sum += (await fs.stat(path.join(dir, name))).size;
    }
  } catch {
    // missing directory
  }
  return sum;
}

async function runVideos(countries: () => Promise<Map<string, CountryInfo>>, videoItems: () => Promise<Map<string, VideoItem>>): Promise<void> {
  await fs.mkdir(CLIPS_DIR, { recursive: true });
  let manifest = await readJson<Manifest>(MANIFEST_PATH);
  let pool = await readJson<PoolEntry[]>(POOL_PATH);

  if (!manifest || FLAG_RESELECT || manifest.videos.length === 0) {
    log('Testvideos: Auswahl aus Wikidata (P10 Video + P625 Koordinate) …');
    pool = await buildPool(await videoItems(), await countries());
    await writeJson(POOL_PATH, pool);
    log(`  ${pool.length} geeignete Kandidaten nach Filter; prüfe Verfügbarkeit mit ffprobe …`);
    const videos = await chooseVideos(pool, []);
    manifest = { version: 1, createdAt: new Date().toISOString(), source: 'Wikidata P10/P625', videos };
    await writeJson(MANIFEST_PATH, manifest);
    log(`  Manifest geschrieben: ${videos.length} Videos → ${path.relative(ROOT, MANIFEST_PATH)}`);
  } else {
    log(`Testvideos: gespeicherte Auswahl (${manifest.videos.length} Videos) aus dem Manifest.`);
  }
  if (FLAG_SELECT_ONLY) return;

  // Licences (best effort; the Commons API is not used).
  const needLicence = manifest.videos.filter((v) => v.license === null);
  if (needLicence.length > 0) {
    log(`  Lizenzangaben für ${needLicence.length} Dateien lesen …`);
    let blocked = 0;
    for (const video of needLicence) {
      const { license, author } = await fetchLicence(video.commonsFile);
      if (!license && !author) blocked++;
      video.license = license;
      video.author = author;
      await sleep(400);
      if (blocked >= 5 && blocked === needLicence.indexOf(video) + 1) {
        log('  Commons-Dateiseiten nicht erreichbar; Lizenz bleibt leer (sourceUrl verweist auf die Dateiseite).');
        break;
      }
    }
    await writeJson(MANIFEST_PATH, manifest);
  }

  // Clips.
  const started = Date.now();
  let done = 0;
  const failed: ManifestVideo[] = [];
  const queue = [...manifest.videos];
  const current = manifest;
  const worker = async (): Promise<void> => {
    for (;;) {
      const video = queue.shift();
      if (!video) return;
      const target = path.join(DATA_DIR, video.file);
      const had = await exists(target);
      const ok = await cutClip(video);
      done++;
      if (ok) {
        const d = await clipDurationOf(target);
        if (d !== null) video.clipDuration = d;
        if (!had) await writeJson(MANIFEST_PATH, current);
        log(`  ${String(done).padStart(2)}/${current.videos.length}  ${video.file}${had ? ' (vorhanden)' : ''}`);
      } else {
        failed.push(video);
        log(`  ${String(done).padStart(2)}/${current.videos.length}  ${video.file} FEHLGESCHLAGEN`);
      }
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
  await writeJson(MANIFEST_PATH, current);

  // Replace videos whose clip could not be cut by the next candidates of the pool.
  if (failed.length > 0 && pool) {
    log(`  ${failed.length} Clip(s) fehlgeschlagen, ersetze aus dem Kandidatenpool …`);
    const failedIds = new Set(failed.map((f) => f.wikidata));
    const keep = current.videos.filter((v) => !failedIds.has(v.wikidata));
    const tried = pool.filter((p) => failedIds.has(p.qid)).map((p) => p.qid);
    const replaced = await chooseVideos(pool.filter((p) => !tried.includes(p.qid)), keep);
    current.videos = replaced;
    await writeJson(MANIFEST_PATH, current);
    for (const video of replaced) {
      if (await exists(path.join(DATA_DIR, video.file))) continue;
      if (await cutClip(video)) {
        const d = await clipDurationOf(path.join(DATA_DIR, video.file));
        if (d !== null) video.clipDuration = d;
      } else {
        current.videos = current.videos.filter((v) => v !== video);
        log(`  ${video.file} ebenfalls fehlgeschlagen; entfernt.`);
      }
      await writeJson(MANIFEST_PATH, current);
    }
  }

  const bytes = await totalBytes(CLIPS_DIR, '.mp4');
  log(`Testvideos fertig: ${current.videos.length} Clips, ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  if (bytes > CLIP_BUDGET_BYTES) log(`  Warnung: Clips überschreiten ${CLIP_BUDGET_BYTES / 1e6} MB.`);
}

// ---------------------------------------------------------------------------------------------
// Gallery

/** Landmark classes queried worldwide: [class, min sitelinks, max items taken]. */
const WORLD_CLASSES: [string, string, number, number][] = [
  ['Q515', 'city', 40, 380],
  ['Q1549591', 'big city', 60, 200],
  ['Q16970', 'church building', 15, 170],
  ['Q2977', 'cathedral', 12, 160],
  ['Q23413', 'castle', 10, 170],
  ['Q16560', 'palace', 10, 130],
  ['Q12518', 'tower', 8, 110],
  ['Q1440300', 'observation tower', 6, 60],
  ['Q11303', 'skyscraper', 12, 130],
  ['Q12280', 'bridge', 8, 120],
  ['Q158438', 'arch bridge', 6, 40],
  ['Q12570', 'suspension bridge', 6, 50],
  ['Q174782', 'square', 8, 130],
  ['Q4989906', 'monument', 8, 120],
  ['Q179700', 'statue', 8, 60],
  ['Q33506', 'museum', 15, 120],
  ['Q207694', 'art museum', 15, 70],
  ['Q55488', 'railway station', 10, 110],
  ['Q44782', 'port', 6, 50],
  ['Q39715', 'lighthouse', 6, 60],
  ['Q32815', 'mosque', 10, 90],
  ['Q44539', 'temple', 6, 50],
  ['Q5393308', 'Buddhist temple', 8, 70],
  ['Q842402', 'Hindu temple', 8, 50],
  ['Q483110', 'stadium', 15, 90],
  ['Q153562', 'opera house', 8, 40],
  ['Q25550691', 'town hall', 6, 50],
  ['Q82117', 'city gate', 5, 40],
  ['Q839954', 'archaeological site', 15, 110],
  ['Q57821', 'fortification', 8, 50],
  ['Q44613', 'monastery', 10, 60],
  ['Q160742', 'abbey', 8, 40],
  ['Q34038', 'waterfall', 10, 50],
  ['Q570116', 'tourist attraction', 8, 60],
  ['Q2319498', 'landmark', 5, 50],
  ['Q1081138', 'historic site', 8, 40],
];

/** Classes queried inside Germany (P17 = Q183). */
const GERMAN_CLASSES: [string, string, number, number][] = [
  ['Q42744322', 'Stadt (urban municipality)', 15, 300],
  ['Q16970', 'Kirchengebäude', 4, 170],
  ['Q2977', 'Kathedrale', 3, 40],
  ['Q23413', 'Burg', 3, 120],
  ['Q751876', 'Schloss', 3, 110],
  ['Q16560', 'Palast', 3, 40],
  ['Q12518', 'Turm', 3, 60],
  ['Q1440300', 'Aussichtsturm', 3, 50],
  ['Q12280', 'Brücke', 3, 70],
  ['Q174782', 'Platz', 3, 60],
  ['Q4989906', 'Denkmal', 3, 60],
  ['Q33506', 'Museum', 5, 60],
  ['Q55488', 'Bahnhof', 4, 60],
  ['Q18543139', 'Hauptbahnhof', 3, 40],
  ['Q25550691', 'Rathaus', 3, 40],
  ['Q82117', 'Stadttor', 3, 30],
  ['Q39715', 'Leuchtturm', 3, 30],
  ['Q44613', 'Kloster', 4, 40],
  ['Q17715832', 'Burgruine', 3, 40],
  ['Q38720', 'Windmühle', 3, 20],
  ['Q11303', 'Hochhaus', 3, 30],
  ['Q537127', 'Straßenbrücke', 3, 50],
  ['Q158438', 'Bogenbrücke', 3, 30],
  ['Q543654', 'Rathaus (city hall)', 3, 40],
  ['Q262166', 'Gemeinde', 20, 200],
];

const WORLD_TARGET = 2900;
const GERMAN_TARGET = 1400;

function classQuery(cls: string, minSitelinks: number, germanyOnly: boolean): string {
  return `SELECT ?item ?sl ?coord ?image ?country ?de ?en WHERE {
    ?item wdt:P31 wd:${cls} ; wikibase:sitelinks ?sl .
    FILTER(?sl >= ${minSitelinks})
    ${germanyOnly ? '?item wdt:P17 wd:Q183 .' : ''}
    ?item wdt:P625 ?coord ; wdt:P18 ?image .
    OPTIONAL { ?item wdt:P17 ?country }
    OPTIONAL { ?item rdfs:label ?de FILTER(LANG(?de) = "de") }
    OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  }`;
}

interface ClassHit {
  qid: string;
  sl: number;
  lat: number;
  lon: number;
  image: string;
  countries: Set<string>;
  de: string | null;
  en: string | null;
}

function collectHits(rows: SparqlRow[]): ClassHit[] {
  const map = new Map<string, ClassHit>();
  for (const row of rows) {
    const qid = qidOf(row.item?.value ?? '');
    const point = parsePoint(row.coord?.value ?? '');
    const image = row.image ? commonsNameOf(row.image.value) : null;
    if (!qid || !point || !image) continue;
    let hit = map.get(qid);
    if (!hit) {
      hit = { qid, sl: Number(row.sl?.value ?? 0), ...point, image, countries: new Set(), de: null, en: null };
      map.set(qid, hit);
    }
    // Prefer a raster image when an item has several.
    if (!isRaster(hit.image) && isRaster(image)) hit.image = image;
    if (row.country) hit.countries.add(qidOf(row.country.value));
    if (row.de) hit.de = row.de.value;
    if (row.en) hit.en = row.en.value;
  }
  return [...map.values()].sort((a, b) => b.sl - a.sl || a.qid.localeCompare(b.qid));
}

async function selectGallery(countries: Map<string, CountryInfo>, videoItems: Map<string, VideoItem>): Promise<GalleryCandidate[]> {
  const out = new Map<string, GalleryCandidate>();
  // (a) every item with a video.
  for (const item of [...videoItems.values()].sort((a, b) => a.qid.localeCompare(b.qid))) {
    const image = [...item.images].sort().find(isRaster);
    if (!image) continue;
    const country = pickCountry(item.countries, countries);
    out.set(item.qid, {
      id: item.qid, label: labelOf(item.labelDe, item.labelEn, country?.iso ?? null, item.qid),
      lat: item.lat, lon: item.lon, country: country?.iso ?? null, commonsFile: image, hasVideo: true, group: 'video',
    });
  }
  log(`  (a) Objekte mit Video: ${out.size}`);

  const addFromClasses = async (classes: [string, string, number, number][], germany: boolean, target: number, group: string): Promise<number> => {
    // Round-robin over classes, each sorted by sitelinks, so that every class contributes.
    const lists: ClassHit[][] = [];
    for (const [cls, name, minSl, cap] of classes) {
      try {
        const rows = await sparqlCached(classQuery(cls, minSl, germany), `${group} ${name}`);
        const hits = collectHits(rows).filter((h) => isRaster(h.image)).slice(0, cap);
        lists.push(hits);
        log(`    ${name.padEnd(28)} ${String(hits.length).padStart(4)} (sitelinks >= ${minSl})`);
      } catch (err: unknown) {
        log(`    ${name.padEnd(28)} übersprungen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    let added = 0;
    for (let round = 0; added < target; round++) {
      let any = false;
      for (const list of lists) {
        const hit = list[round];
        if (!hit) continue;
        any = true;
        if (out.has(hit.qid) || added >= target) continue;
        const country = pickCountry(hit.countries, countries);
        out.set(hit.qid, {
          id: hit.qid, label: labelOf(hit.de, hit.en, country?.iso ?? null, hit.qid), lat: hit.lat, lon: hit.lon,
          country: country?.iso ?? null, commonsFile: hit.image, hasVideo: false, group,
        });
        added++;
      }
      if (!any) break;
    }
    return added;
  };

  log('  (b) Sehenswürdigkeiten weltweit:');
  const world = await addFromClasses(WORLD_CLASSES, false, WORLD_TARGET, 'world');
  log(`  (b) ${world} neue Objekte`);
  log('  (c) Objekte in Deutschland:');
  const german = await addFromClasses(GERMAN_CLASSES, true, GERMAN_TARGET, 'germany');
  log(`  (c) ${german} neue Objekte`);
  return [...out.values()];
}

async function fetchBuffer(url: string, maxBytes: number): Promise<{ status: number; body: Buffer | null; retryAfter: number }> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  const retryAfter = Number(response.headers.get('retry-after') ?? '0');
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status, body: null, retryAfter };
  }
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > maxBytes) {
    await response.body?.cancel();
    return { status: 413, body: null, retryAfter: 0 };
  }
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), retryAfter };
}

let globalPauseUntil = 0;

async function downloadThumb(candidate: GalleryCandidate): Promise<'ok' | 'skip' | 'fail'> {
  const target = path.join(GALLERY_DIR, `${candidate.id}.jpg`);
  if (await exists(target)) return 'skip';
  const urls = [...thumbUrls(candidate.commonsFile), originalUrl(candidate.commonsFile)];
  for (const [index, url] of urls.entries()) {
    const isOriginal = index === urls.length - 1;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const wait = globalPauseUntil - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const { status, body, retryAfter } = await fetchBuffer(url, isOriginal ? 6_000_000 : 8_000_000);
        if (status === 429 || status === 503) {
          globalPauseUntil = Date.now() + Math.max(retryAfter * 1000, 5000 * attempt);
          continue;
        }
        if (!body) break; // 4xx: try the next URL form
        const jpeg = await sharp(body, { failOn: 'none' })
          .rotate()
          .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH * 2, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 82 })
          .toBuffer();
        await fs.writeFile(`${target}.part`, jpeg);
        await fs.rename(`${target}.part`, target);
        return 'ok';
      } catch {
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  return 'fail';
}

async function writeGalleryJson(candidates: GalleryCandidate[], testItems: Set<string>): Promise<number> {
  const present = new Set((await fs.readdir(GALLERY_DIR)).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)));
  const images: GalleryImage[] = candidates
    .filter((c) => present.has(c.id))
    .map((c) => ({
      id: c.id, file: `gallery/${c.id}.jpg`, label: c.label, lat: c.lat, lon: c.lon, country: c.country,
      wikidata: c.id, commonsFile: c.commonsFile, hasVideo: c.hasVideo, testItem: testItems.has(c.id),
    }));
  await writeJson(GALLERY_PATH, { version: 1, images });
  return images.length;
}

async function runGallery(countries: () => Promise<Map<string, CountryInfo>>, videoItems: () => Promise<Map<string, VideoItem>>): Promise<void> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  let candidates = FLAG_RESELECT ? null : await readJson<GalleryCandidate[]>(CANDIDATES_PATH);
  if (!candidates) {
    log('Galerie: Auswahl aus Wikidata (P18 Bild + P625 Koordinate) …');
    candidates = await selectGallery(await countries(), await videoItems());
    await writeJson(CANDIDATES_PATH, candidates);
    // Remove thumbnails of an earlier selection that are no longer listed.
    const keep = new Set(candidates.map((c) => `${c.id}.jpg`));
    let pruned = 0;
    for (const name of await fs.readdir(GALLERY_DIR)) {
      if (name.endsWith('.jpg') && !keep.has(name)) {
        await fs.rm(path.join(GALLERY_DIR, name));
        pruned++;
      }
    }
    if (pruned > 0) log(`  ${pruned} nicht mehr ausgewählte Bilder entfernt.`);
  } else {
    log(`Galerie: gespeicherte Auswahl (${candidates.length} Kandidaten).`);
  }
  const manifest = await readJson<Manifest>(MANIFEST_PATH);
  const testItems = new Set(manifest?.videos.map((v) => v.wikidata) ?? []);

  const missing: GalleryCandidate[] = [];
  for (const c of candidates) if (!(await exists(path.join(GALLERY_DIR, `${c.id}.jpg`)))) missing.push(c);
  // Test items first, then items with video, then the rest in selection order.
  missing.sort((a, b) => Number(testItems.has(b.id)) - Number(testItems.has(a.id)) || Number(b.hasVideo) - Number(a.hasVideo));
  log(`  ${candidates.length} Kandidaten, ${candidates.length - missing.length} vorhanden, ${missing.length} zu laden.`);

  const started = Date.now();
  const deadline = started + GALLERY_MINUTES * 60_000;
  let done = 0;
  let ok = 0;
  let failed = 0;
  let stoppedByTime = false;
  const queue = [...missing];
  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() > deadline) {
        stoppedByTime = true;
        return;
      }
      const candidate = queue.shift();
      if (!candidate) return;
      const result = await downloadThumb(candidate);
      done++;
      if (result === 'ok') ok++;
      if (result === 'fail') failed++;
      if (done % 100 === 0 || done === missing.length) {
        const rate = done / Math.max(1, (Date.now() - started) / 1000);
        log(`  ${String(done).padStart(5)}/${missing.length}  ok ${ok}, Fehler ${failed}, ${rate.toFixed(1)}/s, Rest ~${((missing.length - done) / Math.max(rate, 0.01) / 60).toFixed(0)} min`);
      }
      if (done % 500 === 0) await writeGalleryJson(candidates, testItems);
    }
  };
  await Promise.all(Array.from({ length: GALLERY_CONCURRENCY }, worker));
  const count = await writeGalleryJson(candidates, testItems);
  const bytes = await totalBytes(GALLERY_DIR, '.jpg');
  log(`Galerie fertig: ${count} Bilder in gallery.json, ${(bytes / 1e6).toFixed(1)} MB, ${failed} Fehler, ${((Date.now() - started) / 60000).toFixed(1)} min.`);
  if (stoppedByTime) log(`  Zeitlimit (${GALLERY_MINUTES} min) erreicht; erneuter Aufruf lädt den Rest.`);
}

// ---------------------------------------------------------------------------------------------
// Check

async function runCheck(): Promise<void> {
  const problems: string[] = [];
  const manifest = await readJson<Manifest>(MANIFEST_PATH);
  if (!manifest) problems.push('manifest.json fehlt');
  else {
    for (const v of manifest.videos) if (!(await exists(path.join(DATA_DIR, v.file)))) problems.push(`fehlt: ${v.file}`);
  }
  const gallery = await readJson<{ images: GalleryImage[] }>(GALLERY_PATH);
  if (!gallery) problems.push('gallery.json fehlt');
  else {
    for (const g of gallery.images) if (!(await exists(path.join(DATA_DIR, g.file)))) problems.push(`fehlt: ${g.file}`);
  }
  log(`Manifest: ${manifest?.videos.length ?? 0} Videos; Galerie: ${gallery?.images.length ?? 0} Bilder.`);
  if (problems.length > 0) {
    log(`${problems.length} Problem(e):\n${problems.slice(0, 40).map((p) => `  ${p}`).join('\n')}`);
    log('Daten laden mit: pnpm datum:fetch');
    process.exitCode = 1;
  } else {
    log('Alle Dateien vorhanden.');
  }
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  if (FLAG_CHECK) return runCheck();
  // Shared, lazily loaded query results.
  let countriesPromise: Promise<Map<string, CountryInfo>> | null = null;
  let itemsPromise: Promise<Map<string, VideoItem>> | null = null;
  const countries = (): Promise<Map<string, CountryInfo>> => (countriesPromise ??= loadCountries());
  const videoItems = (): Promise<Map<string, VideoItem>> => (itemsPromise ??= loadVideoItems());
  if (!FLAG_GALLERY_ONLY) await runVideos(countries, videoItems);
  if (!FLAG_VIDEOS_ONLY) await runGallery(countries, videoItems);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
