#!/usr/bin/env node
/**
 * Prüft ein exportiertes Protokoll von Sicht, ohne Sicht zu brauchen.
 *
 *   node tools/pruefen/ledger-verify.mjs sicht-ledger-koblenz.jsonl
 *   node tools/pruefen/ledger-verify.mjs sicht-ledger-koblenz.jsonl --head <64 Hexzeichen>
 *
 * Die Datei kommt aus der Konsole (Reiter PROTOKOLL, EXPORT): ein Eintrag je Zeile, als JSON.
 * Jeder Eintrag nennt in `prev` die Prüfsumme seines Vorgängers und in `hash` die eigene:
 *
 *   hash = SHA-256( prev + "\n" + kanonisch(Eintrag ohne prev und hash) )
 *
 * »Kanonisch« heißt: JSON ohne Leerraum, die Schlüssel jedes Objekts sortiert. Der erste Eintrag
 * verweist auf 64 Nullen. Wer einen Eintrag ändert, entfernt oder umstellt, bricht die Kette an
 * dieser Stelle; dieses Programm nennt sie.
 *
 * Mit --head wird zusätzlich geprüft, ob die Kette bei der genannten Prüfsumme endet oder sie
 * enthält. So lässt sich ein Stand abgleichen, den ein Nachbarknoten bezeugt hat, oder einer, der
 * auf einem gedruckten Bericht steht. Ohne einen solchen Abgleich beweist eine unversehrte Kette
 * nur, dass die Datei in sich stimmig ist, nicht, dass sie die ursprüngliche ist.
 *
 * Dieses Programm benutzt nichts aus dem Repository und nichts außer Node selbst, damit eine
 * Aufsicht es lesen und unabhängig einsetzen kann. Dasselbe in Python: ledger_verify.py.
 *
 * Ausgang: 0 = unversehrt (und --head gefunden), 1 = gebrochen oder --head nicht gefunden,
 * 2 = falscher Aufruf oder Datei nicht lesbar.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GENESIS = '0'.repeat(64);

/** JSON ohne Leerraum, Schlüssel sortiert; `undefined` kommt in gelesenem JSON nicht vor. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

function verify(text) {
  let prev = GENESIS;
  let count = 0;
  const heads = new Set();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const at = count + 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return { ok: false, entries: count, head: prev, brokenAt: at, reason: 'Zeile ist kein gültiges JSON', heads };
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, entries: count, head: prev, brokenAt: at, reason: 'Zeile ist kein Eintrag', heads };
    }
    if (entry.seq !== at) {
      return { ok: false, entries: count, head: prev, brokenAt: at, reason: `Sequenznummer ${entry.seq} statt ${at}`, heads };
    }
    if (entry.prev !== prev) {
      return { ok: false, entries: count, head: prev, brokenAt: at, reason: 'Verweis auf den Vorgänger stimmt nicht', heads };
    }
    const { prev: _prev, hash, ...body } = entry;
    const expected = createHash('sha256').update(prev).update('\n').update(canonical(body)).digest('hex');
    if (expected !== hash) {
      return { ok: false, entries: count, head: prev, brokenAt: at, reason: 'Inhalt passt nicht zur Prüfsumme', heads };
    }
    prev = hash;
    heads.add(hash);
    count = at;
  }
  return { ok: true, entries: count, head: prev, brokenAt: null, reason: null, heads };
}

const args = process.argv.slice(2);
const headAt = args.indexOf('--head');
const wanted = headAt >= 0 ? (args[headAt + 1] ?? '').toLowerCase() : null;
const files = args.filter((_arg, i) => headAt < 0 || (i !== headAt && i !== headAt + 1));
if (files.length !== 1 || (wanted !== null && !/^[0-9a-f]{8,64}$/.test(wanted))) {
  console.error('Aufruf: node ledger-verify.mjs <Datei> [--head <Prüfsumme oder ihr Anfang, mindestens 8 Hexzeichen>]');
  process.exit(2);
}

let text;
try {
  text = readFileSync(files[0], 'utf8');
} catch (err) {
  console.error(`Datei nicht lesbar: ${err.message}`);
  process.exit(2);
}
// Ein Byte Order Mark am Anfang gehört nicht zum ersten Eintrag.
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

const result = verify(text);
if (!result.ok) {
  console.log(`Kette GEBROCHEN bei Eintrag ${result.brokenAt}: ${result.reason}.`);
  console.log(`Unversehrt bis einschließlich Eintrag ${result.entries}, Stand ${result.head}.`);
  process.exit(1);
}
console.log(`Kette unversehrt: ${result.entries} ${result.entries === 1 ? 'Eintrag' : 'Einträge'}.`);
console.log(`Letzter Stand: ${result.head}`);
if (wanted !== null) {
  const found = [...result.heads].some((hash) => hash.startsWith(wanted)) || (result.entries === 0 && GENESIS.startsWith(wanted));
  if (!found) {
    console.log(`Der genannte Stand ${wanted} kommt in dieser Kette NICHT vor.`);
    process.exit(1);
  }
  console.log(result.head.startsWith(wanted) ? 'Der genannte Stand ist der letzte Stand dieser Kette.' : 'Der genannte Stand ist ein früherer Stand dieser Kette.');
}
