/**
 * Erzeugt zwei Blätter zum Ausdrucken, in der Schrift der übrigen Unterlagen:
 *
 *   node docs/ablauf/build.cjs              beide
 *   node docs/ablauf/build.cjs ablauf       deliverables/Sicht-Vorfuehrung-Ablauf.pdf aus docs/DEMO.md
 *   node docs/ablauf/build.cjs leitfaden    deliverables/Sicht-Gespraechsleitfaden.pdf aus
 *                                           docs/vertrieb/GESPRAECHSLEITFADEN.md
 *
 * Braucht Playwright mit Chromium. Die Umsetzung von Markdown ist auf das beschränkt, was die
 * beiden Vorlagen verwenden: Überschriften in drei Stufen, Absätze, Listen, Tabellen,
 * Befehlsblöcke.
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const deliverables = path.resolve(__dirname, '..', '..', 'deliverables');
const SHEETS = {
  ablauf: {
    source: path.resolve(__dirname, '..', 'DEMO.md'),
    target: path.join(deliverables, 'Sicht-Vorfuehrung-Ablauf.pdf'),
    title: 'Sicht — Ablauf der Vorführung',
    label: 'Ablauf der Vorführung · zum Ausdrucken',
    foot: 'SICHT · Erprobungsstand · Übungsmaterial',
  },
  leitfaden: {
    source: path.resolve(__dirname, '..', 'vertrieb', 'GESPRAECHSLEITFADEN.md'),
    target: path.join(deliverables, 'Sicht-Gespraechsleitfaden.pdf'),
    title: 'Sicht — Gesprächsleitfaden',
    label: 'Gesprächsleitfaden · zum Ausdrucken',
    foot: 'SICHT · Erprobungsstand · Vorlage',
  },
};
const wanted = process.argv.slice(2);
for (const name of wanted) {
  if (!(name in SHEETS)) {
    process.stderr.write(`Unbekanntes Blatt „${name}“. Möglich: ${Object.keys(SHEETS).join(', ')}.\n`);
    process.exit(1);
  }
}
const sheets = wanted.length > 0 ? wanted : Object.keys(SHEETS);
const fonts = pathToFileURL(path.resolve(__dirname, '..', 'onepager', 'fonts')).href;

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markup: code, bold, links (the text is kept, the address dropped: this is for paper). */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/&lt;(https?:[^&]+)&gt;/g, '$1');
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function convert(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (line.startsWith('```')) {
      // Consecutive command blocks are printed as one list of commands.
      const commands = [];
      while (i < lines.length && lines[i].startsWith('```')) {
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) commands.push(lines[i++]);
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
      }
      out.push(`<pre>${commands.map(esc).join('\n')}</pre>`);
      continue;
    }
    if (line.startsWith('# ')) { out.push(`<h1>${inline(line.slice(2))}</h1>`); i++; continue; }
    if (line.startsWith('## ')) { out.push(`<h2>${inline(line.slice(3))}</h2>`); i++; continue; }
    if (line.startsWith('### ')) { out.push(`<h3>${inline(line.slice(4))}</h3>`); i++; continue; }
    if (line.startsWith('|')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      const kind = head[0] === 'Min.' ? ' class="run"' : '';
      out.push(
        `<table${kind}><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    const bullet = /^(-|\d+\.)\s+/;
    if (bullet.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && (bullet.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (bullet.test(lines[i])) items.push(lines[i].replace(bullet, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||```|-\s|\d+\.\s)/.test(lines[i])) paragraph.push(lines[i++].trim());
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

const page = (sheet) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${esc(sheet.title)}</title>
<style>
  @font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url("${fonts}/JetBrainsMono-Regular.woff2") format("woff2"); }
  @font-face { font-family: "JetBrains Mono"; font-weight: 500; src: url("${fonts}/JetBrainsMono-Medium.woff2") format("woff2"); }
  @font-face { font-family: "JetBrains Mono"; font-weight: 700; src: url("${fonts}/JetBrainsMono-Bold.woff2") format("woff2"); }
  @page { size: A4; margin: 15mm 14mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 7.6pt; line-height: 1.5; color: #050505; font-variant-ligatures: none; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.5pt solid #050505; padding-bottom: 2.4mm; margin-bottom: 5mm; }
  .wordmark { font-size: 11pt; font-weight: 700; letter-spacing: 0.42em; }
  .label { font-size: 6.2pt; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: #555; }
  h1 { font-size: 15pt; font-weight: 700; line-height: 1.2; margin-bottom: 3mm; }
  h2 { font-size: 6.6pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; border-bottom: 0.5pt solid #050505; padding-bottom: 1.4mm; margin: 6.5mm 0 2.6mm; break-after: avoid; }
  h3 { font-size: 7.6pt; font-weight: 700; margin: 4.2mm 0 1.6mm; break-after: avoid; }
  p { margin-bottom: 2mm; max-width: 172mm; }
  pre { font: inherit; border-left: 0.7pt solid #050505; padding: 0.6mm 0 0.6mm 3mm; margin: 1mm 0 3mm; line-height: 1.7; break-inside: avoid; }
  code { font: inherit; font-weight: 500; }
  ul, ol { margin: 0 0 2.4mm 0; padding-left: 5mm; max-width: 172mm; }
  li { margin-bottom: 0.9mm; }
  table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; }
  th { text-align: left; font-size: 6.2pt; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #555; padding: 0 2.5mm 1.2mm 0; border-bottom: 0.5pt solid #050505; }
  td { vertical-align: top; padding: 1.3mm 2.5mm 1.3mm 0; border-bottom: 0.35pt solid #9a9a9a; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  table.run td:nth-child(1) { width: 11mm; font-weight: 700; white-space: nowrap; }
  table.run td:nth-child(2) { width: 68mm; }
  table.run td:nth-child(3) { color: #333; }
</style></head>
<body>
<header><span class="wordmark">SICHT</span><span class="label">${esc(sheet.label)}</span></header>
${convert(fs.readFileSync(sheet.source, 'utf8'))}
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
   for (const name of sheets) {
    const sheet = SHEETS[name];
    const target = sheet.target;
    const tab = await browser.newPage();
    const temp = path.join(__dirname, `.${name}.html`);
    fs.writeFileSync(temp, page(sheet));
    await tab.goto(pathToFileURL(temp).href);
    await tab.evaluate(() => document.fonts.ready);
    const font = await tab.evaluate(() => document.fonts.check('8pt "JetBrains Mono"'));
    if (!font) throw new Error('JetBrains Mono wurde nicht geladen (docs/onepager/fonts).');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await tab.pdf({
      path: target,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-family:monospace;font-size:6pt;color:#555;padding:0 14mm;display:flex;justify-content:space-between;"><span>' + esc(sheet.foot) + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
    fs.rmSync(temp, { force: true });
    await tab.close();
    console.log(path.relative(process.cwd(), target));
   }
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
