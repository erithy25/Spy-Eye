/**
 * Markdown, soweit die Unterlagen in docs/ es verwenden: Überschriften, Absätze, Listen (auch
 * verschachtelt), Zitate, Befehlsblöcke, Tabellen, Trennlinien, Fußnoten; im Text Auszeichnung für
 * fett, kursiv, Befehle, Verweise. Keine fremde Bibliothek: Die Unterlagen sollen sich überall
 * bauen lassen, wo Node und Playwright vorhanden sind.
 *
 * parse(text) liefert einen Baum aus Blöcken; die Darstellung übernimmt render.cjs.
 */

// ---------------------------------------------------------------- im Text

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|<>~'.split(''));

function isWord(ch) {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Findet das schließende Zeichenpaar zu einer öffnenden Klammer; -1, wenn es fehlt. */
function matching(src, start, open, close) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '`') {
      const end = closeCode(src, i);
      if (end !== null) i = end.next - 1;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Ein Befehl im Text: gleich viele Gravis am Anfang und Ende. */
function closeCode(src, start) {
  let ticks = 0;
  while (src[start + ticks] === '`') ticks++;
  const fence = '`'.repeat(ticks);
  let from = start + ticks;
  for (;;) {
    const at = src.indexOf(fence, from);
    if (at < 0) return null;
    // Genau diese Zahl an Gravis, nicht mehr.
    if (src[at + ticks] === '`') {
      let run = at;
      while (src[run] === '`') run++;
      from = run;
      continue;
    }
    let content = src.slice(start + ticks, at);
    if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') content = content.slice(1, -1);
    return { content: content.replace(/\n/g, ' '), next: at + ticks };
  }
}

/** Sucht das Ende einer Hervorhebung, das zum Anfang bei `start` passt. */
function closeEmphasis(src, start, mark) {
  const len = mark.length;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '`') {
      const end = closeCode(src, i);
      if (end !== null) {
        i = end.next - 1;
        continue;
      }
    }
    if (src.startsWith(mark, i)) {
      const before = src[i - 1];
      const after = src[i + len];
      if (before === undefined || /\s/.test(before)) continue;
      // Ein einzelnes Zeichen darf nicht Teil eines doppelten sein.
      if (len === 1 && (after === mark || before === mark)) {
        if (after === mark) i++;
        continue;
      }
      if (mark[0] === '_' && isWord(after)) continue;
      return i;
    }
  }
  return -1;
}

/**
 * Zerlegt eine Textzeile in Knoten:
 * text, code, strong, em, link (href, children), autolink, footref, break.
 */
function parseInline(src) {
  const nodes = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') nodes.push({ type: 'text', value: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        flush();
        nodes.push({ type: 'break' });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.has(next)) {
        buffer += next;
        i += 2;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }
    if (ch === '`') {
      const end = closeCode(src, i);
      if (end !== null) {
        flush();
        nodes.push({ type: 'code', value: end.content });
        i = end.next;
        continue;
      }
    }
    if (ch === '[') {
      const note = /^\[\^([^\]\s]+)\]/.exec(src.slice(i));
      if (note) {
        flush();
        nodes.push({ type: 'footref', id: note[1] });
        i += note[0].length;
        continue;
      }
      const close = matching(src, i, '[', ']');
      if (close > 0 && src[close + 1] === '(') {
        const end = matching(src, close + 1, '(', ')');
        if (end > 0) {
          const target = src.slice(close + 2, end).trim();
          const href = (/^<([^>]*)>/.exec(target)?.[1] ?? target.split(/\s+/)[0] ?? '').trim();
          flush();
          nodes.push({ type: 'link', href, children: parseInline(src.slice(i + 1, close)) });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '<') {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/.exec(src.slice(i));
      if (auto) {
        flush();
        nodes.push({ type: 'autolink', href: auto[1] });
        i += auto[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const double = src[i + 1] === ch;
      const mark = double ? ch + ch : ch;
      const after = src[i + mark.length];
      const before = src[i - 1];
      const opens = after !== undefined && !/\s/.test(after) && !(ch === '_' && isWord(before));
      if (opens) {
        const close = closeEmphasis(src, i + mark.length + 1, mark);
        if (close > 0) {
          flush();
          nodes.push({ type: double ? 'strong' : 'em', children: parseInline(src.slice(i + mark.length, close)) });
          i = close + mark.length;
          continue;
        }
      }
      buffer += mark;
      i += mark.length;
      continue;
    }
    if (ch === ' ' && /^ {2,}\n/.test(src.slice(i))) {
      flush();
      nodes.push({ type: 'break' });
      i += /^ +\n/.exec(src.slice(i))[0].length;
      continue;
    }
    if (ch === '\n') {
      buffer += ' ';
      i++;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return nodes;
}

// ---------------------------------------------------------------- Blöcke

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RE_RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const RE_NOTE = /^\[\^([^\]\s]+)\]:\s*(.*)$/;

/** Teilt eine Tabellenzeile an den Strichen, die nicht in einem Befehl stehen und nicht maskiert sind. */
function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '`') {
      const end = closeCode(text, i);
      if (end !== null) {
        cell += text.slice(i, end.next).replace(/\\\|/g, '|');
        i = end.next - 1;
      } else {
        cell += ch;
      }
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.trim() !== '') cells.push(cell.trim());
  return cells;
}

