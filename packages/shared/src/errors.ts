// Error taxonomy — CONTRACTS.md §8. The single source of truth for wire error codes and
// their retryability. `apps/api` maps provider failures onto these; the client dispatches
// behavior off `code` + `retryable`.
import type { UtteranceId } from './types';

export type ErrorCode =
  | 'AUTH_EXPIRED'
  | 'AUTH_INVALID'
  | 'SESSION_INVALID'
  | 'PROTO_ERROR'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'ASR_UNAVAILABLE'
  | 'ASR_TIMEOUT'
  | 'FORMAT_UNAVAILABLE'
  | 'FORMAT_TIMEOUT'
  | 'INJECT_FAILED'
  | 'OFFLINE_BUFFERED'
  | 'INTERNAL';

export interface ErrorSpec {
  code: ErrorCode;
  /**
   * Default wire retryability. The §8 table lists INTERNAL as "maybe"; because the wire
   * `error` frame (§4.3) carries a required boolean, "maybe" is resolved to the safe default
   * `false` here and can be overridden per-instance via `UndertoneError` when the cause is
   * known to be transient.
   */
  retryable: boolean;
  /** When true, the client must honor a backoff delay before retrying (§8 RATE_LIMITED). */
  requiresBackoff: boolean;
  description: string;
  clientBehavior: string;
}

export const ERROR_TAXONOMY: Record<ErrorCode, ErrorSpec> = {
  AUTH_EXPIRED: {
    code: 'AUTH_EXPIRED',
    retryable: true,
    requiresBackoff: false,
    description: 'JWT expired at upgrade or mid-session',
    clientBehavior: 'fetch fresh token, reconnect silently',
  },
  AUTH_INVALID: {
    code: 'AUTH_INVALID',
    retryable: false,
    requiresBackoff: false,
    description: 'bad/forged token, Clerk session revoked',
    clientBehavior: 'sign-in screen',
  },
  SESSION_INVALID: {
    code: 'SESSION_INVALID',
    retryable: false,
    requiresBackoff: false,
    description: 'resume of unknown/expired session',
    clientBehavior: 'offline-buffer path, new session',
  },
  PROTO_ERROR: {
    code: 'PROTO_ERROR',
    retryable: false,
    requiresBackoff: false,
    description: 'malformed frame/message',
    clientBehavior: 'close, reconnect fresh; report telemetry',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    retryable: true,
    requiresBackoff: true,
    description: 'per-user msg/frame rate exceeded (Redis)',
    clientBehavior: 'back off, HUD unchanged',
  },
  QUOTA_EXCEEDED: {
    code: 'QUOTA_EXCEEDED',
    retryable: false,
    requiresBackoff: false,
    description: 'weekly word cap hit at format time',
    clientBehavior: 'HUD honest error + upgrade prompt; transcript still returned raw',
  },
  ASR_UNAVAILABLE: {
    code: 'ASR_UNAVAILABLE',
    retryable: true,
    requiresBackoff: true,
    description: 'provider connect/5xx',
    clientBehavior: 'offline-buffer + retry x3 backoff',
  },
  ASR_TIMEOUT: {
    code: 'ASR_TIMEOUT',
    retryable: true,
    requiresBackoff: true,
    description: 'finalize > 2000ms',
    clientBehavior: 'offline-buffer + retry x3 backoff',
  },
  FORMAT_UNAVAILABLE: {
    code: 'FORMAT_UNAVAILABLE',
    retryable: true,
    requiresBackoff: true,
    description: 'Anthropic connect/5xx/refusal',
    clientBehavior: 'inject RAW final transcript, flag "unformatted" in HUD',
  },
  FORMAT_TIMEOUT: {
    code: 'FORMAT_TIMEOUT',
    retryable: true,
    requiresBackoff: true,
    description: 'no TTFT within 2000ms',
    clientBehavior: 'inject RAW final transcript, flag "unformatted" in HUD',
  },
  INJECT_FAILED: {
    code: 'INJECT_FAILED',
    retryable: false,
    requiresBackoff: false,
    description: 'native injection error (client-local)',
    clientBehavior: 'text to clipboard + HUD "copied — paste with Ctrl/Cmd+V"',
  },
  OFFLINE_BUFFERED: {
    code: 'OFFLINE_BUFFERED',
    retryable: true,
    requiresBackoff: true,
    description: 'transport down at capture',
    clientBehavior: 'HUD honest state; background retry',
  },
  INTERNAL: {
    code: 'INTERNAL',
    retryable: false, // §8 "maybe" — resolved to the safe default; override when transient.
    requiresBackoff: false,
    description: 'anything unmapped',
    clientBehavior: 'HUD generic error; telemetry',
  },
};

/** All §8 codes, in declaration order. */
export const ERROR_CODES = Object.keys(ERROR_TAXONOMY) as ErrorCode[];

/** Default wire retryability for a code, per the §8 table. */
export function isRetryable(code: ErrorCode): boolean {
  return ERROR_TAXONOMY[code].retryable;
}

export interface UndertoneErrorOptions {
  /** Override the taxonomy default (e.g. resolve INTERNAL "maybe" to true when transient). */
  retryable?: boolean;
  /** Server-specified backoff delay; set iff the taxonomy marks the code `requiresBackoff` (§4.3 v1.1.0). */
  retryAfterMs?: number;
  utteranceId?: UtteranceId;
  cause?: unknown;
}

/** Canonical application error. Carries exactly the fields the wire `error` frame needs. */
export class UndertoneError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly utteranceId: UtteranceId | undefined;

  constructor(code: ErrorCode, message?: string, options?: UndertoneErrorOptions) {
    super(
      message ?? ERROR_TAXONOMY[code].description,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'UndertoneError';
    this.code = code;
    this.retryable = options?.retryable ?? ERROR_TAXONOMY[code].retryable;
    this.retryAfterMs = options?.retryAfterMs;
    this.utteranceId = options?.utteranceId;
  }
}

// Provider-layer ASR errors (CONTRACTS.md §2.1). These live below the wire boundary; the
// gateway maps them onto ErrorCode (ASR_UNAVAILABLE / ASR_TIMEOUT) before sending an `error`.
export class AsrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsrError';
  }
}
export class AsrTimeoutError extends AsrError {
  constructor(message = 'ASR finalize timed out') {
    super(message);
    this.name = 'AsrTimeoutError';
  }
}
export class AsrStreamClosedError extends AsrError {
  constructor(message = 'ASR stream is closed') {
    super(message);
    this.name = 'AsrStreamClosedError';
  }
}
