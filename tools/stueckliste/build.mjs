#!/usr/bin/env node
/**
 * Stückliste von Sicht: was ausgeliefert wird, in welcher Fassung, unter welcher Lizenz.
 *
 *   node tools/stueckliste/build.mjs             schreibt docs/stueckliste/sicht.cdx.json (CycloneDX 1.5)
 *                                                und docs/STUECKLISTE.md
 *   node tools/stueckliste/build.mjs --offline   fragt nichts im Netz ab: keine Lizenz fremder Plattformen,
 *                                                kein Abgleich mit bekannten Schwachstellen
 *   node tools/stueckliste/build.mjs --check     schreibt nichts; endet mit Fehler, wenn die Stückliste nicht
 *                                                mehr zu pnpm-lock.yaml passt
 *   node tools/stueckliste/build.mjs --stand "2. Dezember 2026"
 *
 * Quelle der Pakete ist pnpm-lock.yaml, nicht der eingerichtete Ordner: Die Liste nennt deshalb
 * auch die Binärpakete der Plattformen, auf denen gerade nicht gebaut wird. Die Lizenz eines
 * Pakets steht in seiner package.json; für nicht eingerichtete Pakete wird sie einmal bei der
 * Paketverwaltung erfragt und in lizenzen.json festgehalten.
 *
 * Braucht nur Node ab 20.11 und, für Abfragen im Netz, pnpm. Keine weiteren Pakete.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const checkOnly = args.includes('--check');
const standAt = args.indexOf('--stand');
const stand = standAt >= 0 && args[standAt + 1] ? args[standAt + 1] : '18. November 2026';

const lockFile = path.join(repo, 'pnpm-lock.yaml');
const cacheFile = path.join(here, 'lizenzen.json');
const bomFile = path.join(repo, 'docs', 'stueckliste', 'sicht.cdx.json');
const paperFile = path.join(repo, 'docs', 'STUECKLISTE.md');

/** Was der Knoten ausführt und was in der Konsole gebündelt ist. */
const ROOTS = [
  { importer: 'apps/server', part: 'Knoten' },
  { importer: 'apps/web', part: 'Konsole' },
];

/** Wozu die direkt eingebundenen Pakete dienen. */
const PURPOSE = {
  fastify: 'Webserver des Knotens',
  '@fastify/multipart': 'Annahme hochgeladener Aufnahmen',
  '@fastify/static': 'Auslieferung der Konsole',
  '@huggingface/transformers': 'Vorverarbeitung und Textzerlegung für die Modelle',
  'onnxruntime-node': 'Ausführung der Modelle auf dem Prozessor',
  sharp: 'Bilder lesen, verkleinern, verpixeln',
  react: 'Oberfläche der Konsole',
  'react-dom': 'Oberfläche der Konsole',
};

/** Bemerkungen zu Lizenzen, die eine Vergabestelle nachfragt. */
const LICENCE_NOTES = {
  'LGPL-3.0-or-later': 'libvips, die Bildbibliothek hinter sharp; eigene Datei, unverändert geladen',
  'Apache-2.0 AND LGPL-3.0-or-later': 'sharp für Windows; das Paket enthält libvips',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT': 'sharp als WebAssembly, enthält libvips; nur für Plattformen ohne Binärpaket',
  'BlueOak-1.0.0': 'freizügige Lizenz',
  '(MIT OR CC0-1.0)': 'wahlweise',
};

/** SPDX-Kennungen, die als solche in die Stückliste gehen; alles andere als Name oder Ausdruck. */
const SPDX_IDS = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-4.0', 'CC0-1.0',
  'ISC', 'LGPL-3.0-or-later', 'MIT', 'MPL-2.0', 'ODbL-1.0', 'OFL-1.1', 'Python-2.0', 'Unlicense',
]);

// ---------------------------------------------------------------- pnpm-lock.yaml lesen

