// Resumable session state — CONTRACTS.md §4.4. In-memory map (v1); a horizontal-scale build
// moves this to Redis (ARCHITECTURE §1/§3). A session survives transport loss for
// RESUME_TTL_MS; a `session.resume` after that window yields `SESSION_INVALID` (§8).
import type { AppContext, SessionId, UtteranceId } from '@undertone/shared';
import type { Plan } from '../routes/session-token';

/** Session resumable for 60s after transport loss — CONTRACTS.md §4.4. */
export const RESUME_TTL_MS = 60_000;

/** Per-utterance server-side high-water mark used for ack/replay reconciliation (§4.4). */
export interface UtteranceProgress {
  utteranceId: UtteranceId;
  appContext: AppContext;
  /** Highest in-order frameSeq accepted so far; -1 before any frame. */
  highWaterSeq: number;
}

export interface SessionRecord {
  sessionId: SessionId;
  userId: string;
  plan: Plan;
  locale: string;
  appContext: AppContext;
  /** The in-flight utterance, if any — restored on resume so replay continues in order. */
  utterance?: UtteranceProgress;
  /** null while a connection is live; timestamp (ms) when transport was lost. */
  disconnectedAt: number | null;
}

/**
 * In-memory session registry with a 60s post-disconnect resume window. `now` is injectable so
 * tests can drive the expiry boundary deterministically.
 */
export class SessionStore {
  private readonly sessions = new Map<SessionId, SessionRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Register a fresh session on `session.start`. Overwrites any prior record for the id. */
  create(record: Omit<SessionRecord, 'disconnectedAt'>): SessionRecord {
    const full: SessionRecord = { ...record, disconnectedAt: null };
    this.sessions.set(record.sessionId, full);
    return full;
  }

  get(sessionId: SessionId): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Mark transport loss; starts the 60s resume clock. No-op if the session is unknown. */
  markDisconnected(sessionId: SessionId): void {
    const record = this.sessions.get(sessionId);
    if (record) record.disconnectedAt = this.now();
  }

  /**
   * Attempt to resume. Returns the live record and clears the disconnect clock when the session
   * exists and is within the resume window; otherwise purges it and returns undefined (caller
   * emits `SESSION_INVALID`).
   */
  resume(sessionId: SessionId): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;
    if (record.disconnectedAt !== null && this.now() - record.disconnectedAt > RESUME_TTL_MS) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    record.disconnectedAt = null;
    return record;
  }

  /** Drop a session permanently (clean disconnect / terminal error). */
  delete(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }
}
