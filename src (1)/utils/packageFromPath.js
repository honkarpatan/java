/**
 * packageFromPath.js — "Add relative path to Top"
 * Inserts: // relative/path/File.java
 * Skips if any top // …*.java path comment already exists.
 */
import { isJavaFile, readActiveCode } from './javaFiles.js';

const toast = acode.require('toast');

const SRC_ROOT_HINTS = [
  'src/main/java/',
  'src/test/java/',
  'src/main/kotlin/',
  'app/src/main/java/',
  'src/',
  'java/',
];

export function resolveFilePath(file) {
  if (!file) return '';
  let p = file.uri || file.filename || file.name || '';
  if (p.includes('::')) p = p.split('::').pop() || p;
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(p.slice(7));
    } catch (_) {
      p = p.slice(7);
    }
  }
  return String(p).replace(/\\/g, '/');
}

export function getProjectRoot(file) {
  try {
    const folders = window.addedFolder || window.fileList?.list || [];
    const list = Array.isArray(folders) ? folders : [];
    const filePath = resolveFilePath(file);
    let best = '';
    for (const f of list) {
      let root = f?.url || f?.uri || f?.path || f;
      if (typeof root !== 'string') continue;
      if (root.includes('::')) root = root.split('::').pop() || root;
      if (root.startsWith('file://')) {
        try {
          root = decodeURIComponent(root.slice(7));
        } catch (_) {
          root = root.slice(7);
        }
      }
      root = String(root).replace(/\\/g, '/').replace(/\/$/, '');
      if (filePath && filePath.startsWith(root) && root.length > best.length) {
        best = root;
      }
    }
    if (best) return best;
  } catch (_) {}

  const filePath = resolveFilePath(file);
  if (!filePath || !filePath.includes('/')) return '';
  const parts = filePath.split('/');
  parts.pop();
  const joined = parts.join('/');
  for (const hint of SRC_ROOT_HINTS) {
    const needle = '/' + hint.replace(/\/$/, '').toLowerCase();
    const idx = joined.toLowerCase().lastIndexOf(needle);
    if (idx >= 0) return joined.slice(0, idx);
  }
  return parts.join('/');
}

export function getRelativePath(file, projectRoot) {
  const abs = resolveFilePath(file);
  if (!abs) return file?.filename || file?.name || '';
  const root = String(projectRoot || '').replace(/\\/g, '/').replace(/\/$/, '');
  let path = abs;
  if (root && path.startsWith(root + '/')) {
    path = path.slice(root.length + 1);
  } else if (root && path === root) {
    path = file?.filename || file?.name || '';
  } else {
    for (const hint of SRC_ROOT_HINTS) {
      const i = path.toLowerCase().lastIndexOf('/' + hint.toLowerCase());
      if (i >= 0) {
        path = path.slice(i + 1);
        break;
      }
    }
    if (path === abs) path = path.split('/').slice(-4).join('/');
  }
  return path.replace(/^\/+/, '');
}

/**
 * True if file already has a path-style comment near the top.
 * Matches any // line containing .java before first real code line.
 * Also matches with leading spaces / path: prefix.
 */
function hasPathComment(code) {
  const lines = String(code || '').split('\n');
  let seen = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('//')) {
      // any path-looking comment: has .java or has a slash path segment
      if (/\.java\b/i.test(t) || /^\/\/\s*[\w./\\-]+\/[\w./\\-]+/.test(t)) {
        return true;
      }
      seen++;
      if (seen > 6) break;
      continue;
    }
    // first non-comment code → stop scanning
    break;
  }
  return false;
}

export function addRelativePathComment(file = editorManager?.activeFile) {
  if (!isJavaFile(file)) {
    toast('Open a .java file', 1500);
    return false;
  }

  const code = readActiveCode();
  if (hasPathComment(code)) {
    toast('Path comment already at top', 1800);
    return false;
  }

  const root = getProjectRoot(file);
  const rel = getRelativePath(file, root);
  if (!rel) {
    toast('Could not resolve relative path', 2000);
    return false;
  }

  const insert = `// ${rel}\n`;
  const editor = editorManager?.editor;
  try {
    if (editor && typeof editor.dispatch === 'function' && editor.state?.doc) {
      editor.dispatch({ changes: { from: 0, to: 0, insert } });
    } else if (editor?.session?.insert) {
      editor.session.insert({ row: 0, column: 0 }, insert);
    } else {
      toast('Editor insert failed', 1500);
      return false;
    }
    toast(`Added: // ${rel}`, 2000);
    return true;
  } catch (e) {
    console.warn('[addRelativePathComment]', e);
    toast('Failed to add path comment', 1500);
    return false;
  }
}

export function addPackageFromPath(file) {
  return addRelativePathComment(file);
}

export function describeRelativePath(file = editorManager?.activeFile) {
  const root = getProjectRoot(file);
  const rel = getRelativePath(file, root);
  return { root, rel };
}
