/**
 * Peek References — reusable "Go to Reference" module for Acode plugins.
 *
 *   import { createPeekReferences, JAVA_PROFILE } from './modules/peekReferences';
 *
 *   const peek = createPeekReferences({
 *     profile: JAVA_PROFILE,                       // or 'java' | 'cpp' | 'php' | custom profile
 *     getDirLabel: (file) => '~/',                 // optional text after the file name
 *   });
 *   peek.show();      // references of the symbol under the cursor
 *   peek.hide();
 *   peek.dispose();   // on plugin unload
 *
 * To reuse it in another plugin (C++, PHP …) copy this folder and pass another profile.
 */
import { loadCm, isCm6, createMainBridge } from './cmBridge.js';
import { PeekView } from './peekView.js';
import { symbolAt, isIdentifier, findReferences, pickActiveIndex } from './referenceFinder.js';
import { createProfile, getProfile } from './languageProfiles.js';
import { removeStyles } from './styles.js';

export * from './languageProfiles.js';
export { findReferences, symbolAt, isIdentifier, buildPreview, pickActiveIndex } from './referenceFinder.js';

const DEFAULT_MESSAGES = {
  references: 'References',
  close: 'Close',
  noReferences: 'No references found',
  noSymbol: 'Place the cursor on a symbol first',
  unsupported: 'Go to References needs the CodeMirror 6 editor',
};

/**
 * @param {object} [options]
 * @param {string|object} [options.profile]  profile id or profile object (default: generic)
 * @param {object} [options.acode]           host `acode` (default: global)
 * @param {object} [options.editorManager]   host `editorManager` (default: global)
 * @param {(msg: string) => void} [options.toast]
 * @param {(file: object) => string} [options.getDirLabel]  text shown after the file name
 * @param {object} [options.messages]        override UI strings
 * @param {number} [options.maxReferences=5000]
 */
export function createPeekReferences(options = {}) {
  const host = options.acode || globalThis.acode;
  const em = options.editorManager || globalThis.editorManager;
  const messages = { ...DEFAULT_MESSAGES, ...(options.messages || {}) };
  const profile = typeof options.profile === 'string' ? getProfile(options.profile) : createProfile(options.profile || {});
  const maxReferences = options.maxReferences || 5000;

  const state = { cm: null, bridge: null, view: null, editor: null, unsubscribe: null };

  const toast = (msg) => {
    if (options.toast) return options.toast(msg);
    try {
      host.require('toast')(msg, 2500);
    } catch (_) {}
  };

  function hide() {
    if (state.view) state.view.close();
  }

  function listen() {
    const onSwitch = () => hide();
    try {
      em.on('switch-file', onSwitch);
      em.on('remove-file', onSwitch);
    } catch (_) {}
    state.unsubscribe = () => {
      try {
        em.off('switch-file', onSwitch);
        em.off('remove-file', onSwitch);
      } catch (_) {}
    };
  }

  /** Open the popup for the symbol under the cursor (or the selected identifier). */
  function show(opts = {}) {
    state.cm = state.cm || loadCm(host);
    const editor = em && em.editor;
    if (!state.cm || !isCm6(editor)) {
      toast(messages.unsupported);
      return false;
    }

    const code = editor.state.doc.toString();
    const sel = editor.state.selection.main;
    let symbol = opts.symbol || null;
    if (!symbol && !sel.empty) {
      const text = code.slice(sel.from, sel.to);
      if (isIdentifier(text, profile)) symbol = text;
    }
    if (!symbol) {
      const hit = symbolAt(code, sel.head, profile);
      if (hit && !hit.isKeyword) symbol = hit.symbol;
    }
    if (!symbol) {
      toast(messages.noSymbol);
      return false;
    }

    const refs = findReferences(code, symbol, profile, { max: maxReferences });
    if (!refs.length) {
      toast(messages.noReferences);
      return false;
    }

    hide();
    if (state.editor && state.editor !== editor && state.bridge) state.bridge.dispose(state.editor);
    state.bridge = state.bridge || createMainBridge(state.cm);
    if (!state.bridge.attach(editor)) {
      toast(messages.unsupported);
      return false;
    }
    state.editor = editor;

    const file = em.activeFile || null;
    const fileId = file && file.id;
    let actionStack = null;
    try {
      actionStack = host.require('actionStack');
    } catch (_) {}

    const view = new PeekView({
      cm: state.cm,
      editor,
      bridge: state.bridge,
      profile,
      symbol,
      refs,
      activeIndex: pickActiveIndex(refs, sel.head),
      fileName: opts.fileName ?? (file && file.name) ?? '',
      dirLabel: opts.dirLabel ?? (options.getDirLabel ? options.getDirLabel(file) : ''),
      labels: messages,
      isActive: () => em.editor === editor && (!file || (em.activeFile && em.activeFile.id === fileId)),
      actionStack,
      onClose: () => {
        if (state.view === view) state.view = null;
        if (state.unsubscribe) {
          state.unsubscribe();
          state.unsubscribe = null;
        }
      },
    });
    state.view = view;
    state.bridge.current = view;
    listen();
    view.open();
    return true;
  }

  function dispose() {
    hide();
    if (state.bridge) state.bridge.dispose(state.editor || (em && em.editor));
    state.bridge = null;
    state.editor = null;
    removeStyles();
  }

  return { show, hide, dispose, isOpen: () => !!state.view, profile };
}
