/**
 * Erzeugt die Unterlagenmappe: die acht Unterlagen aus docs/ als druckfertige PDF-Dateien im
 * Erscheinungsbild von Sicht, zum Weitergeben ohne das Repository.
 *
 *   node docs/unterlagen/build.cjs                       alle acht
 *   node docs/unterlagen/build.cjs strategy faq          einzelne: strategy, compliance, faq, evaluation, brand,
 *                                                        architecture, security, bom
 *   node docs/unterlagen/build.cjs --stand "2. Dezember 2026"
 *   node docs/unterlagen/build.cjs brand --html          lässt die Zwischendatei docs/unterlagen/.brand.html liegen
 *   node docs/unterlagen/build.cjs --tabellen            nennt je Tabelle die gewählte Form und die Spaltenbreiten
 *
 * Braucht Playwright mit Chromium und die Schriftdateien in docs/onepager/fonts. Markdown wird
 * von markdown.cjs gelesen, in render.cjs gesetzt und hier gedruckt und geprüft:
 *
 *   vor dem Druck   keine Zelle und kein Absatz ragt über seinen Rand, keine Tabellenzeile im
 *                   Raster ist höher als eine Seite, keine Schrift ist kleiner als 6,5 pt
 *   nach dem Druck  (wenn pdftotext und pdfinfo vorhanden sind) jedes Wort der Vorlage steht im
 *                   PDF, jede Überschrift ebenso, jede Netzadresse in der Quellenliste; keine Seite
 *                   endet mit einer Überschrift oder einem Tabellenkopf; nur die eigene Schrift
 *                   ist eingebettet
 *
 * Schlägt eine Prüfung fehl, wird die Datei trotzdem geschrieben und der Befehl endet mit Fehler.
 * Ein »HINWEIS« ist kein Fehler: Ein Wort, das in einer schmalen Spalte ohne Trennstrich umbrochen
 * wurde, steht vollständig im PDF, liest sich aber schlecht.
 *
 * Die Prüfungen für Leser, Spaltenrechnung und Tabellenform: node --test docs/unterlagen/test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parse } = require('./markdown.cjs');
const { renderDocument, CONTENT, PAGE, TYPE } = require('./render.cjs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Das Modul »playwright« wurde nicht gefunden. Die Unterlagen werden mit Chromium gedruckt; ohne Playwright mit Chromium entstehen keine PDF-Dateien.');
  process.exit(1);
}

const repo = path.resolve(__dirname, '..', '..');
const outDir = path.join(repo, 'deliverables', 'unterlagen');
const fontsUrl = pathToFileURL(path.join(repo, 'docs', 'onepager', 'fonts')).href;

/** Kurzname, Vorlage, Zieldatei und Titel für Kopf und Fußzeile. */
const DOCUMENTS = {
  strategy: { source: 'docs/STRATEGY.md', target: 'Sicht-Strategie.pdf', title: 'Strategie' },
  compliance: { source: 'docs/COMPLIANCE.md', target: 'Sicht-Recht-und-Vorkehrungen.pdf', title: 'Recht und Vorkehrungen' },
  faq: { source: 'docs/FAQ.md', target: 'Sicht-Fragen-und-Antworten.pdf', title: 'Fragen und Antworten' },
  evaluation: { source: 'docs/EVALUATION.md', target: 'Sicht-Messbericht.pdf', title: 'Messbericht' },
  brand: { source: 'docs/BRAND.md', target: 'Sicht-Marke.pdf', title: 'Marke' },
  architecture: { source: 'docs/ARCHITEKTUR.md', target: 'Sicht-Architektur.pdf', title: 'Architektur' },
  security: { source: 'docs/SICHERHEIT.md', target: 'Sicht-Sicherheitsdurchsicht.pdf', title: 'Sicherheitsdurchsicht' },
  bom: { source: 'docs/STUECKLISTE.md', target: 'Sicht-Stueckliste.pdf', title: 'Stückliste' },
};
const DEFAULT_STAND = '18. November 2026';

// ---------------------------------------------------------------- vor dem Druck

