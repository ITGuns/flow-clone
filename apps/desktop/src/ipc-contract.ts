// Desktop-internal IPC contract — ORCHESTRATOR-OWNED, frozen like CONTRACTS.md.
// Tasks 4a (HUD) and 4g (session orchestrator) build against this file and may not amend it;
// friction is reported up. It deliberately contains ONLY what crosses the main↔HUD boundary.
//
// Mapping from the CONTRACTS.md §3 session state machine to the HUD's three pre-attentive
// states (guide §7: listening / thinking / done):
//   arming | listening            → 'listening'   (mic live; `level` drives the audio display)
//   finalizing | formatting       → 'thinking'
//   injecting                     → 'thinking'    (sub-200ms tail; no fourth visual state)
//   idle after successful inject  → 'done'        (HUD auto-dismisses ~800ms later, §3)
//   error(code)                   → 'error'       (honest failure, guide §3 — incl. OFFLINE_BUFFERED
//                                                  "buffered, will retry" which sets `recoverable`)
//   idle (no recent utterance)    → 'hidden'
import type { ErrorCode } from '@undertone/shared';

export type HudPhase = 'hidden' | 'listening' | 'thinking' | 'done' | 'error';

export interface HudState {
  phase: HudPhase;
  /** Mic level 0..1 from the EnergyVAD — meaningful only while `phase === 'listening'`. */
  level: number;
  /** Set iff phase === 'error'. */
  errorCode?: ErrorCode;
  /** True when the error resolves itself (e.g. OFFLINE_BUFFERED retry) — HUD softens the tone. */
  recoverable?: boolean;
}

/** main → HUD renderer: full-state push on every change (idempotent; renderer holds no history). */
export const HUD_STATE_CHANNEL = 'undertone:hud-state';
/** HUD renderer → main: fired once when the HUD webContents is ready to receive state. */
export const HUD_READY_CHANNEL = 'undertone:hud-ready';

export const HUD_DONE_DISMISS_MS = 800;
