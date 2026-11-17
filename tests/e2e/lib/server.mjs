import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export async function startStaticServer({
  rootDir,
  subpathPrefix = '',
  initialOverrides = {},
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const normalizedPrefix = subpathPrefix
    ? '/' + subpathPrefix.replace(/^\/+|\/+$/g, '')
    : '';

  const overrides = new Map(Object.entries(initialOverrides));
  const requests = [];

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push({
      method: req.method,
      url: req.url,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      timestamp: Date.now(),
    });

    let relUrlPath = parsedUrl.pathname;
    if (normalizedPrefix) {
      if (relUrlPath === normalizedPrefix) {
        relUrlPath = '/';
      } else if (relUrlPath.startsWith(normalizedPrefix + '/')) {
        relUrlPath = relUrlPath.slice(normalizedPrefix.length);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found (outside subpath prefix)');
        return;
      }
    }

    if (relUrlPath === '/') {
      relUrlPath = '/index.html';
    }

    const cleanRel = relUrlPath.replace(/^\/+/, '');
    if (overrides.has(cleanRel)) {
      const ov = overrides.get(cleanRel);
      const status = ov.status ?? 200;
      const contentType = ov.contentType ?? 'application/json; charset=utf-8';
      const body =
        typeof ov.body === 'string' || Buffer.isBuffer(ov.body)
          ? ov.body
          : JSON.stringify(ov.body);
      res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': ov.cacheControl ?? 'no-store',
      });
      res.end(body);
      return;
    }

    const candidate = path.resolve(resolvedRoot, cleanRel);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (candidate !== resolvedRoot && !candidate.startsWith(rootWithSep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let filePath = candidate;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}${normalizedPrefix ? normalizedPrefix + '/' : '/'}`;

  return {
    port: addr.port,
    baseUrl,
    origin: `http://127.0.0.1:${addr.port}`,
    requests,
    clearRequests() {
      requests.length = 0;
    },
    setOverride(relPath, spec) {
      overrides.set(relPath.replace(/^\/+/, ''), spec);
    },
    clearOverride(relPath) {
      overrides.delete(relPath.replace(/^\/+/, ''));
    },
    async close() {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
