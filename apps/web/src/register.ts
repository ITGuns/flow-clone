// The dashboard's "style" selector → CONTRACTS §1 `Register`. The desktop derives register from the
// focused OS app (packages/shared register-map); the browser has no focused target app, so the user
// picks the tone directly. The synthetic AppContext identifies this surface for the server pipeline.
import type { AppContext, Register } from '@undertone/shared';

export type DictationStyle = 'chat' | 'email' | 'document' | 'code';

export interface StyleOption {
  readonly id: DictationStyle;
  readonly label: string;
  readonly hint: string;
  readonly register: Register;
}

/** The four styles offered in the UI, each mapped 1:1 onto a Register value. */
export const STYLE_OPTIONS: readonly StyleOption[] = [
  { id: 'chat', label: 'Chat', hint: 'Casual, quick messages', register: 'chat' },
  { id: 'email', label: 'Email', hint: 'Polished and professional', register: 'email' },
  { id: 'document', label: 'Document', hint: 'Clear, structured prose', register: 'document' },
  { id: 'code', label: 'Code', hint: 'Commits, comments, terse notes', register: 'code' },
];

/** Default style (task 4h: register defaults to 'document'). */
export const DEFAULT_STYLE: DictationStyle = 'document';

/** Map a style id onto its Register, defaulting to 'document' for an unknown id. */
export function styleToRegister(style: DictationStyle): Register {
  return STYLE_OPTIONS.find((option) => option.id === style)?.register ?? 'document';
}

/**
 * Build the synthetic AppContext sent on `session.start` / `utterance.start` (§4.3). The web
 * dashboard is a fixed "app"; only the register varies with the selected style.
 */
export function buildAppContext(style: DictationStyle): AppContext {
  return {
    bundleId: 'web.dashboard',
    appName: 'Undertone Web',
    windowTitle: '',
    register: styleToRegister(style),
  };
}
