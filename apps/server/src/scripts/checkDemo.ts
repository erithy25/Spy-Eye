/**
 * Checks a prepared demonstration from end to end: `pnpm demo:check`.
 *
 * Looks at the machine (ffmpeg, footage), then asks the nodes of the demonstration what a
 * presenter will ask them: sign in, choose the mandate, search in German, ask the neighbours,
 * get a refusal, verify the ledger. If the nodes are not running, they are started for the check
 * and stopped afterwards. Every line ends in OK or FEHLT; the exit code is non-zero when
 * anything is missing, so the output can be passed on as it is.
 *
 * The check signs in as the supervisor of the demonstration and therefore leaves entries in the
 * ledgers of the nodes, like any other use.
 */
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, repoRoot } from '../config.js';
import { checkFfmpeg } from '../media/ffmpeg.js';
import type { AppState, FederatedResult, IntelSnapshot, Mandate, PeerInfo, PublicInfo, SearchResponse } from '../types.js';
import { collectFootage, footagePresent } from './footage.js';

interface NodeEntry {
  id: string;
  name: string;
  region: string;
  port: number;
  peers: string[];
  seed?: string;
}

/** A German query that the seed archives of the peers answer and the encoder must understand. */
const QUERY = 'überflutete Wiese';
/** A query the prompt guard has to refuse. */
const REFUSED_QUERY = 'Gesicht von Herrn Müller';
const WIDTH = 64;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const write = (text: string): void => void process.stdout.write(text);

let open = 0;

function line(label: string, ok: boolean, hint = ''): void {
  if (!ok) open++;
  const text = label.length > WIDTH ? `${label.slice(0, WIDTH - 1)}…` : label;
  write(`  ${text.padEnd(WIDTH)}  ${ok ? 'OK' : 'FEHLT'}\n`);
  if (!ok && hint !== '') write(`      → ${hint}\n`);
}

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}

interface Answer<T> {
  status: number;
  data: T | null;
  error: string;
  rule: string;
}

/** One signed-in conversation with a node. */
class Client {
  private cookie = '';

  constructor(private readonly base: string) {}

