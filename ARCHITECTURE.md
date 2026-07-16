# ARCHITECTURE — Undertone

Cross-platform push-to-talk dictation. Hold hotkey → speak → release → polished text at the
cursor of whatever app was focused, in under 1.2s p50 / 2.5s p95 from key-release.

This document and CONTRACTS.md are the invariant prefix of every implementation task.
CONTRACTS.md defines the exact shapes; this file defines the topology, the data flow, and
the latency budget those shapes must live inside.

## 1. System diagram

```
┌────────────────────────── user's machine ──────────────────────────┐
│                                                                     │
│  target app (Slack, VS Code, …)  ◄── injection ──┐                  │
│                                                  │                  │
│  ┌──────────────── Undertone desktop (Electron) ─┴───────────────┐  │
│  │                                                               │  │
│  │  native module (per OS)          renderer (React)             │  │
│  │  ├─ global hotkey (down/up)      ├─ HUD window (non-activating│  │
│  │  ├─ text injection               │   listening/thinking/done) │  │
│  │  │   mac: AX API                 ├─ history view              │  │
│  │  │   win: SendInput/UIA          ├─ settings / onboarding     │  │
│  │  └─ active-app detection         └─ audio capture (Web Audio  │  │
│  │                                      → 16kHz mono PCM16)      │  │
│  │  main process                                                 │  │
│  │  ├─ session orchestrator (state machine, CONTRACTS §3)        │  │
│  │  ├─ WS client (binary audio up, JSON control both ways,       │  │
│  │  │   reconnect + buffered replay, backpressure)               │  │
│  │  └─ offline buffer (utterances retried, never lost)           │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                       wss:// (binary audio frames + JSON control)
                               │
┌────────────────────────── Fly.io ────────────────────────────────────┐
│  api (Node + Fastify + TS)                                           │
│  ├─ WS gateway: JWT handshake, per-connection state machine          │
│  ├─ ASRProvider adapter ──────────► Deepgram streaming (or MockASR)  │
│  ├─ formatter service ────────────► Haiku 4.5 streaming (or MockFmt) │
│  ├─ REST: /session/token, /dictionary, /history, /usage, /me         │
│  ├─ Stripe webhooks · Clerk auth · metering (words injected)         │
│  ├─ Postgres (Drizzle): users, dictionary, transcripts(encrypted),   │
│  │                      usage, subscriptions                         │
│  └─ Redis: rate limits, usage counters, session state               │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. The streaming data flow (the product's spine)

**While the key is held (talk time — costs the user nothing):**
1. Key-down → HUD appears (never takes focus, §7 of guide) → native module captures the
   currently-focused app → `session.start` with `AppContext`.
2. Renderer captures mic audio, resamples to 16kHz mono PCM16, chunks into 20ms frames.
3. WS client streams binary frames to the gateway; gateway relays into an open
   `ASRProvider` stream; partial transcripts accumulate server-side (and flow back for the
   HUD's live feedback).

**On key-release (this is the only part the user waits for):**
4. Client sends `audio.end`; gateway finalizes the ASR stream → final transcript.
5. Formatter builds ONE Haiku call: system prompt (command grammar §4.3 of guide) +
   dictionary entries (≤200 / ~2k tokens, fuzzy-filtered against transcript beyond the cap)
   + `AppContext` register conditioning + final transcript. **Never per-partial reformatting.**
6. Haiku output streams back over WS as `format.delta`s; for utterances > ~15 words the
   client injects deltas as they arrive (sentence-boundary chunks); shorter utterances inject
   once on `format.done`.
7. Injection lands via the native module into the still-focused target app. Word count is
   metered server-side at format time.

**Failure path (non-negotiable, guide §3):** offline or any pipeline error after capture →
utterance's audio is persisted to the local offline buffer, HUD shows an honest error state,
retry with backoff. Captured speech is never silently lost.

## 3. Deploy topology

- **Fly.io**, single region to start (pick nearest the first users; `iad` default), api as
  one Fly app; Postgres = Fly managed; Redis = Upstash or Fly Redis. Scale-out later is
  horizontal on the WS gateway (sessions are sticky per-connection; no cross-node state
  beyond Redis).
- Desktop updates via electron-updater against GitHub Releases (Phase 5).
- ASR and Haiku are external SaaS — the latency budget assumes same-continent routing.

## 4. Latency budget (key-release → text-at-cursor), p50 on paper

Audio streaming and partial transcription happen during speech and cost nothing here.

| # | Hop | Budget (ms) |
|---|-----|------------|
| 1 | Key-release detect → `audio.end` sent (client) | 15 |
| 2 | WS client→server transit (control frame) | 40 |
| 3 | ASR finalize: flush → final transcript (Deepgram endpointing) | 300 |
| 4 | Prompt assembly: dictionary filter + context (server, CPU) | 15 |
| 5 | Haiku 4.5 TTFT (streaming) | 350 |
| 6 | Haiku completion for a short utterance (≤15 words) | 150 |
| 7 | WS server→client transit (format stream) | 40 |
| 8 | Injection execution (SendInput / AX insert) | 40 |
|   | **Sum** | **950** |
|   | **Margin** | **250** |
|   | **Budget** | **1200** |

- For long utterances, hop 6 stretches but injection starts at first sentence boundary after
  TTFT, so *perceived* latency stays near the short-utterance number.
- p95 (2500ms) absorbs: ASR finalize tail (~600ms), Haiku TTFT tail (~800ms), one WS retry.
- **Instrumentation is part of the contract**: every hop above has a named timing mark
  (CONTRACTS.md §9); the Phase 1 gate and Phase 5 telemetry both read the same marks.

Guardrails that keep the budget honest:
- One Haiku call per utterance. Model: `claude-haiku-4-5-20251001`. A bigger model here is a
  product bug (guide §2).
- Dictionary cap: 200 entries / ~2k tokens in-prompt; beyond that, fuzzy-filter to matches.
- ASR connection is opened at key-down (or kept warm), never at key-release.
- WS connection is persistent with heartbeat; key-release never pays a TCP/TLS handshake.

## 5. Mock mode (guide §4.4)

`MOCK_MODE=1` read from env at startup by every service:
- `MockASRProvider` streams canned partials from `packages/shared/fixtures/` with realistic
  jitter (30–120ms), then a final on `finalize()`.
- `MockFormatter` applies deterministic rules (strip listed disfluencies, capitalize, apply
  the exhaustive command grammar) — enough to exercise the full pipeline mechanics.
- Clerk/Stripe: local no-op stubs issuing fake sessions/subscriptions.
- Playwright E2E and CI run entirely in this mode, keyless.

## 6. Monorepo

pnpm workspaces:
```
apps/desktop     Electron + React + TS (main / renderer / native per-OS modules)
apps/api         Node + Fastify + TS
packages/shared  contracts as code: TS types, WS frame codec, error taxonomy,
                 golden-set fixtures — the ONLY place protocol types live
```
`packages/shared` is the compiled form of CONTRACTS.md; api and desktop import from it and
never redeclare protocol types.

## 7. Verification reality (guide §4.5)

- Orchestrator host is Windows 11: Windows native module is locally compilable/smoke-testable;
  macOS is not.
- OS-matrix CI (`macos-latest`, `windows-latest`) is the definition of "done" for native code.
- What CI can't see (injection landing in real apps, hotkey-while-unfocused, HUD focus
  behavior, real-network latency) → numbered manual scripts in HUMAN_TODO.md.
