const CACHE_VERSION = 'v4';
const APP_SHELL_CACHE = `kawaii-calorie-tracker-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `kawaii-calorie-tracker-runtime-${CACHE_VERSION}`;
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './fonts/xingye-langman-yuzhou-wenrou.ttf',
  './fonts/zaozigongfangyuanqipaopao.otf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }

  event.respondWith(handleStaticRequest(event.request));
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put('./index.html', response.clone()).catch(() => {});
    return response;
  } catch {
    return (
      (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('./index.html')) ||
      Response.error()
    );
  }
}

async function handleStaticRequest(request) {
  const cache = await caches.open(isAppShellRequest(request) ? APP_SHELL_CACHE : RUNTIME_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  if (cached) {
    void refreshCache(request, cache);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return (await caches.match('./index.html')) || Response.error();
  }
}

function isAppShellRequest(request) {
  const pathname = new URL(request.url).pathname;
  return APP_SHELL_ASSETS.some((asset) => pathname.endsWith(asset.replace(/^\.\//, '/')));
}

async function refreshCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
  } catch {
    // Ignore refresh failures while offline.
  }
}
