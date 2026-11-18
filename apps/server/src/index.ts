import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import type { PeerRecord } from './intel/federation.js';
import { checkFfmpeg } from './media/ffmpeg.js';
import { FaceDetector } from './ml/faces.js';
import { HazardHead } from './ml/head.js';
import { EmbeddingModel } from './ml/model.js';
import { loadVocabulary } from './ml/vocab.js';
import { PlatformNode, VERSION, type NodeConfig, type SharedRuntime } from './node.js';

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
    };
  });
}

async function main(): Promise<void> {
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  say(`Sicht ${VERSION}`);
  say(`  ${await checkFfmpeg()}`);

  const model = new EmbeddingModel();
  const faces = new FaceDetector();
  let hazard: HazardHead | null = null;
  try {
    hazard = await HazardHead.load(path.join(config.assetsDir, 'hazard-head.json'));
    if (hazard && hazard.encoder !== config.modelId) {
      say(`  Gefahren-Modell wurde für ${hazard.encoder} trainiert und ist mit ${config.modelId} nicht nutzbar.`);
      hazard = null;
    }
  } catch (err: unknown) {
    say(`  Gefahren-Modell nicht ladbar: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Load in the background so the consoles are reachable (and show progress) immediately.
  let lastMessage = '';
  model.onState((state) => {
    if (state.phase === 'loading' && state.message !== lastMessage && !state.message.startsWith('Lade Modellgewichte')) {
      lastMessage = state.message;
      say(`  ${state.message}`);
    }
  });
  const ready = (async () => {
    await Promise.all([model.load(), faces.load()]);
    const vocabulary = await loadVocabulary(model, (done, total) => {
      model.updateState({ message: `Berechne Tag-Vokabular … ${done}/${total}` });
    });
    model.updateState({ vocabSize: vocabulary.labels.length, message: 'Bereit' });
    say(`  Modell ${config.modelId} bereit (${model.state.device}, ${model.dim} Dimensionen, ${vocabulary.labels.length} Tags)`);
    if (model.state.notice !== '') say(`  Hinweis: ${model.state.notice}`);
    say(faces.ready ? '  Gesichtsmaskierung aktiv' : `  Gesichtsmaskierung NICHT aktiv: ${faces.problem ?? 'unbekannt'}`);
    say(hazard ? `  Gefahren-Modell ${hazard.card.version} aktiv (${hazard.classes.join(', ')})` : '  Gefahren-Modell nicht aktiv');
    return vocabulary;
  })();
  ready.catch((err: unknown) => {
    say(`  Modell konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
  });

  const shared: SharedRuntime = { model, faces, hazard, ready };
  const nodes = (await loadNodeConfigs()).map((cfg) => new PlatformNode(cfg, shared));
  for (const node of nodes) {
    await node.start(true);
    say(`  ${node.info.name}: http://${node.cfg.host === '0.0.0.0' ? '127.0.0.1' : node.cfg.host}:${node.cfg.port}`);
  }
  const first = nodes[0];
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
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
