import { Worker } from 'node:worker_threads';
import type { SearchHostMessage, SearchThreadMessage, TopRows } from './galleryKernel.js';

/**
 * The gallery search thread, seen from the main thread.
 *
 * A localisation compares up to about a hundred query rows (frames and their crops) with every
 * reference picture: 6 393 rows of 768 values against 48 rows (12 frames with 4 tiles each) are
 * a quarter of a billion multiply-adds, about 0.4 s of one core in JavaScript, 100 rows about
 * 1 s. On the main thread that held every HTTP request of the node for as long. Here the search
 * runs in a worker thread: the gallery matrix lies in shared memory and is handed to the thread
 * once per version, a search posts only its query rows (moved, not copied) and gets back the
 * chosen rows with their similarities; the main thread only builds the result objects from them.
 *
 * One thread for all galleries of the process; searches of several nodes queue in it. Splitting
 * the gallery across two threads was measured on 4 cores (100 query rows, full gallery): the
 * main thread stays just as free either way (loop lag p99 under 10 ms), and a search takes about
 * 40 % less wall time with two (1.0 s instead of 1.6 to 1.9 s beside a running image model). But
 * locate() runs the search side by side with the world model (about 5 s for 12 frames, see
 * geoclipService.ts) and waits for both, so the shorter search rarely shortens a localisation.
 * The cores are already shared out: the image model's runs take all of them, the world model
 * half, so that at most 1.5 times the cores are busy; a second search thread adds to that, and
 * with searches back to back it cost the image model 13 to 18 % of its throughput.
 *
 * Failures never cost a localisation: if the thread cannot start, dies, answers with an error or
 * an answer that does not fit, or stops answering, the call rejects and Gallery.searchAsync
 * computes that search on the main thread as before. The first such failure is reported once.
 */

/**
 * The worker script. From the sources (tsx: tests, scripts, `pnpm dev`) this module is a .ts file
 * and so is the worker; from the build both are .js next to each other in dist/datum.
 */
const fromSource = import.meta.url.endsWith('.ts');
const defaultEntry = new URL(fromSource ? './gallerySearchWorker.ts' : './gallerySearchWorker.js', import.meta.url);

/**
 * Node options of the worker. A worker inherits the parent's options, which under tsx include its
 * loader, so the .ts worker is compiled the same way. Only when the sources run without tsx's
 * options in the parent (an embedding that registered the loader by other means) is it added.
 */
function workerExecArgv(): string[] | undefined {
  if (!fromSource) return undefined;
  if (process.execArgv.some((arg) => arg.includes('tsx'))) return undefined;
  return ['--import', import.meta.resolve('tsx')];
}

/** No new thread for this long after one that ended before it had answered a single search. */
const RETRY_AFTER_MS = 30_000;
/** A thread that holds searches and answers none for this long is ended (a search takes < 1 s). */
const STALL_MS = 60_000;
/** How long closing waits for the searches under way before it ends the thread. */
const CLOSE_DRAIN_MS = 2000;

/** One version of a gallery's vectors, as the search thread receives it. */
export interface GalleryMatrix {
  /** Key of the gallery: one thread serves every gallery of the process. */
  gallery: number;
  /** Changes whenever the gallery's matrix is replaced. */
  version: number;
  /** n x dim rows in shared memory; never written again once handed over. */
  matrix: Float32Array;
  n: number;
  dim: number;
}

export interface GallerySearchThreadOptions {
  /** Worker script. Default: gallerySearchWorker next to this module. */
  entry?: URL;
  /** No new thread for this long after one that failed before answering. Default 30 s. */
  retryAfterMs?: number;
  /** A thread that holds searches and answers none for this long is ended. Default 60 s. */
  stallMs?: number;
  /** Receives the one notice about a failed thread. Default: standard error. */
  log?: (line: string) => void;
}

