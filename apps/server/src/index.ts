import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import type { PeerRecord } from './intel/federation.js';
import { checkFfmpeg } from './media/ffmpeg.js';
import { PlatformNode, VERSION, type NodeConfig } from './node.js';
import { createSharedRuntime } from './runtime.js';

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
    dataDir: string;
    /** Ids of other nodes in this file that this node federates with. */
    peers: string[];
    /** Optional directory (relative to the repository) with seed footage for a fresh node. */
    seed?: string;
  }[];
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function fromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

/** One key per pair of nodes, the same on both sides. */
function pairSecret(master: string, a: string, b: string): string {
  return createHmac('sha256', master).update([a, b].sort().join('|')).digest('hex');
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
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
  return parsed.nodes.map((n): NodeConfig => {
    const peers: PeerRecord[] = [];
    for (const peerId of n.peers) {
      const peer = byId.get(peerId);
      if (!peer) throw new Error(`${file}: node "${n.id}" lists unknown peer "${peerId}"`);
      peers.push({
        id: peer.id,
        name: peer.name,
        operator: peer.operator,
        region: peer.region,
        url: `http://127.0.0.1:${peer.port}`,
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
      host: config.host,
      port: n.port,
      dataDir: fromRoot(n.dataDir),
      peers,
      ...(n.seed ? { seedDir: fromRoot(n.seed) } : {}),
    };
  });
}

/**
 * `--prepare`: loads the exercise footage into the first node, lets every node finish analysing
 * what it holds, then exits. Run once before a demonstration so that nothing has to be computed
 * in front of the audience.
 */
async function prepare(nodes: PlatformNode[], ready: Promise<unknown>, say: (line: string) => void): Promise<void> {
  await ready;
  await Promise.all(nodes.map((n) => n.settled));
  const first = nodes[0];
  if (first?.scenario.definition && first.scenario.info().status === 'absent') {
    try {
      await first.scenario.installFootage();
    } catch (err: unknown) {
      say(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  const started = Date.now();
  for (;;) {
    const parts = nodes.map((n) => {
      const videos = n.store.infos();
      const done = videos.filter((v) => v.status === 'ready').length;
      const failed = videos.filter((v) => v.status === 'error').length;
      return { name: n.info.region || n.info.name, done, failed, total: videos.length };
    });
    process.stdout.write(`\r  Auswertung: ${parts.map((p) => `${p.name} ${p.done}/${p.total}${p.failed > 0 ? ` (${p.failed} Fehler)` : ''}`).join(' · ')}   `);
    if (parts.every((p) => p.done + p.failed >= p.total)) {
      const failed = parts.reduce((sum, p) => sum + p.failed, 0);
      say(`\n  Vorbereitet in ${Math.round((Date.now() - started) / 1000)} s${failed > 0 ? `, ${failed} Aufnahme(n) mit Fehler` : ''}. Start der Vorführung: pnpm demo`);
      await Promise.allSettled(nodes.map((n) => n.stop()));
      process.exit(failed > 0 ? 1 : 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main(): Promise<void> {
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  say(`Sicht ${VERSION}`);
  say(`  ${await checkFfmpeg()}`);

  const shared = await createSharedRuntime(say);
  const nodes = (await loadNodeConfigs()).map((cfg) => new PlatformNode(cfg, shared));
  for (const node of nodes) {
    await node.start(true);
    say(`  ${node.info.name}: http://${node.cfg.host === '0.0.0.0' ? '127.0.0.1' : node.cfg.host}:${node.cfg.port}`);
  }
  const first = nodes[0];
  if (process.argv.includes('--prepare')) {
    await prepare(nodes, shared.ready, say);
    return;
  }
  if (first?.auth.demoMode) {
    say(`  Demo-Zugänge: ${first.auth.listUsers().map((u) => u.id).join(', ')} · Passwort: ${first.auth.demoHint}`);
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    say('Beende …');
    Promise.allSettled(nodes.map((n) => n.stop())).then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // A parent that started the nodes as a child process (the demonstration check) asks for an
  // orderly end this way; Windows has no signal that a process could catch.
  process.on('message', (message: unknown) => {
    if (message === 'shutdown') shutdown();
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
