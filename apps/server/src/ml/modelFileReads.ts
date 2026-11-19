/**
 * Loading a model through transformers.js (4.x) in Node opens the files it loads as read streams
 * that nobody reads to the end: its FileResponse starts a stream in its constructor, every .onnx
 * file gets two of them (the cache lookup and the load), and onnxruntime is then given the file's
 * path and reads the file itself. Each stream still runs to the end on its own and keeps every
 * chunk until it does, i.e. a full copy of the file in memory per stream: 1.8 GB for the two towers
 * of the image model, 0.2 GB for the depth model. In an inference thread the reads only advance
 * while the thread is idle, so the copies pile up over minutes of analysis, and whether collected
 * or not, the allocator keeps most of those pages (measured: the image model's thread grew by about
 * 100 MB per pass of the node's batch mix, and by 1 GB within two idle seconds).
 *
 * `withoutModelFileReads` runs a load and ends every read stream that was opened meanwhile once
 * the load is done. A body that the loader needed (a configuration, the tokenizer, a model loaded
 * from a buffer instead of a path) has been read completely by then, so ending the streams
 * afterwards takes nothing away from it. Only for a thread that does nothing but load the model.
 *
 * A stream that closes during the load (read to the end) is let go at once: its listeners lead to
 * every chunk it read, and holding it would keep them from the collector for the rest of the load.
 * That happens on a first start, where the files are downloaded one after the other: the text
 * tower's stream (0.5 GB) ends while the image tower is still being downloaded and loaded. Not
 * solved by this: if no collection runs before the load ends, those chunks stay uncollected in the
 * idle thread until its next piece of work, and the allocator keeps most of the pages even then
 * (measured on a first start: about 0.3 GB more than the unwrapped load, whose image-tower stream
 * keeps reading and so triggers the collection). Starts from the model cache are not affected.
 */
import fs from 'node:fs';

type CreateReadStream = typeof fs.createReadStream;

export async function withoutModelFileReads<T>(load: () => Promise<T>): Promise<T> {
  // transformers.js calls fs.createReadStream on the module object at call time, so replacing the
  // property for the duration of the load sees its streams (only in this thread's module object).
  const target = fs as unknown as { createReadStream: CreateReadStream };
  const original = target.createReadStream;
  const open = new Set<fs.ReadStream>();
  const tracking = function (this: unknown, ...args: Parameters<CreateReadStream>): fs.ReadStream {
    const stream = original.apply(this, args);
    open.add(stream);
    stream.once('close', () => open.delete(stream));
    return stream;
  };
  target.createReadStream = tracking as CreateReadStream;
  try {
    return await load();
  } finally {
    if (target.createReadStream === tracking) target.createReadStream = original;
    for (const stream of open) stream.destroy();
  }
}
