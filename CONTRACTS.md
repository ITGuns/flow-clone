# CONTRACTS — Undertone

**This file is law.** Implementation tasks build against it and may not amend it. Contract
friction is reported up to the orchestrator; the orchestrator amends; affected tasks
re-dispatch. All types below live in `packages/shared/src/` and are imported — never
redeclared — by `apps/api` and `apps/desktop`.

Version: 1.4.0 (bump minor on additive change, major on breaking; record in DECISIONS.md).
References to "guide §…" mean `docs/BUILD_GUIDE.md`.

## 1. Core domain types (`packages/shared/src/types.ts`)

```ts
export type UtteranceId = number;        // u16, per-session monotonic, starts at 1
export type SessionId = string;          // UUIDv4, client-generated per WS connection

export interface AppContext {
  bundleId: string;        // mac bundle id / win executable name, e.g. "com.tinyspeck.slackmacgap" | "slack.exe"
  appName: string;         // human name, "Slack"
  windowTitle: string;     // may be ""; truncate to 256 chars
  register: Register;      // derived client-side via packages/shared/src/register-map.ts
}
export type Register = "chat" | "email" | "code" | "document" | "terminal" | "unknown";

export interface DictionaryEntry {
  id: string;              // UUIDv4
  phrase: string;          // what the user means, e.g. "Kubernetes"
  soundsLike: string[];    // optional ASR mishearings, e.g. ["cooper netties"]
  createdAt: string;       // ISO 8601
}

export interface FormatRequest {
  transcript: string;              // finalized ASR text
  appContext: AppContext;
  dictionary: DictionaryEntry[];   // ALREADY capped/filtered per §6 rules
  locale: string;                  // BCP-47, "en-US" v1
}

export interface FormatResult {
  text: string;            // final formatted text (concatenation of all deltas)
  wordCount: number;       // whitespace-split of `text`; THE metering unit
  commandsApplied: string[]; // which §4.3 grammar commands fired (for telemetry counts only)
}
```

## 2. Provider interfaces

### 2.1 ASRProvider (`packages/shared/src/asr.ts`) — vendor SDKs live only behind this

```ts
export interface ASRProvider {
  /** Open a streaming session. MUST resolve before first sendAudio. */
  startStream(opts: ASRStreamOptions): Promise<ASRStream>;
}
export interface ASRStreamOptions {
  sampleRate: 16000;
  encoding: "linear16";
  channels: 1;
  locale: string;
  keywords?: string[];      // dictionary phrases for ASR biasing (provider may ignore)
}
export interface ASRStream {
  sendAudio(chunk: Uint8Array): void;               // PCM16LE; throws AsrStreamClosedError after close
  finalize(): Promise<string>;                      // flush → final transcript; rejects with AsrTimeoutError after 2000ms
  onPartial(cb: (text: string) => void): void;      // cumulative-partial semantics: each call replaces the previous partial
  onError(cb: (err: AsrError) => void): void;
  close(): void;                                    // idempotent, releases the connection
}
```
Implementations: `DeepgramASRProvider` (apps/api), `MockASRProvider` (packages/shared, reads
fixture files, jitters 30–120ms between partials).

### 2.2 Formatter (`packages/shared/src/formatter.ts`)

