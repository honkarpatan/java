/**
 * linter/javacLinter.js — javac -Xlint + Python-style CM6 UI
 * (underline + .cm-gutter.java-lint-gutter dots)
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode, detectMainClass } from '../utils/javaFiles.js';
import { setFileProblems, clearFileProblems } from '../problems/problemsStore.js';
import { alpineExecScript, shellEscape, toBase64 } from '../utils/alpineExec.js';
import { analyzeImports } from '../autoImport/importAnalysis.js';

const toast = acode.require('toast');

let lintTimer = null;
let saveHandler = null;
let registered = false;
let lintInProgress = false;
let lastLintedCode = '';
let lastLintAt = 0;

const WORK = '/tmp/acode-java-tools/lint';

let cmLintCompartment = null;
let javaLintGutterCompartment = null;
let ErrorDotMarker = null;

const listeners = {
  input: null,
  keyup: null,
  switchFile: null,
};

function dbg() {
  try {
    console.log.apply(console, ['[JavaLint]'].concat([].slice.call(arguments)));
  } catch (_) {}
}

export function parseJavacOutput(text, fileName) {
  const out = [];
  const src = String(text || '');
  const re =
    /(?:^|\n)([^\n]*?\.java):(\d+)(?::(\d+))?:\s*(error|warning|note):\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({
      line: Math.max(1, parseInt(m[2], 10) || 1),
      column: m[3] ? parseInt(m[3], 10) : 1,
      type: /warn/i.test(m[4]) ? 'warning' : /note/i.test(m[4]) ? 'info' : 'error',
      message: String(m[5] || '').trim(),
      source: 'javac',
      fileName: fileName || m[1] || '',
    });
  }
  if (!out.length && /\berror:\s+/i.test(src)) {
    const lines = src.split('\n').filter(function (l) {
      return /\b(error|warning):\s+/i.test(l);
    });
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i];
      out.push({
        line: 1,
        column: 1,
        type: /warn/i.test(line) ? 'warning' : 'error',
        message: line.replace(/^.*?\b(error|warning):\s*/i, '').trim() || line.trim(),
        source: 'javac',
        fileName: fileName || '',
      });
    }
  }
  return out;
}

function ensureCustomGutterClasses() {
  if (ErrorDotMarker) return;
  try {
    const cmView = acode.require('@codemirror/view');
    if (!cmView || !cmView.GutterMarker) return;
    ErrorDotMarker = class extends cmView.GutterMarker {
      constructor(message, severity) {
        super();
        this.message = message || '';
        this.severity = severity || 'error';
      }
      eq(other) {
        return other && other.message === this.message && other.severity === this.severity;
      }
      toDOM() {
        const el = document.createElement('div');
        el.className =
          'java-lint-gutter-dot ' +
          (this.severity === 'warning' ? 'java-lint-gutter-warn' : 'java-lint-gutter-error');
        el.title = this.message;
        el.setAttribute('aria-label', this.message);
        return el;
      }
    };
  } catch (e) {
    dbg('GutterMarker unavailable', e);
  }
}

function ensureLintExtension(editor) {
  if (!editor || !editor.dispatch || !editor.state) return;
  try {
    const cmLint = acode.require('@codemirror/lint');
    const cmState = acode.require('@codemirror/state');
    if (!cmLint || !cmState || !cmState.Compartment) return;
    if (!cmLintCompartment) cmLintCompartment = new cmState.Compartment();
    const existing = cmLintCompartment.get(editor.state);
    if (existing === undefined && cmLint.linter) {
      const parts = [cmLint.linter(function () { return []; }, { delay: 750 })];
      editor.dispatch({
        effects: cmState.StateEffect.appendConfig.of(cmLintCompartment.of(parts)),
      });
      dbg('CM6 linter() extension attached');
    }
  } catch (e) {
    dbg('ensureLintExtension', e);
  }
}

