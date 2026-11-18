/**
 * English wording of ledger summaries. The ledger keeps every entry as it was written, because the
 * entries are part of the hash chain. Entries written by a current node carry their English version
 * (`summaryEn`, recorded with the entry); entries written before that have only the German summary.
 * Those follow fixed templates of the node, so the console words them in English itself. Names in
 * quotes (recordings, mandates, cases, queries) stay as they were recorded; a summary of a template
 * not listed here is shown as recorded.
 */
import type { LedgerEntryInfo } from './api';


type Rule = [RegExp, (m: RegExpMatchArray, name: (s: string) => string) => string];

const RULES: Rule[] = [
  [/^Anmeldung abgelehnt$/, () => 'Sign-in refused'],
  [/^(.+) angemeldet$/, (m, n) => `${n(m[1]!)} signed in`],
  [/^(.+) abgemeldet$/, (m, n) => `${n(m[1]!)} signed out`],
  [/^Mandat „(.+)“ für den Testbetrieb angelegt$/, (m) => `Mandate “${m[1]}” created for the trial`],
  [/^Mandat „(.+)“ angelegt$/, (m) => `Mandate “${m[1]}” created`],
  [/^Mandat „(.+)“ geschlossen$/, (m) => `Mandate “${m[1]}” closed`],
  [/^Arbeit unter Mandat „(.+)“ aufgenommen$/, (m) => `Work started under mandate “${m[1]}”`],
  [/^Übungsmandat „(.+)“ angelegt$/, (m) => `Exercise mandate “${m[1]}” created`],
  [/^Aufzeichnung „(.+)“ übernommen \((.+)\)$/, (m, n) => `Recording “${m[1]}” taken in (${n(m[2]!)})`],
  [/^Aufzeichnung „(.+)“ nach Ablauf der Löschfrist \((\d+) Tage\) gelöscht$/, (m) => `Recording “${m[1]}” deleted after the retention period (${m[2]} days)`],
  [/^Aufzeichnung „(.+)“ gelöscht$/, (m) => `Recording “${m[1]}” deleted`],
  [/^Anfrage abgelehnt \((.+)\)$/, (m) => `Query refused (${m[1]})`],
  [/^Suche „(.+)“: (\d+) Treffer$/, (m) => `Search “${m[1]}”: ${m[2]} ${m[2] === '1' ? 'hit' : 'hits'}`],
  [/^Fundstelle zu „(.+)“ in einem Bild gezeigt$/, (m) => `Match for “${m[1]}” shown in a frame`],
  [/^Quelle „(.+)“ angelegt$/, (m) => `Source “${m[1]}” created`],
  [/^Quelle „(.+)“ geändert$/, (m) => `Source “${m[1]}” changed`],
  [/^Quelle „(.+)“ entfernt$/, (m) => `Source “${m[1]}” removed`],
  [/^Direktbild „(.+)“ getrennt$/, (m) => `Live feed “${m[1]}” disconnected`],
  [/^Übungsmaterial „(.+)“ eingespielt$/, (m) => `Exercise material “${m[1]}” installed`],
  [/^Übungsmaterial „(.+)“ entfernt$/, (m) => `Exercise material “${m[1]}” removed`],
  [/^Übung „(.+)“ gestartet \((.+)×\)$/, (m) => `Exercise “${m[1]}” started (${m[2]}×)`],
  [/^Übung „(.+)“ beendet, Ergebnisse verworfen$/, (m) => `Exercise “${m[1]}” stopped, results discarded`],
  [/^Wache abgelehnt \((.+)\)$/, (m) => `Watch refused (${m[1]})`],
  [/^Beschreibung am Bestand geprüft: „(.+)“, (\d+) von (\d+) Bildern$/, (m) => `Description tested on the holdings: “${m[1]}”, ${m[2]} of ${m[3]} frames`],
  [/^Wache „(.+)“ aufgestellt$/, (m) => `Watch “${m[1]}” set up`],
  [/^Wache „(.+)“ geändert$/, (m) => `Watch “${m[1]}” changed`],
  [/^Wache „(.+)“ abgezogen$/, (m) => `Watch “${m[1]}” withdrawn`],
  [/^Wache „(.+)“ nachgeschärft \(Version (\d+) → (\d+)\)$/, (m) => `Watch “${m[1]}” retrained (version ${m[2]} → ${m[3]})`],
  [/^Gelerntes der Wache „(.+)“ verworfen \(Version (\d+)\)$/, (m) => `Learning of watch “${m[1]}” discarded (version ${m[2]})`],
  [/^Meldung „(.+)“ von (.+) \((\d+) %\)$/, (m, n) => `Alert “${m[1]}” from ${n(m[2]!)} (${m[3]} %)`],
  [/^Lage „(.+)“: (.+)$/, (m) => `Incident “${m[1]}”: ${m[2]}`],
  [/^Vorgang „(.+)“ angelegt$/, (m) => `Case “${m[1]}” created`],
  [/^Beweisstück zu Vorgang (.+) genommen$/, (m) => `Evidence added to case ${m[1]}`],
  [/^Beweisstück aus Vorgang (.+) entfernt$/, (m) => `Evidence removed from case ${m[1]}`],
  [/^Vermerk zu Vorgang (.+)$/, (m) => `Note on case ${m[1]}`],
  [/^Vorgang „(.+)“ versiegelt$/, (m) => `Case “${m[1]}” sealed`],
  [/^Vorgang „(.+)“ als Bericht ausgegeben$/, (m) => `Case “${m[1]}” exported as a report`],
  [/^Lagebericht erzeugt$/, () => 'Situation report created'],
  [/^Messbericht erzeugt$/, () => 'Measurement report created'],
  [/^Protokoll geprüft: unversehrt \((\d+) Einträge\)$/, (m) => `Ledger verified: intact (${m[1]} entries)`],
  [/^Protokoll geprüft: BESCHÄDIGT \((\d+) Einträge\)$/, (m) => `Ledger verified: DAMAGED (${m[1]} entries)`],
  [/^Protokoll exportiert$/, () => 'Ledger exported'],
  [/^Stichprobe gezogen: (\d+) von (\d+) Abfragen$/, (m) => `Sample drawn: ${m[1]} of ${m[2]} queries`],
  [/^Lagen als GeoJSON ausgegeben \((\d+)\)$/, (m) => `Incidents exported as GeoJSON (${m[1]})`],
  [/^Lage „(.+)“ als CAP-Meldung ausgegeben$/, (m) => `Incident “${m[1]}” exported as a CAP alert`],
  [/^Aufhebung der Maskierung abgelehnt: Freigabe ungültig$/, () => 'Unmasking refused: approval invalid'],
  [/^Aufhebung der Maskierung abgelehnt: Freigabe durch die anfragende Person selbst$/, () => 'Unmasking refused: approved by the requesting person'],
  [/^Maskierung für „(.+)“ aufgehoben \(Freigabe: (.+)\)$/, (m, n) => `Masking lifted for “${m[1]}” (approved by ${n(m[2]!)})`],
  [/^Fremdanfragen von (.+) ausgesetzt: mehr als (\d+) in (\d+) Minuten$/, (m) => `Queries from ${m[1]} suspended: more than ${m[2]} in ${m[3]} minutes`],
  [/^Fremdanfrage von (.+) abgelehnt \((.+)\)$/, (m) => `Query from ${m[1]} refused (${m[2]})`],
  [/^Fremdanfrage von (.+): „(.+)“, (\d+) Treffer freigegeben$/, (m) => `Query from ${m[1]}: “${m[2]}”, ${m[3]} hits released`],
  [/^Protokollstand von (.+) bezeugt$/, (m) => `Ledger head of ${m[1]} witnessed`],
  [/^Vorführbestand eingespielt: (\d+) Aufzeichnungen$/, (m) => `Demonstration holdings installed: ${m[1]} recordings`],
  [/^Knoten (.+) gestartet \(Version (.+)\)$/, (m, n) => `Node ${n(m[1]!)} started (version ${m[2]})`],
  [/^Ortung neu angestoßen$/, () => 'Fix recomputation started'],
  [/^Grundwahrheit für (\d+) Videos? hinterlegt$/, (m) => `Ground truth stored for ${m[1]} ${m[1] === '1' ? 'video' : 'videos'}`],
];

/**
 * The summary in English, or the recorded German summary when no template matches. `name`
 * words names the console knows (accounts, sources, the node) in English.
 */
export function ledgerSummaryEn(summary: string, name: (s: string) => string): string {
  for (const [re, make] of RULES) {
    const m = summary.match(re);
    if (m) return make(m, name);
  }
  return summary;
}

/** The English summary of an entry: the one the node recorded, else the console's wording of the German one. */
export function ledgerEnglish(entry: Pick<LedgerEntryInfo, 'summary' | 'summaryEn'>, name: (s: string) => string): string {
  return entry.summaryEn !== undefined && entry.summaryEn !== '' ? entry.summaryEn : ledgerSummaryEn(entry.summary, name);
}
