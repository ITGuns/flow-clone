// Post-build smoke test for the win32 addon — run by CI on windows-latest AFTER `build:native`.
// Verifies the compiled artifact loads and exposes the exact primitive surface the TS binding
// expects, then exercises the read-only, side-effect-free calls. It deliberately does NOT
// synthesize input (SendInput/hotkey behavior is a §8 human checkpoint, not CI-observable).
// CommonJS by necessity: it require()s the native .node addon under test.
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert');

const binding = require('./index.js');

const expected = [
  'hotkeyRegister',
  'hotkeyUnregister',
  'getForegroundWindow',
  'sendUnicode',
  'clipboardPaste',
  'getActiveApp',
];
for (const name of expected) {
  assert.strictEqual(typeof binding[name], 'function', `addon is missing export: ${name}`);
}

// getForegroundWindow(): ForegroundInfo | null — either shape is acceptable on a headless runner.
const fg = binding.getForegroundWindow();
if (fg !== null) {
  assert.strictEqual(typeof fg.pid, 'number');
  assert.strictEqual(typeof fg.isOwnProcess, 'boolean');
  assert.strictEqual(typeof fg.className, 'string');
  assert.strictEqual(typeof fg.title, 'string');
}

// getActiveApp(): NativeActiveApp — fields always present (possibly empty strings).
const app = binding.getActiveApp();
assert.strictEqual(typeof app.exeName, 'string');
assert.strictEqual(typeof app.appName, 'string');
assert.strictEqual(typeof app.title, 'string');
assert.strictEqual(typeof app.pid, 'number');

// hotkeyRegister/unregister lifecycle with a real WH_KEYBOARD_LL hook on a dedicated thread.
// F24 (0x87) is used to avoid colliding with anything a runner might care about; no key is ever
// pressed, so the callback should not fire.
let fired = 0;
const handle = binding.hotkeyRegister(0x87, () => {
  fired++;
});
assert.strictEqual(typeof handle, 'number');
binding.hotkeyUnregister(handle);
binding.hotkeyUnregister(handle); // idempotent — must not throw
assert.strictEqual(fired, 0);

console.log('undertone win32 addon smoke: OK');