function clearDomFallback() {
  const nodes = document.querySelectorAll('.java-lint-error-line, .java-lint-warn-line');
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].classList.remove('java-lint-error-line', 'java-lint-warn-line');
    nodes[i].removeAttribute('title');
  }
}

function applyDomFallback(problems) {
  clearDomFallback();
  const editor = editorManager && editorManager.editor;
  if (!editor || !editor.dom || !problems || !problems.length) return;
  const content = editor.dom.querySelector('.cm-content');
  if (!content) return;
  const byRow = new Map();
  for (let i = 0; i < problems.length; i++) {
    const p = problems[i];
    const row = Math.max(0, (p.line || 1) - 1);
    if (!byRow.has(row) || p.type === 'error') byRow.set(row, p);
  }
  const lines = content.querySelectorAll('.cm-line');
  byRow.forEach(function (p, row) {
    try {
      if (lines[row]) {
        lines[row].classList.add(
          p.type === 'warning' ? 'java-lint-warn-line' : 'java-lint-error-line'
        );
        lines[row].title = p.message || '';
      }
    } catch (_) {}
  });
}

function buildDiagnostics(problems, doc) {
  return (problems || []).map(function (p) {
    const lineNum = Math.min(Math.max(1, p.line || 1), doc.lines);
    const lineObj = doc.line(lineNum);
    const text = lineObj.text || '';
    let col = Math.max(0, (p.column || 1) - 1);
    if (col > text.length) col = Math.max(0, text.length - 1);
    let from = lineObj.from + col;
    let end = col;
    if ((p.column || 1) <= 1) {
      end = text.length;
    } else {
      const isWord = /[A-Za-z0-9_]/.test(text[end] || '');
      if (isWord) {
        while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
      } else {
        end = Math.min(text.length, col + 1);
      }
    }
    if (end <= col) end = Math.min(text.length, col + 1);
    let to = lineObj.from + end;
    if (from >= lineObj.to) from = Math.max(lineObj.from, lineObj.to - 1);
    if (to <= from) to = Math.min(lineObj.to, from + 1);
    return {
      from: from,
      to: to,
      severity: p.type === 'warning' ? 'warning' : 'error',
      message: p.message || '',
      source: p.source || 'javac',
    };
  });
}

function applyCustomGutter(editor, problems) {
  try {
    const cmView = acode.require('@codemirror/view');
    const cmState = acode.require('@codemirror/state');
    if (!cmView || !cmView.gutter || !cmState || !cmState.RangeSet) {
      dbg('gutter API missing');
      return false;
    }
    ensureCustomGutterClasses();
    if (!ErrorDotMarker) return false;
    if (!javaLintGutterCompartment) {
      javaLintGutterCompartment = new cmState.Compartment();
    }

    const ranges = [];
    const byLine = new Map();
    const list = problems || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const lineNum = Math.min(Math.max(1, p.line || 1), editor.state.doc.lines);
      if (!byLine.has(lineNum) || p.type === 'error') byLine.set(lineNum, p);
    }
    byLine.forEach(function (p, lineNum) {
      try {
        const line = editor.state.doc.line(lineNum);
        ranges.push({
          from: line.from,
          value: new ErrorDotMarker(
            p.message || '',
            p.type === 'warning' ? 'warning' : 'error'
          ),
        });
      } catch (_) {}
    });
    ranges.sort(function (a, b) {
      return a.from - b.from;
    });

    let set;
    if (!ranges.length) {
      set = cmState.RangeSet.empty || cmState.RangeSet.of([]);
    } else {
      set = cmState.RangeSet.of(
        ranges.map(function (r) {
          return r.value.range(r.from);
        }),
        true
      );
    }

    const gutterExt = cmView.gutter({
      class: 'java-lint-gutter',
      markers: function () {
        return set;
      },
    });

    const existing = javaLintGutterCompartment.get(editor.state);
    if (existing === undefined) {
      editor.dispatch({
        effects: cmState.StateEffect.appendConfig.of(
          javaLintGutterCompartment.of(gutterExt)
        ),
      });
    } else {
      editor.dispatch({
        effects: javaLintGutterCompartment.reconfigure(gutterExt),
      });
    }
    dbg('custom java-lint-gutter markers', ranges.length);
    return true;
  } catch (e) {
    dbg('custom gutter failed', e);
    return false;
  }
}

