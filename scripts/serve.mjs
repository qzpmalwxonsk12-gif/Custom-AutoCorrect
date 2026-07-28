/**
 * Zero-dependency static server for ./demo.
 *
 * The extension only ever requests http(s) origins, so a file:// page cannot be
 * enabled. Serving the demo over localhost is the quickest way to exercise it.
 *
 * Usage: node scripts/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const port = Number(process.argv[2] ?? 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = path.join(root, path.normalize(requested).replace(/^([/\\])+/, ''));

    // Never serve outside ./demo.
    if (!target.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    const code = e && e.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code).end(code === 404 ? 'Not found' : 'Server error');
  }
});

server.listen(port, () => {
  console.log(`[demo] http://localhost:${port}  (Ctrl+C to stop)`);
});
