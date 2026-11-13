import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode } from '../utils/javaFiles.js';
const toast = acode.require('toast');
let commandId = null;

function findLocalDefinition(code, symbol) {
  const lines = code.split('\n');
  const patterns = [
    new RegExp(String.raw`(?:public|private|protected|static|final|\s)+[\w.<>,\[\]\s]+\s+${symbol}\s*[\(=;]`, 'm'),
    new RegExp(String.raw`(?:class|interface|enum)\s+${symbol}\b`, 'm'),
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) if (re.test(lines[i])) return { line: i };
  }
  return null;
}

export async function executeGoToDefinition() {
  if (getSettings().enableGoToDefinition === false) return toast('Disabled', 1200);
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
  const hit = findLocalDefinition(readActiveCode(), symbol);
  if (hit) {
    try {
      if (editor.session?.gotoLine) editor.session.selection.moveCursorTo(hit.line, 0);
      else if (editor.dispatch && editor.state?.doc) {
        const line = editor.state.doc.line(hit.line + 1);
        editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      }
      return toast(`→ line ${hit.line + 1}`, 1200);
    } catch (_) {}
  }
  try {
    const lsp = acode.require('lsp');
    if (lsp?.executeCommand) return await lsp.executeCommand('editor.action.revealDefinition');
  } catch (_) {}
  toast('Not found (enable JDTLS for project-wide)', 2000);
}

export function registerGoToDefinition() {
  try {
    const commands = acode.require('commands');
    commandId = 'java-tools.gotoDef';
    commands?.add?.({ name: commandId, description: 'Java: Go to Definition', exec: () => executeGoToDefinition() });
  } catch (_) {}
}

export function unregisterGoToDefinition() {
  try { if (commandId) acode.require('commands')?.remove?.(commandId); } catch (_) {}
  commandId = null;
}
