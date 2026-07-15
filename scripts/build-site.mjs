// Assemble the public site: marketing landing at `/`, dictation dashboard at `/app/`.
// Run AFTER both workspace builds (root script `site:build` chains them):
//   marketing -> apps/marketing/dist  becomes  site-dist/
//   web       -> apps/web/dist        becomes  site-dist/app/
// The web bundle uses relative asset URLs (vite base './'), so it works unchanged from /app/.
import { cp, rm, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const marketingDist = join(repo, 'apps', 'marketing', 'dist');
const webDist = join(repo, 'apps', 'web', 'dist');
const out = join(repo, 'site-dist');

for (const dir of [marketingDist, webDist]) {
  try {
    await access(dir);
  } catch {
    console.error(
      `missing build output: ${dir} — run the workspace builds first (pnpm site:build)`,
    );
    process.exit(1);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(marketingDist, out, { recursive: true });
await cp(webDist, join(out, 'app'), { recursive: true });
console.log(`site assembled at ${out} (landing at /, dashboard at /app/)`);