/** Zerlegt eine Zeile »schlüssel: wert«; der Schlüssel darf in Hochkommas stehen. */
function keyValue(line) {
  let key;
  let rest;
  if (line.startsWith("'") || line.startsWith('"')) {
    const end = line.indexOf(line[0], 1);
    key = line.slice(1, end);
    rest = line.slice(end + 1);
  } else {
    const at = line.indexOf(':');
    key = at < 0 ? line : line.slice(0, at);
    rest = at < 0 ? '' : line.slice(at);
  }
  rest = rest.replace(/^:\s*/, '');
  if (rest.length > 1 && (rest.startsWith("'") || rest.startsWith('"')) && rest.endsWith(rest[0])) rest = rest.slice(1, -1);
  return [key, rest];
}

const list = (value) => value.replace(/^\[|\]$/g, '').split(',').map((entry) => entry.trim()).filter(Boolean);

/** Liest die drei Abschnitte, die die Stückliste braucht. Kein allgemeiner YAML-Leser. */
function readLock(text) {
  const importers = {};
  const packages = {};
  const snapshots = {};
  let section = null;
  let entry = null;
  let group = null;
  let dependency = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.search(/\S/);
    const line = raw.trim();
    if (indent === 0) {
      section = line.replace(/:.*$/, '');
      entry = group = dependency = null;
      continue;
    }
    const [key, value] = keyValue(line);
    if (section === 'importers') {
      if (indent === 2) { entry = importers[key] = {}; group = null; }
      else if (indent === 4 && entry) group = entry[key] = {};
      else if (indent === 6 && group) dependency = key;
      else if (indent === 8 && group && key === 'version') group[dependency] = value;
    } else if (section === 'packages') {
      if (indent === 2) entry = packages[key] = { integrity: null, cpu: [], os: [] };
      else if (indent === 4 && entry) {
        if (key === 'resolution') entry.integrity = /integrity:\s*([^,}\s]+)/.exec(value)?.[1] ?? null;
        if (key === 'cpu' || key === 'os') entry[key] = list(value);
      }
    } else if (section === 'snapshots') {
      if (indent === 2) { entry = snapshots[key] = { dependencies: {}, optionalDependencies: {} }; group = null; }
      else if (indent === 4 && entry) group = key === 'dependencies' || key === 'optionalDependencies' ? entry[key] : null;
      else if (indent === 6 && group) group[key] = value;
    }
  }
  return { importers, packages, snapshots };
}

/** Schlüssel eines Schnappschusses für ein Paar aus Name und Angabe; kennt Zweitnamen. */
function snapshotKey(snapshots, name, value) {
  const direct = `${name}@${value}`;
  if (snapshots[direct]) return direct;
  if (snapshots[value]) return value;
  return null;
}

const bare = (key) => key.replace(/\(.*$/, '');
function nameAndVersion(key) {
  const plain = bare(key);
  const at = plain.lastIndexOf('@');
  return { name: plain.slice(0, at), version: plain.slice(at + 1) };
}

/** Alle Pakete, die von den ausgelieferten Teilen aus erreichbar sind, ohne Bauwerkzeuge. */
function closure(lock) {
  const reached = new Map();
  const missing = [];
  for (const root of ROOTS) {
    const importer = lock.importers[root.importer];
    if (!importer) throw new Error(`pnpm-lock.yaml kennt ${root.importer} nicht.`);
    const queue = [];
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [name, value] of Object.entries(importer[group] ?? {})) {
        const key = snapshotKey(lock.snapshots, name, value);
        if (key) queue.push({ key, direct: true }); else missing.push(`${name}@${value}`);
      }
    }
    const seen = new Set();
    while (queue.length) {
      const { key, direct } = queue.shift();
      const id = bare(key);
      const record = reached.get(id) ?? { id, ...nameAndVersion(key), parts: new Set(), direct: false, dependsOn: new Set() };
      record.parts.add(root.part);
      record.direct = record.direct || direct;
      reached.set(id, record);
      if (seen.has(key)) continue;
      seen.add(key);
      const snapshot = lock.snapshots[key];
      for (const group of ['dependencies', 'optionalDependencies']) {
        for (const [name, value] of Object.entries(snapshot[group])) {
          const next = snapshotKey(lock.snapshots, name, value);
          if (!next) { missing.push(`${name}@${value}`); continue; }
          record.dependsOn.add(bare(next));
          queue.push({ key: next, direct: false });
        }
      }
    }
  }
  if (missing.length) throw new Error(`Im Lockfile nicht auflösbar: ${[...new Set(missing)].join(', ')}`);
  for (const record of reached.values()) {
    const meta = lock.packages[record.id] ?? { integrity: null, cpu: [], os: [] };
    record.integrity = meta.integrity;
    record.cpu = meta.cpu;
    record.os = meta.os;
  }
  return [...reached.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version, 'en', { numeric: true }) : a.name.localeCompare(b.name, 'en')));
}

