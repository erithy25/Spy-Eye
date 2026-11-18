/**
 * Prüfungen für den Leser (markdown.cjs), die Spaltenrechnung (layout.cjs) und die Wahl der
 * Tabellenform (render.cjs).
 *
 *   node --test docs/unterlagen/test.cjs
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, parseInline, plain, splitRow } = require('./markdown.cjs');
const { allocate, linesAt } = require('./layout.cjs');
const { renderDocument } = require('./render.cjs');

const types = (blocks) => blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type));

test('Überschriften, Absätze und Trennlinien', () => {
  const doc = parse('# Titel\n\nErster Absatz,\nzweite Zeile.\n\n## Abschnitt ##\n\n---\n\n#### Vierte Ebene\nText direkt danach.\n');
  assert.deepEqual(types(doc.blocks), ['h1', 'paragraph', 'h2', 'rule', 'h4', 'paragraph']);
  assert.equal(plain(doc.blocks[1].inline), 'Erster Absatz, zweite Zeile.');
  assert.equal(plain(doc.blocks[2].inline), 'Abschnitt');
});

test('Auszeichnung im Text', () => {
  const nodes = parseInline('**fett** und *kursiv*, `a*b` bleibt, snake_case_wort auch, 2 * 3 * 4 ebenso.');
  assert.deepEqual(nodes.map((n) => n.type), ['strong', 'text', 'em', 'text', 'code', 'text']);
  assert.equal(nodes[4].value, 'a*b');
  assert.equal(plain(nodes), 'fett und kursiv, a*b bleibt, snake_case_wort auch, 2 * 3 * 4 ebenso.');
});

test('Verweise: Klammern in der Adresse, Befehl im Text, Adresse in spitzen Klammern', () => {
  const nodes = parseInline('Siehe [den `Bericht` (2024)](https://example.org/a_(b)/c?x=1&y=2) und <https://example.org/z>.');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.href, 'https://example.org/a_(b)/c?x=1&y=2');
  assert.equal(plain(link.children), 'den Bericht (2024)');
  assert.equal(nodes.find((n) => n.type === 'autolink').href, 'https://example.org/z');
});

test('Listen: gezählt mit Startwert, verschachtelt, mit Folgezeilen und Leerzeilen zwischen Punkten', () => {
  const doc = parse(
    ['3. Erster Punkt', '   über zwei Zeilen.', '4. Zweiter Punkt', '   - innen eins', '   - innen zwei', '     mit Folgezeile', '', '5. Dritter Punkt', '', 'Danach ein Absatz.'].join('\n'),
  );
  assert.deepEqual(types(doc.blocks), ['list', 'paragraph']);
  const list = doc.blocks[0];
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 3);
  assert.equal(plain(list.items[0].blocks[0].inline), 'Erster Punkt über zwei Zeilen.');
  const inner = list.items[1].blocks[1];
  assert.equal(inner.type, 'list');
  assert.equal(inner.ordered, false);
  assert.equal(plain(inner.items[1].blocks[0].inline), 'innen zwei mit Folgezeile');
});

test('Zitat und Befehlsblock', () => {
  const doc = parse('> **Leitsatz.** Zweiter Satz\n> über zwei Zeilen.\n\n```bash\npnpm test\n# kein Titel\n| keine | Tabelle |\n```\n\nSchluss.');
  assert.deepEqual(types(doc.blocks), ['quote', 'code', 'paragraph']);
  assert.equal(plain(doc.blocks[0].blocks[0].inline), 'Leitsatz. Zweiter Satz über zwei Zeilen.');
  assert.equal(doc.blocks[1].lang, 'bash');
  assert.equal(doc.blocks[1].text, 'pnpm test\n# kein Titel\n| keine | Tabelle |');
});

test('Tabellen: Striche in Befehlen und maskierte Striche trennen keine Zellen', () => {
  assert.deepEqual(splitRow('| `a | b` | x \\| y | z |'), ['`a | b`', 'x | y', 'z']);
  const doc = parse('Vorsatz:\n\n| Befehl | Zweck |\n| --- | ---: |\n| `--speed 1\\|2` | Uhr |\n| nur eine Zelle |\n\nDanach.');
  const table = doc.blocks[1];
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, ['left', 'right']);
  assert.equal(table.rows.length, 2);
  assert.equal(plain(table.rows[0][0]), '--speed 1|2');
  assert.equal(table.rows[1].length, 2);
  assert.equal(plain(table.rows[1][1]), '');
});

test('Fußnoten werden gesammelt und stehen nicht im Text', () => {
  const doc = parse('Aussage[^a] und weiter.\n\n[^a]: Die Quelle,\n    zweite Zeile.\n');
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].inline.find((n) => n.type === 'footref').id, 'a');
  assert.equal(plain(doc.notes.get('a')), 'Die Quelle, zweite Zeile.');
});

test('Spaltenrechnung: Zeilenzahl und Verteilung', () => {
  const words = (text) => text.split(' ').map((w, i) => ({ len: w.length, space: i > 0 }));
  assert.equal(linesAt(words('eins zwei drei vier'), 9), 2);
  assert.equal(linesAt(words('eins zwei drei vier'), 4), 4);
  const head = [words('Kurz'), words('Lang')];
  const rows = [[words('ja'), words('ein langer Text der über mehrere Zeilen laufen muss weil die Spalte schmal ist')]];
  const fits = allocate(head, rows, 200);
  assert.equal(fits.natural, true);
  const tight = allocate(head, rows, 40);
  assert.equal(tight.natural, false);
  assert.equal(tight.widths.reduce((a, b) => a + b, 0) <= 40, true);
  // Die kurze Spalte bekommt nicht mehr als sie braucht, der Rest geht an den Text.
  assert.equal(tight.widths[0], 4);
  assert.equal(allocate(head, rows, 6), null);
});

test('Tabellenform: schmal bleibt Raster, lange Texte in vielen Spalten werden zu Sätzen', () => {
  const long = 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat. '.repeat(3);
  const md = [
    '# Sicht — Probe',
    '',
    '| Größe | Wert |',
    '| --- | --- |',
    '| Ereignisse | 13 von 13 |',
    '',
    '| Nr. | A | B | C | D | E |',
    '| --- | --- | --- | --- | --- | --- |',
    `| 1 | ${long} | ${long} | ${long} | ${long} | [Quelle](https://example.org/q) |`,
  ].join('\n');
  const out = renderDocument(parse(md), { title: 'Probe', source: 'docs/PROBE.md', stand: '1. Januar 2027' }, 'file:///fonts');
  assert.equal(out.title, 'Probe');
  assert.deepEqual(out.tables.map((t) => t.mode), ['raster', 'saetze']);
  assert.deepEqual(out.sources, [{ href: 'https://example.org/q', title: 'Quelle' }]);
  assert.match(out.html, /Stand: 1\. Januar 2027 · Erprobungsstand/);
  assert.match(out.html, /<a href="https:\/\/example\.org\/q">Quelle<\/a>&nbsp;<span class="ref">\[1\]<\/span>/);
});

test('Umbruchstellen in Zellen: nach Schrägstrich zwischen Wörtern, nicht in Angaben', () => {
  const md = [
    '| Quelle | Angabe |',
    '| --- | --- |',
    `| onnx-community/siglip2-base-patch32-256-ONNX und docs/EVALUATION.md | BT-Drs. 21/7120, 1 Bild/s, \`intel/guard.ts\` ${'und weiter '.repeat(30)} |`,
    '',
    'Im Absatz bleibt docs/EVALUATION.md ohne eigene Umbruchstelle.',
  ].join('\n');
  const out = renderDocument(parse(md), { title: 'Probe', source: 'docs/PROBE.md', stand: '1. Januar 2027' }, 'file:///fonts');
  assert.match(out.html, /onnx-community\/<wbr>siglip2-base-patch32-256-ONNX und docs\/<wbr>EVALUATION\.md/);
  assert.match(out.html, /BT-Drs\. 21\/7120, 1 Bild\/s, <code><span class="fest">intel\/guard\.ts<\/span><\/code>/);
  assert.match(out.html, /<p>Im Absatz bleibt docs\/EVALUATION\.md ohne/);
});

test('Querformat: breite Tabelle mit kurzen Zellen, Überschrift und Vorsatz gehen mit auf die Seite', () => {
  const head = ['Nr.', 'Knoten', 'Kreis', 'Quellen', 'Aufnahmen', 'Ereignisse', 'Meldungen', 'Fehlmeldungen', 'Verzug', 'Beginn', 'Stand', 'Bemerkung'];
  const row = (i) => [i, `Knoten Rhein-Lahn-Kreis ${i}`, 'Rhein-Lahn-Kreis', 11, 300 + i, '13 von 13', 15, 1, '1,1 s', 'T+01:20', 'in Vorbereitung', 'Übung RHEIN-MOSEL, Lauf 2'];
  const md = [
    '# Sicht — Probe',
    '',
    'Einleitung.',
    '',
    '---',
    '',
    '## Knoten',
    '',
    'Der Stand aller Knoten:',
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...[1, 2, 3].map((i) => `| ${row(i).join(' | ')} |`),
    '',
    'Danach wieder im Hochformat.',
  ].join('\n');
  const out = renderDocument(parse(md), { title: 'Probe', source: 'docs/PROBE.md', stand: '1. Januar 2027' }, 'file:///fonts');
  assert.deepEqual(out.tables.map((t) => t.mode), ['quer']);
  const quer = /<div class="quer">([\s\S]*?)<\/div>/.exec(out.html);
  assert.ok(quer, 'die Tabelle steht in einem Abschnitt im Querformat');
  assert.match(quer[1], /<h2>Knoten<\/h2>\s*<p class="vorsatz">Der Stand aller Knoten:<\/p>\s*<table class="raster/);
  assert.doesNotMatch(out.html, /<hr>/, 'die Trennlinie vor der Überschrift entfällt, die Überschrift trägt selbst eine');
  assert.match(out.html, /<\/div>\s*<p>Danach wieder im Hochformat\.<\/p>/);
});

test('Anmerkungen und ausgeschriebene Adressen', () => {
  const md = 'Aussage[^q] und <https://example.org/pfad/zur-quelle?a=1>.\n\n[^q]: Die Anmerkung mit [Verweis](https://example.org/x).\n';
  const out = renderDocument(parse(md), { title: 'Probe', source: 'docs/PROBE.md', stand: '1. Januar 2027' }, 'file:///fonts');
  assert.match(out.html, /Aussage&nbsp;<span class="ref">\(1\)<\/span>/);
  assert.match(out.html, /<h2>Anmerkungen<\/h2>/);
  assert.match(out.html, /<a class="url" href="https:\/\/example\.org\/pfad\/zur-quelle\?a=1">/);
  assert.deepEqual(out.sources.map((s) => s.href), ['https://example.org/x']);
});