function applyEditorMarkers(probs, mode) {
  dbg('applyEditorMarkers mode=', mode, 'count=', (probs || []).length);
  const editor = editorManager && editorManager.editor;
  if (!editor) {
    dbg('no editor for markers');
    return;
  }

  try {
    if (editor.session && editor.session.setAnnotations) {
      if (mode === 'disable') {
        editor.session.setAnnotations([]);
        return;
      }
      editor.session.setAnnotations(
        (probs || []).map(function (p) {
          return {
            row: Math.max(0, (p.line || 1) - 1),
            column: Math.max(0, (p.column || 1) - 1),
            text: p.message,
            type: p.type === 'warning' ? 'warning' : 'error',
          };
        })
      );
      dbg('Ace annotations set');
      return;
    }
  } catch (e) {
    dbg('Ace annotations failed', e);
  }

  if (!editor.dispatch || !editor.state) {
    applyDomFallback(mode === 'disable' ? [] : probs);
    return;
  }

  if (mode === 'disable') {
    try {
      const cmLint = acode.require('@codemirror/lint');
      if (cmLint && cmLint.setDiagnostics) {
        editor.dispatch(cmLint.setDiagnostics(editor.state, []));
      }
    } catch (_) {}
    applyCustomGutter(editor, []);
    clearDomFallback();
    return;
  }

  const showLine = mode === 'linter' || mode === 'both';
  const showGutter = mode === 'linter' || mode === 'both' || mode === 'inline';

  ensureLintExtension(editor);

  try {
    const cmLint = acode.require('@codemirror/lint');
    if (cmLint && cmLint.setDiagnostics) {
      const list = showLine ? probs : [];
      const diagnostics = buildDiagnostics(list, editor.state.doc);
      editor.dispatch(cmLint.setDiagnostics(editor.state, diagnostics));
      dbg('CM6 setDiagnostics', diagnostics.length);
    } else {
      dbg('setDiagnostics missing');
    }
  } catch (e) {
    dbg('CM6 setDiagnostics error', e);
  }

  if (showGutter) applyCustomGutter(editor, probs || []);
  else applyCustomGutter(editor, []);

  if (showLine) applyDomFallback(probs || []);
  else clearDomFallback();
}

