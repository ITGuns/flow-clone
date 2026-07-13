# Voice-to-Text Dictation SaaS — Autonomous Build Guide
### Fable 5 orchestration · Opus 4.8 execution · v3 (gap-swept)

**How to use this file:** open Claude Code (or an equivalent agent harness with filesystem, shell, git, and subagent support), select **Claude Fable 5**, paste this entire file, and let it run. Fable does the planning and gatekeeping; **Opus 4.8 does nearly all the implementation** per the routing policy in §2. Before starting, complete the human checklist in §1 — it is the only part of this project a model cannot do for you.

---

## 1. Prerequisites — the human checklist

The build is designed to proceed **without any of these** using mock mode (§4.4), so missing items pause features, not the build. But nothing ships until they exist.

| Item | Needed for | When |
|---|---|---|
| Anthropic API key | Haiku 4.5 formatting pass | Phase 1 real-mode gate |
| Streaming ASR key — **Deepgram** (decided; see §4.1) | Real transcription | Phase 1 real-mode gate |
| Stripe account (test mode is fine) | Billing | Phase 3 |
| Clerk account | Auth | Phase 3 |
| Fly.io or Railway account | Deploy | Phase 5 |
| Apple Developer account ($99/yr) | macOS signing + notarization | Phase 5 |
| Windows code-signing cert (EV or Azure Trusted Signing) | Windows signing | Phase 5 |
| GitHub repo with Actions enabled | CI on macOS/Windows runners — **this is how native code gets verified**, see §4.5 | Phase 0 |
| A macOS machine and a Windows machine you can physically touch | Human verification checkpoints (§8) | Phase 2 onward |
| Product name decision | Branding, bundle IDs, domains | Any time before Phase 4 |

Secrets go in `.env` files that are gitignored from commit zero, mirrored by a committed `.env.example`. The orchestrator maintains **`HUMAN_TODO.md`** in the repo root — every time it hits something only a human can do (create an account, click a verification email, plug in a physical machine), it logs the item there with exact instructions and continues on whatever isn't blocked. **Check this file whenever you return to the run.**

### Product decisions (defaults — Fable uses these unless the human overrides in-session)

- **Name:** codename **"Undertone"** used consistently as a placeholder (bundle ID `com.yourco.undertone`). Renaming later is a find-replace; *shipping* requires the human to pick a real name and clear a trademark search (logged to `HUMAN_TODO.md`).
- **Pricing:** Free — 2,000 formatted words/week. Pro — $12/mo or $96/yr, unlimited with fair-use cap of 50k words/week. Metering unit: **words injected** (counted server-side at format time).
- **Trial:** 14 days of Pro on signup, no card required.
- **Telemetry:** self-hosted PostHog, anonymous by default, opt-out in settings. Never log transcript content in telemetry — usage counts and latency timings only. This must stay consistent with the privacy posture in §3.

---

## 2. Model routing policy

### The economics, in one paragraph

Fable 5: $10/M input, $50/M output. Opus 4.8: $5/M in, $25/M out. Fable's lead over Opus grows with task length and ambiguity, and shrinks toward zero on well-specified implementation work. An auth integration, a CRUD endpoint, a settings screen: Opus produces the same code at half the price. So:

> **Opus 4.8 by default. Fable 5 only where reasoning compounds — architecture, contracts, gates, escalated debugging, whole-codebase review. If you can write a clear spec for a task, it goes to Opus. If writing the spec IS the task, it stays with Fable.**

### Routing table

| Task type | Model | Why |
|---|---|---|
| Architecture, latency budget, contracts, schema | **Fable 5** | Cross-cutting; errors here cost weeks |
| Streaming pipeline design (the latency spine) | **Fable 5** | Novel, unforgiving, drives the product |
| Phase gates and integration reviews | **Fable 5** | Long-context coherence; 1M window earns its price here |
| Escalated debugging (two-strikes rule below) | **Fable 5** | Only after Opus fails twice, with full failure context attached |
| Everything else — specced modules, CRUD, UI, tests, config, docs | **Opus 4.8** | Half the price, same quality on specified work |
| OS input synthesis, accessibility hooks, security review, encryption | **Opus 4.8 — mandatory** | Fable's cyber classifiers flag exactly this shape of legitimate work. A refusal arrives as HTTP 200 + `stop_reason: "refusal"` — treat it as a routing signal, send to Opus, never reword-and-retry |
| Runtime formatting inside the product | **Haiku 4.5** | ~200ms budget; a bigger model here is a product bug |

### Dispatch mechanism (concrete — this is how "send to Opus" actually happens)

