import fs from 'node:fs/promises';
import type { Store } from '../store.js';
import type { Alert, CaseFile, Incident, LedgerEntryInfo, Mandate, NodeInfo, SourceInfo } from '../types.js';

/** Printable documents: the situation report and the case file. Self-contained HTML, no scripts. */

export type Lang = 'de' | 'en';

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function stamp(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace; color: #111; margin: 0; padding: 24px; background: #fff; }
  main { max-width: 190mm; margin: 0 auto; }
  h1 { font-size: 15pt; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 2px; }
  h2 { font-size: 9pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; border-bottom: 1px solid #111; padding-bottom: 4px; margin: 26px 0 10px; }
  p { margin: 0 0 8px; }
  .sub { color: #555; }
  .banner { border: 1.5px solid #111; padding: 4px 10px; display: inline-block; font-weight: 700; letter-spacing: 0.2em; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 6px; }
  th, td { text-align: left; vertical-align: top; padding: 4px 8px 4px 0; border-bottom: 1px solid #ddd; font-size: 9.5pt; }
  th { font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.08em; font-size: 8pt; }
  .kv td:first-child { width: 34%; color: #555; }
  figure { margin: 0 0 16px; break-inside: avoid; }
  figure img { width: 100%; display: block; border: 1px solid #111; }
  figcaption { font-size: 8.5pt; padding-top: 4px; color: #333; }
  .hash { font-size: 7.5pt; word-break: break-all; color: #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  footer { margin-top: 28px; border-top: 1px solid #111; padding-top: 8px; font-size: 8pt; color: #555; }
  @media print { body { padding: 0; } }
`;

function page(title: string, lang: Lang, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

async function embedFrame(store: Store, videoId: string, frameNumber: number): Promise<string | null> {
  try {
    const bytes = await fs.readFile(store.framePath(videoId, frameNumber));
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

const SEVERITY: Record<Lang, Record<number, string>> = {
  de: { 1: 'niedrig', 2: 'mittel', 3: 'hoch' },
  en: { 1: 'low', 2: 'medium', 3: 'high' },
};

export async function situationReport(input: {
  lang: Lang;
  node: NodeInfo;
  mandate: Mandate | null;
  incidents: Incident[];
  alerts: Alert[];
  sources: SourceInfo[];
  onlineSources: number;
  framesAnalysed: number;
  ledgerHead: string;
  ledgerLength: number;
  author: string;
  store: Store;
}): Promise<string> {
  const { lang } = input;
  const de = lang === 'de';
  const now = Date.now();
  const open = input.incidents.filter((i) => i.status !== 'closed').sort((a, b) => b.severity - a.severity || b.lastSeen - a.lastSeen);
  const exercise = open.some((i) => i.exercise) || input.mandate?.exercise === true;
  const critical = open.filter((i) => i.severity === 3).length;

  const parts: string[] = [];
  if (exercise) parts.push(`<div class="banner">${de ? 'ÜBUNG · ÜBUNG · ÜBUNG' : 'EXERCISE · EXERCISE · EXERCISE'}</div>`);
  parts.push(`<h1>${de ? 'Lagebericht' : 'Situation report'}</h1>`);
  parts.push(`<p class="sub">${esc(input.node.name)} · ${esc(input.node.operator)} · ${stamp(now, lang)}</p>`);
  parts.push(`<table class="kv">
    <tr><td>${de ? 'Mandat' : 'Mandate'}</td><td>${input.mandate ? `${esc(input.mandate.title)} — ${esc(input.mandate.legalBasis)}` : '—'}</td></tr>
    <tr><td>${de ? 'Erstellt von' : 'Prepared by'}</td><td>${esc(input.author)}</td></tr>
    <tr><td>${de ? 'Quellen' : 'Sources'}</td><td>${input.onlineSources} ${de ? 'von' : 'of'} ${input.sources.length} ${de ? 'liefern Bilder' : 'delivering imagery'}</td></tr>
    <tr><td>${de ? 'Ausgewertete Bilder' : 'Frames analysed'}</td><td>${input.framesAnalysed.toLocaleString(de ? 'de-DE' : 'en-GB')}</td></tr>
  </table>`);

  parts.push(`<h2>${de ? 'Zusammenfassung' : 'Summary'}</h2>`);
  if (open.length === 0) {
    parts.push(`<p>${de ? 'Derzeit sind keine Lagen offen.' : 'No incidents are open at this time.'}</p>`);
  } else {
    const confirmed = input.alerts.filter((a) => a.status === 'confirmed').length;
    parts.push(
      `<p>${
        de
          ? `${open.length} offene ${open.length === 1 ? 'Lage' : 'Lagen'}, davon ${critical} mit hoher Dringlichkeit. ${input.alerts.length} Meldungen liegen vor, ${confirmed} davon durch den Lagedienst bestätigt.`
          : `${open.length} open ${open.length === 1 ? 'incident' : 'incidents'}, ${critical} of high urgency. ${input.alerts.length} alerts on record, ${confirmed} confirmed by the duty analyst.`
      }</p>`,
    );
    parts.push(`<table><tr><th>#</th><th>${de ? 'Lage' : 'Incident'}</th><th>${de ? 'Ort (UTM)' : 'Location (UTM)'}</th><th>${de ? 'Dringlichkeit' : 'Urgency'}</th><th>${de ? 'Quellen' : 'Sources'}</th><th>${de ? 'Erstmeldung' : 'First seen'}</th></tr>
      ${open
        .map(
          (i, n) =>
            `<tr><td>${n + 1}</td><td>${esc(de ? i.title : i.titleEn)}</td><td>${esc(i.mgrs)}</td><td>${SEVERITY[lang][i.severity]}</td><td>${i.corroboration}</td><td>${stamp(i.firstSeen, lang)}</td></tr>`,
        )
        .join('\n')}
    </table>`);
  }

  for (const [n, incident] of open.entries()) {
    const alerts = input.alerts.filter((a) => incident.alertIds.includes(a.id) && a.status !== 'dismissed').sort((a, b) => b.confidence - a.confidence);
    parts.push(`<h2>${n + 1} · ${esc(de ? incident.title : incident.titleEn)}</h2>`);
    parts.push(
      `<p>${
        de
          ? `Erstmals erkannt ${stamp(incident.firstSeen, lang)}, zuletzt ${stamp(incident.lastSeen, lang)}. Gemeldet von ${incident.corroboration} unabhängigen ${incident.corroboration === 1 ? 'Quelle' : 'Quellen'}. Koordinate ${esc(incident.mgrs)}.`
          : `First detected ${stamp(incident.firstSeen, lang)}, last seen ${stamp(incident.lastSeen, lang)}. Reported by ${incident.corroboration} independent ${incident.corroboration === 1 ? 'source' : 'sources'}. Grid reference ${esc(incident.mgrs)}.`
      }</p>`,
    );
    const figures: string[] = [];
    for (const alert of alerts.slice(0, 4)) {
      const image = await embedFrame(input.store, alert.videoId, alert.frameNumber);
      if (!image) continue;
      figures.push(
        `<figure><img src="${image}" alt=""><figcaption>${esc(de ? alert.watchName : alert.watchNameEn)} · ${esc(alert.sourceName)} · ${stamp(alert.firstSeen, lang)} · ${Math.round(alert.confidence * 100)} % · ${
          alert.status === 'confirmed' ? (de ? 'bestätigt' : 'confirmed') : de ? 'ungeprüft' : 'unreviewed'
        }</figcaption></figure>`,
      );
    }
    if (figures.length > 0) parts.push(`<div class="grid">${figures.join('\n')}</div>`);
  }

  parts.push(`<footer>${
    de
      ? `Maschinell erzeugt aus den Meldungen des Systems; Bewertung und Entscheidung liegen beim Stab. Gesichter sind unkenntlich gemacht. Protokollstand: Eintrag ${input.ledgerLength}, Hash ${input.ledgerHead}.`
      : `Generated from the system's alerts; assessment and decisions remain with the staff. Faces are masked. Ledger state: entry ${input.ledgerLength}, hash ${input.ledgerHead}.`
  }</footer>`);
  return page(de ? 'Lagebericht' : 'Situation report', lang, parts.join('\n'));
}

export async function caseReport(input: {
  lang: Lang;
  node: NodeInfo;
  file: CaseFile;
  mandate: Mandate | null;
  contentHash: string;
  ledger: LedgerEntryInfo[];
  ledgerHead: string;
  store: Store;
  userName: (id: string) => string;
}): Promise<string> {
  const { lang, file } = input;
  const de = lang === 'de';
  const parts: string[] = [];
  if (input.mandate?.exercise) parts.push(`<div class="banner">${de ? 'ÜBUNG · ÜBUNG · ÜBUNG' : 'EXERCISE · EXERCISE · EXERCISE'}</div>`);
  parts.push(`<h1>${de ? 'Vorgang' : 'Case file'} ${esc(file.id)}</h1>`);
  parts.push(`<p class="sub">${esc(file.title)}</p>`);
  parts.push(`<table class="kv">
    <tr><td>${de ? 'Stelle' : 'Authority'}</td><td>${esc(input.node.name)} · ${esc(input.node.operator)}</td></tr>
    <tr><td>${de ? 'Mandat' : 'Mandate'}</td><td>${input.mandate ? `${esc(input.mandate.title)} — ${esc(input.mandate.legalBasis)}` : esc(file.mandateId)}</td></tr>
    <tr><td>${de ? 'Angelegt' : 'Opened'}</td><td>${stamp(file.createdAt, lang)} · ${esc(input.userName(file.createdBy))}</td></tr>
    <tr><td>${de ? 'Status' : 'Status'}</td><td>${
      file.sealedAt !== null
        ? `${de ? 'versiegelt' : 'sealed'} ${stamp(file.sealedAt, lang)} · ${esc(input.userName(file.sealedBy ?? ''))}`
        : de
          ? 'in Bearbeitung'
          : 'in progress'
    }</td></tr>
    <tr><td>${de ? 'Inhalts-Hash (SHA-256)' : 'Content hash (SHA-256)'}</td><td class="hash">${input.contentHash}</td></tr>
  </table>`);

  parts.push(`<h2>${de ? 'Beweisstücke' : 'Exhibits'} (${file.items.length})</h2>`);
  for (const [n, item] of file.items.entries()) {
    const image = await embedFrame(input.store, item.videoId, item.frameNumber);
    parts.push(`<figure>
      ${image ? `<img src="${image}" alt="">` : ''}
      <figcaption>
        <strong>${de ? 'Nr.' : 'No.'} ${n + 1}</strong> · ${esc(item.sourceName)} · ${stamp(item.at, lang)}${item.query ? ` · ${de ? 'Anfrage' : 'query'}: „${esc(item.query)}“` : ''}
        ${item.note ? `<br>${esc(item.note)}` : ''}
        <br><span class="hash">SHA-256 ${de ? 'des Originalbilds' : 'of the original frame'}: ${item.sha256}</span>
        <br><span class="hash">${de ? 'Aufzeichnung' : 'Recording'} ${item.videoId}, ${de ? 'Bild' : 'frame'} ${item.frameNumber} · ${de ? 'aufgenommen von' : 'added by'} ${esc(input.userName(item.addedBy))}, ${stamp(item.addedAt, lang)}</span>
      </figcaption>
    </figure>`);
  }
  if (file.items.length === 0) parts.push(`<p class="sub">${de ? 'Keine Beweisstücke.' : 'No exhibits.'}</p>`);

  if (file.notes.length > 0) {
    parts.push(`<h2>${de ? 'Vermerke' : 'Notes'}</h2>`);
    parts.push(`<table>${file.notes
      .map((note) => `<tr><td style="width:30%">${stamp(note.at, lang)}<br>${esc(input.userName(note.by))}</td><td>${esc(note.text)}</td></tr>`)
      .join('\n')}</table>`);
  }

  parts.push(`<h2>${de ? 'Protokollauszug' : 'Ledger excerpt'}</h2>`);
  parts.push(`<table><tr><th>#</th><th>${de ? 'Zeit' : 'Time'}</th><th>${de ? 'Wer' : 'Actor'}</th><th>${de ? 'Vorgang' : 'Action'}</th><th>Hash</th></tr>
    ${input.ledger
      .map(
        (e) =>
          `<tr><td>${e.seq}</td><td>${stamp(Date.parse(e.ts), lang)}</td><td>${esc(e.actor)}</td><td>${esc(e.summary)}</td><td class="hash">${e.hash.slice(0, 16)}…</td></tr>`,
      )
      .join('\n')}
  </table>`);

  parts.push(`<footer>${
    de
      ? `Die abgebildeten Bilder sind die maskierte Fassung. Die Hashwerte beziehen sich auf die unveränderten Originalbilder im System und erlauben den Abgleich einer späteren Herausgabe. Protokollstand bei Erstellung: ${input.ledgerHead}.`
      : `The images shown are the masked versions. The hashes refer to the unaltered original frames held in the system and allow a later disclosure to be checked. Ledger head at the time of export: ${input.ledgerHead}.`
  }</footer>`);
  return page(`${de ? 'Vorgang' : 'Case'} ${file.id}`, lang, parts.join('\n'));
}
