import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { build } from 'vite';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PRICING, PRIVACY_CLAIMS } from './content';

// The real guard against copy drift: run an actual production build and assert the figures and
// privacy claims survive into the emitted HTML. This runs `vite build` (merging vite.config.ts)
// into a throwaway directory, so it tests what ships, not the source templates.

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

let outDir: string;
const pages: Record<string, string> = {};

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'undertone-mkt-'));
  await build({
    root: pkgRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  for (const name of ['index', 'pricing', 'privacy', 'terms']) {
    // Collapse whitespace so assertions survive HTML pretty-printing / line wrapping in source.
    pages[name] = readFileSync(join(outDir, `${name}.html`), 'utf8').replace(/\s+/g, ' ');
  }
});

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('production build emits all pages with bundled assets', () => {
  it('produces every page', () => {
    for (const name of ['index', 'pricing', 'privacy', 'terms']) {
      expect(pages[name], `${name}.html missing`).toBeTruthy();
    }
  });

  it('rewrites the source entry to a hashed asset (proves a real build, not a copy)', () => {
    expect(pages.index).toContain('assets/');
    expect(pages.index).not.toContain('/src/main.ts');
  });
});

describe('pricing figures survive into built HTML (BUILD_GUIDE §1)', () => {
  it.each(Object.entries(PRICING))('contains %s → "%s"', (_key, value) => {
    expect(pages.pricing).toContain(value);
  });

  it('states the exact §1 numbers verbatim', () => {
    // Belt-and-braces literal check, independent of the content module.
    for (const literal of ['2,000', '$12', '$96', '50k', '14-day']) {
      expect(pages.pricing, `pricing page must contain ${literal}`).toContain(literal);
    }
  });
});

describe('privacy claims survive into built HTML', () => {
  it('landing page renders a privacy-as-a-feature section', () => {
    expect(pages.index).toContain('Privacy is the product');
  });

  it.each(Object.entries(PRIVACY_CLAIMS))('landing page contains the %s claim', (_key, claim) => {
    expect(pages.index).toContain(claim);
  });

  it('privacy stub page repeats the same grounded claims', () => {
    expect(pages.privacy).toContain(PRIVACY_CLAIMS.audio);
    expect(pages.privacy).toContain(PRIVACY_CLAIMS.transcripts);
    expect(pages.privacy).toContain(PRIVACY_CLAIMS.telemetry);
  });
});

describe('CTAs point at the web dashboard, not a download (task 4h / DECISIONS D-023)', () => {
  it('the landing page leads with an "Open the dashboard" CTA into /app/', () => {
    expect(pages.index).toContain('Open the dashboard');
    expect(pages.index).toContain('href="/app/"');
  });

  it('no download buttons remain on the landing or pricing pages', () => {
    for (const page of ['index', 'pricing', 'privacy', 'terms']) {
      expect(pages[page], `${page} still references a download`).not.toContain('Download for');
      expect(pages[page], `${page} still links #download`).not.toContain('#download');
    }
    expect(pages.index).not.toContain('Download for macOS');
    expect(pages.index).not.toContain('Download for Windows');
    expect(pages.pricing).not.toContain('Download free');
  });

  it('pricing plan CTAs route into the dashboard', () => {
    expect(pages.pricing).toContain('href="/app/"');
  });

  it('the Pro plan CTA deep-links into the dashboard billing section (task 4i)', () => {
    // The Pro upgrade CTA points at /app/#billing so the trial/upgrade path lands on the billing
    // section directly, not the bare dashboard.
    expect(pages.pricing).toContain('href="/app/#billing"');
    expect(pages.pricing).toContain('Start 14-day Pro trial');
  });
});

describe('legal stubs reference the real counsel docs (task 4h)', () => {
  it('privacy points at docs/legal/privacy-policy.md', () => {
    expect(pages.privacy).toContain('docs/legal/privacy-policy.md');
  });

  it('terms points at docs/legal/terms-of-service.md', () => {
    expect(pages.terms).toContain('docs/legal/terms-of-service.md');
  });
});
