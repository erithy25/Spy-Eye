import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { EmbeddingModel } from './model.js';

/**
 * Built-in concept vocabulary used for the live auto-tagging display and scene labels.
 * Search itself is open-vocabulary and does NOT depend on this list.
 */
export const VOCABULARY: readonly string[] = [
  // people
  'a man', 'a woman', 'a child', 'a baby', 'a group of people', 'a crowd', 'a couple', 'a face', 'hands',
  'a person walking', 'a person running', 'a person sitting', 'a person standing', 'a person talking',
  'a person eating', 'a person drinking', 'a person cooking', 'a person dancing', 'a person sleeping',
  'a person reading', 'a person writing', 'a person working at a computer', 'a person using a phone',
  'a person driving', 'a person riding a bicycle', 'a person riding a motorcycle', 'a person riding a horse',
  'a person swimming', 'a person skiing', 'a person surfing', 'a person skateboarding', 'a person climbing',
  'a person playing soccer', 'a person playing tennis', 'a person playing basketball', 'a person playing guitar',
  'a person singing', 'a person giving a presentation', 'a person shaking hands', 'a person carrying a bag',
  'a person holding a cup', 'a person wearing a helmet', 'a person wearing a suit', 'a person wearing a uniform',
  'a person wearing sunglasses', 'a person wearing a hat', 'a person wearing a mask', 'a police officer',
  'a construction worker', 'a doctor', 'a chef', 'a soldier', 'a cyclist', 'a pedestrian', 'an athlete',
  // vehicles
  'a car', 'a taxi', 'a police car', 'a sports car', 'a van', 'a pickup truck', 'a truck', 'a bus', 'a school bus',
  'a train', 'a tram', 'a subway train', 'a motorcycle', 'a scooter', 'a bicycle', 'an airplane', 'a helicopter',
  'a boat', 'a ship', 'a sailboat', 'an ambulance', 'a fire truck', 'a tractor', 'a forklift', 'a drone',
  'a license plate', 'a traffic jam', 'a parked car',
  // street
  'a street', 'a highway', 'an intersection', 'a crosswalk', 'a sidewalk', 'a traffic light', 'a stop sign',
  'a road sign', 'a parking lot', 'a parking garage', 'a gas station', 'a bridge', 'a tunnel', 'a roundabout',
  'a bus stop', 'a train station', 'an airport', 'a harbor', 'a construction site', 'a street at night',
  // animals
  'a dog', 'a cat', 'a horse', 'a cow', 'a sheep', 'a pig', 'a chicken', 'a bird', 'a duck', 'a fish', 'a shark',
  'a whale', 'a dolphin', 'an elephant', 'a giraffe', 'a zebra', 'a lion', 'a tiger', 'a bear', 'a monkey',
  'a deer', 'a rabbit', 'a squirrel', 'a snake', 'a butterfly', 'a bee', 'a spider',
  // objects
  'a cup', 'a coffee mug', 'a glass', 'a bottle', 'a wine glass', 'a plate of food', 'a bowl', 'a knife', 'a fork',
  'a laptop', 'a computer monitor', 'a keyboard', 'a smartphone', 'a tablet', 'a television', 'a camera',
  'a microphone', 'headphones', 'a book', 'a newspaper', 'a document', 'a whiteboard', 'a clock', 'a watch',
  'a backpack', 'a handbag', 'a suitcase', 'an umbrella', 'a chair', 'a couch', 'a bed', 'a table', 'a desk',
  'a lamp', 'a door', 'a window', 'stairs', 'an elevator', 'a refrigerator', 'an oven', 'a sink', 'a toilet',
  'a ball', 'a guitar', 'a piano', 'a drum kit', 'a toy', 'a balloon', 'a flag', 'a box', 'a shopping cart',
  'a shelf', 'a tool', 'a machine', 'a robot', 'a weapon', 'a gun', 'money', 'a credit card', 'a key', 'a fence',
  'a bench', 'a fire hydrant', 'a trash can', 'a ladder', 'a tent', 'a screen with text', 'a chart', 'a map',
  'a logo', 'a sign with text', 'a poster', 'a painting', 'flowers', 'a christmas tree', 'a candle', 'a cake',
  // food
  'pizza', 'a burger', 'a sandwich', 'pasta', 'sushi', 'salad', 'fruit', 'vegetables', 'bread', 'coffee', 'beer',
  'wine', 'ice cream', 'a barbecue',
  // places indoor
  'an office', 'a meeting room', 'a kitchen', 'a living room', 'a bedroom', 'a bathroom', 'a restaurant',
  'a cafe', 'a bar', 'a supermarket', 'a shop', 'a shopping mall', 'a warehouse', 'a factory', 'a laboratory',
  'a hospital', 'a classroom', 'a library', 'a gym', 'a stadium', 'a concert', 'a theater', 'a church',
  'a museum', 'a hallway', 'a lobby', 'a garage', 'a server room', 'a tv studio', 'a hotel room',
  // places outdoor
  'a city skyline', 'a skyscraper', 'a house', 'an apartment building', 'a garden', 'a park', 'a playground',
  'a forest', 'a mountain', 'a beach', 'the ocean', 'a lake', 'a river', 'a waterfall', 'a desert', 'a field',
  'a farm', 'a village', 'a snowy landscape', 'a swimming pool', 'a golf course', 'a soccer field',
  'a tennis court', 'a ski slope', 'a campsite', 'a market', 'a festival', 'a wedding', 'a protest',
  'a parade', 'a castle', 'a monument',
  // conditions and shot types
  'night', 'sunset', 'sunrise', 'rain', 'snow', 'fog', 'fire', 'smoke', 'an explosion', 'water', 'clouds',
  'a blue sky', 'a storm', 'lightning', 'fireworks', 'a close-up shot', 'an aerial view', 'a wide landscape shot',
  'a black and white image', 'an animated cartoon', 'a video game', 'a screenshot of a computer screen',
  'text on screen', 'a title card', 'a blurry image', 'a dark scene', 'security camera footage',
  'dashcam footage', 'an underwater scene', 'a news broadcast', 'an interview', 'a sports broadcast',
  // colours on common subjects
  'a red car', 'a black car', 'a white car', 'a blue car', 'a silver car', 'a yellow car', 'a green car',
  'a red bus', 'a green bus', 'a yellow bus', 'a white van', 'a white truck', 'a person in a red shirt',
  'a person in a blue shirt', 'a person in a white shirt', 'a person in a black jacket',
  'a person in a yellow vest',
];

