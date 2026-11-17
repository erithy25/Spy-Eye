/**
 * Downloads the model weights into the local cache so the app can run fully offline afterwards
 * (start the server with SPY_EYE_OFFLINE=1 to forbid any network access).
 */
import { config } from '../config.js';
import { EmbeddingModel } from '../ml/model.js';

const model = new EmbeddingModel();
let last = '';
model.onState((state) => {
  if (state.message !== last) {
    last = state.message;
    process.stdout.write(`\r${state.message.padEnd(70)}`);
  }
});

try {
  await model.load();
  process.stdout.write(`\nModell ${config.modelId} (${config.modelDtype}) liegt in ${config.modelCacheDir}\n`);
} catch (err: unknown) {
  process.stderr.write(`\nDownload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
