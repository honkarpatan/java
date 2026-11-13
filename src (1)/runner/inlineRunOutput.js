/**
 * inlineRunOutput.js — map stdout onto System.out.print/println sites.
 * C++-style: extract string literals and split combined lines when
 * print (no \\n) is followed by println on the same stdout line.
 */
import { getSettings } from '../core/settings.js';
import { clearChipsOnEdit } from '../input/inputChips.js';

let compartment = null;
let logsVisible = false;
let clearHandler = null;
let switchHandler = null;
let updateCompartment = null;
let boundEditor = null;

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function formatLogFragment(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '↵')
    .replace(/\t/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}

function isMetaLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^\[compile\]/i.test(t)) return true;
  if (/^\[compile failed\]/i.test(t)) return true;
  if (/^\[run\]/i.test(t)) return true;
  if (/^\[cmd\]/i.test(t)) return true;
  if (/^\[file\]/i.test(t)) return true;
  if (/^\[time\]/i.test(t)) return true;
  if (/^\[exit\b/i.test(t)) return true;
  if (/JAVA_RUN_END/i.test(t)) return true;
  return false;
}

/**
 * Extract first string literal content from a print/println/printf call.
 * @returns {{ text: string, method: 'print'|'println'|'printf', trailingNL: boolean }|null}
 */
function extractPrintLiteral(line) {
  const m = line.match(
    /\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(\s*"((?:\\.|[^"\\])*)"/
  );
  if (!m) {
    const m2 = line.match(
      /\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(\s*'((?:\\.|[^'\\])*)'/
    );
    if (!m2) {
      // println with non-literal still counts as a site (trailing NL)
      const m3 = line.match(/\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(/);
      if (!m3) return null;
      return {
        text: '',
        method: m3[1],
        trailingNL: m3[1] === 'println',
      };
    }
    return {
      text: decodeJavaString(m2[2]),
      method: m2[1],
      trailingNL: m2[1] === 'println' || /\\n/.test(m2[2]),
    };
  }
  return {
    text: decodeJavaString(m[2]),
    method: m[1],
    trailingNL: m[1] === 'println' || /\\n/.test(m[2]),
  };
}

