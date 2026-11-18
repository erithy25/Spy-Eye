/**
 * Darstellung der Unterlagen: Aus dem Baum, den markdown.cjs liefert, wird ein HTML-Dokument im
 * Erscheinungsbild von Sicht (eine Schrift, Haarlinien, gesperrte Versalien für Beschriftungen,
 * weißes Papier). Gedruckt wird es von build.cjs.
 *
 * Tabellen bekommen je nach Inhalt eine von vier Formen (siehe planTable):
 *   raster      Hochformat, Tabellenschrift 7,4 pt
 *   raster klein  Hochformat, 6,6 pt
 *   quer        eigene Seite im Querformat, für breite Tabellen mit kurzen Zellen
 *   saetze      jede Zeile als Satz untereinander (Beschriftung links, Inhalt rechts), für
 *               Tabellen mit langen Textzellen, die als Raster zu schmale Spalten bekämen
 *
 * Verweise ins Netz behalten ihren Text und bekommen eine Ziffer in eckigen Klammern; die
 * Adressen stehen nummeriert am Ende des Dokuments unter „Quellen“.
 */
const { plain } = require('./markdown.cjs');
const { allocate, naturalWidth, linesAt } = require('./layout.cjs');

// ---------------------------------------------------------------- Maße

const PT_MM = 25.4 / 72;
/** Dickte der Schrift in Geviert (JetBrains Mono: jedes Zeichen 0,6). */
const ADVANCE = 0.6;
const PAGE = {
  hoch: { width: 210, height: 297 },
  quer: { width: 297, height: 210 },
  margin: { top: 15, side: 14, bottom: 17 },
};
const CONTENT = {
  hoch: PAGE.hoch.width - 2 * PAGE.margin.side,
  quer: PAGE.quer.width - 2 * PAGE.margin.side,
  hochHeight: PAGE.hoch.height - PAGE.margin.top - PAGE.margin.bottom,
  querHeight: PAGE.quer.height - PAGE.margin.top - PAGE.margin.bottom,
};
const TYPE = {
  body: 8,
  /** Überschriften: Ihre Größen kommen sonst nirgends vor; daran erkennt die Prüfung sie im PDF. */
  h2: 11,
  h3: 9,
  h4: 6.8,
  /** Breite der Textspalte für Absätze und Listen: rund 94 Zeichen. */
  measure: 160,
  table: { normal: 7.4, klein: 6.6 },
  tableLine: 1.45,
  label: 6.6,
  /** Sperrung der Versalien in Geviert. */
  tracking: 0.12,
  ref: 6.5,
};
/** Abstand zwischen zwei Tabellenspalten, in Zeichen der Tabellenschrift. */
const GAP = 2;

/**
 * Wann ein Raster noch lesbar ist: Keine Zelle hat mehr als `gridLines` Zeilen, und keine Spalte
 * ist zugleich schmal und hoch (unter `narrow` Zeichen mit mehr als `narrowLines` Zeilen, unter
 * `slim` Zeichen mit mehr als `slimLines`). Das Querformat ist für breite Tabellen mit kurzen
 * Zellen da: höchstens `querLines` Zeilen je Zelle und keine Zelle über `querCell` Zeichen.
 * In der Form »saetze« wird die erste Spalte zur Kopfzeile des Satzes, wenn keine ihrer Zellen
 * länger als `titleCell` Zeichen ist.
 */
const LIMIT = { gridLines: 12, narrow: 26, narrowLines: 6, slim: 16, slimLines: 3, querLines: 6, querCell: 160, titleCell: 64 };

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mm = (value) => `${Math.round(value * 100) / 100}mm`;

// ---------------------------------------------------------------- Quellen

class Sources {
  constructor() {
    this.list = [];
    this.byHref = new Map();
  }

  /** Nummer einer Adresse; die erste Nennung bestimmt Reihenfolge und Bezeichnung. */
  number(href, title) {
    const known = this.byHref.get(href);
    if (known !== undefined) return known;
    this.list.push({ href, title });
    this.byHref.set(href, this.list.length);
    return this.list.length;
  }
}

// ---------------------------------------------------------------- im Text

/** Ab dieser Länge darf ein Pfad oder Befehlswort in sich umbrechen; kürzere bleiben ganz. */
const CODE_BREAK = 22;

