/**
 * deps/classpath.js — Build runtime/compile classpath
 */
import { getSettings } from '../core/settings.js';
import { jarPathForCoord, defaultCacheDir } from './mavenClient.js';

/**
 * Ordered classpath entries (dirs + jars), colon-joined for Unix.
 * 1. .
 * 2. settings.extraClasspath
 * 3. project lib/*.jar (caller may pass projectDir)
 * 4. installed Maven jars from cache
 */
export function buildClasspathList(opts = {}) {
  const settings = getSettings();
  const parts = [];
  const push = (p) => {
    const s = String(p || '').trim();
    if (s && !parts.includes(s)) parts.push(s);
  };

  push('.');
  push('classes');

  for (const p of String(settings.extraClasspath || '').split(/[:;]/)) {
    push(p);
  }

  if (opts.projectLibJars && Array.isArray(opts.projectLibJars)) {
    for (const j of opts.projectLibJars) push(j);
  }

  let coords = [];
  try {
    coords = JSON.parse(settings.mavenCoordinates || '[]');
    if (!Array.isArray(coords)) coords = [];
  } catch (_) {
    coords = [];
  }
  const cache = (settings.mavenCacheDir || '').trim() || defaultCacheDir();
  for (const c of coords) {
    const jar = jarPathForCoord(c, cache);
    if (jar) push(jar);
  }

  if (settings.enableAndroidClasspath && settings.androidSdkPath) {
    // common platforms path — best-effort
    push(`${String(settings.androidSdkPath).replace(/\/$/, '')}/platforms/android-34/android.jar`);
  }

  return parts;
}

export function buildClasspathString(opts = {}) {
  return buildClasspathList(opts).join(':');
}

export function listInstalledCoordinates() {
  try {
    const arr = JSON.parse(getSettings().mavenCoordinates || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
