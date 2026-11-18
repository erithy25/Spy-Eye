/**
 * Downloads the model weights into the local cache so the app can run fully offline afterwards
 * (start the server with SICHT_OFFLINE=1 to forbid any network access).
 */
import { config } from '../config.js';
import { FaceDetector } from '../ml/faces.js';
import { EmbeddingModel } from '../ml/model.js';
import { depthModelId, ensureDepthModel } from '../datum/depth.js';

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
  const faces = new FaceDetector();
  await faces.load();
  process.stdout.write(faces.ready ? 'Gesichts-Detektor für die Maskierung liegt vor.\n' : `Gesichts-Detektor fehlt: ${faces.problem ?? ''}\n`);
  await ensureDepthModel();
  process.stdout.write(`Tiefenmodell ${depthModelId} für den Raum liegt vor.\n`);
  process.exit(faces.ready ? 0 : 1);
} catch (err: unknown) {
  process.stderr.write(`\nDownload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
