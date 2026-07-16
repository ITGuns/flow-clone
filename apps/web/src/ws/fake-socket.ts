// Scripted fake WebSocket for the dictation-client tests. Not a `.test` file — imported only by the
// suites. Records everything the client sends and lets the test drive open/message/close events.
import {
  decodeFrame,
  type AudioFrame,
  type ClientMessage,
  type ServerMessage,
} from '@undertone/shared';
import { SOCKET_OPEN, type DictationSocket, type SocketFactory } from './dictation-client';

export class FakeSocket implements DictationSocket {
  readonly url: string;
  readyState = SOCKET_OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly sentText: string[] = [];
  readonly sentBinary: Uint8Array[] = [];
  closedWith: number | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | ArrayBufferView): void {
    if (typeof data === 'string') {
      this.sentText.push(data);
    } else {
      this.sentBinary.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
    }
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  // ── test drivers ───────────────────────────────────────────────────────────────────────────
  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Deliver a raw (possibly non-string) frame — used to prove non-text data is ignored. */
  emitRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitClose(code = 1006): void {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code });
  }

  // ── decoded accessors ──────────────────────────────────────────────────────────────────────
  controlMessages(): ClientMessage[] {
    return this.sentText.map((t) => JSON.parse(t) as ClientMessage);
  }

  controlByType<T extends ClientMessage['t']>(t: T): Extract<ClientMessage, { t: T }>[] {
    return this.controlMessages().filter((m): m is Extract<ClientMessage, { t: T }> => m.t === t);
  }

  audioFrames(): AudioFrame[] {
    return this.sentBinary.map((b) => decodeFrame(b));
  }
}

/** A SocketFactory that records every socket it creates and resolves waiters as they appear. */
export class FakeSocketFactory {
  readonly sockets: FakeSocket[] = [];
  private waiters: ((s: FakeSocket) => void)[] = [];

  readonly create: SocketFactory = (url) => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    const waiter = this.waiters.shift();
    if (waiter) waiter(socket);
    return socket;
  };

  /** Resolve with the socket at `index`, waiting if it has not been created yet. */
  waitFor(index: number): Promise<FakeSocket> {
    const existing = this.sockets[index];
    if (existing) return Promise.resolve(existing);
    return new Promise<FakeSocket>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
