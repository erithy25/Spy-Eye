/**
 * Erzeugt deliverables/Sicht-Einseiter.pdf aus einseiter.html.
 *
 *   node docs/onepager/build.cjs
 *
 * Braucht Playwright mit Chromium. Bricht ab, wenn der Inhalt nicht auf eine A4-Seite passt
 * oder die Schrift nicht geladen wurde.
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const source = path.join(__dirname, 'einseiter.html');
const target = path.resolve(__dirname, '..', '..', 'deliverables', 'Sicht-Einseiter.pdf');
const preview = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  try {
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
  } finally {
    await browser.close();
  }
})().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
