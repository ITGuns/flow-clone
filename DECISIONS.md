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

## 2026-07-14 — D-013: Phase 2 double-dispatch — real, not a false alarm (corrected)
Both the 2a and 2b agents reported a "concurrent writer" editing their worktree. I first
judged this a misread (only one agent dispatched per worktree; worktrees are isolated). WRONG:
six completion notifications arrived for four dispatched tasks — two distinct agent task-ids
each for 2a and 2b. So two agents genuinely ran in each of those worktrees (mechanism unclear;
likely a harness-level relaunch). The isolation premise held (2a's writer never touched 2b's
files — separate directories), but "one agent per worktree" did not. Outcome was still clean:
the second agent in each pair DETECTED the other and reconciled rather than overwriting, and I
independently verified both committed HEADs green (2a 105 desktop tests, 2b 89) before merging.
Lesson: verify agent-count claims against notification task-ids, not against intent.

## 2026-07-14 — D-014: Unified native loader on 2a's `NativeModule` shape
2a and 2b diverged on the loader: 2a's async convention-based `loadNativeModule(): NativeModule`
(with `checkPermission`, fields hotkeys/injector/detector, graceful NativeUnavailableError) vs
2b's sync `loadNativePlatform(): NativePlatform` (hotkeys/injector/activeApp, no permission). Kept
2a's (richer; `checkPermission` is what the 2d permission wiring will consume in Phase 4). Adapted
win32 to expose the same `createNativeModule(): NativeModule` (detector = its activeApp;
checkPermission → 'granted' since Windows needs no accessibility grant for SendInput/hooks).
2b's createWin32Platform + its tests retained.

## 2026-07-14 — D-015: Cross-platform native build via a dispatcher
build:native/smoke:native now route through native/build-native.mjs + smoke-native.mjs, which
dispatch on process.platform and no-op off-target-OS. Lets the CI native-matrix run ONE
unconditional build/smoke step per leg (each builds only its own addon), and merges 2a's mac +
2b's win build steps into a single pair. binding.gyp files stay OS-scoped (type:none off-target)
so cross-OS `pnpm install` never tries to build a foreign addon.

## 2026-07-14 — D-016: Native addons uncompilable in-container; PermissionBridge→native deferred
Neither addon compiled here: macOS is impossible in a non-mac env; the Windows host has no MSVC/
VS Build Tools and no resolvable Python (node-gyp prerequisites). Both rely on OS-matrix CI as the
compile authority (guide §4.5). Also: 2d's `PermissionBridge` real wiring to the native
`checkPermission` + Electron mic APIs is deferred to Phase 4 (task 4d onboarding), where it is
first consumed and where the Electron main process actually runs — writing it now would be an
untestable composition root. The `FakePermissionBridge` seam is in place.

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

## 2026-07-14 — D-009: `retryAfterMs` emitted for ALL requiresBackoff codes (ratified)
1c read §4.3 v1.1.0 literally: `retryAfterMs` present iff the taxonomy marks the code
`requiresBackoff` — so ASR_*/FORMAT_*/OFFLINE_BUFFERED carry a 1000ms default, not just
RATE_LIMITED. That reading is correct and is now the ratified semantics. No change.

## 2026-07-14 — D-010: WS auth rejection lands as close(4401) post-upgrade
§4.1 says "before upgrade completes"; @fastify/websocket cannot cleanly reject pre-upgrade.
The client observes close code 4401 identically either way. Accepted; revisit only if a
proxy/CDN needs the HTTP-level reject.

## 2026-07-14 — D-011: Golden set corrected to the exhaustive §4.3 grammar
1f (built before docs/BUILD_GUIDE.md existed in-repo) invented colon/semicolon commands and
used "exclamation mark" for the grammar's "exclamation point"; two list cases used bare
"new line" as a bullet marker. All corrected at the gate (replacements keep the set at 42);
MockFormatter now passes 26/26 mock-scoped cases. Root cause fixed by committing the guide
to docs/ and pointing CONTRACTS.md at it. Governance docs added to .prettierignore.

