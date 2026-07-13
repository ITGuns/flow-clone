// Production Transport wrapping the global `WebSocket` (Node 24 / undici in the Electron main
// process — no dependency needed). This is the ONLY place the real socket is touched; all client
// logic lives above the Transport seam and is tested against a fake. Kept deliberately thin.
import type { Transport, TransportCloseInfo, TransportConnection } from './types';

class WebSocketConnection implements TransportConnection {
  private readonly ws: WebSocket;
  private messageCb: ((data: string | Uint8Array) => void) | undefined;
  private closeCb: ((info: TransportCloseInfo) => void) | undefined;
  // Frames that arrive before the client registers its sinks are buffered, never dropped.
  private readonly pendingMessages: Array<string | Uint8Array> = [];
  private pendingClose: TransportCloseInfo | undefined;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('message', (ev: MessageEvent) => this.onRawMessage(ev.data));
    this.ws.addEventListener('close', (ev: CloseEvent) =>
      this.onRawClose({ code: ev.code, reason: ev.reason }),
    );
  }

  private onRawMessage(data: unknown): void {
    const normalized = WebSocketConnection.normalize(data);
    if (normalized === undefined) return;
    if (this.messageCb) this.messageCb(normalized);
    else this.pendingMessages.push(normalized);
  }

  private onRawClose(info: TransportCloseInfo): void {
    if (this.closeCb) this.closeCb(info);
    else this.pendingClose = info;
  }

  private static normalize(data: unknown): string | Uint8Array | undefined {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return undefined;
  }

  send(data: string | Uint8Array): void {
    this.ws.send(data);
  }

  onMessage(cb: (data: string | Uint8Array) => void): void {
    this.messageCb = cb;
    if (this.pendingMessages.length > 0) {
      const queued = this.pendingMessages.splice(0);
      for (const m of queued) cb(m);
    }
  }

  onClose(cb: (info: TransportCloseInfo) => void): void {
    this.closeCb = cb;
    if (this.pendingClose) {
      const info = this.pendingClose;
      this.pendingClose = undefined;
      cb(info);
    }
  }

  bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  close(code?: number, reason?: string): void {
    try {
      this.ws.close(code, reason);
    } catch {
      // Closing a socket that is already closing/closed throws in some runtimes — safe to ignore.
    }
  }
}

/** The production Transport. Resolves once the socket is OPEN; rejects on a pre-open error. */
export function createWebSocketTransport(): Transport {
  return {
    connect(url: string): Promise<TransportConnection> {
      return new Promise<TransportConnection>((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url);
        const conn = new WebSocketConnection(ws);
        ws.addEventListener(
          'open',
          () => {
            settled = true;
            resolve(conn);
          },
          { once: true },
        );
        ws.addEventListener('error', () => {
          if (!settled) {
            settled = true;
            reject(new Error(`WebSocket failed to open: ${url}`));
          }
        });
      });
    },
  };
}
