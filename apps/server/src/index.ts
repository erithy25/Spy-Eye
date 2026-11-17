import Fastify, { LogController } from 'fastify';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { EventHub } from './events.js';
import { checkFfmpeg } from './media/ffmpeg.js';
import { EmbeddingModel } from './ml/model.js';
import { loadVocabulary } from './ml/vocab.js';
import { Pipeline } from './pipeline.js';
import { registerRoutes } from './routes.js';
import { SearchEngine } from './search.js';
import { Store } from './store.js';

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    // Uploads are streamed to disk; the body limit only applies to non-multipart requests.
    bodyLimit: 1024 * 1024,
  });
  const log = {
    info: (msg: string) => app.log.info(msg),
    error: (msg: string) => app.log.error(msg),
  };

  await fs.mkdir(config.dataDir, { recursive: true });
  const ffmpegVersion = await checkFfmpeg();
  log.info(`Using ${ffmpegVersion}`);

  const store = new Store();
  const model = new EmbeddingModel();
  const hub = new EventHub();
  const pipeline = new Pipeline(store, model, hub, log);
  const search = new SearchEngine(store, model);

  model.onState((state) => hub.broadcast({ type: 'model', model: state }));

  const pending = await store.load(log.info);
  log.info(`Loaded ${store.all().length} video(s) from ${config.dataDir}; ${pending.length} pending`);

  await registerRoutes(app, { store, model, pipeline, search, hub });

  // Load the model in the background so the UI is reachable (and shows progress) immediately.
  const modelReady = (async (): Promise<void> => {
    await model.load();
    const vocabulary = await loadVocabulary(model, (done, total) => {
      model.updateState({ message: `Berechne Tag-Vokabular … ${done}/${total}` });
    });
    pipeline.setVocabulary(vocabulary);
    model.updateState({ vocabSize: vocabulary.labels.length, message: 'Bereit' });
    log.info(`Model ${config.modelId} (${config.modelDtype}) ready: dim ${model.dim}, ${vocabulary.labels.length} tags`);
  })();
  pipeline.setReadyGate(modelReady);
  modelReady
    .then(() => {
      for (const id of pending) pipeline.enqueue(id);
    })
    .catch((err: unknown) => {
      log.error(`Model initialisation failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    pipeline.shutdown();
    hub.close();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
