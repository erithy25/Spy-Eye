import fs from 'node:fs/promises';
import type { Store } from '../store.js';
import type { Alert, CaseFile, Incident, LedgerEntryInfo, Mandate, Metrics, NodeInfo, ScenarioInfo, SourceInfo } from '../types.js';

/** Printable documents: situation report, case file and measurement report. Self-contained HTML, no scripts. */

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
  /**
   * Whether the exhibits are shown as pictures. False for a reader whose role may not see
   * imagery (oversight): the report then lists every exhibit with its source, time and checksums,
   * which is what a check of the file needs, and says that the pictures were left out.
   */
  pictures: boolean;
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
    const image = input.pictures ? await embedFrame(input.store, item.videoId, item.frameNumber) : null;
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
          `<tr><td>${e.seq}</td><td>${stamp(Date.parse(e.ts), lang)}</td><td>${esc(e.actor)}</td><td>${esc(de ? e.summary : (e.summaryEn ?? e.summary))}</td><td class="hash">${e.hash.slice(0, 16)}…</td></tr>`,
      )
      .join('\n')}
  </table>`);

  const aboutPictures = input.pictures
    ? de
      ? 'Die abgebildeten Bilder sind die maskierte Fassung.'
      : 'The images shown are the masked versions.'
    : de
      ? 'Diese Ausgabe enthält keine Bilder: Die Rolle, für die sie erzeugt wurde, sieht kein Bildmaterial.'
      : 'This copy contains no images: the role it was produced for does not see imagery.';
  parts.push(`<footer>${
    de
      ? `${aboutPictures} Die Hashwerte beziehen sich auf die unveränderten Originalbilder im System und erlauben den Abgleich einer späteren Herausgabe. Protokollstand bei Erstellung: ${input.ledgerHead}.`
      : `${aboutPictures} The hashes refer to the unaltered original frames held in the system and allow a later disclosure to be checked. Ledger head at the time of export: ${input.ledgerHead}.`
  }</footer>`);
  return page(`${de ? 'Vorgang' : 'Case'} ${file.id}`, lang, parts.join('\n'));
}

/** Exercise time as T+mm:ss. */
function exerciseClock(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  return `T+${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The measurement report of an exercise: what the script injected, what the watches reported and
 * how long it took, with the conditions of the run. It contains no imagery, so the oversight role
 * can produce it as well.
 */
export function measurementReport(input: {
  lang: Lang;
  node: NodeInfo;
  mandate: Mandate | null;
  author: string;
  scenario: ScenarioInfo;
  metrics: Metrics;
  recordings: { total: number; analysed: number };
  machine: { cpu: string; threads: number; device: string; modelId: string };
  ledgerHead: string;
  ledgerLength: number;
}): string {
  const { lang, metrics, scenario } = input;
  const de = lang === 'de';
  const num = (value: number, digits = 1): string => value.toLocaleString(de ? 'de-DE' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const evaluation = metrics.evaluation;
  const parts: string[] = [];
  parts.push(`<div class="banner">${de ? 'ÜBUNG · ÜBUNG · ÜBUNG' : 'EXERCISE · EXERCISE · EXERCISE'}</div>`);
  parts.push(`<h1>${de ? 'Messbericht' : 'Measurement report'}</h1>`);
  parts.push(`<p class="sub">${esc(input.node.name)} · ${esc(input.node.operator)} · ${stamp(Date.now(), lang)}</p>`);

  const state: Record<ScenarioInfo['status'], [string, string]> = {
    absent: ['nicht eingespielt', 'not installed'],
    installing: ['wird ausgewertet', 'being analysed'],
    ready: ['bereit, nicht gestartet', 'ready, not started'],
    running: ['läuft', 'running'],
    paused: ['angehalten', 'paused'],
    finished: ['beendet', 'finished'],
  };
  parts.push(`<table class="kv">
    <tr><td>${de ? 'Übung' : 'Exercise'}</td><td>${esc(de ? scenario.title : scenario.titleEn)}</td></tr>
    <tr><td>${de ? 'Stand' : 'State'}</td><td>${exerciseClock(scenario.elapsedSec)} ${de ? 'von' : 'of'} ${exerciseClock(scenario.durationSec).slice(2)} · ${state[scenario.status][de ? 0 : 1]} · ${de ? 'Übungsuhr' : 'exercise clock'} ${scenario.speed}×</td></tr>
    <tr><td>${de ? 'Mandat' : 'Mandate'}</td><td>${input.mandate ? `${esc(input.mandate.title)} — ${esc(input.mandate.legalBasis)}` : '—'}</td></tr>
    <tr><td>${de ? 'Erstellt von' : 'Prepared by'}</td><td>${esc(input.author)}</td></tr>
    <tr><td>${de ? 'Rechner' : 'Machine'}</td><td>${esc(input.machine.cpu)} · ${input.machine.threads} Threads · ${esc(input.machine.device)}</td></tr>
    <tr><td>${de ? 'Bildkodierer' : 'Image encoder'}</td><td>${esc(input.machine.modelId)}</td></tr>
  </table>`);

  parts.push(`<h2>${de ? 'Ergebnis' : 'Result'}</h2>`);
  if (!evaluation) {
    parts.push(`<p>${de ? 'Es liegt kein Übungslauf vor. Der Bericht wird gefüllt, sobald eine Übung läuft oder beendet ist.' : 'There is no exercise run. The report fills once an exercise is running or has finished.'}</p>`);
  } else {
    const delays = evaluation.events.map((e) => e.latencySec).filter((v): v is number => v !== null);
    const range = delays.length > 0 ? `${num(Math.min(...delays))} ${de ? 'bis' : 'to'} ${num(Math.max(...delays))} s` : '—';
    parts.push(`<table class="kv">
      <tr><td>${de ? 'Erkannte Ereignisse' : 'Events detected'}</td><td><strong>${evaluation.detected} ${de ? 'von' : 'of'} ${evaluation.total}</strong> ${de ? 'der bis zu diesem Stand eingespielten Ereignisse' : 'of the events injected up to this point'}</td></tr>
      <tr><td>${de ? 'Erkennungsverzug' : 'Detection delay'}</td><td><strong>${evaluation.medianLatencySec !== null ? `${num(evaluation.medianLatencySec)} s` : '—'}</strong> ${de ? 'im Median, Spanne' : 'median, range'} ${range}</td></tr>
      <tr><td>${de ? 'Fehlmeldungen' : 'False alerts'}</td><td><strong>${evaluation.falseAlarms} ${de ? 'von' : 'of'} ${evaluation.alerts}</strong> ${de ? 'Meldungen der Übungswachen' : 'alerts of the exercise watches'}</td></tr>
      <tr><td>${de ? 'Urteile der Auswertenden' : 'Verdicts of the analysts'}</td><td>${metrics.alerts.confirmed} ${de ? 'bestätigt' : 'confirmed'} · ${metrics.alerts.dismissed} ${de ? 'verworfen' : 'dismissed'} · ${metrics.alerts.open} ${de ? 'offen' : 'open'}</td></tr>
      <tr><td>${de ? 'Sichtungsquote' : 'Coverage'}</td><td>${input.recordings.analysed} ${de ? 'von' : 'of'} ${input.recordings.total} ${de ? 'Aufzeichnungen vollständig ausgewertet' : 'recordings analysed in full'} · ${Math.round(metrics.footageSec / 60)} min · ${metrics.framesAnalysed.toLocaleString(de ? 'de-DE' : 'en-GB')} ${de ? 'Bilder im Verzeichnis' : 'frames indexed'}</td></tr>
      <tr><td>${de ? 'Auswertegeschwindigkeit' : 'Analysis speed'}</td><td>${metrics.analysisSpeed !== null ? `${num(metrics.analysisSpeed)}${de ? '-fache Echtzeit auf diesem Rechner; reine Auswertezeit je Aufzeichnung, ohne ersten Durchgang und Warten' : ' times real time on this machine; analysis time per recording only, without the first pass and waiting'}` : '—'}</td></tr>
      <tr><td>${de ? 'Protokollierte Abfragen' : 'Logged queries'}</td><td>${metrics.searches.count} ${de ? (metrics.searches.count === 1 ? 'Suche' : 'Suchen') : metrics.searches.count === 1 ? 'search' : 'searches'}, ${de ? 'davon' : 'of which'} ${metrics.searches.federated} ${de ? 'im Verbund' : 'federated'} · ${metrics.searches.blocked} ${de ? 'abgelehnte Anfragen' : 'requests refused'}</td></tr>
      <tr><td>${de ? 'Schutz' : 'Protection'}</td><td>${metrics.facesMasked} ${de ? 'Gesichter maskiert' : 'faces masked'} · ${metrics.unmaskEvents} ${de ? (metrics.unmaskEvents === 1 ? 'Freigabe' : 'Freigaben') : metrics.unmaskEvents === 1 ? 'release' : 'releases'} ${de ? 'des Originals' : 'of the original'}</td></tr>
    </table>`);

    parts.push(`<h2>${de ? 'Ereignisse des Drehbuchs' : 'Events of the script'}</h2>`);
    parts.push(`<table><tr><th>#</th><th>${de ? 'Ereignis' : 'Event'}</th><th>${de ? 'Quelle' : 'Source'}</th><th>${de ? 'Beginn' : 'Onset'}</th><th>${de ? 'Meldung' : 'Alert'}</th><th>${de ? 'Verzug' : 'Delay'}</th><th>${de ? 'Wache' : 'Watch'}</th></tr>
      ${evaluation.events
        .map(
          (e, n) =>
            `<tr><td>${n + 1}</td><td>${esc(e.label)}</td><td>${esc(e.sourceName)}</td><td>${exerciseClock(e.onsetSec)}</td><td>${
              e.detectedSec !== null ? exerciseClock(e.detectedSec) : `<strong>${de ? 'nicht erkannt' : 'not detected'}</strong>`
            }</td><td>${e.latencySec !== null ? `${num(e.latencySec)} s` : '—'}</td><td>${e.watchName !== null ? esc(e.watchName) : '—'}</td></tr>`,
        )
        .join('\n')}
    </table>`);

    parts.push(`<h2>${de ? 'Meldungen ohne Ereignis im Drehbuch' : 'Alerts without an event in the script'}</h2>`);
    if (evaluation.unexplained.length === 0) {
      parts.push(`<p>${de ? 'Keine.' : 'None.'}</p>`);
    } else {
      const verdict: Record<Alert['status'], [string, string]> = { new: ['offen', 'open'], confirmed: ['bestätigt', 'confirmed'], dismissed: ['verworfen', 'dismissed'] };
      parts.push(`<table><tr><th>${de ? 'Zeit' : 'Time'}</th><th>${de ? 'Wache' : 'Watch'}</th><th>${de ? 'Quelle' : 'Source'}</th><th>${de ? 'Sicherheit' : 'Confidence'}</th><th>${de ? 'Urteil' : 'Verdict'}</th></tr>
        ${evaluation.unexplained
          .map(
            (a) =>
              `<tr><td>${exerciseClock(a.exerciseSec)}</td><td>${esc(de ? a.watchName : a.watchNameEn)}</td><td>${esc(a.sourceName)}</td><td>${Math.round(a.confidence * 100)} %</td><td>${verdict[a.status][de ? 0 : 1]}</td></tr>`,
          )
          .join('\n')}
      </table>`);
    }
  }

  parts.push(`<h2>${de ? 'Wie die Zahlen zu lesen sind' : 'How to read the figures'}</h2>`);
  parts.push(
    `<p>${
      de
        ? 'Ein Ereignis gilt als erkannt, wenn die dafür vorgesehene Wache an der betroffenen Quelle meldet. Der Verzug zählt in Übungszeit vom Beginn des Ereignisses bis zur Meldung; eine Wache meldet erst, wenn sie über mehrere Bilder hinweg anspricht.'
        : 'An event counts as detected when the watch assigned to it raises an alert on the source concerned. The delay is counted in exercise time from the onset of the event to the alert; a watch reports only once it responds across several frames.'
    }</p>`,
  );
  if (scenario.speed > 1) {
    parts.push(
      `<p>${
        de
          ? `Die Übungsuhr lief mit ${scenario.speed}-facher Geschwindigkeit. Der Verzug in Übungszeit steigt dadurch, weil das System weiter in Echtzeit arbeitet; vergleichbar sind nur Läufe mit derselben Uhr.`
          : `The exercise clock ran at ${scenario.speed} times real time. This raises the delay in exercise time, because the system keeps working in real time; only runs with the same clock are comparable.`
      }</p>`,
    );
  }
  parts.push(
    `<p>${
      de
        ? 'Die Übung spielt vorab ausgewertetes Material ab. Die Rechenzeit der Auswertung ist im Verzug deshalb nicht enthalten; sie steht oben als Auswertegeschwindigkeit. Die Werte beschreiben diesen Lauf auf diesem Material und diesem Rechner und sagen nichts über die Güte auf anderem Material.'
        : 'The exercise replays footage that was analysed beforehand. The computing time of the analysis is therefore not part of the delay; it is given above as analysis speed. The figures describe this run on this footage and this machine and say nothing about the quality on other footage.'
    }</p>`,
  );
  parts.push(`<footer>${
    de
      ? `Maschinell erzeugt aus den Meldungen und dem Protokoll dieses Knotens; der Bericht enthält kein Bildmaterial. Protokollstand: Eintrag ${input.ledgerLength}, Hash ${input.ledgerHead}.`
      : `Generated from the alerts and the ledger of this node; the report contains no imagery. Ledger state: entry ${input.ledgerLength}, hash ${input.ledgerHead}.`
  }</footer>`);
  return page(de ? 'Messbericht' : 'Measurement report', lang, parts.join('\n'));
}
