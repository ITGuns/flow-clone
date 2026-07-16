// Browser-native speech recognition (D-026) — a thin wrapper over the vendor Web Speech API
// (`window.SpeechRecognition ?? window.webkitSpeechRecognition`) behind an injectable interface, so
// component/hook tests drive a scripted fake with zero DOM speech support.
//
// PRIVACY (honest, not overclaimed): the recognizer is provided by the BROWSER VENDOR. In Chrome/
// Edge the audio is sent to the vendor's cloud speech service (Google) for transcription — it is
// NOT local. Only the resulting text touches our servers (POST /v1/format). The caller surfaces
// this to the user in the dictation note.
//
// Recognition quality: browser transcripts carry minimal punctuation/casing. That is fine — our
// server formatter applies the §4.3 voice-command grammar ("period", "new line", "scratch that", …)
// and prose cleanup, so the polished result matches the streaming path.

/** One transcription alternative (we always take the top alternative, index 0). */
export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

/** One result — final or interim — carrying its ranked alternatives. */
export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
}

/** The cumulative list of results for the session. */
export interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
}

/** The `onresult` event: `resultIndex` is the first result that changed since the last event. */
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

/** The `onerror` event. `error` is the SpeechRecognitionErrorCode string (e.g. "not-allowed"). */
export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

/** The subset of the native `SpeechRecognition` instance this wrapper drives. */
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

/** Constructor-injected factory — produces a fresh recognition instance per utterance. */
export type SpeechRecognitionFactory = () => SpeechRecognitionLike;

/** A normalized recognizer error surfaced to the UI (honest state). */
export interface RecognizerError {
  /** The vendor error code, or `start-failed` when `.start()` threw synchronously. */
  error: string;
  message: string;
}

/** Callbacks for one recognition session. */
export interface RecognizerEvents {
  /** Cumulative live text (finalized segments + current interim) as it streams. */
  onInterim?(text: string): void;
  /** A recognition error (mic denied, network, no-speech, …). */
  onError?(error: RecognizerError): void;
}

/** The recognizer surface the dictation hook depends on — a scripted fake implements this in tests. */
export interface Recognizer {
  /** Begin recognition (continuous + interim), wiring the session callbacks. Idempotent while active. */
  start(events: RecognizerEvents): void;
  /** Stop and resolve the finalized transcript (finals joined; a trailing interim is kept). */
  stop(): Promise<string>;
  /** Hard-cancel — no result; swallows the follow-up aborted-error/end. */
  abort(): void;
  /** Whether a session is currently running. */
  readonly active: boolean;
}

export interface BrowserRecognizerOptions {
  /** BCP-47 language tag. Defaults to `en-US` (web v1). */
  lang?: string;
  /** Safety net: resolve `stop()` if the browser never fires `onend`. Defaults to 2000ms. */
  stopTimeoutMs?: number;
}

/** Collapse whitespace runs to single spaces and trim — browser transcripts are irregularly spaced. */
function normalizeSpeech(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Wraps a vendor `SpeechRecognition` instance. One instance is reusable across utterances: each
 * `start()` creates a fresh underlying recognition (matching the native single-shot lifecycle).
 */
export class BrowserRecognizer implements Recognizer {
  private readonly lang: string;
  private readonly stopTimeoutMs: number;

  private recognition: SpeechRecognitionLike | null = null;
  private events: RecognizerEvents = {};
  private isActive = false;
  private aborting = false;

  private finalSegments: string[] = [];
  private interimText = '';

  private stopResolve: ((transcript: string) => void) | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly factory: SpeechRecognitionFactory,
    options: BrowserRecognizerOptions = {},
  ) {
    this.lang = options.lang ?? 'en-US';
    this.stopTimeoutMs = options.stopTimeoutMs ?? 2000;
  }

  get active(): boolean {
    return this.isActive;
  }

  start(events: RecognizerEvents): void {
    if (this.isActive) return;
    this.events = events;
    this.finalSegments = [];
    this.interimText = '';
    this.aborting = false;

    const recognition = this.factory();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.lang;
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.handleError(event);
    recognition.onend = () => this.handleEnd();
    this.recognition = recognition;
    this.isActive = true;

    try {
      recognition.start();
    } catch (err) {
      this.isActive = false;
      this.events.onError?.({
        error: 'start-failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stop(): Promise<string> {
    if (!this.recognition || !this.isActive) {
      return Promise.resolve(this.finalTranscript());
    }
    return new Promise<string>((resolve) => {
      this.stopResolve = resolve;
      this.stopTimer = setTimeout(() => this.settleStop(), this.stopTimeoutMs);
      try {
        this.recognition?.stop();
      } catch {
        this.settleStop();
      }
    });
  }

  abort(): void {
    this.aborting = true;
    this.isActive = false;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    this.settleStop();
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private handleResult(event: SpeechRecognitionEventLike): void {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results.item(i);
      const transcript = result.item(0).transcript;
      if (result.isFinal) {
        const segment = normalizeSpeech(transcript);
        if (segment !== '') this.finalSegments.push(segment);
      } else {
        interim = `${interim} ${transcript}`;
      }
    }
    this.interimText = normalizeSpeech(interim);
    this.events.onInterim?.(this.cumulativeText());
  }

  private handleError(event: SpeechRecognitionErrorEventLike): void {
    if (this.aborting) return; // our own abort() → benign; ignore the follow-up error
    this.events.onError?.({ error: event.error, message: event.message ?? '' });
  }

  private handleEnd(): void {
    this.isActive = false;
    if (this.stopResolve) this.settleStop();
  }

  private settleStop(): void {
    if (!this.stopResolve) return;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
    }
    const resolve = this.stopResolve;
    this.stopResolve = null;
    this.isActive = false;
    resolve(this.finalTranscript());
  }

  /** Live text shown while speaking: finalized segments + the current interim. */
  private cumulativeText(): string {
    const parts = [...this.finalSegments];
    if (this.interimText !== '') parts.push(this.interimText);
    return normalizeSpeech(parts.join(' '));
  }

  /** The transcript resolved on stop: finals joined, plus any trailing interim (never eat words). */
  private finalTranscript(): string {
    const parts = [...this.finalSegments];
    if (this.interimText !== '') parts.push(this.interimText);
    return normalizeSpeech(parts.join(' '));
  }
}

/** The narrow window shape carrying the vendor-prefixed recognition constructors. */
interface SpeechRecognitionWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/** A `SpeechRecognition` constructor (standard or webkit-prefixed). */
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function defaultWindow(): SpeechRecognitionWindow {
  return typeof window !== 'undefined' ? (window as SpeechRecognitionWindow) : {};
}

/** The available recognition constructor for this browser, or undefined (e.g. Firefox). */
export function windowSpeechRecognitionCtor(
  win: SpeechRecognitionWindow = defaultWindow(),
): SpeechRecognitionCtor | undefined {
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

/** True when the browser exposes a Web Speech recognition constructor. */
export function isBrowserSpeechSupported(win: SpeechRecognitionWindow = defaultWindow()): boolean {
  return windowSpeechRecognitionCtor(win) !== undefined;
}
