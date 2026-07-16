// CI smoke check for the compiled macOS addon (darwin only). Proves the .node loads under the
// runtime N-API ABI and exports the full binding surface, and that checkPermission() returns a
// legal value WITHOUT triggering the OS permission prompt. On non-darwin it is a no-op.
//
// It does NOT assert injection/hotkey behaviour — that needs a real focused app and Accessibility
// permission, which only a human on a physical Mac can verify (see the manual script in REPORT).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

if (process.platform !== 'darwin') {
  console.log(`[undertone:native/mac] smoke skipped on ${process.platform}`);
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const addonPath = join(here, 'build', 'Release', 'undertone_mac.node');

if (!existsSync(addonPath)) {
  console.error(`[undertone:native/mac] addon not found at ${addonPath} — run build:native first`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const addon = require(addonPath);

const expected = [
  'hotkeyRegister',
  'hotkeyUnregister',
  'inject',
  'getActiveApp',
  'checkPermission',
];
const missing = expected.filter((name) => typeof addon[name] !== 'function');
if (missing.length > 0) {
  console.error(`[undertone:native/mac] addon missing exports: ${missing.join(', ')}`);
  process.exit(1);
}

const permission = addon.checkPermission();
if (!['granted', 'denied', 'unknown'].includes(permission)) {
  console.error(`[undertone:native/mac] checkPermission returned illegal value: ${permission}`);
  process.exit(1);
}

// getActiveApp must return the documented shape (all strings) without throwing.
const app = addon.getActiveApp();
for (const key of ['bundleId', 'appName', 'windowTitle']) {
  if (typeof app[key] !== 'string') {
    console.error(`[undertone:native/mac] getActiveApp().${key} is not a string`);
    process.exit(1);
  }
}

console.log(`[undertone:native/mac] smoke OK — permission=${permission}, exports present`);
process.exit(0);
