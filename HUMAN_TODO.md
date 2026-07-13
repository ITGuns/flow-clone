# HUMAN_TODO

Items only a human can do. The build continues in mock mode around every one of these;
**nothing here blocks the build, everything here blocks the ship.**
Check this file whenever you return to the run.

## Blocking the Phase 1 real-mode gate (latency numbers)

### 1. Anthropic API key (Haiku 4.5 formatting)
- Create at https://console.anthropic.com → API Keys.
- Put in `apps/api/.env` as `ANTHROPIC_API_KEY=sk-ant-...` (file is gitignored).

### 2. Deepgram API key (streaming ASR)
- Sign up at https://console.deepgram.com (free tier includes streaming credit).
- Put in `apps/api/.env` as `DEEPGRAM_API_KEY=...`.

## Blocking OS-matrix CI (definition of done for all native code)

### 3. GitHub repository with Actions enabled
- Create a repo (private is fine) at https://github.com/new.
- `git remote add origin <url> && git push -u origin main` from `C:\Users\USER\Desktop\flow`.
- Actions are enabled by default; the workflows in `.github/workflows/` will run on push.
- Without this, macOS native code is entirely unverified (this machine is Windows).

## Blocking Phase 3 (backend platform)

### 4. Clerk account (auth)
- https://dashboard.clerk.com → create application → copy publishable + secret keys to
  `apps/api/.env` (`CLERK_SECRET_KEY`) and `apps/desktop/.env` (`CLERK_PUBLISHABLE_KEY`).

### 5. Stripe account, test mode (billing)
- https://dashboard.stripe.com → test mode → `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Products will be created by script in Phase 3 (Pro $12/mo, $96/yr per guide §1 defaults).

## Blocking Phase 5 (deploy + ship)

### 6. Fly.io account (or Railway) — deploy target
### 7. Apple Developer account ($99/yr) — macOS signing + notarization
### 8. Windows code-signing cert — EV cert or Azure Trusted Signing
### 9. A macOS machine you can physically touch — human verification checkpoints (guide §8).
   The Windows verification machine can be this one.

## Blocking public launch

### 10. Product name decision
- "Undertone" (`com.yourco.undertone`) is a placeholder used consistently; renaming is a
  find-replace. Shipping requires a real name + trademark search.

### 11. Counsel review of privacy policy + ToS (drafted in Phase 4)

---
*Physical-machine test scripts will be appended here by the orchestrator as Phase 2+ tasks
complete (numbered manual tests per guide §8).*
