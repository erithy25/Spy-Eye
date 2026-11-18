/**
 * Erzeugt den Einseiter als PDF, deutsch und englisch:
 *
 *   node docs/onepager/build.cjs            beide Ausgaben
 *   node docs/onepager/build.cjs de         nur deliverables/Sicht-Einseiter.pdf (aus einseiter.html)
 *   node docs/onepager/build.cjs en         nur deliverables/Sicht-One-Pager-EN.pdf (aus one-pager-en.html)
 *   node docs/onepager/build.cjs de bild.png   schreibt zusätzlich ein Bild der Seite
 *
 * Braucht Playwright mit Chromium. Bricht ab, wenn der Inhalt nicht auf eine A4-Seite passt
 * oder die Schrift nicht geladen wurde. Beide Ausgaben teilen sich Aufbau und Zahlen; eine
 * Änderung am Inhalt gehört in beide Dateien.
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const deliverables = path.resolve(__dirname, '..', '..', 'deliverables');
const EDITIONS = {
  de: { source: path.join(__dirname, 'einseiter.html'), target: path.join(deliverables, 'Sicht-Einseiter.pdf') },
  en: { source: path.join(__dirname, 'one-pager-en.html'), target: path.join(deliverables, 'Sicht-One-Pager-EN.pdf') },
};
const args = process.argv.slice(2);
const wanted = args.filter((arg) => arg in EDITIONS);
const preview = args.find((arg) => !(arg in EDITIONS));
const editions = wanted.length > 0 ? wanted : Object.keys(EDITIONS);
if (preview && editions.length !== 1) {
  process.stderr.write('Ein Bild der Seite gibt es nur zusammen mit genau einer Ausgabe (de oder en).\n');
  process.exit(1);
}

async function build(browser, { source, target }) {
  {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(source).href);
    await page.evaluate(() => document.fonts.ready);

    const check = await page.evaluate(() => {
      const sheet = document.querySelector('.page');
      const spacer = document.querySelector('.spacer');
      return {
        overflow: sheet.scrollHeight - sheet.clientHeight,
        slack: Math.round(spacer.getBoundingClientRect().height),
        font: document.fonts.check('10pt "JetBrains Mono"'),
      };
    });
    if (!check.font) throw new Error('JetBrains Mono wurde nicht geladen (docs/onepager/fonts).');
    if (check.overflow > 0 || check.slack <= 0) {
      throw new Error(`Inhalt passt nicht auf eine Seite (Überlauf ${check.overflow}px, freier Raum ${check.slack}px).`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.pdf({ path: target, format: 'A4', printBackground: true, preferCSSPageSize: true });
    if (preview) await page.screenshot({ path: preview, fullPage: true });
    process.stdout.write(`geschrieben: ${target} (freier Raum ${check.slack}px)\n`);
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const key of editions) await build(browser, EDITIONS[key]);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
