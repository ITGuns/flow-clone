// Presentational copy for the permission surfaces (Phase 2d), kept out of the components so the
// wording — which is the privacy posture the product promises (guide §3) — has one home and can be
// reviewed on its own. No styling, no logic; pure strings keyed by kind and platform.
import type { PermissionKind } from '../../permissions';

export type Platform = 'macos' | 'windows';

export interface PrePromptCopy {
  /** Short title, e.g. "Allow microphone access". */
  title: string;
  /** One-line reason this permission is needed. */
  why: string;
  /** Privacy posture — the things we DO with the data. */
  does: string[];
  /** The things we explicitly DON'T do (the promise that makes privacy a feature). */
  doesNot: string[];
  /** Label of the primary action that triggers the OS interaction after acknowledgement. */
  acknowledgeLabel: string;
  /** Label of the secondary "not now" affordance. */
  dismissLabel: string;
}

export interface RecoveryCopy {
  title: string;
  /** Lead sentence describing the situation. */
  lead: string;
  /** Ordered, concrete steps to fix it in the OS. */
  steps: string[];
  openSettingsLabel: string;
  recheckLabel: string;
}

const MIC_PRE_PROMPT: PrePromptCopy = {
  title: 'Allow microphone access',
  why: 'Undertone turns what you say into polished text at your cursor — it needs your microphone to hear you.',
  does: [
    'Streams your speech for transcription only while you hold the dictation key.',
    'Sends audio over an encrypted connection to convert it to text.',
  ],
  doesNot: [
    'Never records or listens in the background — only while you hold the key.',
    'Never stores your audio: it is transcribed and then discarded on the server.',
    'Never uses your audio to train models or shares it with anyone.',
  ],
  // "Continue" (not "Allow") because the OS prompt with the real Allow/Deny is what appears NEXT.
  acknowledgeLabel: 'Continue',
  dismissLabel: 'Not now',
};

const ACCESSIBILITY_PRE_PROMPT: PrePromptCopy = {
  title: 'Enable accessibility access',
  why: 'Undertone uses macOS Accessibility to type the finished text into whatever app you are using.',
  does: [
    'Inserts your dictated text into the app you already had focused.',
    'Opens System Settings so you can switch Undertone on.',
  ],
  doesNot: [
    'Never reads your screen, your documents, or what you type.',
    'Never monitors other apps — it only inserts text when you dictate.',
  ],
  // macOS has no accessibility prompt; acknowledging deep-links to System Settings.
  acknowledgeLabel: 'Open System Settings',
  dismissLabel: 'Not now',
};

export function prePromptCopy(kind: PermissionKind): PrePromptCopy {
  return kind === 'microphone' ? MIC_PRE_PROMPT : ACCESSIBILITY_PRE_PROMPT;
}

export function recoveryCopy(
  kind: PermissionKind,
  platform: Platform,
  restricted: boolean,
): RecoveryCopy {
  if (restricted) {
    return {
      title:
        kind === 'microphone' ? 'Microphone access is blocked' : 'Accessibility access is blocked',
      lead: 'This permission is managed by your organization or device policy, so it cannot be changed here.',
      steps: ['Ask your administrator to allow this permission for Undertone, then re-check.'],
      openSettingsLabel: 'Open Settings',
      recheckLabel: 'Re-check',
    };
  }
  if (kind === 'microphone') {
    return platform === 'macos'
      ? {
          title: 'Microphone access is off',
          lead: 'macOS is blocking the microphone. Turn it back on to keep dictating.',
          steps: [
            'Open System Settings → Privacy & Security → Microphone.',
            'Switch Undertone on.',
            'Come back here and choose Re-check.',
          ],
          openSettingsLabel: 'Open System Settings',
          recheckLabel: 'Re-check',
        }
      : {
          title: 'Microphone access is off',
          lead: 'Windows is blocking the microphone. Turn it back on to keep dictating.',
          steps: [
            'Open Settings → Privacy & security → Microphone.',
            'Turn on “Microphone access” and “Let desktop apps access your microphone”.',
            'Come back here and choose Re-check.',
          ],
          openSettingsLabel: 'Open Settings',
          recheckLabel: 'Re-check',
        };
  }
  // accessibility (macOS only)
  return {
    title: 'Accessibility access is off',
    lead: 'macOS needs Accessibility turned on so Undertone can type text into your apps.',
    steps: [
      'Open System Settings → Privacy & Security → Accessibility.',
      'Switch Undertone on.',
      'Come back here and choose Re-check.',
    ],
    openSettingsLabel: 'Open System Settings',
    recheckLabel: 'Re-check',
  };
}
