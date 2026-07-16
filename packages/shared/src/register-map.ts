// Register derivation — CONTRACTS.md §1 / ARCHITECTURE §1. Pure, deterministic, OS-agnostic:
// turns a raw frontmost/foreground app (bundleId/exe + human name + window title, as produced
// by the per-OS `ActiveAppDetector`, CONTRACTS §2.3) into a `Register`. This is the brain that
// sits ABOVE the native detectors — it performs NO OS calls, only string classification.
//
// Precedence (most stable signal first — documented, and enforced by register-map.test.ts):
//   1. bundleId / exe   — the most stable identifier; a bundle id or executable name is fixed
//      per app and immune to the noise of window titles. Wins over everything.
//   2. appName          — human name; used only when the identifier is absent or unrecognized.
//   3. windowTitle      — consulted last, and only as a hint. Its one authoritative use is
//      sub-classifying a browser (whose register genuinely depends on the page): a browser
//      identified in step 1/2 is ALWAYS resolved by title, defaulting to `unknown`.
//   4. `unknown`        — nothing matched.
//
// A browser is a special classification: it is a known app, but its Register is content-derived,
// so a matched browser hands off to title-based sub-classification (default `unknown`, never
// falling back to appName). This is why "bundleId wins over a misleading title" holds for
// non-browsers (Slack stays chat) while a browser on github.com correctly reads as code.

import type { Register } from './types';

/** Result of matching an app identity: a concrete Register, or `browser` (resolve by title). */
type Classification = Register | 'browser';

interface AppRule {
  readonly target: Classification;
  /** Exact (normalized) bundleId / exe matches — the precise, collision-free signals. */
  readonly ids: readonly string[];
  /** Substring matches against a normalized bundleId / exe — for app families & variants. */
  readonly idKeywords: readonly string[];
  /** Substring matches against a normalized human appName — the step-2 fallback. */
  readonly nameKeywords: readonly string[];
}