// ---------------------------------------------------------------- Lizenzen

function licenceOf(manifest) {
  const value = manifest.license ?? manifest.licenses;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'string' ? entry : entry?.type)).filter(Boolean).join(' OR ') || null;
  if (value && typeof value === 'object' && typeof value.type === 'string') return value.type;
  return null;
}

/** Ordner der eingerichteten Pakete, nach »name@fassung« geordnet. */
function installedIndex() {
  const index = new Map();
  const store = path.join(repo, 'node_modules', '.pnpm');
  if (!existsSync(store)) return index;
  for (const dir of readdirSync(store)) {
    const at = dir.lastIndexOf('@', dir.indexOf('_') < 0 ? dir.length : dir.indexOf('_'));
    if (at <= 0) continue;
    const name = dir.slice(0, at).replace('+', '/');
    const version = dir.slice(at + 1).replace(/_.*$/, '');
    const manifest = path.join(store, dir, 'node_modules', name, 'package.json');
    if (!index.has(`${name}@${version}`)) index.set(`${name}@${version}`, manifest);
  }
  return index;
}

function resolveLicences(records) {
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const installed = installedIndex();
  const known = {};
  const asked = [];
  for (const record of records) {
    let licence = null;
    const manifest = installed.get(record.id);
    if (manifest && existsSync(manifest)) licence = licenceOf(JSON.parse(readFileSync(manifest, 'utf8')));
    if (!licence && cache[record.id]) licence = cache[record.id];
    if (!licence && !offline && !checkOnly) {
      try {
        const answer = execFileSync('pnpm', ['view', record.id, 'license'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim();
        if (answer) { licence = answer; asked.push(record.id); }
      } catch {
        // bleibt unbekannt; die Unterlage nennt es
      }
    }
    record.licence = licence ?? 'unbekannt';
    if (licence) known[record.id] = licence;
  }
  if (!checkOnly) {
    const sorted = Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b, 'en')));
    writeFileSync(cacheFile, `${JSON.stringify(sorted, null, 1)}\n`);
  }
  return asked;
}

