/**
 * Java: Go to References — VS Code style peek popup (see src/modules/peekReferences).
 * Command id stays `java-tools.findRefs` so existing keybindings keep working.
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile } from '../utils/javaFiles.js';
import { getProjectRoot, getRelativePath } from '../utils/packageFromPath.js';
import { createPeekReferences, JAVA_PROFILE } from '../modules/peekReferences/index.js';

const toast = acode.require('toast');
let commandId = null;
let peek = null;

function dirLabelOf(file) {
  try {
    const rel = getRelativePath(file, getProjectRoot(file));
    const i = rel.lastIndexOf('/');
    return i > 0 ? rel.slice(0, i) : '~/';
  } catch (_) {
    return '~/';
  }
}

function getPeek() {
  if (!peek) {
    peek = createPeekReferences({
      profile: JAVA_PROFILE,
      acode,
      editorManager,
      getDirLabel: dirLabelOf,
    });
  }
  return peek;
}

export async function executeFindReferences() {
  if (getSettings().enableFindReferences === false) return toast('Disabled', 1200);
  if (!isJavaFile(editorManager?.activeFile)) return toast('Not a Java file', 1200);
  return getPeek().show();
}

export function closeFindReferences() {
  try { peek?.hide(); } catch (_) {}
}

export function registerFindReferences() {
  try {
    commandId = 'java-tools.findRefs';
    acode.require('commands')?.add?.({
      name: commandId,
      description: 'Java: Go to References',
      exec: () => executeFindReferences(),
    });
  } catch (_) {}
}

export function unregisterFindReferences() {
  try { if (commandId) acode.require('commands')?.remove?.(commandId); } catch (_) {}
  commandId = null;
  try { peek?.dispose(); } catch (_) {}
  peek = null;
}