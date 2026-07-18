#!/usr/bin/env node
/**
 * Injeksi cache-bust version ke semua referensi asset lokal (HTML + JS imports).
 * Dipanggil otomatis saat CI deploy; bisa juga dijalankan manual:
 *   node scripts/inject-cache-version.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILES = ['admin.html', 'index.html', 'login.html', 'users.html', '404.html'];

function resolveBuildId() {
  const raw = process.env.BUILD_ID
    || process.env.GITHUB_SHA
    || (() => {
      try {
        return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
      } catch {
        return String(Date.now());
      }
    })();
  return raw.slice(0, 12);
}

const BUILD_ID = resolveBuildId();

function bustUrl(url) {
  const base = url.replace(/\?v=[^&]*/, '');
  return `${base}?v=${BUILD_ID}`;
}

function processHtml(content) {
  return content
    .replace(/__BUILD_ID__/g, BUILD_ID)
    .replace(
      /((?:\.\/)?assets\/[a-zA-Z0-9_./-]+\.(?:js|css))(?:\?v=[^"'\s]*)?/g,
      (_, url) => bustUrl(url)
    );
}

function processJs(content) {
  return content
    .replace(/__BUILD_ID__/g, BUILD_ID)
    .replace(
      /(from\s+["'])(\.\.?\/[^"']+\.js)(?:\?v=[^"']*)?(["'])/g,
      (_, prefix, url, suffix) => `${prefix}${bustUrl(url)}${suffix}`
    )
    .replace(
      /(import\s*\(\s*["'])(\.\.?\/[^"']+\.js)(?:\?v=[^"']*)?(["']\s*\))/g,
      (_, prefix, url, suffix) => `${prefix}${bustUrl(url)}${suffix}`
    );
}

function walkJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(full, files);
    } else if (entry.name.endsWith('.js') && entry.name !== 'config.example.js') {
      files.push(full);
    }
  }
  return files;
}

const SW_SNIPPET = `<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}
</script>`;

function ensureSwRegistration(content) {
  if (content.includes('serviceWorker.register')) return content;
  return content.replace('</body>', `${SW_SNIPPET}\n</body>`);
}

function generateServiceWorker(jsFiles) {
  const precache = [
    '/index.html',
    '/admin.html',
    '/login.html',
    '/users.html',
    '/404.html',
    `/assets/css/tailwind.css?v=${BUILD_ID}`,
    '/assets/images/logo.png',
    ...jsFiles.map((f) => `/${path.relative(ROOT, f).replace(/\\/g, '/')}?v=${BUILD_ID}`),
  ];

  const sw = `const CACHE_NAME = 'absensi-${BUILD_ID}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of PRECACHE) {
      try {
        await cache.add(url);
      } catch (e) {}
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isNavigation(request) {
  return request.mode === 'navigate';
}

function navigationFallback(pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  return caches.match(path).then((cached) =>
    cached || caches.match('/index.html').then((home) => home || caches.match('/404.html'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            try { await cache.put(request, res.clone()); } catch (e) {}
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((res) => res)
        .catch(() => navigationFallback(url.pathname))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
`;

  fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
  console.log('[cache-bust] generated sw.js');
}

console.log(`[cache-bust] version: ${BUILD_ID}`);

for (const file of HTML_FILES) {
  const filePath = path.join(ROOT, file);
  if (!fs.existsSync(filePath)) continue;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = ensureSwRegistration(processHtml(original));
  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`[cache-bust] updated ${file}`);
  }
}

const jsDir = path.join(ROOT, 'assets', 'js');
const jsFiles = fs.existsSync(jsDir) ? walkJsFiles(jsDir) : [];
generateServiceWorker(jsFiles);

if (fs.existsSync(jsDir)) {
  for (const filePath of jsFiles) {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = processJs(original);
    if (updated !== original) {
      fs.writeFileSync(filePath, updated);
      console.log(`[cache-bust] updated ${path.relative(ROOT, filePath)}`);
    }
  }
}