/**
 * Wo ein Wort in einer Tabellenzelle ohne Leerzeichen umbrechen darf. Nach einem Bindestrich
 * bricht der Browser von selbst um, nach Schrägstrich und Unterstrich nicht; dort setzt
 * cellText eine Umbruchstelle, aber nur zwischen zwei Wörtern (»onnx-community/siglip2«,
 * »docs/EVALUATION.md«), nicht in Angaben wie »21/7120« oder »Bild/s«. Vermessung (atomsOf)
 * und Darstellung müssen dieselbe Regel verwenden, sonst rechnet die Spaltenverteilung mit
 * Umbrüchen, die es nicht gibt.
 */
const AFTER_SLASH = /(?<=[\p{L}\p{N}]{3}[/_])(?=\p{L}{3})/u;
const TEXT_BREAK = /(?<=[^-/_]-)(?=[^-/_])|(?<=[\p{L}\p{N}]{3}[/_])(?=\p{L}{3})/u;
const CODE_PIECES = /(?<=[-/_])(?=[^-/_])/;

function cellText(value) {
  return value.split(AFTER_SLASH).map(esc).join('<wbr>');
}

/** Befehle und Pfade: Kurze Wörter bleiben ungeteilt, lange dürfen nach Schrägstrich und Unterstrich umbrechen. */
function codeHtml(text) {
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (token === '' || /^\s+$/.test(token)) return token;
      if (token.length <= CODE_BREAK) return `<span class="fest">${esc(token)}</span>`;
      return esc(token).replace(/([/_])(?=[^\s/_])/g, '$1<wbr>');
    })
    .join('');
}

/** Eine Adresse darf nach ihren Trennzeichen umbrechen. */
function urlHtml(href) {
  return esc(href).replace(/(\/+|[-_=?]|&amp;|%[0-9A-Fa-f]{2})(?=[^\s/])/g, '$1<wbr>');
}