// ---------------------------------------------------------------- Bestandteile außerhalb der Paketverwaltung

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/** Modelle, Schrift und Daten. »files« werden gehasht, wenn sie auf diesem Rechner liegen. */
const EXTRAS = [
  {
    ref: 'model:onnx-community/siglip2-base-patch32-256-ONNX',
    type: 'machine-learning-model',
    name: 'SigLIP 2 base patch32-256 (ONNX)',
    supplier: 'Google; ONNX-Fassung der onnx-community',
    licence: 'Apache-2.0',
    delivered: 'wird beim ersten Start geladen',
    purpose: 'Bildkodierer und Textkodierer der Suche und der Wachen',
    files: ['.models/onnx-community/siglip2-base-patch32-256-ONNX/onnx/vision_model.onnx', '.models/onnx-community/siglip2-base-patch32-256-ONNX/onnx/text_model_fp16.onnx'],
  },
  {
    ref: 'model:opencv/face_detection_yunet',
    type: 'machine-learning-model',
    name: 'YuNet face detection 2023mar',
    supplier: 'OpenCV Zoo',
    licence: 'MIT',
    delivered: 'wird beim ersten Start geladen',
    purpose: 'findet Gesichter, damit sie verpixelt werden; erkennt niemanden',
    files: ['.models/opencv/face_detection_yunet/face_detection_yunet_2023mar.onnx'],
  },
  {
    ref: 'model:sicht/hazard-head',
    type: 'machine-learning-model',
    name: 'Gefahrenmodell (Zweitmeinung)',
    supplier: 'Sicht; trainiert auf AIDERv2',
    licence: 'eigene Gewichte; Trainingsdaten CC-BY-4.0',
    delivered: 'liegt im Repository',
    purpose: 'zweite Einschätzung zu Brand, Überflutung, Trümmern, Verkehrsunfall',
    files: ['apps/server/assets/hazard-head.siglip2-base-patch32-256-onnx.json'],
  },
  {
    ref: 'font:jetbrains-mono',
    type: 'file',
    name: 'JetBrains Mono (Regular, Medium, Bold)',
    supplier: 'JetBrains',
    licence: 'OFL-1.1',
    delivered: 'liegt im Repository',
    purpose: 'Schrift der Konsole, der Website und der Unterlagen',
    files: ['apps/web/public/fonts/JetBrainsMono-Regular.woff2', 'apps/web/public/fonts/JetBrainsMono-Medium.woff2', 'apps/web/public/fonts/JetBrainsMono-Bold.woff2'],
  },
  {
    ref: 'data:openstreetmap-koblenz',
    type: 'data',
    name: 'Kartenkacheln Mittelrhein (Zoom 5 bis 14)',
    supplier: 'OpenStreetMap-Mitwirkende über OpenFreeMap; Schema OpenMapTiles',
    licence: 'ODbL-1.0 (Daten); CC-BY-4.0 (Schema)',
    delivered: 'liegt im Repository',
    purpose: 'Karte ohne Netz',
    files: ['apps/web/public/map/manifest.json'],
  },
  {
    ref: 'data:mapzen-terrain',
    type: 'data',
    name: 'Höhenlinien, abgeleitet aus Mapzen Terrain Tiles',
    supplier: 'Mapzen und die dort genannten Quellen',
    licence: 'siehe Quellenliste der Terrain Tiles',
    delivered: 'liegt im Repository, in den Kartenkacheln',
    purpose: 'Geländeform in der Karte',
    files: [],
  },
  {
    ref: 'data:mixkit-exercise',
    type: 'data',
    name: 'Übungsaufnahmen (45 Stück)',
    supplier: 'Mixkit',
    licence: 'Mixkit Stock Video Free License',
    delivered: 'werden mit pnpm exercise:fetch geladen, nicht mitgeliefert',
    purpose: 'Material der Übung RHEIN-MOSEL und der beiden Nachbarknoten',
    files: [],
  },
];

/** Was der Betreiber selbst mitbringt. */
const PREREQUISITES = [
  { name: 'Node.js ab 20.11', licence: 'MIT', note: 'Laufzeit des Knotens' },
  { name: 'ffmpeg', licence: 'LGPL-2.1-or-later oder GPL, je nach Ausgabe', note: 'zerlegt Aufnahmen in Bilder; wird als eigenes Programm aufgerufen, nicht eingebunden' },
];

