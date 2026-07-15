// Minimal static server for the assembled site (scripts/build-site.mjs output).
// Mirrors how a static host serves it in production: real files win; a directory path serves its
// index.html; unknown /app/* paths fall back to the dashboard's index (hash routing needs no more).
// Usage: node scripts/serve-site.mjs [port]   (default 5175)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize } from 'node:path';

const root = fileURLToPath(new URL('../site-dist', import.meta.url));
const port = Number(process.argv[2] ?? 5175);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function tryRead(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  // Resolve inside root only (normalize strips ../ traversal).
  let pathname = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (pathname === '' || pathname.endsWith('/') || pathname.endsWith('\\')) pathname += 'index.html';

  let file = join(root, pathname);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let body = await tryRead(file);
  if (body === null && !extname(pathname)) body = await tryRead(join(root, pathname, 'index.html'));
  if (body === null && pathname.startsWith('app')) body = await tryRead(join(root, 'app', 'index.html'));
  if (body === null) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }

  const type = MIME[extname(file)] ?? MIME[extname(pathname)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
}).listen(port, () => console.log(`site: http://localhost:${port}/ (dashboard at /app/)`));
