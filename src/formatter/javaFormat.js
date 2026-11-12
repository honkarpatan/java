/**
 * formatter/javaFormat.js — Acode formatter registry + document format
 */
import plugin from '../../plugin.json';
import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode } from '../utils/javaFiles.js';

const loader = acode.require('loader');
const toast = acode.require('toast');

let wasmInitialized = false;
let baseUrl = '';
let clangInit = null;
let clangFormatFn = null;

function setValueToEditor(activeFile, formattedCode) {
  const editor = editorManager.editor;
  const isCM6 = editor && typeof editor.dispatch === 'function';

  if (isCM6) {
    const currentCode = editor.state.doc.toString();
    if (currentCode !== formattedCode) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: formattedCode },
      });
    }
    return;
  }

  if (activeFile && activeFile.session) {
    const session = activeFile.session;
    try {
      const um = Object.assign({}, session.getUndoManager());
      const { $undoStack, $redoStack, $rev, $mark } = um;
      session.setValue(formattedCode);
      const undoManager = session.getUndoManager();
      if ($undoStack) undoManager.$undoStack = $undoStack;
      if ($redoStack) undoManager.$redoStack = $redoStack;
      if ($rev != null) undoManager.$rev = $rev;
      if ($mark != null) undoManager.$mark = $mark;
    } catch (_) {
      session.setValue(formattedCode);
    }
    return;
  }

  if (editor && editor.session && editor.session.setValue) {
    editor.session.setValue(formattedCode);
  }
}

function formatBuiltin(code, indentSize) {
  const size = indentSize || 4;
  const pad = ' '.repeat(size);
  const lines = String(code || '').split('\n');
  let level = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\s+$/, '').trim();
    if (!trimmed) {
      out.push('');
      continue;
    }
    if (/^[}\])]/.test(trimmed)) {
      level = Math.max(0, level - 1);
    }
    let adj = level;
    if (/^(case\s|default:)/.test(trimmed)) adj = Math.max(0, level - 1);
    out.push(pad.repeat(adj) + trimmed);
    let bare = trimmed
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");
    for (let j = 0; j < bare.length; j++) {
      if (bare[j] === '{') level++;
      else if (bare[j] === '}') level = Math.max(0, level - 1);
    }
  }
  return out.join('\n');
}

async function loadEngine() {
  if (wasmInitialized && clangFormatFn) return true;
  try {
    const mod = await import('@wasm-fmt/clang-format');
    clangInit = mod.default || mod.init;
    clangFormatFn = mod.format;
    if (!clangInit || !clangFormatFn) return false;
    const wasmUrl = (baseUrl || '') + 'clang-format.wasm';
    await clangInit(wasmUrl);
    wasmInitialized = true;
    return true;
  } catch (_) {
    return false;
  }
}

function resolveStyle(settings) {
  const custom = String(settings.javaFormatCustom || '').trim();
  if (custom) return custom;
  return settings.javaFormatStyle || 'Google';
}

export async function formatDocument() {
  if (!isJavaFile(editorManager && editorManager.activeFile)) {
    toast('Not a Java file', 1200);
    return;
  }
  const settings = getSettings();
  if ((settings.formatterTool || 'clang-wasm') === 'none') {
    toast('Formatter is disabled', 1500);
    return;
  }

  const { editor, activeFile } = editorManager;
  const isCM6 = editor && typeof editor.dispatch === 'function';
  const code = isCM6
    ? editor.state.doc.toString()
    : editor.getValue
      ? editor.getValue()
      : readActiveCode();
  const filename = (activeFile && activeFile.filename) || 'Main.java';

  let formatted = null;

  try {
    if (loader && loader.showTitleLoader) loader.showTitleLoader();
  } catch (_) {}

  try {
    const ok = await loadEngine();
    if (ok && clangFormatFn) {
      try {
        formatted = clangFormatFn(code, filename, resolveStyle(settings));
      } catch (_) {
        formatted = null;
      }
    }
    // Silent fallback — indent only
    if (!formatted) {
      formatted = formatBuiltin(code, 4);
    }

    if (formatted === code) {
      toast('Already formatted', 1000);
      return;
    }
    setValueToEditor(activeFile, formatted);
    toast('Formatted', 1000);
  } catch (error) {
    console.error('[JavaFormat]', error);
    try {
      // last resort
      const fb = formatBuiltin(code, 4);
      if (fb !== code) {
        setValueToEditor(activeFile, fb);
        toast('Formatted', 1000);
      } else {
        toast('Format failed', 1500);
      }
    } catch (_) {
      toast('Format failed', 1500);
    }
  } finally {
    try {
      if (loader && loader.removeTitleLoader) loader.removeTitleLoader();
    } catch (_) {}
  }
}

export function initFormatter(_baseUrl) {
  baseUrl = _baseUrl || baseUrl || '';
  if (baseUrl && !baseUrl.endsWith('/')) baseUrl += '/';

  try {
    acode.registerFormatter(plugin.id, ['java'], async function () {
      await formatDocument();
    });
  } catch (e) {
    console.warn('[JavaFormat] registerFormatter', e);
  }

  try {
    if (editorManager && editorManager.on) {
      editorManager.on('save-file', onSaveFormat);
    }
  } catch (_) {}
}

function onSaveFormat() {
  try {
    const s = getSettings();
    if (s.formatOnSave && s.formatterTool !== 'none' && isJavaFile(editorManager && editorManager.activeFile)) {
      formatDocument().catch(function () {});
    }
  } catch (_) {}
}

export function destroyFormatter() {
  try {
    acode.unregisterFormatter(plugin.id);
  } catch (_) {}
  try {
    if (editorManager && editorManager.off) editorManager.off('save-file', onSaveFormat);
  } catch (_) {}
  wasmInitialized = false;
  clangFormatFn = null;
  clangInit = null;
}
