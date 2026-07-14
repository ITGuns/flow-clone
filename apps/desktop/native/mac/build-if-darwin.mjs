// Builds the macOS N-API addon with node-gyp, but ONLY on darwin. On Windows/Linux (the
// orchestration host and the non-mac CI legs) it is a clean no-op so `pnpm install` and the
// desktop build never fail for lack of Xcode. The compiled artifact lands at
// native/mac/build/Release/undertone_mac.node, which src/native/darwin/binding.ts loads.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

if (process.platform !== 'darwin') {
  console.log(`[undertone:native/mac] skipping build on ${process.platform} (darwin-only addon)`);
  process.exit(0);
}

console.log('[undertone:native/mac] building addon with node-gyp…');
const result = spawnSync('npx', ['--yes', 'node-gyp', 'rebuild'], {
  cwd: here,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error('[undertone:native/mac] node-gyp failed to start:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