async function resolveExtras(previous) {
  const earlier = new Map((previous?.components ?? []).map((component) => [component['bom-ref'], component]));
  for (const extra of EXTRAS) {
    extra.hashes = [];
    for (const file of extra.files) {
      const absolute = path.join(repo, file);
      const name = path.basename(file);
      if (existsSync(absolute)) extra.hashes.push({ file: name, sha256: await sha256(absolute) });
      else {
        const kept = earlier.get(extra.ref)?.properties?.find((property) => property.name === `sicht:sha256:${name}`);
        if (kept) extra.hashes.push({ file: name, sha256: kept.value });
      }
    }
  }
}

// ---------------------------------------------------------------- Abgleich mit bekannten Schwachstellen

function audit(scope) {
  if (offline || checkOnly) return null;
  let text = '';
  try {
    text = execFileSync('pnpm', ['audit', ...(scope === 'prod' ? ['--prod'] : []), '--json'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
  } catch (error) {
    text = typeof error.stdout === 'string' ? error.stdout : '';
  }
  try {
    const report = JSON.parse(text);
    const counts = report.metadata?.vulnerabilities;
    if (!counts) return null;
    const advisories = Object.values(report.advisories ?? {}).map((advisory) => ({
      module: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      id: advisory.github_advisory_id ?? String(advisory.id),
    }));
    return { total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts, advisories };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- CycloneDX

const purl = (record) => `pkg:npm/${record.name.startsWith('@') ? `%40${record.name.slice(1)}` : record.name}@${record.version}`;

function licenceEntry(licence) {
  if (SPDX_IDS.has(licence)) return [{ license: { id: licence } }];
  const inner = licence.replace(/^\((.*)\)$/, '$1');
  if (/ (OR|AND|WITH) /.test(inner) && inner.split(/ (?:OR|AND|WITH) /).every((part) => SPDX_IDS.has(part.replace(/[()]/g, '').trim()))) return [{ expression: licence }];
  return [{ license: { name: licence } }];
}

function integrityHash(integrity) {
  const match = /^(sha\d+)-(.+)$/.exec(integrity ?? '');
  if (!match) return [];
  const alg = { sha512: 'SHA-512', sha256: 'SHA-256', sha1: 'SHA-1' }[match[1]];
  return alg ? [{ alg, content: Buffer.from(match[2], 'base64').toString('hex') }] : [];
}

function buildBom(records, version, timestamp) {
  const components = records.map((record) => ({
    type: 'library',
    'bom-ref': purl(record),
    name: record.name,
    version: record.version,
    scope: record.cpu.length || record.os.length ? 'optional' : 'required',
    purl: purl(record),
    licenses: licenceEntry(record.licence),
    hashes: integrityHash(record.integrity),
    properties: [
      { name: 'sicht:teil', value: [...record.parts].sort().join(', ') },
      ...(record.os.length ? [{ name: 'sicht:os', value: record.os.join(', ') }] : []),
      ...(record.cpu.length ? [{ name: 'sicht:cpu', value: record.cpu.join(', ') }] : []),
    ],
  }));
  for (const extra of EXTRAS) {
    components.push({
      type: extra.type,
      'bom-ref': extra.ref,
      name: extra.name,
      supplier: { name: extra.supplier },
      licenses: licenceEntry(extra.licence),
      description: extra.purpose,
      properties: [
        { name: 'sicht:lieferung', value: extra.delivered },
        ...extra.hashes.map((hash) => ({ name: `sicht:sha256:${hash.file}`, value: hash.sha256 })),
      ],
    });
  }
  const root = `sicht@${version}`;
  const dependencies = [
    { ref: root, dependsOn: [...records.filter((record) => record.direct).map(purl), ...EXTRAS.map((extra) => extra.ref)] },
    ...records.map((record) => ({ ref: purl(record), dependsOn: [...record.dependsOn].sort().map((id) => purl(nameAndVersion(id))) })),
  ];
  const digest = createHash('sha256').update(JSON.stringify([components, dependencies])).digest('hex');
  const serial = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: 'Sicht', name: 'tools/stueckliste/build.mjs', version }],
      component: { type: 'application', 'bom-ref': root, name: 'sicht', version, description: 'Knoten und Konsole' },
    },
    components,
    dependencies,
  };
}

