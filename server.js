const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const NO_CACHE_PATHS = new Set([
  '/index.html',
  '/app.js',
  '/styles.css',
  '/sw.js',
  '/manifest.webmanifest',
  '/assets/banner.png',
  '/icons/calorie-tracker-s.png',
  '/icons/calorie-tracker-m.png',
  '/icons/calorie-tracker-l.png'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: error.message || '服务器错误' });
  }
}).listen(PORT, HOST, () => {
  console.log(`Kawaii Calorie Tracker listening on http://${HOST}:${PORT}`);
});

function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'Not found' });
      return sendJson(res, 500, { ok: false, error: 'Failed to read file' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': getCacheControl(safePath, ext)
    });
    res.end(data);
  });
}

function getCacheControl(requestPath, ext) {
  if (NO_CACHE_PATHS.has(requestPath) || ext === '.html') {
    return 'no-cache, no-store, must-revalidate';
  }
  return 'public, max-age=300';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}
