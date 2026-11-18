/**
 * Preflight for a DATUM demonstration: is everything on this machine that the node needs, and
 * has the reference set been analysed and located? Reads files only; starts nothing.
 *
 *   node apps/server/dist/scripts/datum/check.js      (root: pnpm datum:check)
 *
 * Each line ends with OK or FEHLT; a FEHLT line names the next step. Exit code 1 if anything is
 * missing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from '../../config.js';
import { haversineKm } from '../../core/geo.js';
import type { Fix } from '../../datum/contract.js';
import { modelSlug } from '../../datum/gallery.js';
import { seedFiles } from '../../datum/gallerySeed.js';

const DATASET = path.join(repoRoot, 'datasets', 'datum');
const DATA = path.join(repoRoot, 'data-datum');
let missing = 0;

function line(text: string, ok: boolean, fix = ''): void {
  if (!ok) missing++;
  process.stdout.write(`  ${text.padEnd(62)} ${ok ? 'OK' : `FEHLT${fix ? `  → ${fix}` : ''}`}\n`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function count(dir: string, test: (name: string) => boolean): Promise<number> {
  try {
    return (await fs.readdir(dir)).filter(test).length;
  } catch {
    return 0;
  }
}

async function countTree(dir: string, ext: string): Promise<number> {
  let n = 0;
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith(ext)) n++;
    }
  } catch {
    return 0;
  }
  return n;
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

process.stdout.write('DATUM · Prüfung\n');

const modelDir = path.join(config.modelCacheDir, ...config.modelId.split('/'));
line(`Bildmodell ${config.modelId.split('/').pop()}`, await exists(modelDir), 'pnpm models:download');
line('Tiefenmodell depth-anything-v2-small', await exists(path.join(config.modelCacheDir, 'onnx-community', 'depth-anything-v2-small')), 'pnpm models:download');

const manifest = await readJson<{ videos: { file: string }[] }>(path.join(DATASET, 'manifest.json'));
const clips = await count(path.join(DATASET, 'clips'), (n) => n.endsWith('.mp4'));
line(`Referenzvideos: ${clips} von ${manifest?.videos.length ?? 0}`, !!manifest && clips > 0 && clips >= manifest.videos.length, 'pnpm datum:fetch');
const gallery = await readJson<{ images: { file?: unknown }[] }>(path.join(DATASET, 'gallery.json'));
// Only the pictures gallery.json lists count; other files in the folder are not used.
const listed = gallery?.images ?? [];
const present = (
  await Promise.all(listed.map((img) => (typeof img?.file === 'string' ? exists(path.join(DATASET, img.file)) : Promise.resolve(false))))
).filter(Boolean).length;
line(`Referenzbilder: ${present} von ${listed.length}`, listed.length > 0 && present >= listed.length * 0.98, 'pnpm datum:fetch');
const cached = await exists(path.join(repoRoot, '.cache', 'datum', `gallery-${modelSlug(config.modelId)}.bin`));
const shipped = await exists(seedFiles(DATASET, config.modelId).bin);
line(`Referenzgalerie eingerechnet${cached ? '' : shipped ? ' (mitgelieferte Vektoren, eingelesen beim Start)' : ''}`, cached || shipped, 'pnpm datum:prepare');
const terrain = await countTree(path.join(DATASET, 'terrain'), '.png');
line(`Höhendaten: ${terrain} Kacheln`, terrain > 0, 'pnpm datum:fetch');
line('Ländergrenzen und Orte', (await exists(path.join(config.assetsDir, 'datum', 'countries.json'))) && (await exists(path.join(config.assetsDir, 'datum', 'cities.json'))));
const mapManifest = await readJson<{ minZoom: number }>(path.join(repoRoot, 'apps', 'web', 'public', 'map', 'manifest.json'));
line('Weltkarte (Zoomstufen ab 0)', mapManifest?.minZoom === 0);
line('Konsole gebaut', await exists(path.join(repoRoot, 'apps', 'web', 'dist', 'index.html')), 'pnpm build');

// The analysed node.
const videosDir = path.join(DATA, 'videos');
let recordings = 0;
let analysed = 0;
let located = 0;
let failed = 0;
const errors: number[] = [];
try {
  for (const id of await fs.readdir(videosDir)) {
    const meta = await readJson<{ info: { status: string } }>(path.join(videosDir, id, 'meta.json'));
    if (!meta) continue;
    recordings++;
    if (meta.info.status === 'ready') analysed++;
    const fix = await readJson<Fix>(path.join(videosDir, id, 'datum', 'fix.json'));
    if (fix?.status === 'ready') {
      located++;
      if (fix.location && fix.truth) errors.push(haversineKm(fix.location.lat, fix.location.lon, fix.truth.lat, fix.truth.lon));
    } else if (fix?.status === 'error') failed++;
  }
} catch {
  // no node data yet
}
line(`Aufnahmen im Knoten: ${recordings}`, recordings > 0, 'pnpm datum:prepare');
line(`Ausgewertet: ${analysed} von ${recordings}`, recordings > 0 && analysed === recordings, 'pnpm datum:prepare');
line(`Geortet: ${located} von ${analysed}${failed > 0 ? ` (${failed} Fehler)` : ''}`, analysed > 0 && located === analysed, 'pnpm datum:prepare');
if (errors.length > 0) {
  const sorted = [...errors].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const within = (km: number): string => `${sorted.filter((e) => e <= km).length}/${sorted.length}`;
  process.stdout.write(`  Abweichung zur Wahrheit: Median ${median.toFixed(1)} km · ≤ 25 km: ${within(25)} · ≤ 200 km: ${within(200)} · ≤ 750 km: ${within(750)}\n`);
}
line('Vorbereiteter Stand gesichert', await exists(path.join(DATA, '.prepared', 'manifest.json')), 'pnpm datum:prepare');

process.stdout.write(missing === 0 ? '\nErgebnis: bereit. Start: pnpm datum\n' : `\nErgebnis: ${missing} Punkt(e) fehlen.\n`);
process.exit(missing === 0 ? 0 : 1);
