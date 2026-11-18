/**
 * Erzeugt deliverables/Sicht-Spickkarte.pdf aus docs/ablauf/spickkarte.html: eine Seite für das
 * Pult, verdichtet aus docs/DEMO.md.
 *
 *   node docs/ablauf/spickkarte.cjs            schreibt das PDF
 *   node docs/ablauf/spickkarte.cjs bild.png   schreibt zusätzlich ein Bild der Seite
 *
 * Braucht Playwright mit Chromium. Bricht ab, wenn der Inhalt nicht auf eine A4-Seite passt oder
 * die Schrift nicht geladen wurde. Wer den Ablauf in docs/DEMO.md ändert, ändert ihn auch hier.
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const source = path.join(__dirname, 'spickkarte.html');
const target = path.resolve(__dirname, '..', '..', 'deliverables', 'Sicht-Spickkarte.pdf');
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
      const wide = [...document.querySelectorAll('td, li, p')].filter((el) => el.scrollWidth > el.clientWidth + 1).length;
      return {
        overflow: sheet.scrollHeight - sheet.clientHeight,
        slack: Math.round(spacer.getBoundingClientRect().height),
        wide,
        font: document.fonts.check('10pt "JetBrains Mono"'),
      };
    });
    if (!check.font) throw new Error('JetBrains Mono wurde nicht geladen (docs/onepager/fonts).');
    if (check.overflow > 0 || check.slack <= 0) {
      throw new Error(`Inhalt passt nicht auf eine Seite (Überlauf ${check.overflow}px, freier Raum ${check.slack}px).`);
    }
    if (check.wide > 0) throw new Error(`${check.wide} Zeilen ragen über ihre Spalte.`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.pdf({ path: target, format: 'A4', printBackground: true, preferCSSPageSize: true });
    if (preview) await page.screenshot({ path: preview, fullPage: true });
    process.stdout.write(`geschrieben: ${target} (freier Raum ${check.slack}px)\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