// ---------------------------------------------------------------- Unterlage

const platformOf = (record) => (record.os.length || record.cpu.length ? [record.os.join('/'), record.cpu.join('/')].filter(Boolean).join(' · ') : 'alle');

function writePaper(records, version, audits) {
  const everywhere = records.filter((record) => !record.os.length && !record.cpu.length);
  const platform = records.filter((record) => record.os.length || record.cpu.length);
  const byLicence = new Map();
  for (const record of records) byLicence.set(record.licence, [...(byLicence.get(record.licence) ?? []), record]);
  const licenceRows = [...byLicence.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'en'));
  const direct = records.filter((record) => record.direct);
  const unknown = records.filter((record) => record.licence === 'unbekannt');
  const lines = [];
  const push = (...text) => lines.push(...text);

  push('# Stückliste', '');
  push(`Stand: ${stand} · Fassung ${version}. Diese Unterlage nennt, woraus Sicht besteht: jedes Paket, jedes`);
  push('Modell, die Schrift und die Daten, jeweils mit Fassung, Herkunft und Lizenz. Sie wird aus der');
  push('Sperrdatei der Paketverwaltung erzeugt (`pnpm sbom`) und liegt maschinenlesbar als');
  push('[`docs/stueckliste/sicht.cdx.json`](stueckliste/sicht.cdx.json) im Format CycloneDX 1.5 bei, mit');
  push('der Prüfsumme jedes Pakets. Ein Test hält die Liste an der Sperrdatei fest: Ändert sich ein Paket,');
  push('ohne dass die Liste neu erzeugt wird, scheitert `pnpm test`.', '');

  push('## 1. Was ausgeliefert wird', '');
  push('| Teil | Anzahl | Bemerkung |', '| --- | --- | --- |');
  push(`| Pakete, die auf jeder Plattform laufen | ${everywhere.length} | Knoten und Konsole |`);
  push(`| Binärpakete je Plattform | ${platform.length} | eingerichtet werden nur die der eigenen Plattform |`);
  push(`| Modelle | ${EXTRAS.filter((extra) => extra.type === 'machine-learning-model').length} | zwei werden beim ersten Start geladen, eines liegt bei |`);
  push('| Schrift | 1 | drei Schnitte |');
  push(`| Daten | ${EXTRAS.filter((extra) => extra.type === 'data').length} | Karte, Höhenlinien, Übungsaufnahmen |`);
  push('', 'Nicht in der Liste stehen die Werkzeuge, mit denen gebaut und geprüft wird (TypeScript, Vite, tsx);');
  push('sie laufen nicht im Knoten und sind nicht Teil der Auslieferung.', '');

  push('## 2. Lizenzen der Pakete', '');
  push('| Lizenz | Pakete | Bemerkung |', '| --- | --- | --- |');
  for (const [licence, group] of licenceRows) push(`| ${licence} | ${group.length} | ${LICENCE_NOTES[licence] ?? ''} |`);
  push('');
  push('Keines der Pakete steht unter GPL oder AGPL. Die Bildbibliothek libvips steht unter der LGPL; unter');
  push('Linux liegt sie als eigene Datei (`libvips-cpp.so`) neben der Anbindung und wird unverändert geladen.');
  push('Welche Hinweise und Lizenztexte einer Weitergabe von Sicht beizulegen sind, gehört in die rechtliche');
  push('Prüfung (Abschnitt 8).');
  if (unknown.length) push('', `Ohne Angabe einer Lizenz: ${unknown.map((record) => `\`${record.id}\``).join(', ')}. Vor einer Weitergabe klären.`);
  push('');

  push('## 3. Direkt eingebundene Pakete', '');
  push('| Paket | Fassung | Lizenz | Teil | Wozu |', '| --- | --- | --- | --- | --- |');
  for (const record of direct) push(`| \`${record.name}\` | ${record.version} | ${record.licence} | ${[...record.parts].sort().join(', ')} | ${PURPOSE[record.name] ?? ''} |`);
  push('', 'Alle übrigen Pakete kommen über diese acht herein; sie stehen in Abschnitt 7.', '');

  push('## 4. Modelle, Schrift, Daten', '');
  push('| Bestandteil | Herkunft | Lizenz | Lieferung | Prüfsumme (SHA-256, Anfang) |', '| --- | --- | --- | --- | --- |');
  for (const extra of EXTRAS) {
    const sums = extra.hashes.length ? extra.hashes.map((hash) => `\`${hash.sha256.slice(0, 16)}\` ${hash.file}`).join('; ') : 'nicht erfasst';
    push(`| ${extra.name} | ${extra.supplier} | ${extra.licence} | ${extra.delivered} | ${sums} |`);
  }
  push('', 'Die vollständigen Prüfsummen stehen in der maschinenlesbaren Liste. Die Modellgewichte ändern sich');
  push('im Betrieb nicht; eine abweichende Prüfsumme heißt, dass eine andere Datei geladen wurde.', '');

  push('## 5. Was der Betreiber mitbringt', '');
  push('| Voraussetzung | Lizenz | Bemerkung |', '| --- | --- | --- |');
  for (const item of PREREQUISITES) push(`| ${item.name} | ${item.licence} | ${item.note} |`);
  push('');

  push('## 6. Abgleich mit bekannten Schwachstellen', '');
  if (audits.prod) {
    const shipped = audits.prod.total === 0 ? 'kein bekannter Befund' : `${audits.prod.total} bekannte Befunde`;
    push(`Abgeglichen am ${stand} mit der Datenbank der Paketverwaltung (\`pnpm audit\`, GitHub Advisory`);
    push(`Database). Ausgelieferte Pakete: ${shipped}.`);
    for (const advisory of audits.prod.advisories) push(`- \`${advisory.module}\`, ${advisory.severity}: ${advisory.title} (${advisory.id})`);
    if (audits.all) {
      const tools = audits.all.advisories.filter((advisory) => !audits.prod.advisories.some((shippedAdvisory) => shippedAdvisory.id === advisory.id));
      if (tools.length === 0) push('Werkzeuge zum Bauen und Prüfen: kein bekannter Befund.');
      else {
        push(`Werkzeuge zum Bauen und Prüfen: ${tools.length === 1 ? 'ein bekannter Befund' : `${tools.length} bekannte Befunde`}. Diese Pakete laufen nicht im Knoten.`, '');
        for (const advisory of tools) push(`- \`${advisory.module}\`, Einstufung ${advisory.severity}: ${advisory.title} (${advisory.id})`);
      }
    }
  } else {
    push('Diese Fassung wurde ohne Netz erzeugt; ein Abgleich mit bekannten Schwachstellen steht aus');
    push('(`pnpm sbom` mit Netz, oder `pnpm audit --prod`).');
  }
  push('');
  push('Der Abgleich ist eine Momentaufnahme. Im Betrieb gehört er in einen regelmäßigen Lauf, und jeder');
  push('neue Befund in eine Bewertung, ob der Knoten betroffen ist.', '');

  push('## 7. Alle Pakete', '');
  push('| Paket | Fassung | Lizenz | Plattform |', '| --- | --- | --- | --- |');
  for (const record of records) push(`| \`${record.name}\` | ${record.version} | ${record.licence} | ${platformOf(record)} |`);
  push('');

  push('## 8. Was diese Liste nicht leistet', '');
  push('- Sie ist keine rechtliche Prüfung. Ob die Lizenzen zum vorgesehenen Vertrieb passen, entscheidet');
  push('  ein Jurist; die Liste gibt ihm die Grundlage.');
  push('- Die Binärpakete von onnxruntime und sharp enthalten weitere Bibliotheken. Sie stehen in den');
  push('  Hinweisdateien dieser Pakete, nicht einzeln hier.');
  push('- ffmpeg bringt der Betreiber mit. Unter welcher Lizenz es steht, hängt von der gewählten Ausgabe ab.');
  push('- Die Prüfsummen der Pakete stammen aus der Sperrdatei. Sie belegen, dass eingerichtet wird, was');
  push('  beim Erstellen der Sperrdatei vorlag, nicht, dass dieser Stand frei von Fehlern ist.');
  push('- Für Binärpakete der Plattformen, auf denen die Liste nicht erzeugt wurde, stammt die Lizenzangabe');
  push('  aus der Auskunft der Paketverwaltung (festgehalten in `tools/stueckliste/lizenzen.json`), nicht aus');
  push('  einer eingerichteten Datei.');
  push('');
  writeFileSync(paperFile, lines.join('\n'));
}

