// The OS-permission boundary for the desktop app (Phase 2d). Everything above this interface —
// the flow state machine (`machine.ts`), the onboarding sequencer (`sequencing.ts`), and the
// React surfaces (`../renderer/permissions/**`) — is pure and unit-tests in-container against
// `FakePermissionBridge`. The REAL implementation, which calls into the per-OS native module
// (owned by tasks 2a/2b under `src/native/**`), is wired at the Phase 2 gate.
//
// ── WIRE-UP SEAM ───────────────────────────────────────────────────────────────────────────
// A `NativePermissionBridge implements PermissionBridge` is NOT created here on purpose: it would
// have to import from `src/native/**`, which 2a/2b own. At the Phase 2 gate, add that adapter
// (its own file) mapping these methods onto the native module:
//   macOS microphone     → systemPreferences.getMediaAccessStatus('microphone') / askForMediaAccess
//   macOS accessibility  → systemPreferences.isTrustedAccessibilityClient(false) + settings deep-link
//   Windows microphone   → capability probe + ms-settings:privacy-microphone deep-link
//   Windows accessibility→ always 'not-required' (no AX-injection permission model on Windows)
// This module and its consumers never change when that adapter lands — that is the point of the
// interface. See DECISIONS.md if the seam moves.

/**
 * The permission kinds the app cares about. `microphone` applies on both OSes; `accessibility`
 * is a macOS-only concept (needed for AX text injection) and the bridge reports `not-required`
 * for it on Windows.
 */
export type PermissionKind = 'microphone' | 'accessibility';

/**
 * OS permission status, normalized across platforms:
 * - `granted`      the app may use the capability now.
 * - `denied`       the user (or a previous prompt) refused; on macOS the OS will NOT re-prompt,
 *                  so recovery is via System Settings, not another request.
 * - `undetermined` never asked — the ONLY status from which an OS request may be triggered, and
 *                  only after the in-app pre-prompt is acknowledged (guide §3, non-negotiable).
 * - `restricted`   blocked by policy/MDM/parental controls; the user cannot grant it themselves.
 * - `not-required` the capability needs no permission on this platform (e.g. Windows accessibility).
 */
export type PermissionStatus =
  'granted' | 'denied' | 'undetermined' | 'restricted' | 'not-required';

/**
 * The isolation boundary between permission-flow logic and the OS. Queries never surface UI;
 * `requestMicrophone` is the ONLY method that may trigger a native OS prompt, and the state
 * machine calls it strictly after the user acknowledges the in-app explanation.
 */
export interface PermissionBridge {
  /** Current microphone status. Pure query — never shows an OS prompt. */
  checkMicrophone(): Promise<PermissionStatus>;
  /**
   * Trigger the native microphone permission prompt and resolve with the resulting status.
   * MUST only be called after the in-app pre-prompt is acknowledged (guide §3). On a platform
   * where the OS will not re-prompt (already `denied`), this resolves with the unchanged status.
   */
  requestMicrophone(): Promise<PermissionStatus>;
  /**
   * Current accessibility status. Pure query. Returns `not-required` on Windows. macOS has no
   * programmatic prompt for accessibility — the user toggles it in System Settings — so there is
   * deliberately no `requestAccessibility`; recovery is `openAccessibilitySettings` + re-check.
   */
  checkAccessibility(): Promise<PermissionStatus>;
  /** Deep-link the OS Settings to the Microphone privacy pane (recovery for `denied`). */
  openMicrophoneSettings(): Promise<void>;
  /** Deep-link the OS Settings to the Accessibility privacy pane (macOS recovery). */
  openAccessibilitySettings(): Promise<void>;
}
