/**
 * inlineRunOutput.js — map stdout onto System.out.print/println sites.
 * Multi-iteration loop prints stay on their source line (block widget).
 * Newlines shown as ⤶
 */
import { getSettings } from '../core/settings.js';
import { clearChipsOnEdit } from '../input/inputChips.js';
import { findLoops, getInnermostLoop, resolveLoopRounds } from '../input/loopInput.js';

let compartment = null;
let logsVisible = false;
let clearHandler = null;
let switchHandler = null;
let updateCompartment = null;
let boundEditor = null;

const NL_MARK = '⤶';

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function formatLogFragment(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, NL_MARK)
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

function decodeJavaString(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/**
 * First string literal only (concat rest is dynamic).
 * @returns {{ text: string, method: string, trailingNL: boolean }|null}
 */
function extractPrintLiteral(line) {
  const m = line.match(
    /\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(\s*"((?:\\.|[^"\\])*)"/
  );
  if (m) {
    const text = decodeJavaString(m[2]);
    return {
      text,
      method: m[1],
      trailingNL: m[1] === 'println' || /\n/.test(text),
      partial: /\+/.test(line.slice(line.indexOf(m[0]) + m[0].length)),
    };
  }
  const m2 = line.match(
    /\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(\s*'((?:\\.|[^'\\])*)'/
  );
  if (m2) {
    const text = decodeJavaString(m2[2]);
    return {
      text,
      method: m2[1],
      trailingNL: m2[1] === 'println' || /\n/.test(text),
      partial: /\+/.test(line.slice(line.indexOf(m2[0]) + m2[0].length)),
    };
  }
  const m3 = line.match(/\bSystem\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf)\s*\(/);
  if (!m3) return null;
  return {
    text: '',
    method: m3[1],
    trailingNL: m3[1] === 'println',
    partial: true,
  };
}

function findPrintSites(code) {
  const lines = String(code || '').split('\n');
  const sites = [];
  let loops = [];
  try {
    loops = findLoops(code);
  } catch (_) {}
  const maxLoop = getSettings().maxLoopInputs ?? 100;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\/\//.test(lines[i])) continue;
    if (!/\bSystem\s*\.\s*(?:out|err)\s*\.\s*(?:println|print|printf)\s*\(/.test(lines[i])) {
      continue;
    }
    const lit = extractPrintLiteral(lines[i]);
    if (!lit) continue;
    let loopRounds = 1;
    try {
      const loop = getInnermostLoop(loops, i);
      if (loop) {
        const resolved = resolveLoopRounds(loop, maxLoop, {});
        if (resolved.rounds != null && resolved.rounds > 0) {
          loopRounds = Math.max(1, resolved.rounds);
        }
      }
    } catch (_) {}
    sites.push({
      line: i,
      text: lit.text ?? '',
      method: lit.method || 'print',
      trailingNL: !!lit.trailingNL,
      partial: !!lit.partial,
      loopRounds,
    });
  }
  return sites;
}

/**
 * Map stdout → source lines. Loop prints accumulate on the same line.
 * Never hand leftover of a partial print() to the next println unless
 * the next site's literal is clearly a prefix of that remainder.
 */
