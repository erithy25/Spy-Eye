import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * The vector that search queries are centred with: the mean text embedding of a fixed list of
 * ordinary captions, one asset per encoder (see scripts/buildTextCentre.ts). It is shipped rather
 * than computed at start, because the cut-offs of the search were fitted with exactly this vector
 * and must not shift when the tag vocabulary changes.
 */
export interface TextCentreAsset {
  encoder: string;
  textDtype: string;
  createdAt: string;
  note: string;
  captions: string[];
  mean: number[];
}

export function textCentreFile(): string {
  const slug = (config.modelId.split('/').pop() ?? config.modelId).toLowerCase();
  return path.join(config.assetsDir, `text-centre.${slug}.json`);
}

/** The centre for the configured encoder, or null when there is none or it belongs to another one. */
export async function loadTextCentre(dim: number): Promise<Float32Array | null> {
  try {
    const asset = JSON.parse(await fs.readFile(textCentreFile(), 'utf8')) as TextCentreAsset;
    if (asset.encoder !== config.modelId || !Array.isArray(asset.mean) || asset.mean.length !== dim) return null;
    if (!asset.mean.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return Float32Array.from(asset.mean);
  } catch {
    return null;
  }
}