- **In Claude Code:** define a subagent in `.claude/agents/implementer.md` with `model: claude-opus-4-8` and tool access to filesystem/shell/git, containing the §5.2 task template as its operating instructions. Fable invokes it via the Task tool, one invocation per module, parallel invocations for parallel tasks. Create this subagent file during Phase 0, before any implementation.
- **Headless fallback (scripted pipelines):** `claude -p --model claude-opus-4-8 "<task>"` per task, or direct Messages-API calls with `model: claude-opus-4-8`.
- Either way: `ARCHITECTURE.md` + `CONTRACTS.md` form the **cached prefix** of every dispatch (90% input discount on cache hits — structure prompts invariant-context-first, task-delta-last).

### Escalation — the only path from Opus to Fable

Opus gets **two attempts** per task. Second failure → escalate to Fable **with everything attached**: what was tried, what broke, full error output. Never escalate cold — Fable re-deriving what Opus already learned is paying twice for one discovery. If an escalated task then trips a Fable classifier (likely in Phase 2), the answer is a better-specified third Opus attempt, not a rewording war.

### De-escalation — keeping Fable honest

If Fable finds itself writing implementation code for anything with a clear spec — a settings form, a webhook handler, a migration — it stops, extracts the spec, and dispatches. Fable writing boilerplate is the most expensive failure mode in this workflow.

### Budget expectation

Roughly **10–15% of spend on Fable**, 85–90% on Opus. Fable share creeping past 25% means either specs are too vague (Opus keeps failing upward) or Fable is hoarding work. Both are orchestration bugs; fix the specs or enforce de-escalation.

---

## 3. What we are building

An **original** cross-platform dictation app. Hold a hotkey, speak, release; polished text appears at the cursor in whatever app was already focused. Not a transcription tool that dumps raw text — a *writing* tool producing what the user would have typed with more patience.

The reference product is Wispr Flow (wisprflow.ai): study it for feature scope and interaction model. **Do not copy its code, assets, UI copy, brand, or name.** Same category, original product, original copy, own name.

### The product insight

Raw ASR output is not the product. The gap between "what the mic heard" and "what the user meant to write" is the product, closed by a formatting pass that: strips disfluencies (um, uh, false starts, "no wait, scratch that") · fixes punctuation/capitalization · adapts register to the target app (Slack ≠ legal memo ≠ commit message) · executes voice commands (§4.3) · applies the user's custom dictionary.

Latency is the other half: **key-release → text-at-cursor under 1.2s p50, 2.5s p95.** If a design can't hit it, the design is wrong, not the constraint.

### Scope, v1

**Ship:** global push-to-talk hotkey (configurable, works unfocused) · streaming ASR during speech · Haiku formatting with app-context awareness · injection into arbitrary native apps · custom dictionary · auth, subscriptions, metering · cross-device searchable history (server-stored, displayed in the desktop app; no web dashboard in v1) · macOS + Windows.

**Not v1:** mobile · collaboration · diarization/meetings · offline ASR · Linux · web dashboard.

### Non-negotiables

- **Privacy posture is a feature.** Audio processed and discarded server-side, never persisted without explicit opt-in. Transcripts encrypted at rest. Telemetry never contains content. The privacy policy must be *true* — Fable drafts privacy policy + ToS in Phase 4, flagged in `HUMAN_TODO.md` for counsel review before public launch.
- Mic permission requested with an in-app explanation *before* the OS prompt.
- Offline degradation: hotkey fires, honest error, the captured utterance is buffered locally and retried — never silently lost.

---

## 4. Technical decisions (all decided — don't relitigate without documenting a blocker in `DECISIONS.md` first)

### 4.1 Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron + React + TypeScript |
| Text injection | macOS: Accessibility API (native module) · Windows: SendInput / UI Automation (native module) |
| Audio | Web Audio API → 16kHz mono PCM, client-side resample |
| Transport | WebSocket, binary frames for audio, JSON for control |
| Backend | Node + Fastify + TypeScript |
| ASR | **Deepgram** streaming, behind an `ASRProvider` adapter — vendor SDK never touched by business logic |
| Formatting | Claude Haiku 4.5, streaming output |
| DB / cache | Postgres + Drizzle · Redis |
| Auth / billing | Clerk · Stripe |
| Deploy | Fly.io (Railway acceptable) |
| Monorepo | pnpm workspaces: `apps/desktop`, `apps/api`, `packages/shared` |

### 4.2 The streaming spine (why the product feels good or dead)

