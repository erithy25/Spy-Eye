/**
 * Erzeugt die Spickkarte für das Pult, deutsch und englisch, verdichtet aus docs/DEMO.md:
 *
 *   node docs/ablauf/spickkarte.cjs              beide Ausgaben
 *   node docs/ablauf/spickkarte.cjs de           nur deliverables/Sicht-Spickkarte.pdf (aus spickkarte.html)
 *   node docs/ablauf/spickkarte.cjs en           nur deliverables/Sicht-Cue-Card-EN.pdf (aus cue-card-en.html)
 *   node docs/ablauf/spickkarte.cjs de bild.png  schreibt zusätzlich ein Bild der Seite
 *
 * Braucht Playwright mit Chromium. Bricht ab, wenn der Inhalt nicht auf eine A4-Seite passt oder
 * die Schrift nicht geladen wurde. Wer den Ablauf in docs/DEMO.md ändert, ändert ihn auch in
 * beiden Karten; die englische nennt die Beschriftungen der englischen Konsole.
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const deliverables = path.resolve(__dirname, '..', '..', 'deliverables');
const EDITIONS = {
  de: { source: path.join(__dirname, 'spickkarte.html'), target: path.join(deliverables, 'Sicht-Spickkarte.pdf') },
  en: { source: path.join(__dirname, 'cue-card-en.html'), target: path.join(deliverables, 'Sicht-Cue-Card-EN.pdf') },
};
const args = process.argv.slice(2);
const wanted = args.filter((arg) => arg in EDITIONS);
const preview = args.find((arg) => !(arg in EDITIONS));
const editions = wanted.length > 0 ? wanted : Object.keys(EDITIONS);
if (preview && editions.length !== 1) {
  process.stderr.write('Ein Bild der Seite gibt es nur zusammen mit genau einer Ausgabe (de oder en).\n');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  try {
   for (const edition of editions) {
    const { source, target } = EDITIONS[edition];
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
    await page.close();
   }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