interface PendingSearch {
  resolve: (top: TopRows) => void;
  reject: (err: Error) => void;
  /** Query rows and gallery rows of the call, to check that the answer fits. */
  rows: number;
  n: number;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Why an answer of the thread cannot be used, or null if it fits the call. */
function misfit(message: SearchThreadMessage & { type: 'result' }, rows: number, n: number): string | null {
  const { offsets, indices, similarities } = message;
  if (!(offsets instanceof Int32Array) || !(indices instanceof Int32Array) || !(similarities instanceof Float32Array)) {
    return 'Antwort des Suchthreads hat ein unerwartetes Format';
  }
  if (offsets.length !== rows + 1 || offsets[0] !== 0 || offsets[rows] !== indices.length || indices.length !== similarities.length) {
    return 'Antwort des Suchthreads passt nicht zur Anfrage';
  }
  for (let r = 0; r < rows; r++) {
    if ((offsets[r + 1] as number) < (offsets[r] as number)) return 'Antwort des Suchthreads passt nicht zur Anfrage';
  }
  for (const i of indices) {
    if (i < 0 || i >= n) return 'Antwort des Suchthreads nennt ein unbekanntes Referenzbild';
  }
  return null;
}

/** Every thread that was created and not closed, for closeGallerySearch and forgetGallery. */
const open = new Set<GallerySearchThread>();

/**
 * A worker thread that searches gallery matrices. It is started by the first search, referenced
 * only while it has searches, so an idle thread never keeps a process alive that has otherwise
 * finished (a script, a test, a stopped node), and started again by the next search after it died.
 */
export class GallerySearchThread {
  private readonly entry: URL;
  private readonly retryAfterMs: number;
  private readonly stallMs: number;
  private readonly log: (line: string) => void;

  private worker: Worker | null = null;
  /** Matrix version per gallery that the current worker holds. */
  private readonly known = new Map<number, number>();
  private readonly pending = new Map<number, PendingSearch>();
  private nextId = 1;
  private closed = false;
  /** performance.now() before which no new worker is started (after a failed start). */
  private retryAt = 0;
  /** The current worker has answered at least one search: it works, a later death is a mishap. */
  private answered = false;
  private warned = false;
  private watchdog: NodeJS.Timeout | null = null;
  private drained: (() => void)[] = [];

  constructor(options: GallerySearchThreadOptions = {}) {
    this.entry = options.entry ?? defaultEntry;
    this.retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.log = options.log ?? ((line) => void process.stderr.write(`${line}\n`));
    open.add(this);
  }

  /** True while a worker thread is running (started and not ended). */
  get running(): boolean {
    return this.worker !== null;
  }