Naive pipeline — record → upload → transcribe → format → inject — is ~3-4s. Dead. Correct pipeline: audio streams to ASR **while the user is talking**; partials accumulate server-side; on key-release only the final ASR flush + one Haiku call remain. **Formatting decision, settled:** one Haiku call on the finalized transcript (not incremental per-partial reformatting), with streamed output injected as it arrives for utterances over ~15 words. Dictionary injected into the prompt, **capped at 200 entries / ~2k tokens** — beyond that, retrieval-filter to the entries fuzzy-matching the transcript. Build it this way from commit one; retrofitting streaming is a rewrite.

**WS auth handshake:** client obtains a short-lived JWT (60s expiry) from `POST /session/token` (Clerk-authenticated), presents it in the WS connection query; server validates, binds the connection to the user, and applies per-user rate limits from Redis. Reconnects get a fresh token.

### 4.3 Voice command grammar, v1 (exhaustive — nothing else is a command)

`new line` · `new paragraph` · `period` / `comma` / `question mark` / `exclamation point` (when clearly imperative, not dictated prose — the Haiku prompt handles disambiguation) · `scratch that` (delete previous sentence) · `all caps <phrase> end caps` · `bullet list` / `numbered list` (start), `end list` · `quote <phrase> end quote`.

These live in the Haiku system prompt and are covered by the golden set (§4.6). Anything beyond this list is v2.

### 4.4 Mock mode (what makes the build unblockable)

`MOCK_MODE=1` swaps every external dependency for a local fake, so the **entire pipeline runs end-to-end with zero API keys**, and CI never needs secrets:

- `MockASRProvider`: streams canned partial transcripts from fixture files with realistic timing jitter.
- `MockFormatter`: deterministic rule-based cleanup (enough to exercise the pipeline; the golden set runs against real Haiku only when a key exists).
- Stripe test-mode + Clerk dev instance where keys exist; local no-op stubs where they don't.

Every service reads its mode from env at startup. E2E tests (Playwright) run entirely in mock mode. The Phase 1 latency gate has two tiers: **mock-mode gate** (pipeline mechanics, runs anywhere) and **real-mode gate** (actual numbers, requires Deepgram + Anthropic keys — if keys are missing, log to `HUMAN_TODO.md` and continue building; the real gate blocks *ship*, not *build*).

### 4.5 The sandbox-reality gap (read this, it's where autonomous builds silently fail)

The orchestrator runs in a Linux container. It **cannot execute** macOS Accessibility APIs, Windows SendInput, global hotkeys, or signing/notarization. Pretending otherwise produces untested native code marked "done." The protocol instead:

1. Native modules are written with their OS-API layer isolated behind a thin interface; everything above it is unit-tested with mocked OS APIs, on Linux, in-container.
2. **GitHub Actions matrix on `macos-latest` and `windows-latest`** compiles the native modules, runs their test suites, and produces artifacts on every push. A native task is not "done" until its CI job is green on the real OS.
3. What CI can't verify — does injection actually land in Slack? does the hotkey fire with the app unfocused? does the HUD really not steal focus? — becomes a **human verification checkpoint**: a `HUMAN_TODO.md` entry with a numbered manual test script for a physical machine. §8 lists all of them.

### 4.6 The golden set (what makes formatting quality falsifiable)

Early in Phase 1 (task 1f), Opus authors **40+ fixture pairs**: raw ASR-style transcript in (disfluencies, run-ons, voice commands, dictionary words, register cues) → expected formatted text out. Coverage: each §4.3 command · disfluency stripping · at least 3 target-app registers · dictionary proper nouns · a "do no harm" case where the input is already clean and must pass through unmodified. This is the regression suite for the Haiku prompt: **any prompt change must keep the golden set green** (scored by normalized exact-match for command cases, embedding-similarity threshold for prose cases). The set also doubles as `MockASRProvider` fixtures.

### 4.7 HUD window mechanics (implicit-turned-explicit, or the core interaction breaks)

Frameless, transparent, always-on-top, **non-activating**: macOS — `NSPanel` with `.nonactivatingPanel`, joins all Spaces, ignores mouse where transparent; Windows — `WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`. It must never take keyboard focus from the user's target app — if it does, injection targets the wrong window and the product is broken. This is a named acceptance criterion on task 4a and a human checkpoint in §8.

---

## 5. Working protocol

### 5.1 Fable's own artifacts (the expensive tokens, spent once)

Written before any implementation, kept current, cached-prefix for every dispatch:

- **`ARCHITECTURE.md`** — system diagram, streaming data flow, deploy topology, and a **per-hop latency budget in milliseconds** (capture → WS → ASR → Haiku → WS → injection) that must sum under 1.2s *on paper* before anything is built.
- **`CONTRACTS.md`** — every cross-module TS interface · full WS protocol (message types, binary frame layout, ordering, reconnect + buffered-replay semantics) · Drizzle schema · REST shapes · the `ASRProvider` interface · error taxonomy (every code, when it fires, what the client does). **This file is law.** Opus implements against it and may not amend it; contract friction is reported up, Fable amends, affected tasks re-dispatch. This single rule is what keeps parallel agents from diverging.

