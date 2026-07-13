# DECISIONS

Every judgment call made autonomously, with rationale. Newest last.

## 2026-07-14 — D-001: Repo lives at C:\Users\USER\Desktop\flow
The session's working directory; initialized as a fresh git repo, branch `main`.

## 2026-07-14 — D-002: Orchestrator host is Windows 11, not a Linux container
The guide's §4.5 assumes a Linux sandbox. This host can compile and smoke-test the
**Windows** native module locally (node-gyp toolchain permitting), which upgrades Windows
native work from "CI-only verification" to "locally testable." macOS remains CI + human
verified only. OS-matrix CI stays the authoritative definition of done for both.

## 2026-07-14 — D-003: Guide defaults accepted without override
Name "Undertone", pricing (Free 2k words/wk; Pro $12/mo / $96/yr, 50k words/wk fair use),
14-day trial without card, self-hosted PostHog anonymous-by-default telemetry. No human
override was given in-session; the guide designates these as defaults.

## 2026-07-14 — D-004: Subagent dispatch mechanism
`.claude/agents/implementer.md` created with `model: opus` per guide §2. In this session,
dispatches use the harness Agent tool with an explicit Opus model override and the §5.2 task
template inline; each task prompt instructs the agent to read ARCHITECTURE.md + CONTRACTS.md
first (the invariant prefix), then its task delta.

## 2026-07-14 — D-005: History search over encrypted transcripts = HMAC token index
Contract-level decision (CONTRACTS.md §7): transcript content is AES-256-GCM encrypted at
rest; a plaintext full-text index would defeat that. Search is served by a keyed-hash token
index (HMAC-SHA256 of each normalized word, keyed separately from the content key), giving
exact-word search with no plaintext leakage in the index. Substring/fuzzy search is v2.
Rationale: keeps "transcripts encrypted at rest" *true* in the privacy policy, which §3 makes
a non-negotiable.

## 2026-07-14 — D-006: WS acking cadence
Server acks audio frames every 25 frames (~500ms of audio) — frequent enough to bound the
client replay buffer, sparse enough to be negligible bandwidth. In CONTRACTS.md §4.

## 2026-07-14 — D-007: CONTRACTS v1.1.0 — `retryAfterMs?` added to the `error` wire message
Friction reported by task 0c: §8 RATE_LIMITED told the client to honor `retryAfterMs`, but
§4.3's error frame had no such field. Amended (additive): optional `retryAfterMs`, present
iff the taxonomy marks the code `requiresBackoff`. protocol.ts / errors.ts updated to match;
typecheck + shared suite green. Orchestrator made the code change directly (2 lines) rather
than re-dispatching — below the dispatch threshold.

## 2026-07-14 — D-008: Phase 1 dispatched as parallel worktree-isolated agents
1a–1f run concurrently; 1d/1e/1f all touch packages/shared, so each agent gets an isolated
git worktree (guide §5.2's short-lived-branch discipline). Orchestrator merges on review at
the Phase 1 gate, resolving barrel/index conflicts itself.
