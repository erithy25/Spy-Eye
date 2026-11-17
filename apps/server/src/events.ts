import type { ServerResponse } from 'node:http';
import type { ServerEvent } from './types.js';

/** Fan-out of server-sent events to all connected browsers. */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;

  add(res: ServerResponse, initial: ServerEvent): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this.write(res, initial);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    res.on('error', () => this.clients.delete(res));
    // A real event (not an SSE comment) so the browser can tell a live stream from one that a
    // proxy is buffering, and fall back to polling.
    this.heartbeat ??= setInterval(() => this.broadcast({ type: 'ping' }), 5_000).unref();
  }

  private write(res: ServerResponse, event: ServerEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  broadcast(event: ServerEvent): void {
    if (this.clients.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