/** Display form of a vocabulary entry ("a red car" -> "red car"). */
export function displayLabel(entry: string): string {
  return entry.replace(/^(a|an|the)\s+/i, '');
}

export interface VocabularyIndex {
  labels: string[];
  /** L2-normalized text embeddings, `labels.length * dim`. */
  embeddings: Float32Array;
  dim: number;
}

/**
 * Embeds the vocabulary with the text tower. The result is cached on disk per model so
 * later starts are instant.
 */
export async function loadVocabulary(
  model: EmbeddingModel,
  onProgress: (done: number, total: number) => void,
): Promise<VocabularyIndex> {
  const labels = VOCABULARY.map(displayLabel);
  const prompts = VOCABULARY.map((entry) => `a photo of ${entry.toLowerCase()}.`);
  const hash = createHash('sha256')
    .update(`${config.modelId}|${config.modelDtype}|${model.dim}|${prompts.join('\n')}`)
    .digest('hex')
    .slice(0, 16);
  const cacheFile = path.join(config.modelCacheDir, 'derived', `vocab-${hash}.f32`);
  const expectedBytes = prompts.length * model.dim * 4;

  try {
    const buf = await fs.readFile(cacheFile);
    if (buf.byteLength === expectedBytes) {
      const embeddings = new Float32Array(prompts.length * model.dim);
      Buffer.from(embeddings.buffer).set(buf);
      return { labels, embeddings, dim: model.dim };
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const embeddings = new Float32Array(prompts.length * model.dim);
  const batch = 16;
  for (let i = 0; i < prompts.length; i += batch) {
    const chunk = prompts.slice(i, i + batch);
    const out = await model.embedTexts(chunk);
    embeddings.set(out, i * model.dim);
    onProgress(Math.min(prompts.length, i + batch), prompts.length);
  }
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  await fs.writeFile(tmp, Buffer.from(embeddings.buffer, embeddings.byteOffset, embeddings.byteLength));
  await fs.rename(tmp, cacheFile);
  return { labels, embeddings, dim: model.dim };
}