## 2026-07-14 — D-012: Phase 1 gate verdict — mock-mode PASSED
232 tests; real-WS full-pipeline E2E green incl. FORMAT_TIMEOUT raw-fallback; §9 timing
marks monotonic and plumbed end-to-end; spine overhead beyond injected mock delays is
single-digit ms. Real-mode gate (live Deepgram + Haiku p50/p95) remains blocked on keys —
blocks ship, not build. Phases 2 (native) proceeds; 3 (backend) after 2 merges, per the
guide's sequential-phase discipline.

## 2026-07-15 - D-017: Phase 3 zero-conflict merge; plan constants unified into billing/plans.ts
Five parallel backend tasks merged onto main with no conflicts - the "nobody touches
index.ts/pipeline.ts/gateway.ts, expose ports instead" rule worked. The known cost (plan
limits duplicated 3x across auth/usage/billing) was reconciled at the gate: billing/plans.ts
is the single source; auth/effective-plan.ts and usage/limits.ts are re-export shims.

## 2026-07-15 - D-018: CONTRACTS 1 FormatRequest.dictionary reading ratified
The pipeline runs shared filterDictionary(fullList, transcript) BEFORE building FormatRequest,
so the field is "already capped/filtered per 6" exactly as CONTRACTS 1 states, and mock/real
formatter paths receive identical input. HaikuFormatter's internal re-filter is idempotent on
a capped set. Gate-3 agent's reading confirmed correct.

## 2026-07-15 - D-019: Effective plan is stamped into the session JWT claim
ClerkAuthenticator computes effectivePlan(user, sub, now) at token issuance; the WS pipeline
meters against the connection-bound plan claim with no server-side re-derivation. Consequence:
a mid-session plan change applies on next token refresh (<=60s token expiry), not instantly.
Acceptable for v1; documented.

## 2026-07-15 - D-020: Quota + persistence failure semantics in the pipeline
format.done (the user's words) is ALWAYS delivered first; QUOTA_EXCEEDED error frame follows
when metering reports exceeded. persist/meter/dictionary hook failures degrade silently
(format.done still delivered; no transcript content in logs, guide 3 telemetry rule).

## 2026-07-15 - D-021: Prettier baseline swept; drizzle output ignored; golden-mock flake watch
Repo-wide prettier --write applied (18 files, whitespace only); apps/api/drizzle/ added to
.prettierignore (generated SQL/meta). One golden-mock test failure observed ONCE during a full
-r run immediately after the sweep; unreproducible across 3 re-runs and not correlated with
any golden/mock file change. Watch in CI; if it recurs, investigate fixture-load fs timing.

## 2026-07-15 - D-022: apps/marketing added as a fourth workspace
Guide 4.1 lists three workspaces; task 4e (marketing site) needs a home. Static Vite site,
zero runtime deps, builds to plain files. apps/* glob covers it; pnpm -r stays green.

## 2026-07-15 - D-023: USER SCOPE OVERRIDE - web dashboard replaces download CTAs for now
User (2026-07-15): native toolchain install declined ("too hustle"); directive = make the
WEBSITE the working product: remove download buttons, add a proceed button into a dashboard
where dictation works in the browser. This overrides the guide's "no web dashboard in v1".
New task 4h: apps/web dashboard (browser mic capture -> WS streaming -> live partials ->
formatted text + copy; history; usage), marketing CTAs repointed. Desktop work already built
(4a-4g) is kept - it remains the long-term product; only its local-native verification is
deprioritized.

## 2026-07-15 - D-024: Task 4a (HUD) interrupted by account session limit - deferred
The 4a agent died mid-task on an API session-limit error with uncommitted work in
.worktrees/4a (Electron screenshot harness debugging). Worktree + branch task/4a preserved
untouched for resume. With D-023 the HUD is not on the critical path; resume after 4h.
