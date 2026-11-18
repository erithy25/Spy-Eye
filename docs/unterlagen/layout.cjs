/**
 * Spaltenbreiten für Tabellen. Die Schrift der Unterlagen ist dicktengleich: Jedes Zeichen ist
 * 0,6 Geviert breit. Wie viele Zeilen ein Text bei einer Spaltenbreite braucht, lässt sich deshalb
 * vorab ausrechnen, und die Breiten lassen sich so verteilen, dass die Tabelle möglichst niedrig
 * wird und kein Wort über seine Spalte hinausragt.
 *
 * Maße sind Zeichen der Tabellenschrift. Ein Text ist eine Folge von Stücken; vor einem Stück
 * steht entweder ein Leerzeichen oder eine Stelle, an der ohne Leerzeichen umbrochen werden darf.
 */

/** Wörter, die länger sind, trennt der Browser (deutsche Silbentrennung); darunter nicht. */
const HYPHENATION_FLOOR = 15;

/**
 * Zeilen, die die Stücke bei dieser Breite füllen.
 * @param {{len:number, space:boolean, solid?:boolean}[]} atoms
 */
function linesAt(atoms, width) {
  if (atoms.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const atom of atoms) {
    const gap = atom.space && used > 0 ? 1 : 0;
    if (used + gap + atom.len <= width) {
      used += gap + atom.len;
      continue;
    }
    if (atom.len <= width) {
      lines++;
      used = atom.len;
      continue;
    }
    // Länger als die Spalte: Das Stück wird getrennt. Ein Wort bekommt je Zeile einen
    // Trennstrich, der ein Zeichen kostet; ein Befehl wird ohne Strich umbrochen.
    const per = atom.solid ? width : Math.max(1, width - 1);
    let rest = atom.len;
    if (used > 0) {
      const room = width - used - gap - (atom.solid ? 0 : 1);
      if (room >= 4) rest -= room;
      lines++;
    }
    const pieces = Math.max(1, Math.ceil((rest - width) / per) + 1);
    lines += pieces - 1;
    used = rest - per * (pieces - 1);
  }
  return lines;
}

/** Schmalste Breite, bei der kein Stück der Spalte über den Rand ragt. */
function minWidth(cells) {
  let min = 3;
  for (const atoms of cells) {
    for (const atom of atoms) {
      const need = atom.solid ? atom.len : Math.min(atom.len, HYPHENATION_FLOOR);
      if (need > min) min = need;
    }
  }
  return min;
}

function naturalWidth(atoms) {
  let total = 0;
  for (const atom of atoms) total += atom.len + (atom.space && total > 0 ? 1 : 0);
  return total;
}

function tableHeight(rows, widths) {
  let height = 0;
  for (const row of rows) {
    let tallest = 1;
    for (let c = 0; c < widths.length; c++) {
      const lines = linesAt(row[c] ?? [], widths[c]);
      if (lines > tallest) tallest = lines;
    }
    height += tallest;
  }
  return height;
}

/**
 * Verteilt `available` Zeichen auf die Spalten.
 * @param {{len:number, space:boolean, solid?:boolean}[][]} head  Kopfzeile, je Spalte
 * @param {{len:number, space:boolean, solid?:boolean}[][][]} rows  Zeilen, je Zeile je Spalte
 * @returns {{widths:number[], natural:boolean, tallest:number}|null} null, wenn die Tabelle nicht passt
 */
function allocate(head, rows, available) {
  const columns = head.length;
  const all = [head, ...rows];
  const natural = [];
  const min = [];
  for (let c = 0; c < columns; c++) {
    const cells = all.map((row) => row[c] ?? []);
    natural.push(Math.max(3, ...cells.map(naturalWidth)));
    min.push(Math.min(natural[c], minWidth(cells)));
  }
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  if (sum(natural) <= available) return { widths: natural, natural: true, tallest: 1 };
  if (sum(min) > available) return null;

  const widths = min.slice();
  let remaining = available - sum(min);
  let height = tableHeight(all, widths);
  while (remaining > 0) {
    let best = null;
    for (let c = 0; c < columns; c++) {
      for (const step of [1, 2, 3, 4, 6, 8, 12]) {
        if (step > remaining || widths[c] + step > natural[c]) break;
        widths[c] += step;
        const gain = (height - tableHeight(all, widths)) / step;
        widths[c] -= step;
        if (gain > 0 && (best === null || gain > best.gain)) best = { c, step, gain };
      }
    }
    if (best === null) {
      // Keine Zeile wird niedriger: Das Zeichen geht an die Spalte, die am dichtesten gefüllt ist.
      let densest = -1;
      let density = 0;
      for (let c = 0; c < columns; c++) {
        if (widths[c] >= natural[c]) continue;
        const text = sum(all.map((row) => naturalWidth(row[c] ?? [])));
        if (text / widths[c] > density) {
          density = text / widths[c];
          densest = c;
        }
      }
      if (densest < 0) break;
      best = { c: densest, step: 1 };
    }
    widths[best.c] += best.step;
    remaining -= best.step;
    height = tableHeight(all, widths);
  }
  let tallest = 1;
  for (const row of rows) for (let c = 0; c < columns; c++) tallest = Math.max(tallest, linesAt(row[c] ?? [], widths[c]));
  return { widths, natural: false, tallest };
}

module.exports = { allocate, linesAt, minWidth, naturalWidth, tableHeight, HYPHENATION_FLOOR };
