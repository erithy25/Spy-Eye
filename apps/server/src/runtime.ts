import path from 'node:path';
import { config } from './config.js';
import { FaceDetector } from './ml/faces.js';
import { HazardHead } from './ml/head.js';
import { SEARCH_CALIBRATION } from './ml/calibration.js';
import { EmbeddingModel, loadingNotes, meanRow } from './ml/model.js';
import { loadVocabulary } from './ml/vocab.js';
import type { SharedRuntime } from './node.js';

/**
 * Loads what all nodes of a process share: the embedding model, the face detector and the hazard
 * model. Returns as soon as the small hazard model is read; `ready` resolves when the embedding
 * model is loaded and searching and analysis can start.
 */
export async function createSharedRuntime(say: (line: string) => void): Promise<SharedRuntime> {
  const model = new EmbeddingModel();
  const faces = new FaceDetector();
  let hazard: HazardHead | null = null;
  try {
    // One trained head per image encoder: the head only fits the embeddings it was trained on.
    const slug = (config.modelId.split('/').pop() ?? config.modelId).toLowerCase();
    hazard = await HazardHead.load(path.join(config.assetsDir, `hazard-head.${slug}.json`));
    if (hazard && hazard.encoder !== config.modelId) {
      say(`  Gefahren-Modell wurde für ${hazard.encoder} trainiert und ist mit ${config.modelId} nicht nutzbar.`);
      hazard = null;
    }
  } catch (err: unknown) {
    say(`  Gefahren-Modell nicht ladbar: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The first start fetches the model files, which takes minutes; the notes show that it moves.
  const note = loadingNotes();
  model.onState((state) => {
    if (state.phase !== 'loading') return;
    const text = note(state.message);
    if (text !== null) say(`  ${text}`);
  });

  const ready = (async () => {
    await Promise.all([model.load(), faces.load()]);
    const vocabulary = await loadVocabulary(model, (done, total) => {
      model.updateState({ message: `Berechne Tag-Vokabular … ${done}/${total}` });
    });
    // The vocabulary doubles as a sample of ordinary captions: its mean is what search queries
    // are centred with.
    model.setSearchCentre(meanRow(vocabulary.embeddings, vocabulary.dim), SEARCH_CALIBRATION[model.family].centring);
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
  return { model, faces, hazard, ready };
}