Plus three living run-state files, updated continuously, so a human returning after two days can audit the run in five minutes:

- **`STATUS.md`** — phase, tasks in flight, gates passed/failed with numbers, spend estimate vs. the §2 budget split.
- **`DECISIONS.md`** — every judgment call made autonomously, with rationale. ("Decide, document, proceed" — but the documentation is not optional.)
- **`HUMAN_TODO.md`** — everything blocked on a human, with exact instructions per item.

### 5.2 Opus task template (uniform, no exceptions)

```
MODEL: claude-opus-4-8
ROLE: Senior engineer implementing one module against a frozen contract.
CONTEXT (cached prefix): ARCHITECTURE.md, CONTRACTS.md, + only the files this task touches.
TASK: <one sentence, one module, one boundary>
FILES YOU MAY CREATE/MODIFY: <explicit allowlist — editing outside it is task failure>
ACCEPTANCE CRITERIA:
  - [ ] <mechanically checkable — "tests pass", never "code is clean">
  - [ ] Typechecks clean; no `any`, `@ts-ignore`, or TODO
  - [ ] Unit tests written and passing, INCLUDING failure paths
  - [ ] Works in MOCK_MODE=1 with no external keys
WRITE TESTS FIRST. Implement until green. Commit on green with a conventional-commit message.
DO NOT: modify CONTRACTS.md (stop and report) · touch files outside the allowlist ·
add dependencies without flagging · claim native code works without a green OS-matrix CI run.
REPORT: built, tested, unsure-about, contract friction.
```

One module per task; file allowlists are what prevent merge hell. Git discipline: trunk-based, short-lived branches per task, squash-merge on green CI.

### 5.3 Review discipline (what Fable checks on every returned task)

1. **Contract match** — not "does it work"; drifted-but-working code breaks its neighbors.
2. **Tests test the thing** — failure paths, not just happy paths.
3. **UI tasks: vision review** — screenshot the running UI against §7; never accept an agent's textual self-description of what it built.
4. **Latency tasks: measurements, never arguments.**
5. Rejections are specific ("`ws-client.ts:84` reconnect drops buffered frames; contract §4.2 requires replay"), never "this is wrong" — vague rejections waste a full round-trip.

---

## 6. Build phases

Sequential phases, parallel tasks within each. Model tags per task.

### Phase 0 — Planning & foundation
| | Task | Model |
|---|---|---|
| 0a | `ARCHITECTURE.md` + latency budget | **Fable 5** |
| 0b | `CONTRACTS.md` | **Fable 5** |
| 0c | Monorepo scaffold, TS/lint config, `.env.example`, the `.claude/agents/implementer.md` subagent, GitHub Actions incl. macOS/Windows matrix, `STATUS/DECISIONS/HUMAN_TODO.md` seeds | Opus 4.8 |

### Phase 1 — The latency spine (riskiest first)
| | Task | Model |
|---|---|---|
| 1a | Audio capture + 16kHz resample + VAD | Opus 4.8 |
| 1b | WS client: binary framing, reconnect + buffered replay, backpressure | Opus 4.8 |
| 1c | WS server: token handshake (§4.2), session lifecycle, per-connection state machine | Opus 4.8 |
| 1d | `ASRProvider` interface + Deepgram impl + `MockASRProvider` | Opus 4.8 |
| 1e | Haiku formatting service: prompt w/ §4.3 grammar, dictionary injection + cap, app-context conditioning, `MockFormatter` | Opus 4.8 |
| 1f | Golden set (§4.6): 40+ fixtures + scoring harness | Opus 4.8 |
| — | **GATE: integrate 1a–1f; mock-mode gate always; real-mode p50/p95 measurement when keys exist** | **Fable 5** |

Gate fails → Fable revises the architecture before anyone writes UI. Everything downstream is worthless if this number is wrong.

### Phase 2 — Native integration (**Opus mandatory — classifier territory**, §2)
2a macOS hotkey + Accessibility injection (native module) · 2b Windows hotkey + SendInput/UIA injection · 2c active-app detection → app-context signal · 2d permission flows with pre-prompt UI. All Opus 4.8. Done means: unit tests green on Linux with mocked OS APIs **and** OS-matrix CI green **and** a human checkpoint logged for physical verification. Expect most of the build's escalations here; apply two-strikes with full context.

