import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import type { PeerRecord } from './intel/federation.js';
import { externalPeer, pairSecret, type ExternalPeer } from './intel/peerConfig.js';
import { checkFfmpeg } from './media/ffmpeg.js';
import { PlatformNode, VERSION, nodeScheme, type NodeConfig } from './node.js';
import { createSharedRuntime } from './runtime.js';
import { restorePreparedState, snapshotPreparedState } from './scripts/prepared.js';

interface NodesFile {
  /** Secret from which the pairwise federation keys of the nodes in this file are derived. */
  federationSecret: string;
  nodes: {
    id: string;
    name: string;
    operator: string;
    region: string;
    lat: number;
    lon: number;
    port: number;
    /** Address this node listens on; the default accepts connections from this machine only. */
    host?: string;
    dataDir: string;
    /**
     * The nodes this node federates with: the id of another node in this file (same machine), or
     * the description of a node on another machine with the address it is reached at.
     */
    peers: (string | ExternalPeer)[];
    /** Optional directory (relative to the repository) with seed footage for a fresh node. */
    seed?: string;
    /** false: "--prepare" does not load the exercise footage into this node (DATUM). */
    exercise?: boolean;
    /** true: the recordings of the seed footage are exempt from retention (DATUM reference set). */
    keepSeed?: boolean;
  }[];
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function fromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

async function loadNodeConfigs(): Promise<NodeConfig[]> {
  const flag = process.argv.indexOf('--nodes');
  const file = flag >= 0 ? process.argv[flag + 1] : process.env['SICHT_NODES_FILE'];
  if (!file) {
    return [
      {
        id: env('SICHT_NODE_ID', 'knoten-1'),
        name: env('SICHT_NODE_NAME', 'Lagezentrum'),
        operator: env('SICHT_NODE_OPERATOR', 'Katastrophenschutzbehörde'),
        region: env('SICHT_NODE_REGION', ''),
        lat: Number(env('SICHT_NODE_LAT', '50.3569')),
        lon: Number(env('SICHT_NODE_LON', '7.589')),
        host: config.host,
        port: config.port,
        dataDir: config.dataDir,
        peers: [],
      },
    ];
  }
  const parsed = JSON.parse(await fs.readFile(fromRoot(file), 'utf8')) as NodesFile;
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) throw new Error(`${file}: no nodes defined`);
  for (const n of parsed.nodes) if (!Array.isArray(n.peers)) n.peers = [];
  if (parsed.nodes.some((n) => n.peers.some((p) => typeof p === 'string')) && (typeof parsed.federationSecret !== 'string' || parsed.federationSecret.length < 16)) {
    throw new Error(`${file}: "federationSecret" fehlt oder ist kürzer als 16 Zeichen; aus ihm werden die Schlüssel zwischen den Knoten abgeleitet.`);
  }
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
  return parsed.nodes.map((n): NodeConfig => {
    const peers: PeerRecord[] = [];
    for (const peerId of n.peers) {
      if (typeof peerId !== 'string') {
        // A node on another machine, described with its address.
        const external = externalPeer(file, n.id, peerId, parsed.federationSecret);
        if (peers.some((p) => p.id === external.id) || byId.has(external.id)) throw new Error(`${file}: Nachbar "${external.id}" von "${n.id}" ist doppelt genannt.`);
        peers.push(external);
        continue;
      }
      const peer = byId.get(peerId);
      if (!peer) throw new Error(`${file}: node "${n.id}" lists unknown peer "${peerId}"`);
      peers.push({
        id: peer.id,
        name: peer.name,
        operator: peer.operator,
        region: peer.region,
        url: `${nodeScheme()}://127.0.0.1:${peer.port}`,
        lat: peer.lat,
        lon: peer.lon,
        secret: pairSecret(parsed.federationSecret, n.id, peer.id),
      });
    }
    return {
      id: n.id,
      name: n.name,
      operator: n.operator,
      region: n.region,
      lat: n.lat,
      lon: n.lon,
      host: typeof n.host === 'string' && n.host.trim() !== '' ? n.host.trim() : config.host,
      port: n.port,
      dataDir: fromRoot(n.dataDir),
      peers,
      ...(n.seed ? { seedDir: fromRoot(n.seed) } : {}),
      ...(n.exercise === false ? { exercise: false } : {}),
      ...(n.keepSeed === true ? { keepSeed: true } : {}),
    };
  });
}

