/**
 * Entry of the gallery search thread (started by gallerySearch.ts). Holds the gallery matrices it
 * was given in shared memory and answers searches one after another with the kernel that
 * Gallery.search runs on the main thread (galleryKernel.ts), so both give the same numbers.
 *
 * Messages are handled in the order they were posted. The main thread posts a new matrix
 * version before the first search that needs it, so a search finds exactly the version it was
 * computed for; a search still queued for an older version is answered before the newer matrix
 * replaces it.
 */
import { parentPort } from 'node:worker_threads';
import { searchTopRows, type SearchHostMessage, type SearchThreadMessage } from './galleryKernel.js';

const port = parentPort;
if (!port) throw new Error('gallerySearchWorker.ts läuft nur als Rechenthread.');

interface HeldMatrix {
  version: number;
  matrix: Float32Array;
  n: number;
  dim: number;
}

const matrices = new Map<number, HeldMatrix>();

function post(message: SearchThreadMessage, transfer: ArrayBuffer[] = []): void {
  try {
    port?.postMessage(message, transfer);
  } catch {
    // The port is closed (the host is ending this thread): nobody waits for the answer.
  }
}

function search(message: Extract<SearchHostMessage, { type: 'search' }>): void {
  const { id } = message;
  try {
    const held = matrices.get(message.gallery);
    if (!held || held.version !== message.version) {
      throw new Error(`Galeriestand ${message.gallery}/${message.version} liegt dem Suchthread nicht vor.`);
    }
    if (message.queries.length !== message.rows * held.dim) {
      throw new Error(`Suchanfrage mit ${message.queries.length} Werten passt nicht zu ${message.rows} Zeilen à ${held.dim}.`);
    }
    if (message.allowed !== null && message.allowed.length !== held.n) {
      throw new Error(`Ausschlussliste mit ${message.allowed.length} Einträgen passt nicht zu ${held.n} Referenzbildern.`);
    }
    const top = searchTopRows(message.queries, message.rows, held.matrix, held.n, held.dim, message.k, message.allowed);
    // The three arrays were made here for this answer: they are moved, not copied.
    post({ type: 'result', id, ...top }, [top.offsets.buffer, top.indices.buffer, top.similarities.buffer]);
  } catch (err: unknown) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

port.on('message', (message: SearchHostMessage) => {
  switch (message.type) {
    case 'matrix':
      matrices.set(message.gallery, { version: message.version, matrix: message.matrix, n: message.n, dim: message.dim });
      return;
    case 'drop':
      matrices.delete(message.gallery);
      return;
    case 'search':
      search(message);
      return;
  }
});
