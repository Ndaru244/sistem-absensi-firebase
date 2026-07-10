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

console.log(`[cache-bust] version: ${BUILD_ID}`);

for (const file of HTML_FILES) {
  const filePath = path.join(ROOT, file);
  if (!fs.existsSync(filePath)) continue;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = processHtml(original);
  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`[cache-bust] updated ${file}`);
  }
}

const jsDir = path.join(ROOT, 'assets', 'js');
if (fs.existsSync(jsDir)) {
  for (const filePath of walkJsFiles(jsDir)) {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = processJs(original);
    if (updated !== original) {
      fs.writeFileSync(filePath, updated);
      console.log(`[cache-bust] updated ${path.relative(ROOT, filePath)}`);
    }
  }
}
