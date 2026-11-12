/**
 * deps/mavenClient.js — Maven Central search + jar download (Alpine/curl)
 */
import { alpineExec, alpineExecScript, shellEscape, toBase64 } from '../utils/alpineExec.js';
import { getSettings, updateSetting } from '../core/settings.js';

const toast = acode.require('toast');

export function defaultCacheDir() {
  return '/root/.acode-java-tools/m2';
}

/** g:a:v → absolute jar path under cache */
export function jarPathForCoord(coord, cacheDir) {
  const parts = String(coord || '').split(':');
  if (parts.length < 3) return null;
  const [g, a, v] = parts;
  const gPath = g.replace(/\./g, '/');
  const base = (cacheDir || defaultCacheDir()).replace(/\/$/, '');
  return `${base}/${gPath}/${a}/${v}/${a}-${v}.jar`;
}

export function mavenUrlForCoord(coord) {
  const parts = String(coord || '').split(':');
  if (parts.length < 3) return null;
  const [g, a, v] = parts;
  const gPath = g.replace(/\./g, '/');
  return `https://repo1.maven.org/maven2/${gPath}/${a}/${v}/${a}-${v}.jar`;
}

/**
 * Search Maven Central (solrsearch).
 * @returns {Promise<Array<{ id, g, a, v, text }}>}
 */
export async function searchMaven(query, rows = 12) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url =
    'https://search.maven.org/solrsearch/select?q=' +
    encodeURIComponent(q) +
    `&rows=${rows}&wt=json`;

  // Prefer fetch in WebView; fallback curl in Alpine
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return normalizeDocs(data?.response?.docs || []);
    }
  } catch (e) {
    console.warn('[Maven] fetch failed, try curl', e);
  }

  const script = `#!/bin/sh
curl -fsSL '${shellEscape(url)}' 2>/dev/null || wget -qO- '${shellEscape(url)}' 2>/dev/null
`;
  const raw = await alpineExecScript(script);
  try {
    const data = JSON.parse(String(raw).replace(/^[\s\S]*?(\{)/, '$1'));
    return normalizeDocs(data?.response?.docs || []);
  } catch (_) {
    console.warn('[Maven] parse failed', String(raw).slice(0, 200));
    return [];
  }
}

function normalizeDocs(docs) {
  return (docs || []).map((d) => {
    const g = d.g || '';
    const a = d.a || '';
    const v = d.latestVersion || d.v || '';
    const id = d.id || `${g}:${a}:${v}`;
    return {
      id,
      g,
      a,
      v,
      text: `${g}:${a}:${v}`,
      latestVersion: v,
    };
  }).filter((x) => x.g && x.a && x.v);
}

/**
 * Download jar into cache; pin coordinate in settings.
 */
export async function installMavenCoord(coord) {
  const c = String(coord || '').trim();
  const url = mavenUrlForCoord(c);
  const cache = (getSettings().mavenCacheDir || '').trim() || defaultCacheDir();
  const jar = jarPathForCoord(c, cache);
  if (!url || !jar) throw new Error('Invalid coordinate (need g:a:v)');

  const dir = jar.replace(/\/[^/]+$/, '');
  const script = `#!/bin/sh
set -e
mkdir -p '${shellEscape(dir)}'
if [ -f '${shellEscape(jar)}' ] && [ -s '${shellEscape(jar)}' ]; then
  echo JAR_OK
  exit 0
fi
echo "Downloading ${shellEscape(c)}..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 2 -o '${shellEscape(jar)}' '${shellEscape(url)}'
elif command -v wget >/dev/null 2>&1; then
  wget -O '${shellEscape(jar)}' '${shellEscape(url)}'
else
  echo "NO_DOWNLOADER"
  exit 1
fi
if [ -s '${shellEscape(jar)}' ]; then
  echo JAR_OK
else
  echo JAR_FAIL
  exit 1
fi
`;
  const out = await alpineExecScript(script);
  if (!/JAR_OK/.test(String(out))) {
    throw new Error('Download failed: ' + String(out).slice(0, 120));
  }

  // pin in settings
  let list = [];
  try {
    list = JSON.parse(getSettings().mavenCoordinates || '[]');
    if (!Array.isArray(list)) list = [];
  } catch (_) {
    list = [];
  }
  if (!list.includes(c)) {
    list.push(c);
    updateSetting('mavenCoordinates', JSON.stringify(list));
  }
  return jar;
}

export async function removeMavenCoord(coord) {
  const c = String(coord || '').trim();
  let list = [];
  try {
    list = JSON.parse(getSettings().mavenCoordinates || '[]');
    if (!Array.isArray(list)) list = [];
  } catch (_) {
    list = [];
  }
  list = list.filter((x) => x !== c);
  updateSetting('mavenCoordinates', JSON.stringify(list));

  const cache = (getSettings().mavenCacheDir || '').trim() || defaultCacheDir();
  const jar = jarPathForCoord(c, cache);
  if (jar) {
    try {
      await alpineExec(`rm -f '${shellEscape(jar)}' 2>/dev/null || true`);
    } catch (_) {}
  }
  return true;
}