export async function runJavacLint(file, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const settings = getSettings();
  dbg('run start', {
    enableLinter: settings.enableLinter,
    pluginEnabled: settings.pluginEnabled,
    errorTrigger: settings.errorTrigger,
    force: !!opts.force,
  });

  if (settings.pluginEnabled === false) {
    dbg('skip: pluginEnabled=false');
    return [];
  }
  if (settings.enableLinter === 'disable') {
    dbg('skip: enableLinter=disable');
    return [];
  }
  if (lintInProgress && !opts.force) {
    dbg('skip: already in progress');
    return [];
  }

  const f = file || (editorManager && editorManager.activeFile);
  if (!f) {
    dbg('skip: no active file');
    return [];
  }
  if (!isJavaFile(f)) {
    dbg('skip: not a .java file', f.filename || f.name || f.uri);
    return [];
  }

  const code = readActiveCode();
  if (code === lastLintedCode && !opts.force && Date.now() - lastLintAt < 400) {
    dbg('skip: same code (debounce)');
    return [];
  }

  const key = f.uri || f.filename || 'untitled';
  const detected = detectMainClass(code);
  const className = detected.className;
  const packageName = detected.packageName;
  const name = f.filename || (className || 'Main') + '.java';
  const javac = settings.javacPath || 'javac';
  const lintArgs = settings.javacLintArgs || '-Xlint:all';
  const javaHome = String(settings.javaHome || '').trim();

  dbg('file=', name, 'class=', className, 'pkg=', packageName, 'javac=', javac);

  let script = '#!/bin/sh\nset +e\necho JAVA_LINT_START\n';
  if (javaHome) {
    script += "export JAVA_HOME='" + shellEscape(javaHome) + "'\nexport PATH=\"$JAVA_HOME/bin:$PATH\"\n";
  }
  script += "command -v '" + shellEscape(javac) + "' || command -v javac || echo NO_JAVAC\n";
  script += "'" + shellEscape(javac) + "' -version 2>&1 || javac -version 2>&1 || true\n";
  script += "mkdir -p '" + WORK + "' && cd '" + WORK + "' || { echo CD_FAIL; exit 0; }\n";
  script += 'rm -rf classes; mkdir -p classes\n';
  if (packageName) {
    const dir = packageName.replace(/\./g, '/');
    script += "mkdir -p '" + shellEscape(dir) + "'\n";
    script += "SRC='" + shellEscape(dir) + '/' + shellEscape(className || 'Main') + ".java'\n";
  } else {
    script += "SRC='" + shellEscape(name) + "'\n";
  }
  script += "echo '" + toBase64(code) + "' | base64 -d > \"$SRC\" || { echo WRITE_FAIL; exit 0; }\n";
  script += 'echo "SRC=$SRC"\nls -la "$SRC" 2>&1 | head -2\n';
  script += shellEscape(javac) + ' -d classes -cp . ' + lintArgs + ' "$SRC" 2>&1\n';
  script += 'echo JAVA_LINT_END_EC=$?\n';

  lintInProgress = true;
  try {
    dbg('exec script…');
    const raw = await alpineExecScript(script);
    const textOut = String(raw || '');
    dbg('raw length=', textOut.length, 'preview=', textOut.slice(0, 400).replace(/\n/g, ' | '));

    if (/NO_JAVAC/.test(textOut) || /command not found/i.test(textOut)) {
      dbg('javac missing');
      if (opts.force) toast('javac not found — install OpenJDK (Tools → Dependencies)', 3000);
      clearFileProblems(key);
      return [];
    }
    if (/Executor API not available/i.test(textOut)) {
      dbg('Executor missing');
      if (opts.force) toast('Open Terminal once (Executor not ready)', 2500);
      return [];
    }

    const probs = parseJavacOutput(textOut, name);
    try {
      const importProbs = analyzeImports(code);
      for (let i = 0; i < importProbs.length; i++) probs.push(importProbs[i]);
    } catch (ie) {
      dbg('import analysis', ie);
    }
    dbg('parsed problems=', probs.length, probs.slice(0, 3));

    lastLintedCode = code;
    lastLintAt = Date.now();

    if (probs.length) setFileProblems(key, probs);
    else clearFileProblems(key);
    applyEditorMarkers(probs, settings.enableLinter);

    if (opts.force) {
      toast(
        probs.length ? 'Lint: ' + probs.length + ' issue(s)' : 'Lint: clean (0 errors)',
        2000
      );
    }
    dbg('done in', Date.now() - t0, 'ms');
    return probs;
  } catch (e) {
    dbg('EXCEPTION', (e && e.message) || e);
    if (opts.force) toast('Lint failed: ' + ((e && e.message) || e), 2500);
    return [];
  } finally {
    lintInProgress = false;
  }
}

