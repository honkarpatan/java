import { getSettings } from '../core/settings.js';
import { clearChipsOnEdit } from '../input/inputChips.js';

let compartment = null, logsVisible = false, clearHandler = null, switchHandler = null, updateCompartment = null, boundEditor = null;

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
function formatLogFragment(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '↵').replace(/\t/g, ' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/^[ \t]+|[ \t]+$/g, '');
}
function findPrintSites(code) {
  const lines = String(code || '').split('\n');
  const sites = [];
  const re = /\bSystem\s*\.\s*(?:out|err)\s*\.\s*(?:println|print|printf)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !/^\s*\/\//.test(lines[i])) sites.push({ line: i });
  }
  return sites;
}
function mapOutputToPrintLines(code, output) {
  const sites = findPrintSites(code);
  const outLines = stripAnsi(output).replace(/\r\n/g, '\n').replace(/JAVA_RUN_END[\s\S]*$/m, '').trimEnd().split('\n');
  const map = new Map();
  if (!sites.length) {
    if (outLines.some((l) => l.length)) map.set(0, outLines);
    return map;
  }
  let si = 0;
  for (const line of outLines) {
    const line0 = sites[Math.min(si, sites.length - 1)].line;
    if (!map.has(line0)) map.set(line0, []);
    map.get(line0).push(line);
    if (si < sites.length) si++;
  }
  return map;
}
export function clearInlineRunOutput() {
  logsVisible = false;
  const editor = editorManager?.editor;
  if (editor?.dispatch && compartment) {
    try {
      const cmState = acode.require('@codemirror/state');
      if (compartment.get(editor.state) !== undefined) {
        editor.dispatch({ effects: compartment.reconfigure([]) });
      }
    } catch (_) {}
  }
}
function attachClearOnType(editor) {
  if (!editor) return;
  const onClear = () => {
    if (!logsVisible) return;
    clearInlineRunOutput();
    try { clearChipsOnEdit(); } catch (_) {}
  };
  clearHandler = onClear;
  boundEditor = editor;
  try {
    if (typeof editor.dispatch === 'function') {
      const cmView = acode.require('@codemirror/view');
      const cmState = acode.require('@codemirror/state');
      if (cmView?.EditorView?.updateListener && cmState?.Compartment) {
        if (!updateCompartment) updateCompartment = new cmState.Compartment();
        const ext = cmView.EditorView.updateListener.of((u) => { if (u.docChanged) onClear(); });
        try {
          const existing = updateCompartment.get(editor.state);
          if (existing === undefined) {
            editor.dispatch({ effects: cmState.StateEffect.appendConfig.of(updateCompartment.of(ext)) });
          } else {
            editor.dispatch({ effects: updateCompartment.reconfigure(ext) });
          }
        } catch (_) {}
      }
    } else {
      editor.on?.('change', onClear);
    }
  } catch (_) {}
  if (!switchHandler) {
    switchHandler = () => clearInlineRunOutput();
    try { editorManager?.on?.('switch-file', switchHandler); } catch (_) {}
  }
}
export function showInlineRunOutput(code, output) {
  clearInlineRunOutput();
  if (getSettings().enableInlineRunLogs === false) return;
  const mapping = mapOutputToPrintLines(code, output);
  if (!mapping.size) return;
  const editor = editorManager?.editor;
  if (!editor) return;
  attachClearOnType(editor);
  const cmView = acode.require('@codemirror/view');
  const cmState = acode.require('@codemirror/state');
  if (editor.dispatch && cmView?.Decoration && cmView?.WidgetType && cmState?.Compartment) {
    if (!compartment) compartment = new cmState.Compartment();
    class GhostWidget extends cmView.WidgetType {
      constructor(label) { super(); this.label = label; }
      eq(o) { return o instanceof GhostWidget && o.label === this.label; }
      toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-java-inline-log';
        el.style.cssText = 'margin-left:0.5em;opacity:0.85;font-size:0.9em;white-space:nowrap;';
        el.textContent = this.label;
        return el;
      }
      ignoreEvent() { return true; }
    }
    const ranges = [];
    const doc = editor.state.doc;
    for (const [line0, texts] of mapping) {
      try {
        const line = doc.line(Math.min(line0 + 1, doc.lines));
        const label = texts.map(formatLogFragment).filter(Boolean).join(' · ');
        if (!label) continue;
        ranges.push(cmView.Decoration.widget({ widget: new GhostWidget(label), side: 1 }).range(line.to));
      } catch (_) {}
    }
    if (!ranges.length) return;
    ranges.sort((a, b) => a.from - b.from);
    const deco = cmView.EditorView.decorations.of(cmView.Decoration.set(ranges, true));
    try {
      const existing = compartment.get(editor.state);
      if (existing === undefined) {
        editor.dispatch({ effects: cmState.StateEffect.appendConfig.of(compartment.of(deco)) });
      } else {
        editor.dispatch({ effects: compartment.reconfigure(deco) });
      }
      logsVisible = true;
    } catch (e) { console.warn('[JavaInline]', e); }
  }
}
export function initInlineRunOutput() {}
export function destroyInlineRunOutput() {
  clearInlineRunOutput();
  try { if (switchHandler) editorManager?.off?.('switch-file', switchHandler); } catch (_) {}
  switchHandler = null;
}