// ---------------------------------------------------------------- Ablauf

const version = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const lock = readLock(readFileSync(lockFile, 'utf8'));
const records = closure(lock);
const previous = existsSync(bomFile) ? JSON.parse(readFileSync(bomFile, 'utf8')) : null;

if (checkOnly) {
  const expected = records.map((record) => `${purl(record)} ${integrityHash(record.integrity)[0]?.content ?? ''}`).sort();
  const actual = (previous?.components ?? []).filter((component) => component.type === 'library').map((component) => `${component.purl} ${component.hashes?.[0]?.content ?? ''}`).sort();
  const absent = expected.filter((entry) => !actual.includes(entry));
  const surplus = actual.filter((entry) => !expected.includes(entry));
  if (!previous || absent.length || surplus.length) {
    console.error('Die Stückliste passt nicht mehr zu pnpm-lock.yaml.');
    for (const entry of absent.slice(0, 10)) console.error(`  fehlt:       ${entry.split(' ')[0]}`);
    for (const entry of surplus.slice(0, 10)) console.error(`  überzählig:  ${entry.split(' ')[0]}`);
    console.error('Neu erzeugen mit: pnpm sbom');
    process.exit(1);
  }
  console.log(`Stückliste passt zur Sperrdatei: ${expected.length} Pakete.`);
  process.exit(0);
}