/** `cell`: Der Text steht in einer Tabellenzelle und bekommt deren Umbruchstellen (cellText). */
function inlineHtml(nodes, ctx, cell = false) {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += cell ? cellText(node.value) : esc(node.value);
        break;
      case 'code':
        out += `<code>${codeHtml(node.value)}</code>`;
        break;
      case 'strong':
        out += `<b>${inlineHtml(node.children, ctx, cell)}</b>`;
        break;
      case 'em':
        out += `<em>${inlineHtml(node.children, ctx, cell)}</em>`;
        break;
      case 'link': {
        const inner = inlineHtml(node.children, ctx, cell);
        if (/^(https?:|mailto:)/i.test(node.href)) {
          const n = ctx.sources.number(node.href, plain(node.children).trim());
          out += `<a href="${esc(node.href)}">${inner}</a>&nbsp;<span class="ref">[${n}]</span>`;
        } else {
          // Ein Verweis in das Repository: Der Text steht für sich, in aller Regel ist er der Pfad.
          out += inner;
        }
        break;
      }
      case 'autolink':
        out += `<a class="url" href="${esc(node.href)}">${urlHtml(node.href)}</a>`;
        break;
      case 'footref': {
        const n = ctx.note(node.id);
        out += n === null ? esc(`[^${node.id}]`) : `&nbsp;<span class="ref">(${n})</span>`;
        break;
      }
      case 'break':
        out += '<br>';
        break;
      default:
        throw new Error(`Unbekannter Knoten im Text: ${node.type}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Tabellen: Vermessung

/**
 * Zerlegt den Inhalt einer Zelle in Stücke für layout.cjs. `scale` rechnet eine andere
 * Schriftgröße oder Sperrung in Zeichen der Tabellenschrift um.
 */
function atomsOf(nodes, ctx, scale = 1, solidAll = false) {
  const out = [];
  let spaceBefore = false;
  const push = (text, solid) => {
    for (const part of text.split(/(\s+)/)) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        spaceBefore = true;
        continue;
      }
      // Umbruchstellen ohne Leerzeichen: im Text wie in cellText, in einem langen Befehlswort
      // wie in codeHtml; ein kurzes Befehlswort bleibt ganz.
      const pieces = solid ? (part.length <= CODE_BREAK ? [part] : part.split(CODE_PIECES)) : part.split(TEXT_BREAK);
      pieces.forEach((piece, i) => {
        out.push({ len: Math.ceil(piece.length * scale), space: i === 0 ? spaceBefore : false, solid: solid || solidAll });
      });
      spaceBefore = false;
    }
  };
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'text') push(node.value, false);
      else if (node.type === 'code') push(node.value, true);
      else if (node.type === 'strong' || node.type === 'em') walk(node.children);
      else if (node.type === 'link') {
        walk(node.children);
        if (/^(https?:|mailto:)/i.test(node.href) && out.length > 0) {
          // Die Ziffer hängt mit geschütztem Leerzeichen am letzten Wort.
          const n = ctx.sources.byHref.get(node.href) ?? ctx.sources.list.length + 1;
          out[out.length - 1].len += Math.ceil((3 + String(n).length) * scale);
        }
      } else if (node.type === 'autolink') push(node.href, true);
      else if (node.type === 'break') spaceBefore = true;
    }
  };
  walk(nodes);
  return out;
}

/**
 * Wählt die Form einer Tabelle.
 * @returns {{mode:'raster'|'quer'|'saetze', size:'normal'|'klein', widths:number[]|null, natural:boolean, chars:number, tallest:number}}
 */
function planTable(table, ctx) {
  const cols = table.head.length;
  // Verweisziffern vorab vergeben, damit ihre Breite in die Vermessung eingeht.
  const register = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'link' && /^(https?:|mailto:)/i.test(node.href)) ctx.sources.number(node.href, plain(node.children).trim());
      if (node.children) register(node.children);
    }
  };
  table.head.forEach(register);
  table.rows.forEach((row) => row.forEach(register));

  const longest = Math.max(0, ...table.rows.map((row) => Math.max(...row.map((cell) => plain(cell).length))));
  const variants = [
    { mode: 'raster', size: 'normal', width: CONTENT.hoch },
    { mode: 'raster', size: 'klein', width: CONTENT.hoch },
    { mode: 'quer', size: 'normal', width: CONTENT.quer },
    { mode: 'quer', size: 'klein', width: CONTENT.quer },
  ];
  for (const variant of variants) {
    const font = TYPE.table[variant.size];
    const chars = Math.floor(variant.width / (font * ADVANCE * PT_MM));
    const available = chars - GAP * (cols - 1);
    // Der Tabellenkopf steht gesperrt in Versalien und wird nicht getrennt.
    const headScale = (TYPE.label * (ADVANCE + TYPE.tracking)) / (font * ADVANCE);
    const head = table.head.map((cell) => atomsOf(cell, ctx, headScale, true));
    const rows = table.rows.map((row) => row.map((cell) => atomsOf(cell, ctx)));
    const result = allocate(head, rows, available);
    if (result === null) continue;
    const plan = { mode: variant.mode, size: variant.size, widths: result.widths, natural: result.natural, chars, tallest: result.tallest };
    if (result.natural) return plan;
    // Zeilen der höchsten Zelle je Spalte: Eine schmale Spalte stört nicht, solange sie niedrig bleibt.
    const columnLines = result.widths.map((width, c) => Math.max(1, ...rows.map((row) => linesAt(row[c] ?? [], width))));
    const cramped = result.widths.some(
      (width, c) => (width < LIMIT.narrow && columnLines[c] > LIMIT.narrowLines) || (width < LIMIT.slim && columnLines[c] > LIMIT.slimLines),
    );
    if (variant.mode === 'raster' && result.tallest <= LIMIT.gridLines && !cramped) return plan;
    if (variant.mode === 'quer' && result.tallest <= LIMIT.querLines && longest <= LIMIT.querCell) return plan;
  }
  return { mode: 'saetze', size: 'normal', widths: null, natural: false, chars: 0, tallest: 0 };
}

// ---------------------------------------------------------------- Tabellen: Darstellung

function gridHtml(table, plan, ctx) {
  const cols = table.head.length;
  const font = TYPE.table[plan.size];
  let style = '';
  let colgroup = '';
  if (plan.natural) {
    // Alles passt ohne Umbruch. Eine schmale Tabelle wird nicht über die ganze Breite gezogen:
    // Der Weg vom Stichwort zum Wert bliebe sonst zu weit.
    const total = plan.widths.reduce((a, b) => a + b, 0) + GAP * (cols - 1);
    const share = total / plan.chars;
    style = share >= 0.72 ? 'width:100%' : `width:${Math.max(total + GAP + cols, Math.ceil(plan.chars * 0.5))}ch`;
  } else {
    style = 'width:100%;table-layout:fixed';
    colgroup = `<colgroup>${plan.widths.map((w, c) => `<col style="width:${w + (c < cols - 1 ? GAP : 0)}ch">`).join('')}</colgroup>`;
  }
  const align = (c) => (table.align[c] && table.align[c] !== 'left' ? ` style="text-align:${table.align[c]}"` : '');
  const head = `<thead><tr>${table.head.map((cell, c) => `<th${align(c)}>${inlineHtml(cell, ctx, true)}</th>`).join('')}</tr></thead>`;
  const body = table.rows
    .map((row) => `<tr>${row.map((cell, c) => `<td${align(c)}>${inlineHtml(cell, ctx, true)}</td>`).join('')}</tr>`)
    .join('\n');
  const classes = ['raster', plan.size === 'klein' ? 'klein' : '', plan.natural ? 'frei' : ''].filter(Boolean).join(' ');
  return `<table class="${classes}" style="font-size:${font}pt;${style}">${colgroup}${head}<tbody>\n${body}\n</tbody></table>`;
}

function recordsHtml(table, ctx) {
  const cols = table.head.length;
  const labels = table.head.map((cell) => plain(cell).trim());
  // Breite der Beschriftungsspalte: die längste Beschriftung, gesperrt gesetzt.
  const labelChars = Math.max(...labels.map((l) => Math.max(...l.split(/\s+/).map((w) => w.length), Math.min(l.length, 22))));
  const labelWidth = Math.min(44, labelChars * TYPE.label * (ADVANCE + TYPE.tracking) * PT_MM + 1.5);
  // Eine kurze erste Spalte (Name, Nummer, Stichwort) wird zur Kopfzeile des Satzes; ist sie
  // selbst ein längerer Text, steht sie als erstes Feld bei den anderen.
  const titled = table.rows.every((row) => plain(row[0]).trim().length <= LIMIT.titleCell);
  const records = table.rows
    .map((row) => {
      const fields = [];
      for (let c = titled ? 1 : 0; c < cols; c++) {
        if (plain(row[c]).trim() === '') continue;
        fields.push(`<div class="feld"><dt>${inlineHtml(table.head[c], ctx, true)}</dt><dd>${inlineHtml(row[c], ctx, true)}</dd></div>`);
      }
      const head = titled
        ? `<p class="satz-kopf"><span class="marke">${inlineHtml(table.head[0], ctx)}</span> <b>${inlineHtml(row[0], ctx)}</b></p>`
        : '';
      // Ein Satz ist eine Tabellenzeile und bleibt auf einer Seite (siehe .satz im Stil).
      return `<div class="satz">${head}<dl style="--marke:${mm(labelWidth)}">${fields.join('')}</dl></div>`;
    })
    .join('\n');
  return `<div class="saetze">\n${records}\n</div>`;
}

// ---------------------------------------------------------------- Blöcke

/** Grobe Zeilenzahl eines Blocks in der Textspalte, für die Entscheidung, was zusammenbleibt. */
function estimateLines(block) {
  const perLine = Math.floor(TYPE.measure / (TYPE.body * ADVANCE * PT_MM));
  switch (block.type) {
    case 'paragraph':
      return Math.ceil(plain(block.inline).length / perLine) + 0.5;
    case 'heading':
      return block.level <= 2 ? 4 : 2.5;
    case 'list':
      return block.items.reduce((sum, item) => sum + item.blocks.reduce((s, b) => s + estimateLines(b), 0), 0) + 0.5;
    case 'quote':
      return block.blocks.reduce((s, b) => s + estimateLines(b), 0) + 1;
    case 'code':
      return block.text.split('\n').length + 1;
    case 'rule':
      return 1.5;
    case 'table':
      return Infinity;
    default:
      return 1;
  }
}

function blockHtml(block, ctx, depth = 0) {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inlineHtml(block.inline, ctx)}</p>`;
    case 'heading': {
      const level = Math.min(4, Math.max(2, block.level));
      ctx.headings.push({ level: block.level, text: plain(block.inline).trim() });
      return `<h${level}>${inlineHtml(block.inline, ctx)}</h${level}>`;
    }
    case 'list': {
      const items = block.items
        .map((item, i) => {
          const marker = block.ordered ? `${block.start + i}.` : '—';
          const body = item.blocks.map((b) => blockHtml(b, ctx, depth + 1)).join('\n');
          return `<li><span class="punkt">${marker}</span><div class="punkt-text">${body}</div></li>`;
        })
        .join('\n');
      const widest = block.ordered ? String(block.start + block.items.length - 1).length + 1 : 1;
      return `<ul class="liste${block.ordered ? ' gezaehlt' : ''}" style="--einzug:${widest + 2}ch">\n${items}\n</ul>`;
    }
    case 'quote':
      return `<blockquote>${block.blocks.map((b) => blockHtml(b, ctx, depth + 1)).join('\n')}</blockquote>`;
    case 'code':
      return `<pre>${esc(block.text)}</pre>`;
    case 'rule':
      return '<hr>';
    case 'table': {
      const plan = planTable(block, ctx);
      ctx.tables.push({
        line: block.line + 1,
        columns: block.head.length,
        rows: block.rows.length,
        head: block.head.map((cell) => plain(cell).trim()),
        mode: plan.mode === 'raster' ? (plan.size === 'klein' ? 'raster klein' : 'raster') : plan.mode,
        tallest: plan.tallest,
        widths: plan.natural ? null : plan.widths,
      });
      if (plan.mode === 'saetze') return recordsHtml(block, ctx);
      const html = gridHtml(block, plan, ctx);
      return plan.mode === 'quer' ? `<!--quer-->${html}` : html;
    }
    default:
      throw new Error(`Unbekannter Block: ${block.type}`);
  }
}

