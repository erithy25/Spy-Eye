/**
 * Returns the nodes of the demonstration to their prepared state: `pnpm demo:reset`.
 *
 * After a rehearsal the nodes hold alerts, verdicts, a retrained watch, cases and ledger entries.
 * This command restores what "pnpm demo:prepare" left behind, in a second and without analysing
 * the footage again. The nodes must be stopped. Everything that happened since the preparation is
 * removed, the ledger entries included; that is the point of it, and the reason why a node in
 * operation offers nothing of the kind.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../config.js';
import { restorePreparedState } from './prepared.js';

interface NodeEntry {
  name: string;
  region: string;
  port: number;
  dataDir: string;
}

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}

async function reachable(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/public/info`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  const nodesFile = path.resolve(repoRoot, argument('nodes', 'nodes.demo.json'));
  const nodes = (JSON.parse(await fs.readFile(nodesFile, 'utf8')) as { nodes: NodeEntry[] }).nodes;

  const running = (await Promise.all(nodes.map((n) => reachable(n.port)))).some(Boolean);
  if (running) {
    say('Die Knoten laufen noch. Die Vorführung zuerst beenden (Strg+C im Fenster von „pnpm demo“), dann erneut zurücksetzen.');
    process.exit(1);
  }

  let missing = 0;
  for (const node of nodes) {
    const dataDir = path.isAbsolute(node.dataDir) ? node.dataDir : path.resolve(repoRoot, node.dataDir);
    const result = await restorePreparedState(dataDir);
    const label = (node.region || node.name).padEnd(10);
    if (!result) {
      missing++;
      say(`  ${label} kein vorbereiteter Stand vorhanden`);
      continue;
    }
    const when = new Date(result.preparedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    say(
      `  ${label} Stand vom ${when} wiederhergestellt · ${result.recordings} Aufzeichnungen${
        result.removedRecordings > 0 ? ` · ${result.removedRecordings} seither hinzugekommene entfernt` : ''
      }`,
    );
  }
  if (missing > 0) {
    say('\nFür Knoten ohne vorbereiteten Stand: „pnpm demo:prepare“ ausführen. Der Befehl legt den Stand an.');
    process.exit(1);
  }
  say('\nZurückgesetzt. Start der Vorführung: pnpm demo');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
