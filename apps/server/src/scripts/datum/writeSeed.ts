/**
 * Writes datasets/datum/seed.json from the manifest: the reference videos enter a fresh DATUM
 * node under neutral names (datum-001.mp4 …), so that the place is not given away by the name.
 *
 *   tsx src/scripts/datum/writeSeed.ts
 */
import { writeSeed } from '../../datum/dataset.js';

const result = await writeSeed();
process.stdout.write(`Referenzbestand: ${result.clips} Videos als Startbestand eingetragen${result.missing > 0 ? `, ${result.missing} fehlen (pnpm datum:fetch)` : ''}.\n`);
if (result.clips === 0) process.exit(1);