### Phase 3 — Backend platform (all Opus — the boilerplate tier)
3a Clerk auth + sessions · 3b schema + migrations · 3c history: storage, **encryption at rest**, search · 3d dictionary CRUD + prompt-injection point · 3e Stripe: plans per §1 defaults, metered words, webhooks · 3f rate limiting + usage counters (Redis).

### Phase 4 — Product surface (all Opus)
4a HUD (§4.7 mechanics + §7 design — the product's face) · 4b history view · 4c settings: hotkey, dictionary, preferences, telemetry opt-out · 4d onboarding: permissions → hotkey → first successful dictation · 4e marketing site + pricing page · 4f privacy policy + ToS drafts (→ `HUMAN_TODO.md` for counsel).

### Phase 5 — Hardening & ship
| | Task | Model |
|---|---|---|
| 5a | Error taxonomy end-to-end; offline buffering + retry | Opus 4.8 |
| 5b | Latency instrumentation, per-hop production telemetry | Opus 4.8 |
| 5c | Playwright E2E, mock mode, in CI | Opus 4.8 |
| 5d | electron-updater, signing + notarization pipelines (needs §1 certs; else → `HUMAN_TODO.md`) | Opus 4.8 |
| 5e | Security review | Opus 4.8 (**mandatory**) |
| — | **Final coherence pass: entire codebase in one 1M-token window — contract drift, dead code, cross-module inconsistency no per-task review can see** | **Fable 5** |

---

## 7. Design brief

The HUD is the product's entire visible identity — seen a hundred times a day, and nothing else is. Three states — **listening / thinking / done** — readable *pre-attentively*, from peripheral vision, because the user is looking at their own document. Live audio-level display so the user knows the mic works; silent failure here is the worst bug in the product. Mechanics per §4.7: appears on key-down, dismisses on completion, never takes focus.

Do not ship a generic waveform in a rounded pill with a purple gradient — that is the category default and reads as no decision at all. Find a visual language that comes from *speech* — breath, cadence, the shape of a sentence — and commit. A display face with a point of view, a body face that stays out of the way; not Inter-on-everything. Quality floor, unstated but enforced: keyboard nav, visible focus, `prefers-reduced-motion`, WCAG AA, dark mode.

---

## 8. Definition of done — split by who can verify it

### Machine-verifiable (the orchestrator closes these itself)
- [ ] Mock-mode E2E suite green in CI
- [ ] OS-matrix CI green: native modules compile + tests pass on macos-latest and windows-latest
- [ ] Golden set green against the shipped Haiku prompt
- [ ] Real-mode p50/p95 measured in-container against live Deepgram + Haiku, budget met
- [ ] Typecheck + full test suite green; zero `any`/`@ts-ignore`/TODO
- [ ] Storage inspection script proves zero audio persisted outside opt-in (*verified by inspecting storage, not by reading code*)
- [ ] `STATUS.md`, `DECISIONS.md`, `HUMAN_TODO.md` current

### Human-verified (physical machines; scripts written by the orchestrator into `HUMAN_TODO.md`)
- [ ] p50 < 1.2s / p95 < 2.5s on real hardware over real network, both OSes
- [ ] Injection lands correctly in Slack, VS Code, Chrome, Notes/Notepad, Gmail-in-browser
- [ ] Hotkey fires with the app unfocused; HUD never steals focus (§4.7)
- [ ] Full loop as a new user: auth → subscribe (Stripe test card) → dictate → history syncs
- [ ] Dictionary demonstrably fixes proper nouns raw ASR mangles
- [ ] Signed, notarized installers install clean on fresh machines
- [ ] A stranger dictates a sentence successfully without reading docs
- [ ] Real name chosen, trademark-checked; privacy policy + ToS reviewed by counsel

---

## 9. Kickoff sequence (the orchestrator executes this on paste)

1. Read this file fully. Write to `STATUS.md` the three constraints most likely to break the build and the de-risk plan for each.
2. Check for §1 prerequisites; log every absence to `HUMAN_TODO.md` with instructions. **Do not stop** — mock mode exists so that nothing here blocks the build.
3. Write `ARCHITECTURE.md` and `CONTRACTS.md` (Fable's expensive tokens, spent once). Latency budget must sum under 1.2s on paper.
4. Dispatch 0c, then 1a–1f in parallel to Opus subagents per §2's mechanism.
5. Run the Phase 1 gate. Pass → proceed; fail → revise architecture, re-dispatch.
6. From there Opus owns the build; Fable appears only at gates, two-strike escalations, and the final coherence pass. Decide, document in `DECISIONS.md`, proceed. Escalate when stuck — not when bored.