/**
 * Läuft im Browser. Eine Tabellenzeile in der Form »saetze« bleibt auf einer Seite. Ist ein Satz
 * höher als eine Seite, geht das nicht: Er darf dann zwischen zwei Feldern auf die nächste Seite
 * laufen (ein Feld wird nie geteilt). Liefert die Zahl solcher Sätze.
 */
function releaseTallRecordsInPage(limitMm) {
  const limit = (limitMm * 96) / 25.4;
  let released = 0;
  for (const el of document.querySelectorAll('.satz')) {
    if (el.getBoundingClientRect().height <= limit) continue;
    el.classList.add('lang');
    released++;
  }
  return released;
}

/** Läuft im Browser. Maße in Millimetern kommen von außen. */
function auditInPage(limits) {
  const px = (mm) => (mm * 96) / 25.4;
  const problems = [];
  const label = (el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} „${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)}“`;
  const inQuer = (el) => el.closest('.quer') !== null;

  for (const el of document.querySelectorAll('th, td, dt, dd, p, li, pre, h1, h2, h3, h4, blockquote')) {
    if (el.scrollWidth > el.clientWidth + 1) problems.push(`ragt über den Rand: ${label(el)}`);
  }
  for (const el of document.querySelectorAll('table.raster, .saetze, .liste, p, pre, h2, h3, h4, blockquote, .kopf, .titel')) {
    const limit = px(inQuer(el) ? limits.quer : limits.hoch);
    const rect = el.getBoundingClientRect();
    const left = (el.closest('.quer') ?? document.body).getBoundingClientRect().left;
    if (rect.right - left > limit + 1) problems.push(`breiter als die Seite: ${label(el)}`);
  }
  for (const el of document.querySelectorAll('table.raster tr, .satz:not(.lang), .satz .feld, .zusammen, .liste li, pre, blockquote, .quellen li')) {
    const limit = px(inQuer(el) ? limits.querHeight : limits.hochHeight) * 0.92;
    if (el.getBoundingClientRect().height > limit) problems.push(`höher als eine Seite: ${label(el)}`);
  }
  const floor = (6.5 * 96) / 72 - 0.02;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const small = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent.trim() === '' || !node.parentElement) continue;
    if (Number.parseFloat(getComputedStyle(node.parentElement).fontSize) < floor) small.add(label(node.parentElement));
  }
  for (const item of small) problems.push(`Schrift unter 6,5 pt: ${item}`);
  return problems;
}

/**
 * Was der Leser nicht kennt, erscheint im PDF als gewöhnlicher Text. Die Unterlagen kommen
 * ohne Bilder, Verweise mit Kennung und HTML aus; kommt so etwas hinzu, wird darauf hingewiesen.
 */
function unsupported(markdown) {
  const found = new Map();
  let fenced = false;
  markdown.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const text = line.replace(/`[^`]*`/g, '');
    const hit = (what) => {
      if (!found.has(what)) found.set(what, i + 1);
    };
    if (/!\[[^\]]*\]\(/.test(text)) hit('Ein Bild');
    if (/\]\[[^\]]*\]/.test(text) || /^\s{0,3}\[[^\]^]+\]:\s+\S/.test(text)) hit('Ein Verweis mit Kennung');
    if (/<\/?[a-zA-Z][^>]*>/.test(text.replace(/<(https?|mailto):[^>]+>/g, ''))) hit('HTML');
  });
  return [...found].map(([what, line]) => `${what} (zuerst in Zeile ${line}) wird nicht umgesetzt und erscheint als Text`);
}

// ---------------------------------------------------------------- Prüfung nach dem Druck