```ts
export interface Formatter {
  /** One call per utterance. Yields text deltas in order; return value is the assembled result. */
  format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult>;
}
```
Implementations: `HaikuFormatter` (apps/api, model `claude-haiku-4-5-20251001`, streaming,
max_tokens 1024, temperature 0), `MockFormatter` (deterministic rules; must pass the golden
set's command cases).

### 2.3 Desktop native boundary (`apps/desktop/src/native/types.ts`)

Everything above this interface is unit-testable with mocks on any OS.

```ts
export interface HotkeyManager {
  /** Register a global push-to-talk key. cb fires on transitions only. Returns unregister fn. */
  register(accelerator: string, cb: (phase: "down" | "up") => void): () => void;
  isSupported(accelerator: string): boolean;
}
export interface TextInjector {
  /** Insert text at the cursor of the frontmost app. Never steals or requires focus change. */
  inject(text: string): Promise<InjectResult>;
}
export type InjectResult =
  | { ok: true; method: "ax" | "sendinput" | "uia" | "clipboard-fallback" }
  | { ok: false; code: "NO_PERMISSION" | "NO_TARGET" | "INJECT_FAILED"; message: string };
export interface ActiveAppDetector {
  getActiveApp(): Promise<Omit<AppContext, "register">>;
}
```

## 3. Session state machine (desktop main process AND ws gateway mirror this)

States: `idle → arming → listening → finalizing → formatting → injecting → idle`
plus `error(code)` and `buffering` (offline).

Legal transitions only:
- `idle → arming` on key-down (open/verify ASR stream, show HUD "listening")
- `arming → listening` on first audio frame accepted
- `listening → finalizing` on key-up (`audio.end` sent)
- `finalizing → formatting` on `transcript.final`
- `formatting → injecting` on first `format.delta` (long) or `format.done` (short)
- `injecting → idle` on injection resolved (HUD "done", auto-dismiss 800ms)
- any state `→ error(code)` per §8 taxonomy; `error → idle` after HUD display
- `listening|finalizing → buffering` on transport loss: audio persisted locally, retried
Key-down during any non-idle state is ignored (no re-entrancy in v1).

## 4. WebSocket protocol (`packages/shared/src/protocol.ts` + `frame-codec.ts`)

### 4.1 Connection & auth
- URL: `wss://<host>/v1/stream?token=<JWT>`
- JWT: obtained via `POST /v1/session/token` (Clerk-authenticated REST), HS256, 60s expiry,
  claims `{ sub: userId, plan, jti }`. Server validates on upgrade, binds connection to user,
  loads per-user rate limits from Redis. Expired/invalid → HTTP 4401 close before upgrade
  completes. Reconnects always fetch a fresh token.
- Heartbeat: JSON `ping`/`pong` every 15s; two missed pongs → client treats as dropped.

### 4.2 Binary frame (client→server only; audio)
Fixed 8-byte header, little-endian, then payload:
```
offset 0  u8   version        = 0x01
offset 1  u8   type           = 0x01 (audio)
offset 2  u16  utteranceId
offset 4  u32  frameSeq       // per-utterance, starts at 0, increments by 1
offset 8  ...  payload        // 20ms PCM16LE @16kHz mono = 640 bytes
```
Unknown version/type → server sends `error PROTO_ERROR` and closes 1002.

### 4.3 JSON control messages
Every JSON message: `{ "t": <type>, ...fields }`.

Client → server:
| t | fields | notes |
|---|---|---|
| `session.start` | `sessionId, appContext, locale` | once per connection before audio |
| `utterance.start` | `utteranceId, appContext` | appContext re-captured per utterance |
| `audio.end` | `utteranceId, lastFrameSeq` | key-up; server finalizes after receiving frame `lastFrameSeq` or 250ms, whichever first |
| `session.resume` | `sessionId, utteranceId, lastAckedFrameSeq` | after reconnect mid-utterance |
| `ping` | `ts` | |

Server → client:
| t | fields | notes |
|---|---|---|
| `session.ready` | `sessionId` | ack of start/resume |
| `audio.ack` | `utteranceId, frameSeq` | every 25 frames (~500ms); client may drop replay buffer ≤ frameSeq |
| `transcript.partial` | `utteranceId, text` | cumulative (replaces previous) |
| `transcript.final` | `utteranceId, text, asrMs` | |
| `format.delta` | `utteranceId, text` | append-only chunks |
| `format.done` | `utteranceId, text, wordCount, timings` | `timings` per §9 |
| `usage.update` | `wordsThisWeek, limit` | after each `format.done` |
| `error` | `code, message, retryable, retryAfterMs?, utteranceId?` | codes per §8; `retryAfterMs` present iff the taxonomy marks the code `requiresBackoff` (v1.1.0) |
| `pong` | `ts` | |

### 4.4 Ordering, reconnect, replay, backpressure
- Client keeps a replay ring buffer of un-acked frames (cap 30s of audio = 1500 frames).
- `lastAckedFrameSeq` is `-1` when no frame of the utterance was ever acked (server replays
  from 0). (v1.2.0 clarification)
- On transport loss mid-utterance: state → `buffering`; on reconnect (fresh token),
  send `session.resume`; server replies `session.ready` with its `lastReceivedFrameSeq`
  implied by next `audio.ack`; client replays from `lastAckedFrameSeq + 1`. If the server
  no longer has the session (>60s), it sends `error SESSION_INVALID` and the client falls
  back to the offline buffer path (utterance audio re-sent as a fresh utterance).
- Frames MUST arrive in seq order per utterance; server drops out-of-order frames and
  re-acks its high-water mark.
- Backpressure: if client socket bufferedAmount > 256KB, client pauses capture push into
  the socket (audio keeps buffering locally); resumes when < 64KB.

## 5. REST API (`apps/api`, all under `/v1`, Clerk bearer auth unless noted)

| Method & path | req | res 200 | errors |
|---|---|---|---|
| `POST /v1/session/token` | – | `{ token, expiresAt }` | 401 |
| `GET /v1/me` | – | `{ userId, email, plan, trialEndsAt, usage: { wordsThisWeek, limit } }` | 401 |
| `GET /v1/dictionary` | – | `{ entries: DictionaryEntry[] }` | 401 |
| `POST /v1/dictionary` | `{ phrase, soundsLike? }` | `DictionaryEntry` | 400, 401, 409 (dup phrase), 422 (>500 entries total) |
| `PATCH /v1/dictionary/:id` | partial entry | `DictionaryEntry` | 400, 401, 404, 409 (rename collides with existing phrase — forced by the UNIQUE(user_id, lower(phrase)) index; v1.3.0) |
| `DELETE /v1/dictionary/:id` | – | `{ ok: true }` | 401, 404 |
| `GET /v1/history?q=&cursor=&limit=` | – | `{ items: HistoryItem[], nextCursor? }` | 401 |
| `DELETE /v1/history/:id` | – | `{ ok: true }` | 401, 404 |
| `DELETE /v1/history` | – | `{ ok: true, deleted: number }` | 401 |
| `POST /v1/webhooks/stripe` | Stripe sig | `{ received: true }` | 400 (bad sig; no auth) |
| `POST /v1/billing/checkout` | `{ interval: 'monthly'\|'yearly', successUrl?, cancelUrl? }` | `{ url }` | 400, 401 (added in Phase 3e; ratified v1.4.0) |

```ts
export interface HistoryItem {
  id: string;
  text: string;            // decrypted server-side for the owner
  appName: string;
  register: Register;
  wordCount: number;
  createdAt: string;
}
```
History `q` is exact-word match via the HMAC token index (§7). Cursor = opaque base64 of
`(createdAt, id)`.

## 6. Formatting rules (the Haiku prompt's contract — golden set enforces this)

- Input: FormatRequest. Output: formatted text only, no preamble, no quotes.
- Command grammar is EXACTLY guide §4.3; anything else is prose.
- Dictionary: entries injected as "phrase (may be misheard as: …)" lines. Cap: 200 entries
  or ~2k tokens, whichever first; over cap → include only entries whose phrase or soundsLike
  fuzzy-matches the transcript (trigram similarity ≥ 0.4, `packages/shared/src/dict-filter.ts`).
- Register conditioning: one line per Register value mapping to tone guidance.
- "Do no harm": already-clean input passes through byte-identical.
- Golden set (`packages/shared/fixtures/golden/*.json`): `{ input, appContext, dictionary,
  expected }`. Scoring: normalized exact-match for command cases; embedding-similarity ≥ 0.90
  for prose cases. Any prompt change must keep the set green.

## 7. Database schema (Drizzle, Postgres; `apps/api/src/db/schema.ts`)

```
users            id uuid pk · clerk_id text uniq · email text · plan text ('free'|'pro')
                 · trial_ends_at timestamptz · stripe_customer_id text · created_at
dictionary       id uuid pk · user_id fk · phrase text · sounds_like text[] · created_at
                 · UNIQUE(user_id, lower(phrase))
transcripts      id uuid pk · user_id fk · ciphertext bytea · iv bytea · key_version int
                 · app_name text · register text · word_count int · created_at
                 · INDEX (user_id, created_at desc)
transcript_tokens transcript_id fk · token_hmac bytea · PRIMARY KEY(transcript_id, token_hmac)
                 · INDEX (token_hmac)
usage_weeks      user_id fk · week_start date · words int · PRIMARY KEY(user_id, week_start)
subscriptions    user_id pk fk · stripe_sub_id text · status text · plan_interval text
                 · current_period_end timestamptz · updated_at
```
- Transcript content: AES-256-GCM, key from `TRANSCRIPT_KEY` env (32B base64), `key_version`
  enables rotation. Token index: HMAC-SHA256(`TOKEN_INDEX_KEY`, normalized word) per unique
  word — separate key from content. **No plaintext transcript ever hits disk server-side.**
- Audio: NEVER persisted server-side (opt-in flag is v2; there is no code path that writes
  audio in v1 — the Phase 5 storage-inspection script asserts this).
- Metering: `usage_weeks.words += wordCount` at `format.done` time, week starts Monday UTC.
  Free limit 2000/wk; Pro fair-use 50000/wk. Enforcement in §8 `QUOTA_EXCEEDED`.

## 8. Error taxonomy (`packages/shared/src/errors.ts`)

| code | fires when | retryable | client behavior |
|---|---|---|---|
| `AUTH_EXPIRED` | JWT expired at upgrade or mid-session | yes | fetch fresh token, reconnect silently |
| `AUTH_INVALID` | bad/forged token, Clerk session revoked | no | sign-in screen |
| `SESSION_INVALID` | resume of unknown/expired session | no | offline-buffer path, new session |
| `PROTO_ERROR` | malformed frame/message | no | close, reconnect fresh; report telemetry |
| `RATE_LIMITED` | per-user msg/frame rate exceeded (Redis) | yes (after `retryAfterMs`) | back off, HUD unchanged |
| `QUOTA_EXCEEDED` | weekly word cap hit at format time | no | HUD honest error + upgrade prompt; transcript still returned raw (never eat the user's words) |
| `ASR_UNAVAILABLE` | provider connect/5xx | yes | offline-buffer + retry ×3 backoff |
| `ASR_TIMEOUT` | finalize > 2000ms | yes | same |
| `FORMAT_UNAVAILABLE` | Anthropic connect/5xx/refusal | yes | inject RAW final transcript, flag "unformatted" in HUD |
| `FORMAT_TIMEOUT` | no TTFT within 2000ms | yes | same raw-injection fallback |
| `INJECT_FAILED` | native injection error (client-local) | no | text to clipboard + HUD "copied — paste with Ctrl/Cmd+V" |
| `OFFLINE_BUFFERED` | transport down at capture | yes | HUD honest state; background retry |
| `INTERNAL` | anything unmapped | maybe | HUD generic error; telemetry |

Raw-injection fallback (FORMAT_*) is deliberate: losing formatting is annoying; losing the
user's words is fatal.

## 9. Timing marks (hop names — Phase 1 gate and Phase 5 telemetry read the same marks)

`t_keyup` · `t_audio_end_sent` · `t_asr_final` · `t_prompt_built` · `t_format_ttft` ·
`t_format_done` · `t_client_first_delta` · `t_inject_done`.
Emitted in `format.done.timings` (server marks) and telemetry (client marks). All ms since
`t_keyup`. Never contains transcript content.

## 10. Env contract (`.env.example` mirrors exactly this)

```
MOCK_MODE=1                # 1 = all externals mocked; every service reads at startup
DATABASE_URL=              # postgres
REDIS_URL=
ANTHROPIC_API_KEY=
DEEPGRAM_API_KEY=
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=  # Stripe price ID, Pro $12/mo; mock placeholder in code (v1.3.0)
STRIPE_PRICE_PRO_YEARLY=   # Stripe price ID, Pro $96/yr; mock placeholder in code (v1.3.0)
TRANSCRIPT_KEY=            # base64 32B; dev default generated into .env by scaffold
TOKEN_INDEX_KEY=           # base64 32B; distinct from TRANSCRIPT_KEY
SESSION_JWT_SECRET=        # HS256 secret for WS session tokens (§4.1); mock default in code
POSTHOG_HOST=              # self-hosted; empty = telemetry disabled
```
