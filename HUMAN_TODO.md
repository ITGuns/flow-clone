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

## Physical-machine verification scripts (guide §8)

*Appended as Phase 2+ native tasks complete. Each is a numbered manual test on real hardware —
the part of "done" CI cannot see (guide §4.5). Run every step; a single failure fails the check.*

### 12. macOS native verification (task 2a) — needs a physical Mac + HUMAN_TODO #3 (CI green first)

**Preconditions**
- The macos-latest `native (macos-latest)` CI job is green (addon compiled + smoke-loaded). CI
  green is necessary but NOT sufficient — it never exercises a real hotkey or real injection.
- A dev build of the desktop app runs on the Mac (or a harness that loads the compiled
  `apps/desktop/native/mac/build/Release/undertone_mac.node` plus the `src/native/darwin`
  wrappers). Build locally with `pnpm --filter @undertone/desktop build:native`.

**A. Grant Accessibility permission (the gate for everything below)**
1. Launch the app. Confirm `checkPermission()` reports `denied` before any grant (fresh machine).
2. System Settings → Privacy & Security → Accessibility. Enable the Undertone app (or your dev
   host, e.g. Terminal/Electron). Quit and relaunch.
3. Confirm `checkPermission()` now reports `granted`. If still `denied`, you enabled the wrong
   binary — the trusted process is the one that loaded the addon.

**B. Hotkey fires while the target app is unfocused (§2.3 HotkeyManager, guide §4.7)**
4. Register the push-to-talk accelerator (e.g. `F13`). Click into a DIFFERENT app (Notes) so
   Undertone has no window focus.
5. Press and hold the hotkey. Confirm exactly ONE `down` transition is logged (not one per
   auto-repeat) while held. Release. Confirm exactly ONE `up`.
6. Tap the hotkey rapidly 5x while unfocused. Confirm 5 clean `down`/`up` pairs, none dropped or
   doubled. Proves the CGEventTap sees system-wide keys and the wrapper de-bounce holds on real
   key-repeat.

**C. Injection lands at the cursor of the frontmost app, focus never stolen (§2.3 TextInjector)**
For EACH app: click into its text area, leave it frontmost, inject a known string ("the quick
brown fox"), and confirm the text appears AT THE CURSOR with that app still frontmost and the
caret still in it (Undertone must NOT come forward — guide §4.7). Note the reported
`InjectResult.method`.
7. **Slack** (composer) — expect `method: "ax"`; text at caret.
8. **VS Code** (editor) — expect `ax`; if the field rejects the AX write, expect
   `clipboard-fallback` and verify the prior clipboard contents are restored afterward.
9. **Chrome** (address bar or a Gmail compose / any `<textarea>`) — expect `ax` or
   `clipboard-fallback`; text at caret, page not navigated away.
10. **Notes** — expect `ax`; text at caret.
11. **Gmail in the browser** (compose body) — expect `ax` or `clipboard-fallback`; subject and
    recipients untouched, only the body receives text.
12. In every case, confirm the frontmost app did NOT change and no Undertone window took keyboard
    focus during injection (watch the menu-bar app name — it must stay the target app's).

**D. Error paths (honest failure, guide §8)**
13. Revoke Accessibility permission and relaunch. Trigger an injection. Confirm
    `{ ok: false, code: "NO_PERMISSION" }` and an honest HUD permission-needed state — no crash,
    no silent no-op.
14. Focus a surface with no text field (Desktop/Finder, nothing selected) and inject. Confirm
    `NO_TARGET` (not a crash). Re-grant permission afterward.

**Pass = every numbered step behaves as described on a physical Mac.** File any deviation as a 2a
bug with the app name, the observed `method`/`code`, and whether focus moved.

### 13. Windows native verification (task 2b) — physical Windows 11 machine (this one qualifies)

**Preconditions**
- The `native (windows-latest)` CI job is green (win32 addon compiled + smoke-loaded). NOTE: this
  orchestrator host lacks the build toolchain (no MSVC/VS Build Tools, no resolvable Python), so
  the addon could NOT be compiled locally during the build — CI is the compile authority. To run
  this script locally you must first install VS Build Tools (C++ workload) + Python 3, then
  `pnpm --filter @undertone/desktop build:native`.

1. **Addon smoke** — `pnpm --filter @undertone/desktop build:native; pnpm --filter @undertone/desktop smoke:native` → prints the win32 addon smoke OK line.
2. **Hotkey while unfocused** — register PTT (e.g. `F8` or `RightControl`); click into Notepad so Undertone is unfocused; hold → exactly one `down`; release → exactly one `up`. Hold 3s → still exactly one `down` (auto-repeat suppressed by the pure re-entrancy guard).
3. **SendInput injection — plain** — focus Notepad, inject "hello world" → text at caret, `{ok:true, method:'sendinput'}`.
4. **Unicode/emoji** — inject "héllo 👋 —" → renders correctly incl. the surrogate-pair emoji (KEYEVENTF_UNICODE path).
5. **Cross-app landing** — repeat step 3 in Slack, VS Code, Chrome address bar, Gmail compose (in-browser) → text lands in each, no focus change.
6. **Own-HUD guard** — focus the Undertone window itself and inject → `{ok:false, code:'NO_TARGET'}`, nothing typed.
7. **No foreground** — show the bare desktop and inject → `NO_TARGET`.
8. **Clipboard fallback** — put known text on the clipboard; force a SendInput-rejecting target; inject → text still appears via paste, `method:'clipboard-fallback'`, and the **original clipboard content is restored**.
9. **UIPI / elevated target** — run Undertone non-elevated; focus an app running as Administrator (e.g. elevated PowerShell); inject → `{ok:false, code:'NO_PERMISSION'}`, no partial text, no clipboard clobber.
10. **Active-app detection** — with Slack focused, capture context → `bundleId:"slack.exe"`, `appName:"Slack"` (from version info), `windowTitle` populated and ≤256 chars; repeat with VS Code (`Code.exe`).
11. **Lifecycle/leak** — register then unregister the hotkey 50× → no crash, no lingering global hook (other apps' keyboard latency unaffected).

**Pass = every numbered step behaves as described on physical Windows.** File deviations as a 2b
bug with app name, observed `method`/`code`, and whether focus moved.
