/**
 * The console's one upload path: a queue of files sent to the node a few at a time, shared by
 * every view that takes recordings (BESTAND and ORTUNG). It lives outside React so that uploads
 * keep running and keep their progress when the analyst switches tabs, and both views show the
 * same list.
 */
import { useSyncExternalStore, type DragEvent } from 'react';
import { uploadVideo, type DetailLevel } from './api';
import { VIDEO_FILE_PATTERN } from './format';

export interface UploadOptions {
  sampleFps: number;
  detail: DetailLevel;
  sourceId: string;
}

export interface UploadItem {
  key: string;
  name: string;
  sizeBytes: number;
  /** Share of the file sent (0..1). */
  progress: number;
  /** waiting: queued in the console; uploading: being sent; done: the node took it; failed: refused or broken off. */
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  error: string | null;
  /** Id of the recording the node created, once it took the file. */
  videoId: string | null;
  sourceId: string;
}

/** Several uploads run at once; the analysis on the node does not wait for the last file. */
const PARALLEL_UPLOADS = 4;

type Listener = () => void;

class UploadQueue {
  private items: UploadItem[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly waiting: { key: string; file: File; options: UploadOptions }[] = [];
  private active = 0;
  private serial = 0;
  private frame: number | null = null;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): UploadItem[] => this.items;

  /**
   * Queues the video files among `files` and starts sending. Returns how many were taken and how
   * many were skipped because they are not videos.
   */
  add(files: File[], options: UploadOptions): { accepted: number; skipped: number } {
    const accepted = files.filter((f) => VIDEO_FILE_PATTERN.test(f.name));
    if (accepted.length === 0) return { accepted: 0, skipped: files.length };
    const fresh = accepted.map((file) => {
      const key = `u${++this.serial}-${file.name}`;
      this.waiting.push({ key, file, options });
      const item: UploadItem = {
        key,
        name: file.name,
        sizeBytes: file.size,
        progress: 0,
        status: 'waiting',
        error: null,
        videoId: null,
        sourceId: options.sourceId,
      };
      return item;
    });
    this.items = [...this.items, ...fresh];
    this.emit(true);
    this.pump();
    return { accepted: accepted.length, skipped: files.length - accepted.length };
  }

  /** Removes one entry from the list (a failed upload, or a finished one the analyst has seen). */
  dismiss(key: string): void {
    this.items = this.items.filter((u) => u.key !== key);
    this.emit(true);
  }

  /** Removes every entry that is no longer sending or waiting. */
  clearFinished(): void {
    this.items = this.items.filter((u) => u.status === 'waiting' || u.status === 'uploading');
    this.emit(true);
  }

  /**
   * Forgets the uploads into one source that the node took, once none into it is waiting or
   * sending: their recordings are listed as such, and the next batch counts from zero. Refused
   * uploads stay until dismissed.
   */
  forgetDone(sourceId: string): void {
    const mine = this.items.filter((u) => u.sourceId === sourceId);
    if (mine.length === 0 || mine.some((u) => u.status === 'waiting' || u.status === 'uploading')) return;
    if (!mine.some((u) => u.status === 'done')) return;
    this.items = this.items.filter((u) => u.sourceId !== sourceId || u.status !== 'done');
    this.emit(true);
  }

  private patch(key: string, patch: Partial<UploadItem>, now: boolean): void {
    this.items = this.items.map((u) => (u.key === key ? { ...u, ...patch } : u));
    this.emit(now);
  }

  /**
   * Tells the views. Progress arrives many times a second per file; it is passed on at most once
   * per animation frame, so a folder of files does not re-render the console for every packet.
   */
  private emit(now: boolean): void {
    const run = (): void => {
      this.frame = null;
      for (const l of this.listeners) l();
    };
    if (now) {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      run();
      return;
    }
    if (this.frame === null) this.frame = requestAnimationFrame(run);
  }

  private pump(): void {
    while (this.active < PARALLEL_UPLOADS) {
      const next = this.waiting.shift();
      if (!next) return;
      const { key, file, options } = next;
      this.active++;
      this.patch(key, { status: 'uploading' }, true);
      uploadVideo(file, options, (fraction) => this.patch(key, { progress: fraction }, false))
        .promise.then((result) => {
          const rejected = result.rejected[0];
          const video = result.accepted[0];
          if (rejected || !video) this.patch(key, { status: 'failed', error: rejected?.reason ?? null }, true);
          else this.patch(key, { status: 'done', progress: 1, videoId: video.id }, true);
        })
        .catch((err: unknown) => {
          this.patch(key, { status: 'failed', error: err instanceof Error ? err.message : String(err) }, true);
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

export const uploads = new UploadQueue();

/** The shared list of uploads, re-rendering the caller when it changes. */
export function useUploads(): UploadItem[] {
  return useSyncExternalStore(uploads.subscribe, uploads.snapshot);
}

/** Recursively collects files from dropped directories. */
async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map(filesFromEntry));
  return nested.flat();
}

/** The files of a drop, with the files inside dropped folders. */
export async function filesFromDrop(event: DragEvent): Promise<File[]> {
  const items = Array.from(event.dataTransfer.items);
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(event.dataTransfer.files);
  const nested = await Promise.all(entries.map(filesFromEntry));
  return nested.flat();
}

/**
 * The name of the one folder a drop carries, or null (several entries, or files only). Must be
 * called inside the drop handler, before anything is awaited: the browser empties the drop's
 * items once the handler returns.
 */
export function droppedFolderName(event: DragEvent): string | null {
  const entries = Array.from(event.dataTransfer.items)
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  return entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : null;
}

/** The top folder all chosen files share (a folder picked with the folder picker), or null. */
export function pickedFolderName(files: File[]): string | null {
  let top: string | null = null;
  for (const f of files) {
    const first = (f.webkitRelativePath ?? '').split('/')[0] ?? '';
    if (first === '' || !f.webkitRelativePath.includes('/')) return null;
    if (top === null) top = first;
    else if (top !== first) return null;
  }
  return top;
}

/** Whether a drag carries files (and not, say, selected text or a link). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

/** Accept list for the file picker of recordings. */
export const VIDEO_ACCEPT = 'video/*,.mkv,.avi,.ts,.mts,.m2ts,.flv,.wmv';