// Ordered by evaluation priority. Keywords are chosen to be non-overlapping across registers so
// order only matters as a tie-break; exact ids are globally unique. Curated to cover the §8
// verification targets (Slack, VS Code, Chrome, Notes/Notepad, Gmail-in-browser) plus the
// common apps named in the task brief, on BOTH macOS (bundle id) and Windows (exe) forms.
const APP_RULES: readonly AppRule[] = [
  {
    target: 'chat',
    ids: [
      'com.tinyspeck.slackmacgap', // Slack (mac)
      'slack.exe', // Slack (win)
      'com.hnc.discord', // Discord (mac)
      'discord.exe', // Discord (win)
      'com.microsoft.teams', // Teams (mac, v1)
      'com.microsoft.teams2', // Teams (mac, v2)
      'teams.exe', // Teams (win, classic)
      'ms-teams.exe', // Teams (win, new)
      'com.apple.mobilesms', // Messages (mac)
      'net.whatsapp.whatsapp', // WhatsApp (mac)
      'whatsapp.exe', // WhatsApp (win)
      'org.telegram.desktop', // Telegram (mac)
      'telegram.exe', // Telegram (win)
      'org.whispersystems.signal-desktop', // Signal (mac)
      'signal.exe', // Signal (win)
    ],
    idKeywords: ['slack', 'discord', 'whatsapp', 'telegram'],
    nameKeywords: ['slack', 'discord', 'teams', 'messages', 'whatsapp', 'telegram', 'signal'],
  },
  {
    target: 'email',
    ids: [
      'com.microsoft.outlook', // Outlook (mac)
      'outlook.exe', // Outlook (win)
      'com.apple.mail', // Apple Mail (mac)
      'com.readdle.smartemail-mac', // Spark (mac)
      'spark.exe', // Spark (win)
      'org.mozilla.thunderbird', // Thunderbird (mac)
      'thunderbird.exe', // Thunderbird (win)
      'hxoutlook.exe', // Windows Mail / new Outlook host
      'hxmail.exe', // Windows Mail host
    ],
    idKeywords: ['outlook', 'thunderbird', 'readdle'],
    // "mail" also catches Gmail / Airmail / Mailspring; browsers are matched earlier so a
    // browser named "Google Chrome" never reaches this.
    nameKeywords: ['outlook', 'mail', 'thunderbird', 'spark', 'proton mail'],
  },
  {
    target: 'code',
    ids: [
      'com.microsoft.vscode', // VS Code (mac)
      'com.microsoft.vscodeinsiders', // VS Code Insiders (mac)
      'code.exe', // VS Code (win)
      'com.apple.dt.xcode', // Xcode (mac)
      'com.sublimetext.4', // Sublime Text 4 (mac)
      'com.sublimetext.3', // Sublime Text 3 (mac)
      'sublime_text.exe', // Sublime Text (win)
      'com.jetbrains.intellij', // IntelliJ IDEA (mac)
      'com.jetbrains.pycharm', // PyCharm (mac)
      'com.jetbrains.webstorm', // WebStorm (mac)
      'com.google.android.studio', // Android Studio (mac)
      'idea64.exe', // IntelliJ (win)
      'pycharm64.exe', // PyCharm (win)
      'webstorm64.exe', // WebStorm (win)
      'goland64.exe', // GoLand (win)
      'clion64.exe', // CLion (win)
      'rider64.exe', // Rider (win)
      'phpstorm64.exe', // PhpStorm (win)
      'studio64.exe', // Android Studio (win)
      'org.vim.macvim', // MacVim (mac)
      'nvim.exe', // Neovim (win)
      'vim.exe', // Vim (win)
      'gvim.exe', // gVim (win)
    ],
    idKeywords: [
      'vscode',
      'jetbrains',
      'intellij',
      'pycharm',
      'webstorm',
      'goland',
      'clion',
      'rider',
      'phpstorm',
      'rubymine',
      'datagrip',
      'sublime',
      'macvim',
    ],
    nameKeywords: [
      'vs code',
      'vscode',
      'visual studio code',
      'xcode',
      'intellij',
      'pycharm',
      'webstorm',
      'goland',
      'clion',
      'rider',
      'phpstorm',
      'rubymine',
      'datagrip',
      'android studio',
      'sublime text',
      'vim',
    ],
  },
  {
    target: 'terminal',
    ids: [
      'com.apple.terminal', // Terminal (mac)
      'com.googlecode.iterm2', // iTerm2 (mac)
      'com.github.wez.wezterm', // WezTerm (mac)
      'org.alacritty', // Alacritty (mac)
      'windowsterminal.exe', // Windows Terminal (win)
      'wt.exe', // Windows Terminal launcher (win)
      'powershell.exe', // PowerShell (win)
      'pwsh.exe', // PowerShell Core (win)
      'cmd.exe', // Command Prompt (win)
      'conhost.exe', // Console host (win)
      'wezterm-gui.exe', // WezTerm (win)
      'wezterm.exe', // WezTerm (win)
      'alacritty.exe', // Alacritty (win)
    ],
    idKeywords: ['iterm', 'wezterm', 'alacritty', 'windowsterminal'],
    nameKeywords: [
      'iterm',
      'terminal',
      'powershell',
      'command prompt',
      'wezterm',
      'alacritty',
      'konsole',
      'hyper',
    ],
  },
  {
    target: 'document',
    ids: [
      'com.apple.notes', // Notes (mac)
      'notion.id', // Notion (mac)
      'notion.exe', // Notion (win)
      'com.microsoft.word', // Word (mac)
      'winword.exe', // Word (win)
      'com.microsoft.onenote.mac', // OneNote (mac)
      'onenote.exe', // OneNote (win)
      'md.obsidian', // Obsidian (mac)
      'obsidian.exe', // Obsidian (win)
      'com.apple.iwork.pages', // Pages (mac)
      'notepad.exe', // Notepad (win)
      'wordpad.exe', // WordPad (win)
      'com.evernote.evernote', // Evernote (mac)
      'evernote.exe', // Evernote (win)
    ],
    idKeywords: ['notion', 'obsidian', 'onenote', 'evernote'],
    nameKeywords: [
      'notes',
      'notepad',
      'notion',
      'obsidian',
      'onenote',
      'evernote',
      'word',
      'pages',
      'wordpad',
      'google docs',
    ],
  },
  {
    target: 'browser',
    ids: [
      'com.google.chrome', // Chrome (mac)
      'chrome.exe', // Chrome (win)
      'com.apple.safari', // Safari (mac)
      'com.microsoft.edgemac', // Edge (mac)
      'msedge.exe', // Edge (win)
      'org.mozilla.firefox', // Firefox (mac)
      'firefox.exe', // Firefox (win)
      'company.thebrowser.browser', // Arc (mac)
      'arc.exe', // Arc (win)
      'com.brave.browser', // Brave (mac)
      'brave.exe', // Brave (win)
      'com.operasoftware.opera', // Opera (mac)
      'opera.exe', // Opera (win)
      'com.vivaldi.vivaldi', // Vivaldi (mac)
      'vivaldi.exe', // Vivaldi (win)
    ],
    idKeywords: [
      'chrome',
      'chromium',
      'safari',
      'firefox',
      'edge',
      'brave',
      'vivaldi',
      'opera',
      'thebrowser',
    ],
    nameKeywords: [
      'chrome',
      'chromium',
      'safari',
      'firefox',
      'edge',
      'brave',
      'arc',
      'vivaldi',
      'opera',
    ],
  },
];

