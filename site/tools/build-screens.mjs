/**
 * Derives the pictures of the website from the console screenshots.
 *
 *   node site/tools/build-screens.mjs [sourceDir]
 *
 * Source: 2880 x 1800 PNG screenshots named as in docs/screens (the default source directory).
 * For every screenshot the page uses, this writes to site/assets/screens/:
 *
 *   <name>.webp        the whole screenshot, for the enlarged view
 *   <name>-1440.webp   half size, for the frames in the page (the browser picks by srcset)
 *   <name>-960.webp    a third, for the small detail frames
 *   <name>-ausschnitt.webp (+ -half)   a cut-out where only part of the screen matters
 *
 * Needs sharp, which the server package of this repository already installs.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(path.join(repo, 'apps', 'server', 'package.json'));
const sharp = require('sharp');

const source = path.resolve(process.argv[2] ?? path.join(repo, 'docs', 'screens'));
const target = path.join(here, '..', 'assets', 'screens');

/** Whole screenshots: name -> widths to write besides the full size. */
const WHOLE = {
  lage: [1440],
  'lage-en': [1440],
  suche: [1440],
  wachen: [1440],
  vorgaenge: [1440],
  verbund: [1440],
  protokoll: [1440],
  wirkung: [1440],
  meldung: [960],
  treffer: [960],
  'wache-neu': [960],
  stichprobe: [960],
  maskiert: [],
  freigabe: [],
  original: [],
  ablehnung: [],
};

/** Cut-outs in source pixels: left, top, width, height. */
const CUTS = {
  maskiert: [894, 400, 1200, 900],
  freigabe: [840, 450, 1200, 900],
  original: [894, 400, 1200, 900],
  ablehnung: [0, 0, 2880, 800],
};

const QUALITY = { quality: 86, effort: 6, smartSubsample: true };

async function write(image, file) {
  const info = await image.webp(QUALITY).toFile(path.join(target, file));
  return `${file} ${info.width}x${info.height} ${Math.round(info.size / 1024)} kB`;
}

await fs.mkdir(target, { recursive: true });
const lines = [];
for (const [name, widths] of Object.entries(WHOLE)) {
  const input = path.join(source, `${name}.png`);
  try {
    await fs.access(input);
  } catch {
    lines.push(`${name}.png fehlt in ${source}`);
    continue;
  }
  lines.push(await write(sharp(input), `${name}.webp`));
  for (const width of widths) {
    lines.push(await write(sharp(input).resize({ width, kernel: 'lanczos3' }), `${name}-${width}.webp`));
  }
  const cut = CUTS[name];
  if (cut) {
    const [left, top, width, height] = cut;
    lines.push(await write(sharp(input).extract({ left, top, width, height }), `${name}-ausschnitt.webp`));
    lines.push(
      await write(
        sharp(input).extract({ left, top, width, height }).resize({ width: Math.round(width / 2), kernel: 'lanczos3' }),
        `${name}-ausschnitt-half.webp`,
      ),
    );
  }
}
process.stdout.write(`${lines.join('\n')}\n`);
