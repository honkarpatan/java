import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode } from '../utils/javaFiles.js';
const toast = acode.require('toast');
let commandId = null;

export async function executeFindReferences() {
  if (getSettings().enableFindReferences === false) return toast('Disabled', 1200);
  if (!isJavaFile(editorManager?.activeFile)) return toast('Not a Java file', 1200);
  const editor = editorManager?.editor;
  let symbol = '';
  try {
    if (editor?.getSelectedText) symbol = editor.getSelectedText();
    else if (editor?.state) {
      const { from, to } = editor.state.selection.main;
      symbol = editor.state.doc.sliceString(from, to);
    }
  } catch (_) {}
  symbol = String(symbol || '').trim();
  if (!symbol || /\s/.test(symbol)) return toast('Select a symbol', 1500);
  try {
    const lsp = acode.require('lsp');
    if (lsp?.executeCommand && (getSettings().lspMode || 'off') !== 'off') {
      return await lsp.executeCommand('editor.action.referenceSearch.trigger');
    }
  } catch (_) {}
  const re = new RegExp(String.raw`\b${symbol}\b`);
  const hits = readActiveCode().split('\n').map((t, i) => (re.test(t) ? i + 1 : -1)).filter((x) => x > 0);
  if (!hits.length) return toast('No refs in file', 1500);
  toast(`${hits.length} ref(s) — first @ ${hits[0]}`, 2000);
  try { editor?.session?.selection?.moveCursorTo(hits[0] - 1, 0); } catch (_) {}
}

export function registerFindReferences() {
  try {
    commandId = 'java-tools.findRefs';
    acode.require('commands')?.add?.({ name: commandId, description: 'Java: Find References', exec: () => executeFindReferences() });
  } catch (_) {}
}

export function unregisterFindReferences() {
  try { if (commandId) acode.require('commands')?.remove?.(commandId); } catch (_) {}
  commandId = null;
}
