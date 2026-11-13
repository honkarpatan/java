/**
 * cmBridge.js — everything that touches Acode's CodeMirror 6 modules / the main editor.
 * Kept separate so the finder stays pure and the view code stays readable.
 */

/** Resolve the CM6 modules Acode exposes through `acode.require`. */
export function loadCm(host) {
  const h = host || (typeof globalThis !== 'undefined' ? globalThis.acode : null);
  const get = (name) => {
    try {
      return (h && typeof h.require === 'function' && h.require(name)) || null;
    } catch (_) {
      return null;
    }
  };
  const view = get('@codemirror/view');
  const state = get('@codemirror/state');
  if (!view || !state || !view.EditorView || !state.EditorState) return null;
  return {
    view,
    state,
    language: get('@codemirror/language'),
    commands: get('@codemirror/commands'),
  };
}

/** True for a CodeMirror 6 EditorView (Acode >= the CM6 editor). */
export function isCm6(editor) {
  return !!editor && typeof editor.dispatch === 'function' && !!editor.state && !!editor.state.doc;
}

/**
 * Theme scope classes of the main editor (CM6 generates one per EditorView.theme()).
 * Re-applying them to the peek editor makes every theme rule match it too.
 */
export function themeClassesOf(editor) {
  try {
    return Array.from(editor.dom.classList)
      .filter((c) => c !== 'cm-editor' && c !== 'cm-focused')
      .join(' ');
  } catch (_) {
    return '';
  }
}

function firstOpaqueBackground(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)) return bg;
    node = node.parentElement;
  }
  return null;
}

/** Colours / fonts of the main editor so the popup can follow the active editor theme. */
export function readMetrics(editor) {
  const out = {
    bg: '#1e1e1e',
    fg: '#d4d4d4',
    fontFamily: '',
    fontSize: '',
    lineHeight: '',
  };
  try {
    const content = editor.contentDOM || editor.dom;
    const scroller = editor.scrollDOM || editor.dom;
    out.bg = firstOpaqueBackground(scroller) || firstOpaqueBackground(editor.dom) || out.bg;
    const cs = getComputedStyle(content);
    out.fg = cs.color || out.fg;
    out.fontSize = cs.fontSize;
    out.lineHeight = cs.lineHeight;
    out.fontFamily = getComputedStyle(scroller).fontFamily || cs.fontFamily;
  } catch (_) {}
  return out;
}

/**
 * Language + syntax-highlighting extensions that mirror the main editor, so the popup is
 * coloured by exactly the same theme. Every step is optional and fails soft (plain text).
 */
export function buildLanguageExtensions(cm, editor) {
  const out = [];
  const L = cm.language;
  if (!L) return out;
  try {
    const lang = L.language ? editor.state.facet(L.language) : null;
    if (lang && lang.extension) out.push(lang.extension);
  } catch (_) {}
  try {
    if (typeof L.syntaxHighlighting === 'function') {
      if (typeof L.highlightingFor === 'function') {
        const mainState = editor.state;
        // delegate to whatever highlight style the active theme installed in the main editor
        out.push(L.syntaxHighlighting({ style: (tags) => L.highlightingFor(mainState, tags) }));
      } else if (L.defaultHighlightStyle) {
        out.push(L.syntaxHighlighting(L.defaultHighlightStyle, { fallback: true }));
      }
    }
  } catch (_) {}
  try {
    if (L.indentUnit && typeof L.getIndentUnit === 'function') {
      out.push(L.indentUnit.of(' '.repeat(Math.max(1, L.getIndentUnit(editor.state)))));
    }
  } catch (_) {}
  return out;
}

/**
 * One persistent listener on the main editor that forwards document changes to whichever
 * peek view is currently open (`bridge.current`). It is installed once per editor state in a
 * Compartment and is a no-op when nothing is open, so there is nothing to clean up per open.
 */
export function createMainBridge(cm) {
  const { Compartment, StateEffect, Annotation } = cm.state;
  const { EditorView } = cm.view;
  const compartment = new Compartment();
  const bridge = {
    /** Marks transactions that only mirror the other editor (breaks sync loops). */
    SYNC: Annotation.define(),
    current: null,
    ext: null,
    attach(editor) {
      try {
        const cur = compartment.get(editor.state);
        if (cur === undefined) {
          editor.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(bridge.ext)) });
        } else if (cur !== bridge.ext) {
          editor.dispatch({ effects: compartment.reconfigure(bridge.ext) });
        }
        return true;
      } catch (_) {
        return false;
      }
    },
    release() {
      bridge.current = null;
    },
    dispose(editor) {
      bridge.current = null;
      try {
        if (editor && compartment.get(editor.state) !== undefined) {
          editor.dispatch({ effects: compartment.reconfigure([]) });
        }
      } catch (_) {}
    },
  };
  bridge.ext = EditorView.updateListener.of((update) => {
    const cur = bridge.current;
    if (cur && update.docChanged) cur.onMainUpdate(update);
  });
  return bridge;
}
