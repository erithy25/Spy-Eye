/**
 * Environment check: `pnpm selftest`.
 * Verifies ffmpeg, loads the model on the configured execution provider, runs the built-in probe
 * and prints timings. Exits non-zero when something is wrong, so the output can be shared as-is.
 */
import os from 'node:os';
import { config } from '../config.js';
import { checkFfmpeg } from '../media/ffmpeg.js';
import { EmbeddingModel, loadingNotes } from '../ml/model.js';

const line = (label: string, value: string): void => {
  process.stdout.write(`${label.padEnd(18)}${value}\n`);
};

let failed = false;

line('platform', `${process.platform} ${process.arch}, node ${process.version}`);
line('cpu', `${os.cpus()[0]?.model ?? 'unknown'} · ${os.availableParallelism()} threads`);
line('memory', `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`);
line('data dir', config.dataDir);
line('model', `${config.modelId} (${config.modelDtype})`);
line('ML_DEVICE', config.device);

try {
  line('ffmpeg', await checkFfmpeg());
} catch (err: unknown) {
  failed = true;
  line('ffmpeg', `FEHLT – ${err instanceof Error ? err.message : String(err)}`);
}

const model = new EmbeddingModel();
// Loading can take minutes on the first run (the model files are fetched); show what happens.
const note = loadingNotes();
model.onState((state) => {
  if (state.phase !== 'loading') return;
  const text = note(state.message);
  if (text !== null) line('', text);
});
try {
  const started = Date.now();
  await model.load();
  line('model load', `${((Date.now() - started) / 1000).toFixed(1)} s, dim ${model.dim}, input ${model.imageSize}px`);
  const result = await model.diagnose();
  line('provider', result.device);
  if (model.state.notice !== '') line('notice', model.state.notice);
  line('probe', `${result.agreement}/3 captions matched their picture`);
  line('speed', `${result.imageMs.toFixed(0)} ms per image, ${result.textMs.toFixed(0)} ms per query`);
  if (result.agreement < 2) {
    failed = true;
    line('result', 'FEHLER – das Modell ordnet die Testbilder falsch zu.');
  }
} catch (err: unknown) {
  failed = true;
  line('model', `FEHLER – ${err instanceof Error ? err.message : String(err)}`);
}

line('result', failed ? 'NICHT IN ORDNUNG' : 'OK');
process.exit(failed ? 1 : 0);
