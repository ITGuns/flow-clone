// Cross-platform native-addon smoke dispatcher. Invoked by `pnpm smoke:native`.
// Loads the freshly built addon for the host OS and asserts its export surface — the CI
// authority that the compiled binary at least loads (guide §4.5). No-op off macOS/Windows.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const platform = process.platform;

function run(script) {
  const res = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

if (platform === 'darwin') {
  run(join(here, 'mac', 'smoke.mjs'));
} else if (platform === 'win32') {
  run(join(here, 'win', 'smoke.js'));
} else {
  console.log(`smoke:native — no native addon for platform "${platform}"; skipping.`);
}