function tool(name, args) {
  return execFileSync(name, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasTools() {
  try {
    tool('pdftotext', ['-v']);
    tool('pdfinfo', ['-v']);
    return true;
  } catch (err) {
    // Beide schreiben ihre Version auf die Fehlerausgabe und enden teils mit Fehler; vorhanden sind sie dann trotzdem.
    return err.code !== 'ENOENT';
  }
}

const norm = (text) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function counts(words) {
  const map = new Map();
  for (const word of words) map.set(word, (map.get(word) ?? 0) + 1);
  return map;
}

/** Die Wörter der Vorlage, grob und ohne den eigenen Leser gewonnen: eine unabhängige Gegenprobe. */
function expectedWords(markdown) {
  let text = markdown.replace(/\r/g, '');
  text = text
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && !/^\s*(```|~~~)/.test(line))
    .join('\n');
  text = text.replace(/\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))*)\)/g, '$1');
  // Die Kennung einer Anmerkung ([^a]) steht nicht im PDF; dort steht ihre Ziffer.
  text = text.replace(/\[\^[^\]\s]+\]:?/g, ' ');
  return norm(text).split(' ').filter(Boolean);
}

function verifyPdf(file, markdown, rendered, meta) {
  const problems = [];
  const notes = [];
  const info = tool('pdfinfo', ['-f', '1', '-l', '999', file]);
  const sizes = [...info.matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/g)].map((m) => ({ page: Number(m[1]), w: Number(m[2]), h: Number(m[3]) }));
  const pages = sizes.length;
  const landscape = sizes.filter((s) => s.w > s.h).length;
  for (const s of sizes) {
    const [short, long] = [Math.min(s.w, s.h), Math.max(s.w, s.h)];
    if (Math.abs(short - 595) > 2 || Math.abs(long - 842) > 2) problems.push(`Seite ${s.page} ist nicht A4 (${s.w} x ${s.h} pt)`);
  }

  const footer = norm(`SICHT · ${meta.title}`);
  const tableLabels = new Set(rendered.tables.filter((t) => t.mode !== 'saetze').flatMap((t) => t.head.map(norm)).filter(Boolean));
  const bodies = [];
  for (let n = 1; n <= pages; n++) {
    const raw = tool('pdftotext', ['-raw', '-enc', 'UTF-8', '-f', String(n), '-l', String(n), file, '-']).replace(/\f/g, '');
    const lines = raw.split('\n').filter((line) => norm(line) !== '');
    // Fußzeile und Seitenzahl stehen im Textstrom am Rand der Seite; nur dort werden sie entfernt.
    const marginal = (line) => [footer, `${n} ${pages}`, `${footer} ${n} ${pages}`, `${n} ${pages} ${footer}`].includes(norm(line));
    while (lines.length > 0 && marginal(lines[lines.length - 1])) lines.pop();
    while (lines.length > 0 && marginal(lines[0])) lines.shift();
    bodies.push(lines.join('\n'));
    if (n < pages) {
      const orphan = lastLineProblem(file, n);
      if (orphan) problems.push(`Seite ${n} endet mit ${orphan}`);
    }
  }

  /**
   * Was als Letztes auf einer Seite steht, darf weder Überschrift noch Tabellenkopf sein. Die
   * Schriftgröße einer Zeile ergibt sich aus ihrer Höhe im PDF; geeicht wird an der Fußzeile.
   */
  function lastLineProblem(pdf, n) {
    const xml = tool('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', '-f', String(n), '-l', String(n), pdf, '-']);
    const pageHeight = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(xml)?.[1] ?? 842);
    const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const all = [...xml.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)].map((m) => ({
      top: Number(m[2]),
      height: Number(m[4]) - Number(m[2]),
      text: [...m[5].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) => decode(w[1])).join(' '),
    }));
    const edge = pageHeight - (PAGE.margin.bottom / 25.4) * 72;
    const marginLines = all.filter((l) => l.top > edge);
    const content = all.filter((l) => l.top <= edge);
    if (content.length === 0) return null;
    // Höhe einer Zeile je Punkt Schriftgröße: aus der Fußzeile (6,5 pt), sonst der Wert der Schrift.
    const perPoint = marginLines.length > 0 ? marginLines[0].height / 6.5 : 1.3192;
    const lowest = Math.max(...content.map((l) => l.top));
    const last = content.filter((l) => l.top > lowest - 1.5);
    const near = (size, target) => Math.abs(size - target) < 0.12;
    for (const line of last) {
      const size = line.height / perPoint;
      const upper = line.text === line.text.toUpperCase() && /\p{L}/u.test(line.text);
      if (near(size, TYPE.h2) || near(size, TYPE.h3) || (near(size, TYPE.h4) && upper)) return `der Überschrift „${line.text}“`;
      if (near(size, TYPE.label) && upper && tableLabels.has(norm(line.text))) return `einem Tabellenkopf („${line.text}“)`;
    }
    return null;
  }

  // Getrennte Wörter wieder zusammensetzen: Der Browser setzt beim Trennen U+2010 ans Zeilenende.
  const text = bodies.join('\n').replace(/[\u2010\u00ad]\n/g, '').replace(/\u00ad/g, '');
  const actual = counts(norm(text).split(' ').filter(Boolean));
  const expected = counts(expectedWords(markdown));
  // Was der Titel vorn verliert (»Sicht —«), steht als Wortmarke darüber.
  for (const word of norm(rendered.titlePrefix).split(' ').filter(Boolean)) actual.set(word, (actual.get(word) ?? 0) + 1);
  // Ein Wort, das ohne Trennstrich über ein Zeilenende läuft (die Spalte ist schmaler als ein
  // untrennbares Stück), steht in zwei Teilen im Textstrom. Es fehlt nicht; es wird gemeldet.
  const bridged = new Map();
  for (const body of bodies) {
    const lines = body.split('\n');
    for (let i = 0; i + 1 < lines.length; i++) {
      const before = lines[i].trim().split(/\s+/).pop() ?? '';
      const after = lines[i + 1].trim().split(/\s+/)[0] ?? '';
      if (before === '' || after === '' || /[\u2010\u00ad]$/.test(before)) continue;
      const parts = new Set([...norm(before).split(' '), ...norm(after).split(' ')]);
      for (const word of norm(before + after).split(' ')) {
        if (word !== '' && !parts.has(word)) bridged.set(word, (bridged.get(word) ?? 0) + 1);
      }
    }
  }
  const missing = [];
  const broken = [];
  for (const [word, count] of expected) {
    const found = actual.get(word) ?? 0;
    if (found >= count) continue;
    if (found + (bridged.get(word) ?? 0) >= count) broken.push(word);
    else missing.push(`${word} (${found} von ${count})`);
  }
  if (missing.length > 0) problems.push(`Wörter der Vorlage fehlen im PDF: ${missing.slice(0, 25).join(', ')}${missing.length > 25 ? ` … und ${missing.length - 25} weitere` : ''}`);
  if (broken.length > 0) notes.push(`ohne Trennstrich umbrochen (Spalte schmaler als das Wort): ${broken.slice(0, 25).join(', ')}`);

  const flat = norm(text);
  for (const heading of rendered.headings) {
    if (!flat.includes(norm(heading.text))) problems.push(`Überschrift fehlt im PDF: „${heading.text}“`);
  }
  const packed = text.replace(/\s+/g, '');
  for (const source of rendered.sources) {
    if (!packed.includes(source.href.replace(/\s+/g, ''))) problems.push(`Adresse fehlt in der Quellenliste: ${source.href}`);
  }

  let fonts = [];
  try {
    fonts = tool('pdffonts', [file])
      .split('\n')
      .slice(2)
      .filter((line) => line.trim() !== '')
      .map((line) => ({ name: line.slice(0, 36).trim(), embedded: /\byes\b/.test(line.slice(36)) }));
    for (const font of fonts) {
      if (!/JetBrainsMono/i.test(font.name)) problems.push(`fremde Schrift im PDF: ${font.name} (ein Zeichen fehlt in JetBrains Mono)`);
      if (!font.embedded) problems.push(`Schrift nicht eingebettet: ${font.name}`);
    }
  } catch {
    // pdffonts fehlt: Die Schriftprüfung entfällt.
  }
  return { pages, landscape, problems, notes };
}

// ---------------------------------------------------------------- Ablauf

async function buildOne(browser, key, options) {
  const meta = { ...DOCUMENTS[key], stand: options.stand };
  const markdown = fs.readFileSync(path.resolve(repo, meta.source), 'utf8');
  const rendered = renderDocument(parse(markdown), meta, fontsUrl);

  const temp = path.join(__dirname, `.${key}.html`);
  fs.writeFileSync(temp, rendered.html);
  const target = path.join(options.outDir ?? outDir, meta.target);
  const problems = [];
  let tallRecords = 0;
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(temp).href);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => ['400', '500', '700'].every((weight) => document.fonts.check(`${weight} 8pt "JetBrains Mono"`)));
    if (!loaded) throw new Error('JetBrains Mono wurde nicht geladen (docs/onepager/fonts).');
    tallRecords = await page.evaluate(releaseTallRecordsInPage, CONTENT.hochHeight * 0.9);
    problems.push(...(await page.evaluate(auditInPage, { hoch: CONTENT.hoch, quer: CONTENT.quer, hochHeight: CONTENT.hochHeight, querHeight: CONTENT.querHeight })));
    // Mit Lesezeichen aus den Überschriften und mit Strukturangaben (für Vorleseprogramme).
    await page.pdf({ path: target, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
  } finally {
    await page.close();
    if (!options.keepHtml) fs.rmSync(temp, { force: true });
  }

  let pages = null;
  let landscape = 0;
  const notes = unsupported(markdown);
  if (tallRecords > 0) notes.push(`${tallRecords} Tabellenzeile(n) in der Form »saetze« höher als eine Seite: zwischen zwei Feldern umbrochen`);
  if (options.verify) {
    const result = verifyPdf(target, markdown, rendered, meta);
    pages = result.pages;
    landscape = result.landscape;
    problems.push(...result.problems);
    notes.push(...result.notes);
  }
  const modes = {};
  for (const table of rendered.tables) modes[table.mode] = (modes[table.mode] ?? 0) + 1;
  return { key, meta, pages, landscape, tables: rendered.tables, modes, sources: rendered.sources.length, problems, notes };
}

async function main() {
  const args = process.argv.slice(2);
  const options = { stand: DEFAULT_STAND, keepHtml: false, verify: hasTools(), tables: false };
  const keys = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stand') options.stand = args[++i] ?? DEFAULT_STAND;
    else if (arg === '--html') options.keepHtml = true;
    else if (arg === '--tabellen') options.tables = true;
    else if (DOCUMENTS[arg.toLowerCase()]) keys.push(arg.toLowerCase());
    else throw new Error(`Unbekannte Unterlage „${arg}“. Möglich: ${Object.keys(DOCUMENTS).join(', ')}.`);
  }
  const selected = keys.length > 0 ? keys : Object.keys(DOCUMENTS);
  fs.mkdirSync(outDir, { recursive: true });
  if (!options.verify) console.log('Hinweis: pdftotext/pdfinfo fehlen; die Prüfung nach dem Druck entfällt.');

  // Ein Browser, ein Dokument nach dem anderen.
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const key of selected) {
      const result = await buildOne(browser, key, options);
      const modes = Object.entries(result.modes).map(([mode, count]) => `${count} ${mode}`).join(', ');
      console.log(
        `${path.relative(process.cwd(), path.join(outDir, result.meta.target))}: ${result.pages ?? '?'} Seiten${
          result.landscape > 0 ? `, davon ${result.landscape} quer` : ''
        } · Tabellen: ${modes || 'keine'} · Quellen: ${result.sources}`,
      );
      if (options.tables) {
        for (const table of result.tables) {
          console.log(`    Zeile ${String(table.line).padStart(3)}  ${table.mode.padEnd(12)} ${table.columns} Spalten, ${table.rows} Zeilen${table.tallest > 1 ? `, höchste Zelle ${table.tallest} Zeilen` : ''}${table.widths ? `, Spaltenbreiten ${table.widths.join('/')}` : ''}  [${table.head.join(' | ').slice(0, 70)}]`);
        }
      }
      for (const problem of result.problems) console.log(`    PRÜFUNG: ${problem}`);
      for (const note of result.notes) console.log(`    HINWEIS: ${note}`);
      if (result.problems.length > 0) failed++;
    }
  } finally {
    await browser.close();
  }
  if (failed > 0) {
    console.error(`${failed} Unterlage(n) mit offenen Prüfpunkten.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { DOCUMENTS, buildOne, verifyPdf, hasTools };
