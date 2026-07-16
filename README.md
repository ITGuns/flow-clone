# Undertone

Cross-platform push-to-talk dictation SaaS. Hold a hotkey, speak, release, and polished text
lands at the cursor of whatever app was focused — in under 1.2s p50.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for topology and the latency budget, and
[CONTRACTS.md](./CONTRACTS.md) for the frozen interface contract. `CONTRACTS.md` is law;
`packages/shared` is its compiled form.

## Monorepo layout

```
apps/desktop     Electron + React + TS (main / renderer; native modules land in Phase 2)
apps/api         Node + Fastify + TS (WS gateway + REST; boots keyless under MOCK_MODE=1)
packages/shared  contracts as code: domain types, WS protocol, frame codec, error taxonomy
                 — the ONLY place protocol/domain types live
```

`apps/*` import protocol/domain types from `@undertone/shared` (`workspace:*`) and never
redeclare them.

## Prerequisites

- Node.js >= 24
- pnpm >= 10 (`corepack enable` then `corepack use pnpm@10`)

## Getting started

```sh
pnpm install
cp .env.example .env      # every service reads MOCK_MODE; 1 = all externals mocked
```

The repo runs entirely in **mock mode** with zero external keys. Real keys (Anthropic,
Deepgram, Clerk, Stripe, …) are tracked in [HUMAN_TODO.md](./HUMAN_TODO.md) and gate the
_ship_, not the _build_.

## Commands

Run across all workspaces:

```sh
pnpm -r typecheck    # tsc --noEmit, strict, everywhere
pnpm -r lint         # eslint flat config
pnpm -r test         # vitest
```

Run the API locally (mock mode):

```sh
pnpm --filter @undertone/api dev        # tsx watch; GET /healthz -> { ok: true, mock: true }
```

## CI

`.github/workflows/ci.yml` runs lint + typecheck + test on `ubuntu-latest`, plus a
`macos-latest` / `windows-latest` native matrix (currently the TS suites; the Phase 2 native
modules land in that job). Everything runs under `MOCK_MODE=1`. CI activates once a GitHub
remote exists — see HUMAN_TODO.md item 3.
