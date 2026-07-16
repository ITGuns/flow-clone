# STATUS

**Product:** Undertone (codename) — cross-platform voice-to-text dictation SaaS
**Phase:** 3 gate PASSED → Phase 4 — Product surface
**Mode:** MOCK_MODE (no external API keys present — see HUMAN_TODO.md)
**Last updated:** 2026-07-14

## The three constraints most likely to break this build

### 1. The latency budget (key-release → text-at-cursor: 1.2s p50 / 2.5s p95)
Every architectural mistake shows up here, and retrofitting streaming is a rewrite.
**De-risk:** Phase 1 builds the streaming spine before any UI exists. The per-hop budget in
ARCHITECTURE.md must sum under 1.2s on paper before implementation. The Phase 1 gate measures
the pipeline end-to-end in mock mode (mechanics) and in real mode when keys arrive (numbers).
Formatting is a single Haiku call on the finalized transcript with streamed-out injection —
decided in the guide, not up for relitigation.

### 2. The sandbox-reality gap (native OS integration cannot be fully verified here)
This orchestrator runs on **Windows 11** — better than the Linux-container assumption in the
guide: Windows native modules (SendInput, hotkeys, HUD flags) can be compiled and smoke-tested
locally. macOS Accessibility, signing, and notarization still cannot.
**De-risk:** OS-API layer isolated behind thin interfaces, unit-tested with mocks everywhere;
GitHub Actions matrix (macos-latest + windows-latest) is the definition of "compiles and
passes" for native code; physical-machine test scripts land in HUMAN_TODO.md (§8 of the guide).
Until a GitHub remote exists, OS-matrix CI cannot run — logged as the top HUMAN_TODO item.

### 3. Zero API keys at kickoff (Deepgram, Anthropic, Stripe, Clerk, Fly.io, signing)
Nothing external is connected. If mock mode is an afterthought, the build stalls on every seam.
**De-risk:** MOCK_MODE=1 is a first-class citizen from commit one — MockASRProvider streams
canned partials with timing jitter, MockFormatter is deterministic, CI runs keyless. Real-mode
gates block *ship*, not *build*. Every missing key is in HUMAN_TODO.md with instructions.

## Task board

| Phase | Task | State | Model |
|---|---|---|---|
| 0a | ARCHITECTURE.md + latency budget | ✅ done | Fable 5 |
| 0b | CONTRACTS.md | ✅ done | Fable 5 |
| 0c | Monorepo scaffold + CI + seeds | ✅ done (41 tests; friction → CONTRACTS v1.1.0, D-007) | Opus 4.8 |
| 1a | Audio capture + resample + VAD | ✅ 44 tests | Opus 4.8 |
| 1b | WS client: framing, replay, backpressure | ✅ 19 tests | Opus 4.8 |
| 1c | WS gateway + utterance pipeline | ✅ 33 tests | Opus 4.8 |
| 1d | ASRProvider: Deepgram + mock | ✅ 32 tests | Opus 4.8 |
| 1e | Formatting: Haiku + dict-filter + mock | ✅ 86 tests | Opus 4.8 |
| 1f | Golden set + scoring harness | ✅ 42 fixtures, 21 tests | Opus 4.8 |
| Gate 1 | Integration + mock-mode gate | ✅ **PASSED** (see Gates) | Fable 5 |
| 2a | macOS hotkey + AX injection | ✅ merged; pure layer green | Opus 4.8 |
| 2b | Windows hotkey + SendInput/UIA | ✅ merged; pure layer green | Opus 4.8 |
| 2c | active-app → Register signal | ✅ merged (48 tests) | Opus 4.8 |
| 2d | permission pre-prompt flows | ✅ merged (pre-prompt invariant tested) | Opus 4.8 |
| Gate 2 | native merge + loader unify + CI union | ✅ **PASSED in-container** | Fable 5 |
| 3a–3f | Backend platform | ✅ merged (zero conflicts), gate integration e2e green | Opus 4.8 |
| Gate 3 | composition root + pipeline hooks + backend e2e | ✅ **PASSED** (643 tests: shared 155 / desktop 163 / api 325) | Fable 5 |
| 4a/4b/4c/4e/4f/4g | Product surface wave 1 (4g = session orchestrator, added task) | 🔄 in flight | Opus 4.8 |
| 4d | Onboarding (wave 2 — needs 4g) | ⬜ | Opus 4.8 |
| 5 | Hardening & ship | ⬜ | |

> Gate 3 evidence: keyless e2e proves token→/me→dictionary CRUD→WS utterance→format.done→
> usage.update→history persistence→/me usage increment, plus the quota path (transcript
> STILL delivered, QUOTA_EXCEEDED error strictly after — never eat the user's words).
> Real-mode composition (Clerk/Stripe/Redis/Postgres) typechecks but is unexercised until
> keys exist (HUMAN_TODO #1–5); Drizzle repos need one live-PG integration run before real
> deploy. Watch-item: one unreproducible golden-mock flake in a single full-suite run
> (passed 3 consecutive re-runs; monitor in CI).

> **Native code's *ship* readiness stays blocked on OS-matrix CI (HUMAN_TODO #3, GitHub remote)
> and the two physical-machine scripts (HUMAN_TODO §12 macOS, §13 Windows).** The .mm and .cpp
> addons could not be compiled here (macOS impossible in-container; Windows host lacks MSVC +
> Python). What IS verified: every bridge-isolated pure logic layer, the unified platform loader,
> typecheck/lint/test green across the monorepo. The CI matrix builds each addon on its real
> runner the moment a remote exists.

## Gates

| Gate | Result |
|---|---|
| Latency budget sums < 1.2s on paper | ✅ 950ms p50 + 250ms margin (ARCHITECTURE.md §4) |
| Phase 1 mock-mode gate | ✅ PASSED 2026-07-14 — 232 tests green; full-pipeline E2E over real WS (token→frames→partials→final→deltas→done); §9 marks monotonic; mock timings t_format_done=158ms (happy), 225ms (FORMAT_TIMEOUT raw-fallback); MockFormatter 26/26 golden mock-scoped cases |
| Phase 1 real-mode gate | ⛔ blocked on keys (HUMAN_TODO #1, #2) — blocks ship, not build |
| OS-matrix CI | ⛔ blocked on GitHub remote (HUMAN_TODO #3) |

## Spend split (target: ≤15% Fable / ≥85% Opus)

Phase 0: Fable-heavy by design (architecture + contracts are the expensive tokens, spent once).
Expect the ratio to normalize as Opus implementation dispatches begin.
