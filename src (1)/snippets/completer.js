/**
 * snippets/completer.js — keywords + builtin + custom snippets (C++ pattern)
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode } from '../utils/javaFiles.js';
import { JAVA_KEYWORDS, JAVA_SNIPPETS } from './snippets.js';
import { STD_TYPES } from '../autoImport/stdlibMap.js';

const fsOperation = acode.require('fsOperation') || acode.require('fs');
const CUSTOM_SNIPPET_FILENAME = 'java_snippets.json';

let registered = false;
let aceHandler = null;
let cmCompartment = null;
let lastSnippetPath = null;
let lastFetched = null;

function fileIdentifiers(code) {
  const set = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g;
  let m;
  while ((m = re.exec(String(code || ''))) !== null) set.add(m[1]);
  return [...set];
}

async function getDynamicSnippets() {
  const settings = getSettings();
  if (settings.enableCustomSnippets === false || !settings.customSnippetPath) {
    return JAVA_SNIPPETS;
  }
  const path = String(settings.customSnippetPath || '').trim();
  if (!path) return JAVA_SNIPPETS;
  if (path === lastSnippetPath && lastFetched) return lastFetched;
  try {
    if (!fsOperation) return JAVA_SNIPPETS;
    const exists = await fsOperation(path, CUSTOM_SNIPPET_FILENAME).exists();
    if (!exists) {
      lastSnippetPath = path;
      lastFetched = JAVA_SNIPPETS;
      return JAVA_SNIPPETS;
    }
    const raw = await fsOperation(path, CUSTOM_SNIPPET_FILENAME).readFile('utf-8');
    const parsed = JSON.parse(String(raw || '{}'));
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.java)
        ? parsed.java
        : Array.isArray(parsed.snippets)
          ? parsed.snippets
          : null;
    if (!list || !list.length) {
      lastFetched = JAVA_SNIPPETS;
      return JAVA_SNIPPETS;
    }
    const normalized = list
      .map(function (s) {
        return {
          prefix: s.prefix || s.caption || s.name || '',
          body: s.body || s.snippet || s.content || '',
          description: s.description || s.meta || 'custom',
        };
      })
      .filter(function (s) {
        return s.prefix && s.body;
      });
    // merge: custom overrides same prefix
    const map = new Map();
    JAVA_SNIPPETS.forEach(function (s) {
      map.set(s.prefix, s);
    });
    normalized.forEach(function (s) {
      map.set(s.prefix, s);
    });
    lastSnippetPath = path;
    lastFetched = [...map.values()];
    return lastFetched;
  } catch (e) {
    console.warn('[JavaCompleter] custom snippets', e);
    return JAVA_SNIPPETS;
  }
}

function expandBody(body) {
  return String(body || '')
    .replace(/\$\{\d+:([^}]+)\}/g, '$1')
    .replace(/\$\d+/g, '');
}

async function buildItems(prefix) {
  const settings = getSettings();
  const p = String(prefix || '').toLowerCase();
  const out = [];
  if (settings.enableSnippets !== false) {
    const snips = await getDynamicSnippets();
    for (let i = 0; i < snips.length; i++) {
      const sn = snips[i];
      if (!p || sn.prefix.toLowerCase().startsWith(p) || sn.prefix.toLowerCase().includes(p)) {
        out.push({
          label: sn.prefix,
          type: 'snippet',
          detail: sn.description || 'snippet',
          apply: expandBody(sn.body),
          boost: 12,
        });
      }
    }
  }
  if (settings.enableKeywords !== false) {
    for (let i = 0; i < JAVA_KEYWORDS.length; i++) {
      const kw = JAVA_KEYWORDS[i];
      if (!p || kw.toLowerCase().startsWith(p)) {
        out.push({ label: kw, type: 'keyword', apply: kw, boost: 1 });
      }
    }
  }
  const typeNames = Object.keys(STD_TYPES);
  for (let i = 0; i < typeNames.length; i++) {
    const name = typeNames[i];
    if (!p || name.toLowerCase().startsWith(p)) {
      out.push({ label: name, type: 'class', detail: STD_TYPES[name], apply: name, boost: 5 });
    }
  }
  if (settings.enableIdentifiers !== false) {
    try {
      const ids = fileIdentifiers(readActiveCode());
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (p && id.toLowerCase().startsWith(p)) {
          out.push({ label: id, type: 'variable', apply: id, boost: 2 });
        }
      }
    } catch (_) {}
  }
  return out.slice(0, 80);
}

const javaAceCompleter = {
  identifierRegexps: [/[a-zA-Z_0-9$]/],
  getCompletions: function (editor, session, pos, prefix, callback) {
    if (getSettings().pluginEnabled === false || !isJavaFile(editorManager && editorManager.activeFile)) {
      callback(null, []);
      return;
    }
    buildItems(prefix)
      .then(function (items) {
        callback(
          null,
          items.map(function (it) {
            return {
              caption: it.label,
              value: it.apply || it.label,
              meta: it.type || '',
              score: (it.boost || 0) * 100 + (it.label ? it.label.length : 0),
            };
          })
        );
      })
      .catch(function () {
        callback(null, []);
      });
  },
};

function registerAce() {
  try {
    const langTools = ace && ace.require && ace.require('ace/ext/language_tools');
    if (!langTools || !langTools.addCompleter) return false;
    langTools.addCompleter(javaAceCompleter);
    aceHandler = javaAceCompleter;
    return true;
  } catch (_) {
    return false;
  }
}

function unregisterAce() {
  try {
    const langTools = ace && ace.require && ace.require('ace/ext/language_tools');
    if (langTools && langTools.removeCompleter && aceHandler) {
      langTools.removeCompleter(aceHandler);
    }
  } catch (_) {}
  aceHandler = null;
}

function registerCm6() {
  try {
    const cmAutocomplete = acode.require('@codemirror/autocomplete');
    const cmState = acode.require('@codemirror/state');
    const editor = editorManager && editorManager.editor;
    if (!cmAutocomplete || !cmAutocomplete.autocompletion || !cmState || !cmState.Compartment || !editor || !editor.dispatch) {
      return false;
    }
    const source = function (ctx) {
      if (!isJavaFile(editorManager && editorManager.activeFile)) return null;
      if (getSettings().pluginEnabled === false) return null;
      const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      return buildItems(word.text).then(function (items) {
        return {
          from: word.from,
          options: items.map(function (it) {
            return {
              label: it.label,
              type: it.type,
              detail: it.detail,
              apply: it.apply,
              boost: it.boost,
            };
          }),
        };
      });
    };
    if (!cmCompartment) cmCompartment = new cmState.Compartment();
    const ext = cmAutocomplete.autocompletion({ override: [source] });
    try {
      const existing = cmCompartment.get(editor.state);
      if (existing === undefined) {
        editor.dispatch({
          effects: cmState.StateEffect.appendConfig.of(cmCompartment.of(ext)),
        });
      } else {
        editor.dispatch({ effects: cmCompartment.reconfigure(ext) });
      }
    } catch (_) {}
    return true;
  } catch (e) {
    console.warn('[JavaCompleter] CM6', e);
    return false;
  }
}

export function registerCompleter() {
  if (registered) return;
  registered = true;
  registerAce();
  registerCm6();
  try {
    if (editorManager && editorManager.on) {
      editorManager.on('switch-file', function () {
        if (isJavaFile(editorManager.activeFile)) registerCm6();
      });
    }
  } catch (_) {}
  console.log('[JavaCompleter] registered', JAVA_KEYWORDS.length, 'kw', JAVA_SNIPPETS.length, 'snip');
}

export function unregisterCompleter() {
  registered = false;
  unregisterAce();
  try {
    const editor = editorManager && editorManager.editor;
    const cmState = acode.require('@codemirror/state');
    if (editor && editor.dispatch && cmCompartment && cmState) {
      if (cmCompartment.get(editor.state) !== undefined) {
        editor.dispatch({ effects: cmCompartment.reconfigure([]) });
      }
    }
  } catch (_) {}
}

export function getKeywordList() {
  return getSettings().enableKeywords === false ? [] : JAVA_KEYWORDS;
}
export function getSnippetList() {
  return getSettings().enableSnippets === false ? [] : JAVA_SNIPPETS;
}
