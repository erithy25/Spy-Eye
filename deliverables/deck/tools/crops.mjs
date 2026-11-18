/**
 * Cuts the two details that the English edition of the deck shows from the console screenshots.
 *
 *   node deliverables/deck/tools/crops.mjs [sourceDir]
 *
 * Source: 2880 x 1800 PNG screenshots named as in docs/screens (the default source directory).
 * Output: deliverables/deck/assets/en/<name>.png. A whole screenshot is illegible at slide size
 * where only one panel matters, so the slide shows that panel.
 *
 * Needs sharp, which the server package of this repository already installs. After running it,
 * the pictures have to be uploaded to the Slides document again (see ../README.md).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(repo, 'apps', 'server', 'package.json'));
const sharp = require('sharp');

const source = path.resolve(process.argv[2] ?? path.join(repo, 'docs', 'screens'));
const target = path.join(here, '..', 'assets', 'en');

/** Output name -> source screenshot and the cut in source pixels: left, top, width, height. */
const CUTS = {
  // WACHEN tab: the panel of the selected watch, without the list of watches beside it.
  'wachen-ausschnitt': ['wachen', 800, 448, 2080, 1300],
  // VERBUND tab: the map of the three nodes, without the page head and the table below.
  'verbund-karte': ['verbund', 64, 556, 1660, 880],
};

await fs.mkdir(target, { recursive: true });
for (const [name, [from, left, top, width, height]] of Object.entries(CUTS)) {
  const input = path.join(source, `${from}.png`);
  const meta = await sharp(input).metadata();
  if (meta.width !== 2880 || meta.height !== 1800) {
    throw new Error(`${input}: expected 2880 x 1800, found ${meta.width} x ${meta.height}`);
  }
  const info = await sharp(input)
    .extract({ left, top, width, height })
    .png({ palette: true, colours: 256, dither: 0, effort: 9 })
    .toFile(path.join(target, `${name}.png`));
  console.log(`${name}.png ${info.width}x${info.height} ${Math.round(info.size / 1024)} kB`);
}
