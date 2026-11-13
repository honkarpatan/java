/**
 * autoImport/autoImport.js — Phase 3: insert missing stdlib imports + organize
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode } from '../utils/javaFiles.js';
import { STD_TYPES, JAVA_LANG } from './stdlibMap.js';
import { accurateMissingImports, analyzeImports } from './importAnalysis.js';

const toast = acode.require('toast');

let saveHandler = null;

function getExistingImports(code) {
  const set = new Set();
  const re = /^\s*import\s+(static\s+)?([\w.]+)\s*;/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    set.add(m[2]);
    const simple = m[2].split('.').pop();
    set.add(simple);
  }
  return set;
}

function collectUsedSimpleNames(code) {
  // strip strings/comments roughly
  let s = String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ');
  const names = new Set();
  const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(s)) !== null) names.add(m[1]);
  return names;
}

function findInsertOffset(code) {
  // after package + existing imports block
  const lines = code.split('\n');
  let lastImport = -1;
  let packageLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*package\s+/.test(lines[i])) packageLine = i;
    if (/^\s*import\s+/.test(lines[i])) lastImport = i;
  }
  if (lastImport >= 0) {
    // end of lastImport line
    let off = 0;
    for (let i = 0; i <= lastImport; i++) off += lines[i].length + 1;
    return off;
  }
  if (packageLine >= 0) {
    let off = 0;
    for (let i = 0; i <= packageLine; i++) off += lines[i].length + 1;
    return off;
  }
  return 0;
}

function applyTextInsert(editor, offset, text) {
  if (editor?.dispatch && editor.state?.doc) {
    editor.dispatch({
      changes: { from: offset, insert: text },
    });
    return true;
  }
  if (editor?.session?.insert) {
    const pos = editor.session.doc.indexToPosition(offset);
    editor.session.insert(pos, text);
    return true;
  }
  return false;
}

function replaceFullDocument(editor, newCode) {
  if (editor?.dispatch && editor.state?.doc) {
    const len = editor.state.doc.length;
    editor.dispatch({ changes: { from: 0, to: len, insert: newCode } });
    return true;
  }
  if (editor?.session?.setValue) {
    editor.session.setValue(newCode);
    return true;
  }
  return false;
}

export function suggestImportForType(n) {
  if (JAVA_LANG.has(n)) return null;
  return STD_TYPES[n] || null;
}

/** Compute imports to add for current buffer */
export function planMissingImports(code) {
  // Prefer accurate list (stdlib only — never invent)
  try {
    const acc = accurateMissingImports(code);
    if (acc && acc.length) return acc;
  } catch (_) {}
  // fallback legacy:
  return planMissingImportsLegacy(code);
}
function planMissingImportsLegacy(code) {
  const existing = getExistingImports(code);
  const used = collectUsedSimpleNames(code);
  const toAdd = [];
  for (const name of used) {
    if (JAVA_LANG.has(name)) continue;
    const fqn = STD_TYPES[name];
    if (!fqn) continue;
    if (existing.has(fqn) || existing.has(name)) continue;
    toAdd.push(fqn);
  }
  toAdd.sort();
  return toAdd;
}

export async function runAutoImport() {
  if (!isJavaFile(editorManager?.activeFile)) {
    toast('Not a Java file', 1200);
    return;
  }
  if (getSettings().enableAutoImport === false) {
    toast('Auto-import disabled', 1500);
    return;
  }
  const code = readActiveCode();
  const toAdd = planMissingImports(code);
  if (!toAdd.length) {
    toast('No missing stdlib imports', 1500);
    return;
  }
  const insert = toAdd.map((f) => `import ${f};\n`).join('');
  const offset = findInsertOffset(code);
  // blank line after package if inserting first imports
  const prefix =
    offset > 0 && !/import\s+/.test(code.slice(0, offset)) && !code.slice(0, offset).endsWith('\n\n')
      ? (code.slice(Math.max(0, offset - 1), offset) === '\n' ? '' : '\n')
      : '';
  const editor = editorManager?.editor;
  if (!applyTextInsert(editor, offset, prefix + insert)) {
    toast('Could not edit buffer', 1500);
    return;
  }
  toast(`Added ${toAdd.length} import(s)`, 1800);
}

export async function organizeImports() {
  if (!isJavaFile(editorManager?.activeFile)) {
    toast('Not a Java file', 1200);
    return;
  }
  const code = readActiveCode();
  const lines = code.split('\n');
  const imports = [];
  const rest = [];
  let packageLine = null;
  for (const line of lines) {
    if (/^\s*package\s+/.test(line)) {
      packageLine = line;
      continue;
    }
    if (/^\s*import\s+/.test(line)) {
      imports.push(line.trim());
      continue;
    }
    rest.push(line);
  }
  // unique + sort: java.* then javax.* then others
  const unique = [...new Set(imports)];
  unique.sort((a, b) => {
    const fa = a.replace(/^import\s+/, '').replace(/;$/, '');
    const fb = b.replace(/^import\s+/, '').replace(/;$/, '');
    return fa.localeCompare(fb);
  });
  const parts = [];
  if (packageLine) {
    parts.push(packageLine);
    parts.push('');
  }
  if (unique.length) {
    parts.push(...unique);
    parts.push('');
  }
  // drop leading empty lines from rest
  while (rest.length && rest[0].trim() === '') rest.shift();
  parts.push(...rest);
  const newCode = parts.join('\n');
  if (!replaceFullDocument(editorManager?.editor, newCode)) {
    toast('Could not edit buffer', 1500);
    return;
  }
  toast('Imports organized', 1500);
}

export function registerAutoImport() {
  if (saveHandler) return;
  saveHandler = () => {
    try {
      if (!isJavaFile(editorManager?.activeFile)) return;
      const s = getSettings();
      if (s.autoImportTrigger === 'onSave' && s.enableAutoImport !== false) {
        runAutoImport().catch(() => {});
      }
      if (s.organizeImportsOnSave) {
        organizeImports().catch(() => {});
      }
    } catch (_) {}
  };
  try {
    editorManager?.on?.('save-file', saveHandler);
  } catch (_) {}
}

export function unregisterAutoImport() {
  try {
    if (saveHandler) editorManager?.off?.('save-file', saveHandler);
  } catch (_) {}
  saveHandler = null;
}