const cachedBefore = existsSync(cacheFile) ? Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8'))).length : 0;
const asked = resolveLicences(records);
await resolveExtras(previous);
const audits = { prod: audit('prod'), all: audit('all') };

const bom = buildBom(records, version, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
if (previous && previous.serialNumber === bom.serialNumber) bom.metadata.timestamp = previous.metadata.timestamp;
mkdirSync(path.dirname(bomFile), { recursive: true });
writeFileSync(bomFile, `${JSON.stringify(bom, null, 1)}\n`);
writePaper(records, version, audits);

const unknown = records.filter((record) => record.licence === 'unbekannt');
console.log(`Stückliste: ${records.length} Pakete (${records.filter((record) => record.direct).length} direkt), ${EXTRAS.length} weitere Bestandteile.`);
console.log(`Lizenzen: ${new Set(records.map((record) => record.licence)).size} verschiedene; ${asked.length} im Netz erfragt, ${cachedBefore} waren festgehalten.`);
if (unknown.length) console.log(`Ohne Lizenzangabe: ${unknown.map((record) => record.id).join(', ')}`);
if (audits.prod) console.log(`Bekannte Schwachstellen in ausgelieferten Paketen: ${audits.prod.total}; mit Bauwerkzeugen: ${audits.all ? audits.all.total : 'nicht ermittelt'}.`);
else console.log('Abgleich mit bekannten Schwachstellen: nicht durchgeführt.');
console.log(`Geschrieben: ${path.relative(repo, bomFile)}, ${path.relative(repo, paperFile)}`);