// Browser title/URL hints, evaluated in order. Each is a substring tested against the normalized
// window title — matching both raw hosts (mail.google.com) and the human site names that most
// browsers put in the title bar (Gmail, GitHub, Google Docs). First hit wins; no hit → unknown.
const TITLE_HINTS: readonly (readonly [string, Register])[] = [
  // email
  ['mail.google.com', 'email'],
  ['gmail', 'email'],
  ['outlook.live', 'email'],
  ['outlook.office', 'email'],
  ['outlook.com', 'email'],
  ['mail.yahoo', 'email'],
  ['proton.me/mail', 'email'],
  ['mail.proton', 'email'],
  ['fastmail', 'email'],
  // chat
  ['app.slack.com', 'chat'],
  ['discord.com/channels', 'chat'],
  ['web.whatsapp', 'chat'],
  ['teams.microsoft', 'chat'],
  ['web.telegram', 'chat'],
  // code
  ['github.com', 'code'],
  ['github', 'code'],
  ['gitlab.com', 'code'],
  ['gitlab', 'code'],
  ['bitbucket.org', 'code'],
  ['stackoverflow.com', 'code'],
  ['stack overflow', 'code'],
  ['codesandbox', 'code'],
  ['codepen', 'code'],
  ['replit', 'code'],
  // document
  ['docs.google.com', 'document'],
  ['google docs', 'document'],
  ['sheets.google.com', 'document'],
  ['google sheets', 'document'],
  ['slides.google.com', 'document'],
  ['google slides', 'document'],
  ['notion.so', 'document'],
  ['confluence', 'document'],
  ['coda.io', 'document'],
];

/** Lowercase + trim. The single normalization applied to every field before matching. */
function normalize(value: string): string {
  return (value ?? '').toLowerCase().trim();
}

/** Match a normalized bundleId/exe against the rule table. Returns null when nothing matches. */
function classifyIdentifier(id: string): Classification | null {
  if (!id) return null;
  for (const rule of APP_RULES) {
    if (rule.ids.includes(id)) return rule.target;
    if (rule.idKeywords.some((kw) => id.includes(kw))) return rule.target;
  }
  return null;
}

/** Match a normalized appName against the rule table. Returns null when nothing matches. */
function classifyName(name: string): Classification | null {
  if (!name) return null;
  for (const rule of APP_RULES) {
    if (rule.nameKeywords.some((kw) => name.includes(kw))) return rule.target;
  }
  return null;
}

/** Sub-classify a (browser) window title by URL/name hints. No hint → `unknown`. */
function classifyByTitle(title: string): Register {
  if (!title) return 'unknown';
  for (const [needle, register] of TITLE_HINTS) {
    if (title.includes(needle)) return register;
  }
  return 'unknown';
}

/**
 * Derive the app's Register from its identity. Pure, deterministic, case-insensitive, and
 * total: never throws, and returns `unknown` for empty/garbage input. Precedence is documented
 * at the top of this file: bundleId/exe → appName → windowTitle → unknown, with browsers always
 * resolved by title.
 */
export function deriveRegister(bundleId: string, appName: string, windowTitle: string): Register {
  const title = normalize(windowTitle);

  // 1. Most stable: the bundle id / executable name.
  const byId = classifyIdentifier(normalize(bundleId));
  if (byId === 'browser') return classifyByTitle(title);
  if (byId) return byId;

  // 2. Human app name.
  const byName = classifyName(normalize(appName));
  if (byName === 'browser') return classifyByTitle(title);
  if (byName) return byName;

  // 3. Window title as a last-resort hint (also covers unrecognized browsers).
  return classifyByTitle(title);
}
