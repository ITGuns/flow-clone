# STATUS

**Product:** Undertone (codename) — cross-platform voice-to-text dictation SaaS
**Phase:** 1 gate PASSED (mock) → Phase 2 — Native integration
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
| 2a–2d | Native integration | 🔄 dispatching | Opus 4.8 |
| 3–5 | | ⬜ | |

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
