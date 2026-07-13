// Scripted Transport + TokenProvider for unit tests. Not a test file itself (no `.test`), so it
// is compiled/linted with the sources but never executed as a suite. Lets each test drive the
// exact server behavior — messages, acks, drops — and inspect everything the client sent.
import { decodeFrame, type AudioFrame, type ServerMessage } from '@undertone/shared';
import type { TokenProvider, Transport, TransportCloseInfo, TransportConnection } from './types';

export class FakeConnection implements TransportConnection {
  readonly url: string;
  /** Every frame the client wrote, in order (JSON strings and binary audio frames). */
  readonly sent: Array<string | Uint8Array> = [];
  private messageCb: ((data: string | Uint8Array) => void) | undefined;
  private closeCb: ((info: TransportCloseInfo) => void) | undefined;
  private buffered = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string | Uint8Array): void {
    if (this.closed) throw new Error('send after close');
    // Copy binary so later mutation of the caller's buffer can't rewrite history.
    this.sent.push(typeof data === 'string' ? data : new Uint8Array(data));
  }
  onMessage(cb: (data: string | Uint8Array) => void): void {
    this.messageCb = cb;
  }
  onClose(cb: (info: TransportCloseInfo) => void): void {
    this.closeCb = cb;
  }
  bufferedAmount(): number {
    return this.buffered;
  }
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.({ code, reason });
  }

  // ── Test controls ────────────────────────────────────────────────────────────────────────
  /** Simulate a server→client message. */
  emit(msg: ServerMessage): void {
    this.messageCb?.(JSON.stringify(msg));
  }
  /** Simulate a raw string frame (e.g. malformed JSON). */
  emitRaw(data: string | Uint8Array): void {
    this.messageCb?.(data);
  }
  /** Simulate an unexpected transport loss (not initiated by the client). */
  serverClose(code = 1006, reason = 'abnormal'): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.({ code, reason });
  }
  /** Set the socket send-buffer level that backpressure reads. */
  setBufferedAmount(bytes: number): void {
    this.buffered = bytes;
  }

  // ── Inspection ───────────────────────────────────────────────────────────────────────────
  get controls(): ServerMessage[] {
    // Parse the JSON control frames the client sent (typed loosely as ServerMessage union shape).
    return this.sent
      .filter((d): d is string => typeof d === 'string')
      .map((s) => JSON.parse(s) as ServerMessage);
  }
  /** All control frames as untyped records — convenient for asserting client→server messages. */
  get sentJson(): Array<Record<string, unknown>> {
    return this.sent
      .filter((d): d is string => typeof d === 'string')
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }
  /** Decoded binary audio frames the client sent, in order. */
  get frames(): AudioFrame[] {
    return this.sent
      .filter((d): d is Uint8Array => typeof d !== 'string')
      .map((b) => decodeFrame(b));
  }
  get sentSeqs(): number[] {
    return this.frames.map((f) => f.frameSeq);
  }
}

export class FakeTransport implements Transport {
  readonly connections: FakeConnection[] = [];
  /** When set, connect() rejects once (to exercise the reconnect-on-connect-failure path). */
  failNextConnect = false;

  connect(url: string): Promise<TransportConnection> {
    if (this.failNextConnect) {
      this.failNextConnect = false;
      return Promise.reject(new Error('connect failed'));
    }
    const conn = new FakeConnection(url);
    this.connections.push(conn);
    return Promise.resolve(conn);
  }

  get last(): FakeConnection {
    const c = this.connections[this.connections.length - 1];
    if (!c) throw new Error('no connection yet');
    return c;
  }
  get count(): number {
    return this.connections.length;
  }
}

/** TokenProvider that hands out a fresh, distinct token on each call. */
export class FakeTokenProvider implements TokenProvider {
  readonly issued: string[] = [];
  private n = 0;
  constructor(private readonly prefix = 'tok') {}
  getToken(): Promise<string> {
    this.n += 1;
    const t = `${this.prefix}-${this.n}`;
    this.issued.push(t);
    return Promise.resolve(t);
  }
}
