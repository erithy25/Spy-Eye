/**
 * The DATUM reference dataset: videos with a known recording place (ground truth from
 * Wikidata), used to show and to measure what the engine gets right.
 *
 * The clips enter a node under neutral names ("datum-017.mp4") so that neither the engine nor
 * the person in front of the console learns the place from the file name. The ground truth is
 * attached to a fix only after it has been computed, for comparison.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../config.js';

export interface ManifestVideo {
  id: string;
  file: string;
  title: string;
  /** The label the selection was made with, in whichever language Wikidata gave it first. */
  label: string;
  /** German and English names from Wikidata (scripts/datum/fetchLabels.ts); absent before that ran. */
  labelDe?: string;
  labelEn?: string;
  wikidata: string;
  lat: number;
  lon: number;
  country: string | null;
  countryLabel?: string | null;
  instanceOf?: string | null;
  commonsFile?: string;
  sourceUrl?: string;
  dateFromName?: string | null;
  clipStart?: number;
  clipDuration?: number;
  durationSec?: number;
  license?: string | null;
  author?: string | null;
}

interface ManifestFile {
  version: number;
  videos: ManifestVideo[];
}

export const DATASET_DIR = path.join(repoRoot, 'datasets', 'datum');
const NAME_PATTERN = /^datum-(\d{3})\.mp4$/i;

let cached: { mtimeMs: number; videos: ManifestVideo[] } | null = null;

/** The test videos of the reference dataset (empty when the dataset is not there). */
export async function loadManifest(): Promise<ManifestVideo[]> {
  const file = path.join(DATASET_DIR, 'manifest.json');
  try {
    const stat = await fs.stat(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.videos;
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as ManifestFile;
    const videos = Array.isArray(parsed.videos) ? parsed.videos.filter((v) => typeof v.lat === 'number' && typeof v.lon === 'number') : [];
    cached = { mtimeMs: stat.mtimeMs, videos };
    return videos;
  } catch {
    return [];
  }
}

/** Neutral file name under which the n-th dataset video (0-based) enters a node. */
export function caseName(index: number): string {
  return `datum-${String(index + 1).padStart(3, '0')}.mp4`;
}

/** A reference video's place name in both languages (the selection's label where a name is missing). */
export function truthNames(video: Pick<ManifestVideo, 'label' | 'labelDe' | 'labelEn'>): { de: string; en: string } {
  const de = video.labelDe || video.label;
  return { de, en: video.labelEn || de };
}

/** Ground truth for a recording that came from the reference dataset, by its neutral name. */
export async function truthForName(name: string): Promise<ManifestVideo | null> {
  const match = NAME_PATTERN.exec(path.basename(name));
  if (!match) return null;
  const index = Number(match[1]) - 1;
  const videos = await loadManifest();
  return videos[index] ?? null;
}

/**
 * Writes `datasets/datum/seed.json`: the dataset as seed footage of a fresh DATUM node (one
 * source, neutral names). Returns the number of clips that exist on disk.
 *
 * The node seeds once and never again, so the clips must not fall to retention ("daysAgo" makes
 * them look a day old): nodes.datum.json sets `keepSeed`, which exempts exactly these recordings
 * (this source, these names) from deletion, while other recordings on the node keep the normal
 * retention (see NodeConfig.keepSeed and PlatformNode.enforceRetention).
 */
export async function writeSeed(): Promise<{ clips: number; missing: number }> {
  const videos = await loadManifest();
  const clips: { file: string; name: string; daysAgo: number }[] = [];
  let missing = 0;
  for (const [i, v] of videos.entries()) {
    const file = path.basename(v.file);
    try {
      await fs.access(path.join(DATASET_DIR, 'clips', file));
      clips.push({ file, name: caseName(i), daysAgo: 1 });
    } catch {
      missing++;
    }
  }
  const seed = {
    sources: [
      {
        id: 'referenz',
        name: 'Referenzbestand',
        nameEn: 'Reference set',
        kind: 'upload',
        owner: 'DATUM',
        description: 'Videos mit bekanntem Aufnahmeort aus Wikimedia Commons; der Ort wird nicht mitgegeben.',
        descriptionEn: 'Videos with a known recording place from Wikimedia Commons; the place is not given to the engine.',
        lat: 0,
        lon: 0,
        shared: false,
        clips,
      },
    ],
  };
  await fs.writeFile(path.join(DATASET_DIR, 'seed.json'), `${JSON.stringify(seed, null, 2)}\n`);
  return { clips: clips.length, missing };
}
