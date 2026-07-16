// Cross-platform native-addon build dispatcher. Invoked by `pnpm build:native`.
// Each OS matrix leg (guide §4.5) runs this once; it builds ONLY the addon for the host OS —
// macOS → native/mac (task 2a), Windows → native/win (task 2b) — and is a clean no-op on any
// other platform, so a single unconditional CI invocation does the right thing per runner.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const platform = process.platform;

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

if (platform === 'darwin') {
  // The mac wrapper is itself darwin-guarded; call it directly.
  run(process.execPath, [join(here, 'mac', 'build-if-darwin.mjs')]);
} else if (platform === 'win32') {
  run('node-gyp', ['rebuild'], join(here, 'win'));
} else {
  console.log(`build:native — no native addon for platform "${platform}"; skipping.`);
}
