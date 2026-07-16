// Local fake Deepgram WebSocket server — TEST SUPPORT ONLY (imported by deepgram.test.ts).
// It speaks Deepgram-shaped JSON frames so the adapter's unit tests run with zero network and
// zero API keys. It is deliberately dumb: the test scripts the responses via hooks; the server
// only translates them onto the wire and reports what the client sent.
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

/** One accepted connection. The test uses it to push Deepgram-shaped frames back to the client. */
export class FakeDeepgramConnection {
  readonly #ws: WebSocket;
  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  sendResults(transcript: string, opts: { isFinal?: boolean; speechFinal?: boolean } = {}): void {
    this.#ws.send(
      JSON.stringify({
        type: 'Results',
        channel: { alternatives: [{ transcript }] },
        is_final: opts.isFinal ?? false,
        speech_final: opts.speechFinal ?? false,
      }),
    );
  }

  sendMetadata(): void {
    this.#ws.send(JSON.stringify({ type: 'Metadata' }));
  }

  sendError(description: string): void {
    this.#ws.send(JSON.stringify({ type: 'Error', description }));
  }

  close(code?: number): void {
    this.#ws.close(code);
  }

  terminate(): void {
    this.#ws.terminate();
  }
}

export interface FakeDeepgramHooks {
  onConnection?: (conn: FakeDeepgramConnection, req: IncomingMessage) => void;
  onAudio?: (conn: FakeDeepgramConnection, chunk: Buffer) => void;
  onCloseStream?: (conn: FakeDeepgramConnection) => void;
}

export class FakeDeepgramServer {
  readonly #wss: WebSocketServer;
  readonly #ready: Promise<void>;
  #lastUpgradeUrl = '';

  constructor(hooks: FakeDeepgramHooks = {}) {
    this.#wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#wss.once('listening', () => {
        resolve();
      });
      this.#wss.once('error', reject);
    });

    this.#wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.#lastUpgradeUrl = req.url ?? '';
      const conn = new FakeDeepgramConnection(ws);
      hooks.onConnection?.(conn, req);
      ws.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          hooks.onAudio?.(conn, toBuffer(data));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(toBuffer(data).toString('utf8'));
        } catch {
          return;
        }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { type?: unknown }).type === 'CloseStream'
        ) {
          hooks.onCloseStream?.(conn);
        }
      });
    });
  }

  ready(): Promise<void> {
    return this.#ready;
  }

  get port(): number {
    const addr = this.#wss.address();
    if (addr === null || typeof addr === 'string') throw new Error('fake server is not listening');
    return addr.port;
  }

  get baseUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  get lastUpgradeUrl(): string {
    return this.#lastUpgradeUrl;
  }

  close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      for (const client of this.#wss.clients) client.terminate();
      this.#wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