/**
 * Ordnet die Blöcke der obersten Ebene so, dass keine Überschrift allein am Seitenende steht:
 * Ein kurzer Abschnitt bleibt ganz zusammen, sonst die Überschrift mit ihrem ersten Block. Eine
 * Tabelle im Querformat nimmt mit auf ihre Seite, was unmittelbar zu ihr gehört: die Überschrift
 * vor ihr und den kurzen Vorsatz dazwischen. Eine Trennlinie vor einer Überschrift, die selbst
 * eine Linie trägt, entfällt.
 */
function flow(blocks, ctx) {
  const parts = blocks.map((block) => ({ block, html: blockHtml(block, ctx) }));
  const isHeading = (p) => p !== undefined && p.block.type === 'heading';
  const isQuer = (p) => p !== undefined && p.html.startsWith('<!--quer-->');
  const pointsOn = (p) => p.block.type === 'paragraph' && /:\s*$/.test(plain(p.block.inline));
  const asLeadIn = (p) => p.html.replace(/^<p>/, '<p class="vorsatz">');
  const out = [];
  let i = 0;
  const emitQuer = (list) => {
    const html = list.map((p, idx) => (idx < list.length - 1 && p.block.type === 'paragraph' ? asLeadIn(p) : p.html.replace('<!--quer-->', '')));
    out.push(`<div class="quer">\n${html.join('\n')}\n</div>`);
  };
  while (i < parts.length) {
    const part = parts[i];
    if (isQuer(part)) {
      emitQuer([part]);
      i++;
      continue;
    }
    if (!isHeading(part)) {
      const next = parts[i + 1];
      if (part.block.type === 'rule' && isHeading(next) && next.block.level <= 2) {
        i++;
        continue;
      }
      // Ein Satz, der mit einem Doppelpunkt auf das Folgende zeigt, bleibt bei ihm.
      if (pointsOn(part) && isQuer(next)) {
        emitQuer([part, next]);
        i += 2;
        continue;
      }
      out.push(pointsOn(part) && next !== undefined && !isHeading(next) ? asLeadIn(part) : part.html);
      i++;
      continue;
    }
    // Überschriften, die unmittelbar aufeinander folgen, gehören zusammen.
    const heads = [part];
    let j = i + 1;
    while (isHeading(parts[j])) heads.push(parts[j++]);
    // Der Abschnitt bis zur nächsten Überschrift oder Quertabelle.
    let end = j;
    while (end < parts.length && !isHeading(parts[end]) && !isQuer(parts[end])) end++;
    const section = parts.slice(j, end);
    const lines = section.reduce((sum, p) => sum + estimateLines(p.block), 0);
    if (isQuer(parts[end]) && section.every((p) => p.block.type === 'paragraph') && lines <= 6) {
      emitQuer([...heads, ...section, parts[end]]);
      i = end + 1;
      continue;
    }
    const mark = (p, idx, list) => (pointsOn(p) && list[idx + 1] !== undefined ? asLeadIn(p) : p.html);
    if (section.length > 0 && lines <= 18) {
      out.push(`<div class="zusammen">\n${[...heads.map((p) => p.html), ...section.map(mark)].join('\n')}\n</div>`);
      i = end;
      continue;
    }
    const first = section[0];
    if (first !== undefined && first.block.type !== 'table' && estimateLines(first.block) <= 14) {
      out.push(`<div class="zusammen">\n${[...heads.map((p) => p.html), mark(first, 0, section)].join('\n')}\n</div>`);
      i = j + 1;
      continue;
    }
    for (const head of heads) out.push(head.html);
    i = j;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- Dokument

function css(meta, fontsUrl) {
  const footer = `SICHT · ${meta.title}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const m = PAGE.margin;
  return `
  @font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url("${fontsUrl}/JetBrainsMono-Regular.woff2") format("woff2"); }
  @font-face { font-family: "JetBrains Mono"; font-weight: 500; src: url("${fontsUrl}/JetBrainsMono-Medium.woff2") format("woff2"); }
  @font-face { font-family: "JetBrains Mono"; font-weight: 700; src: url("${fontsUrl}/JetBrainsMono-Bold.woff2") format("woff2"); }

  @page {
    size: A4;
    margin: ${m.top}mm ${m.side}mm ${m.bottom}mm;
    @bottom-left { content: "${footer}"; font-family: "JetBrains Mono", monospace; font-size: 6.5pt; color: #555; vertical-align: top; padding-top: 6mm; }
    @bottom-right { content: counter(page) " / " counter(pages); font-family: "JetBrains Mono", monospace; font-size: 6.5pt; color: #555; vertical-align: top; padding-top: 6mm; }
  }
  @page quer { size: A4 landscape; }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { width: ${CONTENT.hoch}mm; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: ${TYPE.body}pt; line-height: 1.5; color: #050505; background: #fff; font-variant-ligatures: none; hyphens: manual; overflow-wrap: break-word; }
  /* Eine Tabelle im Querformat steht auf eigenen Seiten; der Wechsel des Seitennamens erzwingt den Umbruch. */
  .quer { page: quer; width: ${CONTENT.quer}mm; }

  /* Kopf der ersten Seite */
  .kopf { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.5pt solid #050505; padding-bottom: 2.4mm; }
  .wortmarke { font-size: 11pt; font-weight: 700; letter-spacing: 0.42em; }
  .marke { font-size: ${TYPE.label}pt; font-weight: 500; letter-spacing: ${TYPE.tracking}em; text-transform: uppercase; color: #555; }
  .titel { position: relative; margin: 6mm 0 7mm; padding: 7mm 8mm 6.5mm; break-inside: avoid; }
  .titel i { position: absolute; width: 5mm; height: 5mm; border: 0 solid #050505; }
  .titel i:nth-of-type(1) { top: 0; left: 0; border-top-width: 0.7pt; border-left-width: 0.7pt; }
  .titel i:nth-of-type(2) { top: 0; right: 0; border-top-width: 0.7pt; border-right-width: 0.7pt; }
  .titel i:nth-of-type(3) { bottom: 0; left: 0; border-bottom-width: 0.7pt; border-left-width: 0.7pt; }
  .titel i:nth-of-type(4) { bottom: 0; right: 0; border-bottom-width: 0.7pt; border-right-width: 0.7pt; }
  .titel h1 { font-size: 19pt; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; max-width: 150mm; }
  .titel .stand { margin-top: 3mm; font-size: 7.4pt; font-weight: 500; color: #555; max-width: none; }

  /* Text */
  h2 { font-size: ${TYPE.h2}pt; font-weight: 700; line-height: 1.3; margin: 8.5mm 0 3mm; padding-top: 2.6mm; border-top: 0.5pt solid #050505; break-after: avoid; break-inside: avoid; }
  h3 { font-size: ${TYPE.h3}pt; font-weight: 700; line-height: 1.4; margin: 5.5mm 0 1.6mm; max-width: ${TYPE.measure}mm; break-after: avoid; break-inside: avoid; }
  h4 { font-size: ${TYPE.h4}pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #333; margin: 4.5mm 0 1.4mm; break-after: avoid; break-inside: avoid; }
  p { margin-bottom: 2.2mm; max-width: ${TYPE.measure}mm; orphans: 2; widows: 2; }
  p.vorsatz { break-after: avoid; }
  b { font-weight: 700; }
  /* Ein Trennstrich in einem Pfad, Befehl oder einer Adresse wäre ein falsches Zeichen. */
  code { font: inherit; font-weight: 500; hyphens: none; }
  code .fest { white-space: nowrap; }
  a { color: inherit; text-decoration: none; }
  a.url { hyphens: none; }
  .ref { font-size: ${TYPE.ref}pt; color: #555; }
  hr { border: 0; border-top: 0.35pt solid #9a9a9a; margin: 5mm 0; }
  pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; border-left: 0.7pt solid #050505; padding: 0.6mm 0 0.6mm 3mm; margin: 1.2mm 0 3mm; line-height: 1.7; break-inside: avoid; }
  blockquote { margin: 2.5mm 0 3.5mm; padding: 0.8mm 0 0.8mm 4mm; border-left: 0.7pt solid #050505; font-size: 10pt; break-inside: avoid; }
  blockquote p:last-child { margin-bottom: 0; }
  .zusammen { break-inside: avoid; }

  .liste { list-style: none; margin: 0 0 2.6mm; max-width: ${TYPE.measure}mm; }
  .liste li { display: grid; grid-template-columns: var(--einzug, 3ch) minmax(0, 1fr); margin-bottom: 1mm; break-inside: avoid; }
  .liste .punkt { color: #555; }
  .liste .punkt-text > :last-child { margin-bottom: 0; }
  .liste .liste { margin-top: 1mm; }

  /* Tabellen als Raster */
  table.raster { border-collapse: collapse; margin: 1.4mm 0 4.2mm; line-height: ${TYPE.tableLine}; break-before: avoid; }
  table.raster th { text-align: left; vertical-align: bottom; font-size: ${TYPE.label}pt; font-weight: 500; letter-spacing: ${TYPE.tracking}em; text-transform: uppercase; color: #555; padding: 0 0 1.2mm 0; border-bottom: 0.5pt solid #050505; overflow-wrap: anywhere; }
  /* Getrennt werden nur lange Wörter (Zusammensetzungen), mit mindestens fünf Zeichen auf jeder Seite. */
  table.raster td { vertical-align: top; padding: 1.25mm 0; border-bottom: 0.35pt solid #9a9a9a; hyphens: auto; hyphenate-limit-chars: 14 5 5; overflow-wrap: anywhere; }
  /* Der Spaltenabstand zählt in Zeichen der Tabellenschrift, auch in der kleiner gesetzten Kopfzeile. */
  table.raster td:not(:last-child) { padding-right: ${GAP}ch; }
  table.raster th:not(:last-child) { padding-right: calc(${GAP}ch * ${TYPE.table.normal} / ${TYPE.label}); }
  table.raster.klein th:not(:last-child) { padding-right: ${GAP}ch; }
  table.raster.frei td { hyphens: manual; }
  table.raster tr { break-inside: avoid; }
  table.raster thead { display: table-header-group; }
  /* Am Anfang und am Ende einer Tabelle steht keine Zeile allein auf einer Seite. */
  table.raster tbody tr:first-child, table.raster tbody tr:nth-last-child(2) { break-after: avoid; }

  /* Tabellen als Sätze */
  .saetze { margin: 1.4mm 0 4.2mm; border-top: 0.5pt solid #050505; }
  /* Ein Satz wird nicht über zwei Seiten geteilt. Nur einer, der höher ist als eine Seite, bekommt
     von build.cjs vor dem Druck die Klasse »lang« und läuft dann zwischen zwei Feldern weiter. */
  .satz { padding: 2.2mm 0 2mm; border-bottom: 0.35pt solid #9a9a9a; break-inside: avoid; }
  .satz.lang { break-inside: auto; }
  .satz-kopf { max-width: none; margin-bottom: 1.4mm; break-after: avoid; }
  .satz-kopf .marke { margin-right: 1.5ch; }
  .satz .feld { display: grid; grid-template-columns: var(--marke, 34mm) minmax(0, 1fr); column-gap: 4mm; margin-bottom: 1.1mm; break-inside: avoid; }
  .satz .feld:last-child { margin-bottom: 0; }
  .satz dt { font-size: ${TYPE.label}pt; font-weight: 500; letter-spacing: ${TYPE.tracking}em; text-transform: uppercase; color: #555; padding-top: 0.22em; overflow-wrap: anywhere; }
  .satz dd { overflow-wrap: anywhere; }

  /* Quellen und Schlusszeile */
  .quellen { margin: 0; }
  .quellen li { display: grid; grid-template-columns: 5ch minmax(0, 1fr); font-size: 7.2pt; line-height: 1.45; margin-bottom: 1.1mm; break-inside: avoid; list-style: none; }
  .quellen .nr { color: #555; }
  .quellen .url { color: #333; overflow-wrap: anywhere; }
  .schluss { margin-top: 7mm; padding-top: 2mm; border-top: 0.35pt solid #9a9a9a; font-size: 6.6pt; color: #555; max-width: none; break-inside: avoid; }
`;
}

/**
 * @param {{blocks:object[], notes:Map}} doc  Ergebnis von markdown.parse
 * @param {{title:string, source:string, stand:string, note?:string}} meta
 * @param {string} fontsUrl  Adresse des Ordners mit den Schriftdateien
 */
function renderDocument(doc, meta, fontsUrl) {
  const noteOrder = [];
  const ctx = {
    sources: new Sources(),
    headings: [],
    tables: [],
    note(id) {
      if (!doc.notes.has(id)) return null;
      if (!noteOrder.includes(id)) noteOrder.push(id);
      return noteOrder.indexOf(id) + 1;
    },
  };
  const blocks = doc.blocks.slice();
  // Die erste Überschrift der obersten Ebene ist der Titel; die Wortmarke steht schon darüber.
  let title = meta.title;
  let titlePrefix = '';
  const first = blocks.findIndex((b) => b.type === 'heading' && b.level === 1);
  if (first >= 0) {
    const full = plain(blocks[first].inline).trim();
    title = full.replace(/^Sicht\s*[—–:-]\s*/u, '');
    titlePrefix = full.slice(0, full.length - title.length);
    blocks.splice(first, 1);
  }
  const body = flow(blocks, ctx);

  let tail = '';
  if (noteOrder.length > 0) {
    tail += `<h2>Anmerkungen</h2>\n<ul class="quellen">${noteOrder
      .map((id, i) => `<li><span class="nr">(${i + 1})</span><span>${inlineHtml(doc.notes.get(id), ctx)}</span></li>`)
      .join('\n')}</ul>\n`;
  }
  if (ctx.sources.list.length > 0) {
    ctx.headings.push({ level: 2, text: 'Quellen', generated: true });
    const entry = (s, i) =>
      `<li><span class="nr">[${i + 1}]</span><span>${esc(s.title)}<br><a class="url" href="${esc(s.href)}">${urlHtml(s.href)}</a></span></li>`;
    const list = ctx.sources.list;
    // Die Überschrift bleibt bei den ersten Einträgen; eine kurze Liste bleibt ganz zusammen.
    const lead = list.length <= 10 ? list.length : 3;
    tail += `<div class="zusammen">\n<h2>Quellen</h2>\n<p>Die Ziffern in eckigen Klammern verweisen auf diese Liste.</p>\n<ul class="quellen">\n${list
      .slice(0, lead)
      .map(entry)
      .join('\n')}\n</ul>\n</div>\n`;
    if (list.length > lead) {
      tail += `<ul class="quellen">\n${list
        .slice(lead)
        .map((s, i) => entry(s, i + lead))
        .join('\n')}\n</ul>\n`;
    }
  }
  tail += `<p class="schluss">Erzeugt aus <code>${codeHtml(meta.source)}</code>. Verweise auf Dateien und Befehle beziehen sich auf das Repository.${
    meta.note ? ` ${esc(meta.note)}` : ''
  }</p>`;

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Sicht — ${esc(title)}</title>
<style>${css(meta, fontsUrl)}</style></head>
<body>
<header class="kopf"><span class="wortmarke">SICHT</span><span class="marke">Unterlage · ${esc(meta.title)}</span></header>
<div class="titel"><i></i><i></i><i></i><i></i><h1>${esc(title)}</h1><p class="stand">Stand: ${esc(meta.stand)} · Erprobungsstand</p></div>
${body}
${tail}
</body></html>`;
  return { html, title, titlePrefix, headings: ctx.headings, tables: ctx.tables, sources: ctx.sources.list };
}

module.exports = { renderDocument, planTable, PAGE, CONTENT, TYPE };