function decodeJavaString(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function findPrintSites(code) {
  const lines = String(code || '').split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\/\//.test(lines[i])) continue;
    if (!/\bSystem\s*\.\s*(?:out|err)\s*\.\s*(?:println|print|printf)\s*\(/.test(lines[i])) continue;
    const lit = extractPrintLiteral(lines[i]);
    sites.push({
      line: i,
      text: lit?.text ?? '',
      method: lit?.method || 'print',
      trailingNL: lit?.trailingNL ?? false,
    });
  }
  return sites;
}

/**
 * Map program stdout to print sites.
 * Handles: print("prompt: ") + println("Hello x") → one physical line
 * "prompt: Hello x" split across the two sites.
 */
function mapOutputToPrintLines(code, output) {
  const sites = findPrintSites(code);
  let cleaned = stripAnsi(output)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/JAVA_RUN_END[\s\S]*$/m, '');

  // drop meta lines
  cleaned = cleaned
    .split('\n')
    .filter((l) => !isMetaLine(l))
    .join('\n');

  /** @type {Map<number, string[]>} */
  const map = new Map();
  const push = (line0, text) => {
    const t = formatLogFragment(text);
    if (!t) return;
    if (!map.has(line0)) map.set(line0, []);
    map.get(line0).push(t);
  };

  if (!sites.length) {
    const lines = cleaned.trimEnd().split('\n').filter((l) => l.length);
    if (lines.length) map.set(0, lines.map(formatLogFragment).filter(Boolean));
    return map;
  }

  // Stream walk
  let pos = 0;
  const stream = cleaned;

  for (let si = 0; si < sites.length; si++) {
    const site = sites[si];
    const next = sites[si + 1];

    // skip leading newlines between sites
    while (pos < stream.length && stream[pos] === '\n') pos++;

    if (pos >= stream.length) break;

    const needle = site.text;
    // If we have a literal prefix, try to match it at current position
    if (needle && stream.startsWith(needle, pos)) {
      pos += needle.length;
      // Capture until newline (for println) or until next needle / end
      if (site.trailingNL || site.method === 'println') {
        // rest of this "logical" print already in needle; consume optional \n
        if (stream[pos] === '\n') pos++;
        push(site.line, needle.replace(/\n/g, '↵'));
      } else {
        // print without NL — take only the needle for this site
        push(site.line, needle);
        // remainder until \n belongs to later println if any
        if (next && (next.method === 'println' || next.trailingNL)) {
          let end = stream.indexOf('\n', pos);
          if (end < 0) end = stream.length;
          const rest = stream.slice(pos, end);
          pos = end < stream.length ? end + 1 : end;
          if (rest.length) push(next.line, rest);
          // skip next site in loop since we filled it
          si++;
        } else {
          // no next println — keep rest on same site until \n
          let end = stream.indexOf('\n', pos);
          if (end < 0) end = stream.length;
          const rest = stream.slice(pos, end);
          pos = end < stream.length ? end + 1 : end;
          if (rest.length) push(site.line, rest);
        }
      }
      continue;
    }

    // No literal match — take until newline as this site's output
    let end = stream.indexOf('\n', pos);
    if (end < 0) end = stream.length;
    const chunk = stream.slice(pos, end);
    pos = end < stream.length ? end + 1 : end;
    if (chunk.length) push(site.line, chunk);
  }

  // leftover output → last site
  if (pos < stream.length && sites.length) {
    const rest = stream.slice(pos).replace(/^\n+|\n+$/g, '');
    if (rest.trim()) {
      for (const line of rest.split('\n')) {
        if (line.length) push(sites[sites.length - 1].line, line);
      }
    }
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
    try {
      clearChipsOnEdit();
    } catch (_) {}
  };
  clearHandler = onClear;
  boundEditor = editor;
  try {
    if (typeof editor.dispatch === 'function') {
      const cmView = acode.require('@codemirror/view');
      const cmState = acode.require('@codemirror/state');
      if (cmView?.EditorView?.updateListener && cmState?.Compartment) {
        if (!updateCompartment) updateCompartment = new cmState.Compartment();
        const ext = cmView.EditorView.updateListener.of((u) => {
          if (u.docChanged) onClear();
        });
        try {
          const existing = updateCompartment.get(editor.state);
          if (existing === undefined) {
            editor.dispatch({
              effects: cmState.StateEffect.appendConfig.of(updateCompartment.of(ext)),
            });
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
    try {
      editorManager?.on?.('switch-file', switchHandler);
    } catch (_) {}
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
      constructor(label) {
        super();
        this.label = label;
      }
      eq(o) {
        return o instanceof GhostWidget && o.label === this.label;
      }
      toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-java-inline-log';
        el.style.cssText =
          'margin-left:0.5em;opacity:0.85;font-size:0.9em;white-space:nowrap;font-style:italic;color:#80cbc4;';
        el.textContent = '⟹ ' + this.label;
        return el;
      }
      ignoreEvent() {
        return true;
      }
    }
    const ranges = [];
    const doc = editor.state.doc;
    for (const [line0, texts] of mapping) {
      try {
        const line = doc.line(Math.min(line0 + 1, doc.lines));
        const label = texts.filter(Boolean).join(' · ');
        if (!label) continue;
        ranges.push(
          cmView.Decoration.widget({ widget: new GhostWidget(label), side: 1 }).range(line.to)
        );
      } catch (_) {}
    }
    if (!ranges.length) return;
    ranges.sort((a, b) => a.from - b.from);
    const deco = cmView.EditorView.decorations.of(cmView.Decoration.set(ranges, true));
    try {
      const existing = compartment.get(editor.state);
      if (existing === undefined) {
        editor.dispatch({
          effects: cmState.StateEffect.appendConfig.of(compartment.of(deco)),
        });
      } else {
        editor.dispatch({ effects: compartment.reconfigure(deco) });
      }
      logsVisible = true;
    } catch (e) {
      console.warn('[JavaInline]', e);
    }
  }
}

export function initInlineRunOutput() {}
export function destroyInlineRunOutput() {
  clearInlineRunOutput();
  try {
    if (switchHandler) editorManager?.off?.('switch-file', switchHandler);
  } catch (_) {}
  switchHandler = null;
}