  /**
   * Searches `rows` query rows (`queries`, moved to the thread: detached here once posted) against
   * the matrix; `allowed` (copied) marks the gallery rows that may be chosen. Posts synchronously,
   * so the search reads the matrix version given here even if the gallery changes right after.
   * Rejects when the thread is not available or fails; the caller then searches itself.
   */
  search(matrix: GalleryMatrix, queries: Float32Array<ArrayBuffer>, rows: number, k: number, allowed: Uint8Array | null): Promise<TopRows> {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err: unknown) {
      return Promise.reject(toError(err));
    }
    return new Promise<TopRows>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, rows, n: matrix.n });
      worker.ref();
      try {
        if (this.known.get(matrix.gallery) !== matrix.version) {
          // Shared memory: the thread gets a view of the same bytes, nothing is copied.
          const share: SearchHostMessage = { type: 'matrix', gallery: matrix.gallery, version: matrix.version, matrix: matrix.matrix, n: matrix.n, dim: matrix.dim };
          worker.postMessage(share);
          this.known.set(matrix.gallery, matrix.version);
        }
        const message: SearchHostMessage = { type: 'search', id, gallery: matrix.gallery, version: matrix.version, queries, rows, k, allowed };
        worker.postMessage(message, [queries.buffer]);
      } catch (err: unknown) {
        // Posting failed (nothing was sent for this id): the matrix may or may not have arrived.
        this.known.delete(matrix.gallery);
        this.pending.delete(id);
        this.settle();
        reject(toError(err));
        return;
      }
      this.watchdog ??= this.armWatchdog();
    });
  }

  /** The gallery is gone: the thread releases its matrix. */
  drop(gallery: number): void {
    if (!this.known.delete(gallery)) return;
    try {
      const message: SearchHostMessage = { type: 'drop', gallery };
      this.worker?.postMessage(message);
    } catch {
      // The thread is ending; its matrices go with it.
    }
  }

  /**
   * Ends the thread for good: searches under way may finish (at most CLOSE_DRAIN_MS), the rest
   * reject, and later searches reject at once (Gallery.searchAsync then searches itself).
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    open.delete(this);
    const worker = this.worker;
    if (!worker) return;
    if (this.pending.size > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        new Promise<void>((resolve) => this.drained.push(resolve)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLOSE_DRAIN_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    await worker.terminate();
  }

  private ensureWorker(): Worker {
    if (this.closed) throw new Error('Galeriesuche: Rechenthread wurde beendet.');
    if (this.worker) return this.worker;
    if (performance.now() < this.retryAt) throw new Error('Galeriesuche: Rechenthread vorübergehend nicht verfügbar.');
    let worker: Worker;
    try {
      const execArgv = workerExecArgv();
      worker = new Worker(this.entry, execArgv ? { execArgv } : {});
    } catch (err: unknown) {
      const error = toError(err);
      this.retryAt = performance.now() + this.retryAfterMs;
      this.notice(`Rechenthread startet nicht (${error.message})`);
      throw error;
    }
    this.worker = worker;
    this.answered = false;
    this.known.clear();
    let lastError: Error | null = null;
    worker.on('message', (message: SearchThreadMessage) => this.answer(worker, message));
    worker.on('error', (err: Error) => {
      lastError = err;
    });
    worker.on('messageerror', (err: Error) => {
      // An answer that cannot be read: its call would wait forever, so the thread is ended and
      // what it held is searched on the main thread.
      lastError = err;
      void worker.terminate();
    });
    worker.on('exit', (code: number) => this.exited(worker, lastError, code));
    // Referenced again by every search while it runs.
    worker.unref();
    return worker;
  }

  private answer(worker: Worker, message: SearchThreadMessage): void {
    if (worker !== this.worker || message === null || typeof message !== 'object') return;
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    if (message.type === 'result') {
      const problem = misfit(message, call.rows, call.n);
      if (problem === null) {
        this.answered = true;
        call.resolve({ offsets: message.offsets, indices: message.indices, similarities: message.similarities });
      } else {
        this.notice(problem);
        call.reject(new Error(`Galeriesuche: ${problem}.`));
      }
    } else {
      const text = typeof message.message === 'string' ? message.message : 'unbekannter Fehler';
      this.notice(`Fehler im Suchthread (${text})`);
      call.reject(new Error(`Galeriesuche: ${text}`));
    }
    this.settle();
  }

  private exited(worker: Worker, error: Error | null, code: number): void {
    if (worker !== this.worker) return;
    this.worker = null;
    this.known.clear();
    const reason = error ? error.message : `Code ${code}`;
    if (!this.closed) {
      // A thread that never answered will likely fail again: do not start one for every search.
      if (!this.answered) this.retryAt = performance.now() + this.retryAfterMs;
      this.notice(`Rechenthread ausgefallen (${reason})`);
    }
    const calls = [...this.pending.values()];
    this.pending.clear();
    this.settle();
    for (const call of calls) call.reject(new Error(`Galeriesuche: Rechenthread ${this.closed ? 'wurde beendet' : `ausgefallen (${reason})`}.`));
  }

  /** After an answer or a failed post: unreference an idle thread, rearm or clear the watchdog. */
  private settle(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.pending.size > 0) {
      this.watchdog = this.armWatchdog();
      return;
    }
    this.worker?.unref();
    const waiting = this.drained;
    this.drained = [];
    for (const resolve of waiting) resolve();
  }

  /** Ends a thread that holds searches but has answered none for stallMs. */
  private armWatchdog(): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.watchdog = null;
      const worker = this.worker;
      if (!worker || this.pending.size === 0) return;
      this.notice(`Suchthread antwortet seit ${Math.round(this.stallMs / 1000)} s nicht`);
      void worker.terminate();
    }, this.stallMs);
    // The pending searches keep the process alive through the referenced worker, not this timer.
    timer.unref();
    return timer;
  }

  private notice(reason: string): void {
    if (this.warned || this.closed) return;
    this.warned = true;
    try {
      this.log(`  Galeriesuche: ${reason}; betroffene Suchen laufen im Hauptthread.`);
    } catch {
      // A failing logger must not turn the fallback into a failure.
    }
  }
}

let shared: GallerySearchThread | null = null;

/**
 * The search thread of the process, used by every Gallery that was not given its own. Once
 * closed (node shutdown) it stays closed: later searches run on the main thread.
 */
export function sharedGallerySearch(): GallerySearchThread {
  shared ??= new GallerySearchThread();
  return shared;
}

/** A gallery was garbage-collected: every thread releases its matrix. */
export function forgetGallery(gallery: number): void {
  for (const thread of open) thread.drop(gallery);
}

/** Ends every gallery search thread of this process (node shutdown). */
export async function closeGallerySearch(): Promise<void> {
  await Promise.all([...open].map((thread) => thread.close()));
}