function scheduleLint(source) {
  const settings = getSettings();
  if (settings.errorTrigger !== 'onKeypress' && source !== 'save' && source !== 'manual') {
    dbg('schedule skip trigger=', settings.errorTrigger, 'source=', source);
    return;
  }
  if (!isJavaFile(editorManager && editorManager.activeFile)) return;
  if (lintTimer) clearTimeout(lintTimer);
  lintTimer = setTimeout(function () {
    runJavacLint(null, { force: source === 'manual' }).catch(function (e) {
      dbg('schedule err', e);
    });
  }, source === 'manual' ? 50 : 900);
  dbg('scheduled from', source);
}

function onEditorChange(source) {
  try {
    if (!isJavaFile(editorManager && editorManager.activeFile)) return;
    const settings = getSettings();
    if (settings.enableLinter === 'disable') return;
    if (settings.errorTrigger !== 'onKeypress') return;
    scheduleLint(source || 'change');
  } catch (e) {
    dbg('onEditorChange err', e);
  }
}

export function registerLinter() {
  if (registered) {
    dbg('register: already registered');
    return;
  }
  registered = true;
  dbg('registerLinter()');

  saveHandler = function () {
    const s = getSettings();
    dbg('save-file event, trigger=', s.errorTrigger);
    if (s.errorTrigger === 'onSave' || s.errorTrigger === 'onKeypress') {
      scheduleLint('save');
    }
  };

  listeners.input = function (e) {
    if (
      (e.target && e.target.closest && e.target.closest('.cm-content')) ||
      (e.target && e.target.closest && e.target.closest('.ace_text-input'))
    ) {
      onEditorChange('input');
    }
  };
  listeners.keyup = function (e) {
    if (
      (e.target && e.target.closest && e.target.closest('.cm-content')) ||
      (e.target && e.target.closest && e.target.closest('.ace_editor'))
    ) {
      onEditorChange('keyup');
    }
  };
  listeners.switchFile = function () {
    const af = editorManager && editorManager.activeFile;
    dbg('switch-file', af && af.filename);
    if (isJavaFile(af)) {
      lastLintedCode = '';
      scheduleLint('switch');
    }
  };

  try {
    if (editorManager && editorManager.on) editorManager.on('save-file', saveHandler);
  } catch (e) {
    dbg('save-file hook failed', e);
  }
  try {
    if (editorManager && editorManager.on) editorManager.on('switch-file', listeners.switchFile);
  } catch (e) {
    dbg('switch-file hook failed', e);
  }

  document.addEventListener('input', listeners.input, true);
  document.addEventListener('keyup', listeners.keyup, true);

  try {
    const editor = editorManager && editorManager.editor;
    if (editor && editor.on) {
      editor.on('change', function () {
        onEditorChange('editor.change');
      });
      dbg('editor.on(change) attached');
    }
  } catch (e) {
    dbg('editor change attach failed', e);
  }

  setTimeout(function () {
    if (isJavaFile(editorManager && editorManager.activeFile)) {
      dbg('initial lint');
      runJavacLint(null, { force: false }).catch(function (e) {
        dbg('initial err', e);
      });
    } else {
      dbg('initial: no java file active');
    }
  }, 1200);

  dbg('hooks attached (save, switch, input, keyup)');
}

export function unregisterLinter() {
  registered = false;
  if (lintTimer) clearTimeout(lintTimer);
  try {
    if (saveHandler && editorManager && editorManager.off) editorManager.off('save-file', saveHandler);
  } catch (_) {}
  try {
    if (listeners.switchFile && editorManager && editorManager.off) {
      editorManager.off('switch-file', listeners.switchFile);
    }
  } catch (_) {}
  try {
    if (listeners.input) document.removeEventListener('input', listeners.input, true);
  } catch (_) {}
  try {
    if (listeners.keyup) document.removeEventListener('keyup', listeners.keyup, true);
  } catch (_) {}
  saveHandler = null;
  listeners.input = null;
  listeners.keyup = null;
  listeners.switchFile = null;
  lastLintedCode = '';
  dbg('unregistered');
}

export async function lintNow() {
  return runJavacLint(null, { force: true });
}
