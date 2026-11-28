// Local dev server: serves /public and mounts /api/* handlers (Vercel-style signature).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const securityHeaders = vercel.headers?.[0]?.headers || [];

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    for (const h of securityHeaders) res.setHeader(h.key, h.value); // same CSP as production
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z]/gi, '');
      try {
        const mod = await import(pathToFileURL(path.join(root, 'api', name + '.js')).href);
        req.query = Object.fromEntries(url.searchParams);
        res.status = (c) => ((res.statusCode = c), res);
        res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
        return await mod.default(req, res);
      } catch {
        res.statusCode = 404;
        return res.end('{"error":"not found"}');
      }
    }
    let p = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (p.includes('..')) { res.statusCode = 400; return res.end(); }
    try {
      const buf = await readFile(path.join(root, 'public', p));
      res.setHeader('content-type', (types[path.extname(p)] || 'application/octet-stream') + '; charset=utf-8');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => console.log(`Quiet running at http://localhost:${port}`));
}