  async call<T>(method: 'GET' | 'POST', route: string, body?: unknown, timeoutMs = 60_000): Promise<Answer<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie !== '') headers['cookie'] = this.cookie;
    const response = await fetch(`${this.base}${route}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? '';
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    const failure = !response.ok && parsed !== null && typeof parsed === 'object' ? (parsed as { error?: unknown; rule?: unknown }) : null;
    return {
      status: response.status,
      data: response.ok ? (parsed as T | null) : null,
      error: failure && typeof failure.error === 'string' ? failure.error : response.ok ? '' : `HTTP ${response.status}`,
      rule: failure && typeof failure.rule === 'string' ? failure.rule : '',
    };
  }
}

async function reachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/public/info`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

const decimal = (value: number): string => value.toFixed(2).replace('.', ',');

/** Signs in and puts the session under a mandate; returns null (after reporting) when that fails. */
async function signIn(node: NodeEntry): Promise<Client | null> {
  const client = new Client(`http://127.0.0.1:${node.port}`);
  const login = await client.call<{ user: { name: string } }>('POST', '/api/login', { user: 'leitung', password: config.demoPassword });
  line('Anmeldung als leitung', login.data !== null, `${login.error} Passwort der Vorführung: SICHT_DEMO_PASSWORD, voreingestellt „lagebild“.`);
  if (!login.data) return null;

  const mandates = (await client.call<Mandate[]>('GET', '/api/mandates')).data ?? [];
  const usable = mandates.filter((m) => m.status === 'open' && (m.validTo === null || m.validTo > Date.now()));
  const mandate = usable.find((m) => m.exercise) ?? usable[0];
  if (!mandate) {
    line('Mandat', false, 'Kein gültiges Mandat vorhanden. Ohne Mandat ist keine Auswertung möglich.');
    return null;
  }
  const chosen = await client.call<unknown>('POST', '/api/session/mandate', { id: mandate.id });
  line(`Mandat „${mandate.title}“`, chosen.data !== null, chosen.error);
  return chosen.data !== null ? client : null;
}

async function checkNode(node: NodeEntry, nodes: NodeEntry[], first: boolean): Promise<void> {
  write(`\n${node.name} · http://127.0.0.1:${node.port}\n`);
  const info = await new Client(`http://127.0.0.1:${node.port}`).call<PublicInfo>('GET', '/api/public/info');
  if (!info.data) {
    line('Knoten antwortet', false, 'Der Knoten ist nicht erreichbar.');
    return;
  }
  const client = await signIn(node);
  if (!client) return;

  const state = (await client.call<AppState>('GET', '/api/state')).data;
  const model = state?.model;
  line(
    model ? `Modell ${model.modelId.split('/').pop() ?? model.modelId} auf ${model.device}` : 'Modell',
    model?.phase === 'ready',
    model?.phase === 'loading' ? 'Das Modell lädt noch; den Befehl in einer Minute wiederholen.' : (model?.message ?? 'Kein Modellzustand.'),
  );
  if (model && model.notice !== '') write(`      Hinweis: ${model.notice}\n`);
  const videos = state?.videos ?? [];
  const analysed = videos.filter((v) => v.status === 'ready').length;
  const failed = videos.filter((v) => v.status === 'error').length;
  line(
    `Aufzeichnungen ausgewertet: ${analysed} von ${videos.length}`,
    videos.length > 0 && analysed === videos.length,
    failed > 0
      ? `${failed} Aufnahme(n) mit Fehler. „pnpm exercise:fetch“ und danach „pnpm demo:prepare“ wiederholen.`
      : videos.length === 0
        ? 'Noch kein Material eingespielt. „pnpm demo:prepare“ ausführen.'
        : 'Die Auswertung läuft noch. „pnpm demo:prepare“ ausführen und abwarten.',
  );

  if (first) {
    const intel = (await client.call<IntelSnapshot>('GET', '/api/intel')).data;
    const scenario = intel?.scenario;
    const exerciseWatches = (intel?.watches ?? []).filter((w) => w.id.startsWith('wa_exercise_')).length;
    line(
      scenario ? `Übung „${scenario.title}“: ${scenario.clipsReady} von ${scenario.clipsTotal} Aufnahmen, ${exerciseWatches} Wachen` : 'Übung',
      scenario !== undefined && scenario.status !== 'absent' && scenario.status !== 'installing' && scenario.clipsReady === scenario.clipsTotal && exerciseWatches > 0,
      scenario?.status === 'absent' ? 'Das Übungsmaterial ist nicht eingespielt. „pnpm demo:prepare“ ausführen.' : 'Die Übung ist nicht bereit. „pnpm demo:prepare“ ausführen.',
    );
    if (scenario && (scenario.status === 'running' || scenario.status === 'paused' || scenario.status === 'finished')) {
      write('      Hinweis: Es läuft bereits eine Übung oder ihr Ergebnis steht noch. Vor der Vorführung in der Konsole beenden.\n');
    }
  }

  if (node.seed !== undefined) {
    const search = await client.call<SearchResponse>('GET', `/api/search?q=${encodeURIComponent(QUERY)}&limit=12`);
    const best = search.data?.results[0];
    line(
      search.data ? `Suche „${QUERY}“: ${search.data.matched} Treffer${best ? `, bester ${decimal(best.confidence)}` : ''}, ${search.data.tookMs.toFixed(0)} ms` : `Suche „${QUERY}“`,
      // What is checked is that the encoder separates footage at all; whether the best recording
      // lies just above or just below the cut-off depends on the footage of the node.
      search.data !== null && best !== undefined && best.confidence >= 0.3,
      search.data
        ? 'Die Suche findet im Bestand nichts Passendes. Das deutet auf ein Modell, das falsch rechnet: „pnpm selftest“ ausführen und ohne ML_DEVICE starten.'
        : search.error,
    );
  }

  if (node.peers.length > 0) {
    const names = new Map(nodes.map((n) => [n.id, n.region || n.name]));
    // Nodes greet each other on start and every few seconds; allow a fresh start one round.
    let offline: string[] = [];
    for (let attempt = 0; attempt < 15; attempt++) {
      const peers = (await client.call<PeerInfo[]>('GET', '/api/peers')).data ?? [];
      offline = node.peers.filter((id) => !peers.some((p) => p.id === id && p.online));
      if (offline.length === 0) break;
      await sleep(2000);
    }
    line(
      `Nachbarn erreichbar: ${node.peers.map((id) => names.get(id) ?? id).join(', ')}`,
      offline.length === 0,
      `Nicht erreichbar: ${offline.map((id) => names.get(id) ?? id).join(', ')}. Die Knoten melden sich alle paar Sekunden; kurz warten und wiederholen.`,
    );
  }

  if (first && node.peers.length > 0) {
    const search = await client.call<SearchResponse & { federated?: FederatedResult[] }>(
      'GET',
      `/api/search?q=${encodeURIComponent(QUERY)}&limit=12&federated=1`,
      undefined,
      90_000,
    );
    const answers = search.data?.federated ?? [];
    const hits = answers.reduce((sum, a) => sum + a.matched, 0);
    const answered = answers.filter((a) => a.ok && a.receipt !== null).length;
    line(
      `Verbundfrage: ${hits} Treffer von ${answered} Nachbarn, je mit Beleg`,
      answers.length === node.peers.length && answered === answers.length && hits > 0,
      search.data ? 'Die Nachbarn antworten nicht vollständig oder finden nichts. Sind alle Knoten vorbereitet („pnpm demo:prepare“)?' : search.error,
    );
    for (const a of answers) {
      write(`      ${a.peerName}: ${a.ok ? `${a.matched} Treffer in ${a.tookMs.toFixed(0)} ms, Beleg #${a.receipt ?? '?'}` : `ohne Antwort (${a.error ?? 'unbekannt'})`}\n`);
    }
  }

  if (first) {
    const refused = await client.call<unknown>('GET', `/api/search?q=${encodeURIComponent(REFUSED_QUERY)}`);
    line(
      `Ablehnung „${REFUSED_QUERY}“${refused.rule !== '' ? ` (Regel ${refused.rule})` : ''}`,
      refused.status === 422 && refused.rule !== '',
      'Die Anfrageprüfung hat eine Anfrage nach einer bestimmten Person nicht abgelehnt.',
    );
  }

  const verify = await client.call<{ ok: boolean; entries: number }>('POST', '/api/ledger/verify');
  line(
    verify.data ? `Protokoll: ${verify.data.ok ? 'Kette unversehrt' : 'KETTE BESCHÄDIGT'}, ${verify.data.entries} Einträge` : 'Protokoll',
    verify.data?.ok === true,
    verify.data ? 'Die Protokollkette ist unterbrochen. Der Datenordner des Knotens wurde außerhalb des Systems verändert.' : verify.error,
  );
  await client.call<unknown>('POST', '/api/logout');
}

async function startNodes(nodesFile: string, nodes: NodeEntry[]): Promise<ChildProcess | null> {
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
  try {
    await fs.access(entry);
  } catch {
    line('Knoten starten', false, 'Der Server ist nicht gebaut. „pnpm build“ ausführen.');
    return null;
  }
  const child = fork(entry, ['--nodes', nodesFile], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));
  let exited = false;
  child.once('exit', () => (exited = true));

  const deadline = Date.now() + 15 * 60_000;
  let last = 0;
  for (;;) {
    if (exited) {
      line('Knoten starten', false, `Der Start ist abgebrochen:\n${log.trim().split('\n').slice(-12).join('\n')}`);
      return null;
    }
    const up = (await Promise.all(nodes.map((n) => reachable(n.port)))).filter(Boolean).length;
    // The nodes listen before the model is loaded; they are ready when the line about the
    // sign-in accounts has been printed.
    if (up === nodes.length && /Demo-Zugänge|Lagezentrum:/.test(log) && /bereit \(/.test(log)) return child;
    if (Date.now() > deadline) {
      line('Knoten starten', false, 'Die Knoten sind nach 15 Minuten nicht bereit.');
      await stopNodes(child);
      return null;
    }
    if (Date.now() - last > 15_000) {
      last = Date.now();
      const status = log.trim().split('\n').pop()?.trim() ?? '';
      if (status !== '') write(`      … ${status.slice(0, 90)}\n`);
    }
    await sleep(1000);
  }
}

async function stopNodes(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (child.connected) child.send('shutdown');
  else child.kill();
  await Promise.race([gone, sleep(8000)]);
  if (child.exitCode === null) child.kill();
}

async function main(): Promise<void> {
  const nodesFile = path.resolve(repoRoot, argument('nodes', 'nodes.demo.json'));
  write('Sicht · Prüfung vor der Vorführung\n\n');
  write(`  ${process.platform} ${process.arch} · Node ${process.version} · ${os.availableParallelism()} Threads · ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB\n\n`);

  let nodes: NodeEntry[];
  try {
    nodes = (JSON.parse(await fs.readFile(nodesFile, 'utf8')) as { nodes: NodeEntry[] }).nodes;
  } catch (err: unknown) {
    line(`Knotendatei ${path.basename(nodesFile)}`, false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  line(`Node ${process.versions.node}`, major > 20 || (major === 20 && minor >= 11), 'Node ab Version 20.11 installieren.');
  try {
    const banner = await checkFfmpeg();
    line(`ffmpeg ${/version\s+(\S+)/.exec(banner)?.[1] ?? ''}`.trim(), true);
  } catch (err: unknown) {
    line('ffmpeg', false, err instanceof Error ? err.message : String(err));
  }
  const footage = await collectFootage();
  const present = (await Promise.all(footage.map(footagePresent))).filter(Boolean).length;
  line(`Übungsmaterial: ${present} von ${footage.length} Aufnahmen`, footage.length > 0 && present === footage.length, '„pnpm exercise:fetch“ ausführen (rund 300 MB).');

  const running = (await Promise.all(nodes.map((n) => reachable(n.port)))).filter(Boolean).length;
  let child: ChildProcess | null = null;
  if (running === nodes.length) {
    line(`Knoten laufen bereits: ${nodes.map((n) => `${n.region || n.name} :${n.port}`).join(' · ')}`, true);
  } else if (running > 0) {
    line('Knoten', false, `Nur ${running} von ${nodes.length} Knoten antworten. Die Vorführung beenden und „pnpm demo“ neu starten; belegt ein anderes Programm einen der Anschlüsse ${nodes.map((n) => n.port).join(', ')}?`);
  } else {
    write('  Die Knoten laufen nicht; sie werden für die Prüfung gestartet.\n');
    child = await startNodes(nodesFile, nodes);
    if (child) line(`Knoten gestartet: ${nodes.map((n) => `${n.region || n.name} :${n.port}`).join(' · ')}`, true);
  }

  if (running === nodes.length || child) {
    try {
      if (child) await sleep(2500);
      for (const [index, node] of nodes.entries()) {
        try {
          await checkNode(node, nodes, index === 0);
        } catch (err: unknown) {
          line(`${node.name}: Prüfung abgebrochen`, false, err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      if (child) await stopNodes(child);
    }
  }

  write(
    open === 0
      ? `\nErgebnis: bereit. Start der Vorführung: pnpm demo${child ? '' : ' (läuft bereits)'}\n`
      : `\nErgebnis: ${open} Punkt${open === 1 ? '' : 'e'} offen, siehe oben.\n`,
  );
  process.exit(open === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