function mapOutputToPrintLines(code, output) {
  const sites = findPrintSites(code);
  let cleaned = stripAnsi(output)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/JAVA_RUN_END[\s\S]*$/m, '');

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

  let pos = 0;
  const stream = cleaned;

  for (let si = 0; si < sites.length; si++) {
    const site = sites[si];
    const next = sites[si + 1];
    const rounds = Math.max(1, site.loopRounds || 1);

    for (let r = 0; r < rounds; r++) {
      if (pos >= stream.length) break;

      // Leading newlines only count toward a println/trailingNL site
      if (site.trailingNL || site.method === 'println') {
        // keep one leading \n as content marker if stream starts with \n and site text starts with \n
        if (stream[pos] === '\n' && site.text.startsWith('\n')) {
          // match will handle
        } else {
          while (pos < stream.length && stream[pos] === '\n') pos++;
        }
      } else {
        // print(): do not skip \n — that would steal the next println's separator
        // but skip pure empty only between loop rounds if previous ended mid-line
      }

      if (pos >= stream.length) break;

      const needle = site.text;
      if (needle && stream.startsWith(needle, pos)) {
        pos += needle.length;
        if (site.trailingNL || site.method === 'println') {
          if (stream[pos] === '\n') pos++;
          push(site.line, needle);
        } else if (site.partial || rounds > 1) {
          // partial/concat or loop print: take remainder of this physical line for THIS site
          // only when last round of this site OR no next site sharing the line
          if (r < rounds - 1) {
            // intermediate loop round: take until next occurrence of needle, or a heuristic gap
            let end = stream.length;
            if (needle) {
              const nextOcc = stream.indexOf(needle, pos);
              if (nextOcc >= 0) end = nextOcc;
            }
            const nl = stream.indexOf('\n', pos);
            if (nl >= 0 && nl < end) end = nl;
            const rest = stream.slice(pos, end);
            pos = end;
            push(site.line, needle + rest);
          } else {
            // last round of this print site
            let end = stream.indexOf('\n', pos);
            if (end < 0) end = stream.length;
            const rest = stream.slice(pos, end);
            // Give rest to next println only if next literal matches
            const nextPlain = next ? String(next.text || '').replace(/^\n+/, '') : '';
            if (
              next &&
              (next.method === 'println' || next.trailingNL) &&
              nextPlain &&
              rest.startsWith(nextPlain)
            ) {
              push(site.line, needle);
              // leave rest for next site (including its leading content)
              pos = end < stream.length ? end + 1 : end;
              // put rest on next: handled by next iteration when si advances — need push next
              push(next.line, rest);
              pos = end < stream.length ? end + 1 : end;
              si++; // skip next
              break; // done with rounds of current
            }
            pos = end < stream.length ? end + 1 : end;
            push(site.line, needle + rest);
          }
        } else {
          // pure literal print without concat
          push(site.line, needle);
        }
        continue;
      }

      // No literal match at pos
      if (site.trailingNL || site.method === 'println') {
        let end = stream.indexOf('\n', pos);
        if (end < 0) end = stream.length;
        const chunk = stream.slice(pos, end);
        pos = end < stream.length ? end + 1 : end;
        if (chunk.length) push(site.line, chunk);
      } else {
        // print without match: for loop rounds, carve by next needle or newline
        let end = stream.length;
        if (r < rounds - 1 && needle) {
          const nextOcc = stream.indexOf(needle, pos + 1);
          if (nextOcc > pos) end = nextOcc;
        }
        const nl = stream.indexOf('\n', pos);
        if (nl >= 0 && nl < end) end = nl;
        // last round: stop at newline; do not dump into next println
        if (r === rounds - 1 && nl >= 0) end = nl;
        const chunk = stream.slice(pos, end);
        pos = end;
        if (r === rounds - 1 && stream[pos] === '\n') {
          // leave \n for next println site
        } else if (stream[pos] === '\n' && r < rounds - 1) {
          pos++;
        }
        if (chunk.length) push(site.line, chunk);
      }
    }
  }

  // leftover → last site only if nothing was mapped for it empty and leftover is short
  if (pos < stream.length && sites.length) {
    const rest = stream.slice(pos).replace(/^\n+/, '');
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

    /** One log line as end-of-line widget (single) */
    class GhostInline extends cmView.WidgetType {
      constructor(label) {
        super();
        this.label = label;
      }
      eq(o) {
        return o instanceof GhostInline && o.label === this.label;
      }
      toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-java-inline-log';
        el.style.cssText =
          'margin-left:0.5em;opacity:0.85;font-size:0.9em;white-space:pre;font-style:italic;color:#80cbc4;';
        el.textContent = '⟹ ' + this.label;
        return el;
      }
      ignoreEvent() {
        return true;
      }
    }

    /**
     * Multi-iteration / multi-line logs: block widget so the editor
     * grows space under the source line (loop print feel).
     */
    class GhostBlock extends cmView.WidgetType {
      constructor(texts) {
        super();
        this.texts = texts || [];
      }
      eq(o) {
        return (
          o instanceof GhostBlock &&
          o.texts.length === this.texts.length &&
          o.texts.every((t, i) => t === this.texts[i])
        );
      }
      toDOM() {
        const wrap = document.createElement('div');
        wrap.className = 'cm-java-inline-log-block';
        wrap.style.cssText =
          'display:block;padding:2px 0 2px 1.2em;margin:1px 0 4px;border-left:2px solid rgba(128,203,196,0.45);';
        for (let i = 0; i < this.texts.length; i++) {
          const row = document.createElement('div');
          row.className = 'cm-java-inline-log';
          row.style.cssText =
            'opacity:0.9;font-size:0.88em;white-space:pre;font-style:italic;color:#80cbc4;line-height:1.35;';
          row.textContent = this.texts[i];
          wrap.appendChild(row);
        }
        return wrap;
      }
      get estimatedHeight() {
        return Math.max(16, this.texts.length * 16);
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
        const clean = (texts || []).filter(Boolean);
        if (!clean.length) continue;
        if (clean.length === 1) {
          ranges.push(
            cmView.Decoration.widget({
              widget: new GhostInline(clean[0]),
              side: 1,
            }).range(line.to)
          );
        } else {
          // block under the line — editor expands for loop logs
          ranges.push(
            cmView.Decoration.widget({
              widget: new GhostBlock(clean),
              block: true,
              side: 1,
            }).range(line.to)
          );
        }
      } catch (_) {}
    }
    if (!ranges.length) return;
    ranges.sort((a, b) => a.from - b.from || (a.value?.startSide || 0) - (b.value?.startSide || 0));
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
      console.warn('[InlineRun] decoration failed', e);
    }
    return;
  }
}

export function initInlineRunOutput() {}
export function destroyInlineRunOutput() {
  clearInlineRunOutput();
  try {
    if (switchHandler) editorManager?.off?.('switch-file', switchHandler);
  } catch (_) {}
  switchHandler = null;
  clearHandler = null;
  boundEditor = null;
}