function startsBlock(line, next) {
  return (
    RE_FENCE.test(line) ||
    RE_HEADING.test(line) ||
    RE_RULE.test(line) ||
    RE_QUOTE.test(line) ||
    RE_ITEM.test(line) ||
    (line.includes('|') && next !== undefined && RE_TABLE_RULE.test(next) && next.includes('-'))
  );
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = RE_FENCE.exec(line);
    if (fence) {
      const body = [];
      const mark = fence[1][0];
      const size = fence[1].length;
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}\\${mark}{${size},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence[2].trim(), text: body.join('\n') });
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (line.includes('|') && lines[i + 1] !== undefined && RE_TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left'));
      const line0 = i;
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < head.length) cells.push('');
        rows.push(cells.slice(0, head.length).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', head: head.map(parseInline), align, rows, line: line0 });
      continue;
    }

    if (RE_RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() !== '' && (RE_QUOTE.test(lines[i]) || !startsBlock(lines[i], lines[i + 1]))) {
        const quoted = RE_QUOTE.exec(lines[i]);
        body.push(quoted ? quoted[1] : lines[i]);
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(body) });
      continue;
    }

    const first = RE_ITEM.exec(line);
    if (first && first[1].length <= 3) {
      const ordered = /\d/.test(first[2]);
      const list = { type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items: [] };
      while (i < lines.length) {
        const item = RE_ITEM.exec(lines[i]);
        if (!item || item[1].length > 3 || /\d/.test(item[2]) !== ordered) break;
        // Was zum Punkt gehört, ist so weit eingerückt wie sein Text.
        const offset = item[1].length + item[2].length + (item[3].length > 4 || item[3] === '' ? 1 : item[3].length);
        const body = [item[4]];
        i++;
        while (i < lines.length) {
          const current = lines[i];
          if (current.trim() === '') {
            // Eine Leerzeile gehört nur dann zum Punkt, wenn danach eingerückter Text folgt.
            let ahead = i + 1;
            while (ahead < lines.length && lines[ahead].trim() === '') ahead++;
            const indent = ahead < lines.length ? /^ */.exec(lines[ahead])[0].length : 0;
            if (ahead < lines.length && indent >= Math.min(offset, 2) && indent > 0) {
              body.push('');
              i++;
              continue;
            }
            break;
          }
          const indent = /^ */.exec(current)[0].length;
          if (indent >= offset) {
            body.push(current.slice(offset));
          } else if (indent >= 2) {
            body.push(current.slice(indent));
          } else if (!startsBlock(current, lines[i + 1])) {
            body.push(current.trimStart());
          } else {
            break;
          }
          i++;
        }
        list.items.push({ blocks: parseBlocks(body) });
        // Leerzeilen zwischen den Punkten einer Liste trennen die Liste nicht.
        let ahead = i;
        while (ahead < lines.length && lines[ahead].trim() === '') ahead++;
        const following = ahead < lines.length ? RE_ITEM.exec(lines[ahead]) : null;
        if (ahead > i && following && following[1].length <= 3 && /\d/.test(following[2]) === ordered) i = ahead;
      }
      blocks.push(list);
      continue;
    }

    const text = [];
    while (i < lines.length && lines[i].trim() !== '' && (text.length === 0 || !startsBlock(lines[i], lines[i + 1]))) {
      text.push(lines[i].replace(/^ {1,3}(?=\S)/, ''));
      i++;
    }
    blocks.push({ type: 'paragraph', inline: parseInline(text.map((l, n) => (n < text.length - 1 ? l : l.trimEnd())).join('\n')) });
  }
  return blocks;
}

/** Liest ein ganzes Dokument: Blöcke und Fußnoten. */
function parse(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const notes = new Map();
  const body = [];
  for (let i = 0; i < lines.length; i++) {
    const note = RE_NOTE.exec(lines[i]);
    if (!note) {
      body.push(lines[i]);
      continue;
    }
    const text = [note[2]];
    while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) text.push(lines[++i].trim());
    notes.set(note[1], parseInline(text.join(' ')));
  }
  return { blocks: parseBlocks(body), notes };
}

/** Der reine Text einer Folge von Knoten, wie er gedruckt wird (ohne Verweisziffern). */
function plain(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') out += node.value;
    else if (node.type === 'strong' || node.type === 'em' || node.type === 'link') out += plain(node.children);
    else if (node.type === 'autolink') out += node.href;
    else if (node.type === 'break') out += ' ';
  }
  return out;
}

module.exports = { parse, parseInline, parseBlocks, splitRow, plain };
