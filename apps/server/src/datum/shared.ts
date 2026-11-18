/**
 * Process-wide DATUM resources: the reference gallery is embedded once and shared by every node
 * in the process, like the image model itself.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../config.js';
import type { EmbeddingModel } from '../ml/model.js';
import { Gallery } from './gallery.js';

let loading: Promise<Gallery> | null = null;

/** The loaded gallery; the first call embeds what is not cached yet (minutes on a fresh machine). */
export function sharedGallery(model: EmbeddingModel, ready: Promise<unknown>, say: (line: string) => void): Promise<Gallery> {
  loading ??= (async () => {
    await ready;
    const gallery = new Gallery(model, { cacheDir: path.join(repoRoot, '.cache', 'datum') });
    try {
      await fs.access(path.join(gallery.datasetDir, 'gallery.json'));
    } catch {
      // Without reference pictures the engine still estimates the country and the time.
      say('  Referenzgalerie fehlt (pnpm datum:fetch); Ortung nur auf Länderebene.');
      loading = null;
      return gallery;
    }
    let shown = -1;
    const report = await gallery.load((p) => {
      const step = Math.floor((p.done / Math.max(1, p.total)) * 10);
      if (p.embedded > 0 && step !== shown) {
        shown = step;
        say(`  Referenzbilder: ${p.done}/${p.total}`);
      }
    });
    say(`  Referenzgalerie: ${report.images} Bilder${report.embedded > 0 ? `, ${report.embedded} neu eingerechnet (${report.imagesPerSec.toFixed(0)}/s)` : ''}`);
    return gallery;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