/** Prints the progress of the analysis until every node has worked through what it holds. */
async function waitForAnalysis(nodes: PlatformNode[]): Promise<number> {
  for (;;) {
    const parts = nodes.map((n) => {
      const videos = n.store.infos();
      const done = videos.filter((v) => v.status === 'ready').length;
      const failed = videos.filter((v) => v.status === 'error').length;
      return { name: n.info.region || n.info.name, done, failed, total: videos.length, located: n.datum.outstanding };
    });
    process.stdout.write(
      `\r  Auswertung: ${parts.map((p) => `${p.name} ${p.done}/${p.total}${p.failed > 0 ? ` (${p.failed} Fehler)` : ''}${p.located > 0 ? `, Ortung offen: ${p.located}` : ''}`).join(' · ')}   `,
    );
    if (parts.every((p) => p.done + p.failed >= p.total && p.located === 0)) return parts.reduce((sum, p) => sum + p.failed, 0);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * `--prepare`: lets every node finish analysing what it holds, loads the exercise footage into
 * the first node, analyses that, then exits. Run once before a demonstration so that nothing has
 * to be computed in front of the audience.
 */
async function prepare(nodes: PlatformNode[], ready: Promise<unknown>, say: (line: string) => void): Promise<void> {
  await ready;
  await Promise.all(nodes.map((n) => n.settled));
  const started = Date.now();
  // The archives of the nodes first, the exercise afterwards: analysed side by side they would
  // share the processor, and the analysis speed each node reports would be lower than it is.
  let failed = await waitForAnalysis(nodes);
  const first = nodes[0];
  if (first?.cfg.exercise !== false && first?.scenario.definition && first.scenario.info().status === 'absent') {
    try {
      await first.scenario.installFootage();
    } catch (err: unknown) {
      say(`\n  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    failed = await waitForAnalysis(nodes);
  }
  await Promise.allSettled(nodes.map((n) => n.stop()));
  // The state reached here is kept, so that a rehearsal can be undone with "pnpm demo:reset"
  // without analysing the footage again.
  if (failed === 0) for (const node of nodes) await snapshotPreparedState(node.cfg.dataDir);
  say(`\n  Vorbereitet in ${Math.round((Date.now() - started) / 1000)} s${failed > 0 ? `, ${failed} Aufnahme(n) mit Fehler` : ''}. Start: ${nodes.some((n) => n.cfg.exercise === false) ? 'pnpm datum' : 'pnpm demo'}`);
  process.exit(failed > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  const configs = await loadNodeConfigs();
  say(configs.some((c) => c.exercise === false) ? `DATUM ${VERSION}` : `Sicht ${VERSION}`);
  say(`  ${await checkFfmpeg()}`);
  if (process.argv.includes('--prepare')) {
    // Preparing twice must not turn a rehearsal into the starting point: where a prepared state
    // exists it is put back first, and only what is missing since is analysed.
    for (const cfg of configs) {
      const restored = await restorePreparedState(cfg.dataDir);
      if (restored) say(`  ${cfg.name}: vorbereiteter Stand wiederhergestellt, ${restored.recordings} Aufzeichnungen`);
    }
  }
  const shared = await createSharedRuntime(say);
  const nodes = configs.map((cfg) => new PlatformNode(cfg, shared));
  for (const node of nodes) {
    await node.start(true);
    say(`  ${node.info.name}: ${nodeScheme()}://${node.cfg.host === '0.0.0.0' ? '127.0.0.1' : node.cfg.host}:${node.cfg.port}`);
  }
  const first = nodes[0];
  if (process.argv.includes('--prepare')) {
    await prepare(nodes, shared.ready, say);
    return;
  }
  if (first?.auth.demoMode) {
    say(`  Demo-Zugänge: ${first.auth.listUsers().map((u) => u.id).join(', ')} · Passwort: ${first.auth.demoHint || 'vom Betreiber gesetzt'}`);
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    say('Beende …');
    // The worker threads are deliberately not closed here. Closing an inference thread fails the
    // calls in it while the event loop still runs, and the pipeline then stores a recording that
    // is mid-analysis as failed ("Rechenthread wurde beendet"), which the next start never
    // analyses again. Ending the process right after the nodes leaves that work unfinished, so it
    // is redone at the next start. The inference threads finish their runs and release their
    // sessions during the exit itself (drainAtExit in ml/workerHost.ts, synchronous, so nothing
    // else runs meanwhile); the gallery search thread holds no native resources.
    Promise.allSettled(nodes.map((n) => n.stop())).then(
      () => process.exit(0),
      () => process.exit(1),
    );
    // Whatever has not ended after 4 s does not hold the process any longer.
    setTimeout(() => process.exit(0), 4000).unref();
  };
  // Work that runs beside a request (delayed writes, retention, stream scans) reports its failure
  // here instead of ending the process: a full disk must not take three nodes down mid-operation.
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(`  Fehler im Hintergrund: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // A parent that started the nodes as a child process (the demonstration check) asks for an
  // orderly end this way; Windows has no signal that a process could catch.
  process.on('message', (message: unknown) => {
    if (message === 'shutdown') shutdown();
  });
}

main().catch((err: unknown) => {
  const failure = err as NodeJS.ErrnoException & { port?: number };
  if (failure.code === 'EADDRINUSE') {
    // The usual cause on a demonstration day: the nodes are already running in another window.
    process.stderr.write(
      `\nAnschluss ${failure.port ?? ''} ist bereits belegt. Läuft Sicht schon in einem anderen Fenster? Dann dort weiterarbeiten oder es mit Strg+C beenden.\n` +
        'Läuft dort noch eine frühere Fassung (Spy-Eye), deren Fenster mit Strg+C beenden und neu starten.\n' +
        'Hält ein anderes Programm den Anschluss, lässt er sich mit PORT (ein Knoten) oder in der Knotendatei (mehrere Knoten) ändern.\n',
    );
  } else if (failure.code === 'EACCES' && failure.port !== undefined) {
    process.stderr.write(`\nAnschluss ${failure.port} darf nicht geöffnet werden. Einen Anschluss über 1024 wählen (PORT oder Knotendatei).\n`);
  } else {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  }
  process.exit(1);
});
