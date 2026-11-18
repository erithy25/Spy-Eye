/**
 * Reads a ground-truth file an analyst brings along with own footage: CSV with a header line
 * `name,lat,lon[,label]` (comma, semicolon or tab; with a semicolon the decimal comma of a German
 * spreadsheet is accepted) or JSON (`[{ name, lat, lon, label? }]` or `{ entries: [...] }`).
 * Every row must be valid; the first fault is reported with its line, so the list can be
 * corrected instead of rows going missing without a word.
 */

export interface TruthInput {
  name: string;
  lat: number;
  lon: number;
  label?: string;
}

/** A fault, as a German source text for t() with its values. */
export interface TruthFault {
  text: string;
  vars?: Record<string, string | number>;
}

export type TruthParse = { entries: TruthInput[] } | { fault: TruthFault };

const HEADER: Record<keyof TruthInput, readonly string[]> = {
  name: ['name', 'datei', 'dateiname', 'file', 'filename', 'video'],
  lat: ['lat', 'latitude', 'breite', 'breitengrad'],
  lon: ['lon', 'lng', 'long', 'longitude', 'länge', 'laenge', 'längengrad'],
  label: ['label', 'ort', 'bezeichnung', 'place', 'beschreibung'],
};

/** Splits one CSV line; double quotes enclose fields that hold the delimiter ("" is a quote). */
function splitCsv(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function number(raw: string, decimalComma: boolean): number {
  const text = decimalComma ? raw.replace(',', '.') : raw;
  return text.trim() === '' ? NaN : Number(text);
}

function check(entry: TruthInput, line: number): TruthFault | null {
  if (entry.name === '') return { text: 'Zeile {n}: Der Name des Videos fehlt.', vars: { n: line } };
  if (!Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) return { text: 'Zeile {n}: Breite muss eine Zahl von −90 bis 90 sein.', vars: { n: line } };
  if (!Number.isFinite(entry.lon) || entry.lon < -180 || entry.lon > 180) return { text: 'Zeile {n}: Länge muss eine Zahl von −180 bis 180 sein.', vars: { n: line } };
  return null;
}

function parseCsv(text: string): TruthParse {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== '');
  if (headerAt < 0) return { fault: { text: 'Die Datei ist leer.' } };
  const head = lines[headerAt]!;
  const delimiter = head.includes('\t') ? '\t' : head.includes(';') ? ';' : ',';
  const columns = splitCsv(head, delimiter).map((c) => c.toLowerCase());
  const at = (key: keyof TruthInput): number => columns.findIndex((c) => HEADER[key].includes(c));
  const col = { name: at('name'), lat: at('lat'), lon: at('lon'), label: at('label') };
  if (col.name < 0 || col.lat < 0 || col.lon < 0) {
    return { fault: { text: 'Kopfzeile erwartet: name,lat,lon und optional label.' } };
  }
  const entries: TruthInput[] = [];
  for (let i = headerAt + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const cells = splitCsv(raw, delimiter);
    const label = col.label >= 0 ? (cells[col.label] ?? '') : '';
    const entry: TruthInput = {
      name: cells[col.name] ?? '',
      lat: number(cells[col.lat] ?? '', delimiter !== ','),
      lon: number(cells[col.lon] ?? '', delimiter !== ','),
      ...(label !== '' ? { label } : {}),
    };
    const fault = check(entry, i + 1);
    if (fault) return { fault };
    entries.push(entry);
  }
  return entries.length > 0 ? { entries } : { fault: { text: 'Die Datei enthält keine Einträge.' } };
}

function parseJson(text: string): TruthParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { fault: { text: 'Die Datei ist kein gültiges JSON.' } };
  }
  const list = Array.isArray(data) ? data : data !== null && typeof data === 'object' ? (data as Record<string, unknown>)['entries'] : undefined;
  if (!Array.isArray(list)) return { fault: { text: 'JSON erwartet: [{ name, lat, lon, label }] oder { entries: [...] }.' } };
  const entries: TruthInput[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as Record<string, unknown> | null;
    const value = (key: keyof TruthInput): unknown => (item && typeof item === 'object' ? item[key] : undefined);
    const lat = value('lat');
    const lon = value('lon');
    const label = value('label');
    const entry: TruthInput = {
      name: typeof value('name') === 'string' ? (value('name') as string).trim() : '',
      lat: typeof lat === 'number' ? lat : typeof lat === 'string' ? Number(lat) : NaN,
      lon: typeof lon === 'number' ? lon : typeof lon === 'string' ? Number(lon) : NaN,
      ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    };
    const fault = check(entry, i + 1);
    if (fault) return { fault: { text: fault.text.replace('Zeile', 'Eintrag'), ...(fault.vars ? { vars: fault.vars } : {}) } };
    entries.push(entry);
  }
  return entries.length > 0 ? { entries } : { fault: { text: 'Die Datei enthält keine Einträge.' } };
}

/** Parses the text of a ground-truth file; JSON by extension or by its first character. */
export function parseTruthFile(text: string, fileName: string): TruthParse {
  const json = /\.json$/i.test(fileName) || /^\s*[[{]/.test(text);
  return json ? parseJson(text) : parseCsv(text);
}

/** Whether a file looks like a ground-truth list (and not like a recording). */
export function isTruthFile(name: string): boolean {
  return /\.(csv|json|tsv|txt)$/i.test(name);
}
