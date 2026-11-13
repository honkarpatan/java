/**
 * peekView.js — the VS Code style "References" peek popup.
 *
 *   ┌ file.java  ~/  - References (13)                         [X] ┐
 *   │ code editor (nested CM6, editable)  ┃  reference lines (list)  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * - The left editor is a real CodeMirror 6 editor holding a copy of the main document.
 *   Every edit is forwarded to the main editor (and vice-versa) through ChangeSets, so
 *   both always show the same text. A SYNC annotation prevents echo loops.
 * - Reference hits are drawn with decorations that are mapped through edits and rebuilt
 *   (debounced) with the lexical finder, so they stay highlighted while typing.
 * - The popup copies the main editor's theme classes / metrics and uses Acode's CSS
 *   variables, so it follows both the editor theme and the app theme.
 */
import { findReferences, buildPreview, pickActiveIndex } from './referenceFinder.js';
import { readMetrics, themeClassesOf, buildLanguageExtensions } from './cmBridge.js';
import { ensureStyles } from './styles.js';

const BACK_ID = 'peek-references';
const DOUBLE_TAP_MS = 380;
const REFRESH_MS = 140;
const MIN_HEIGHT = 140;

const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function enableDrag(handle, onStart, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const start = onStart(e);
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_) {}
    handle.classList.add('is-dragging');
    const move = (ev) => onMove(ev, start);
    const up = (ev) => {
      handle.classList.remove('is-dragging');
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch (_) {}
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export class PeekView {
  /**
   * @param {object} o
   * @param {object} o.cm         { view, state, language, commands } CM6 modules
   * @param {object} o.editor     main EditorView
   * @param {object} o.bridge     from createMainBridge()
   * @param {object} o.profile    language profile (see languageProfiles.js)
   * @param {string} o.symbol
   * @param {Array}  o.refs       initial references (from findReferences)
   * @param {number} o.activeIndex
   * @param {string} o.fileName
   * @param {string} [o.dirLabel]
   * @param {object} o.labels     { references, close }
   * @param {() => boolean} o.isActive   false once the main editor/file changed
   * @param {object} [o.actionStack]     Acode actionStack (Android back button)
   * @param {(view: PeekView) => void} [o.onClose]
   */
  constructor(o) {
    this.cm = o.cm;
    this.main = o.editor;
    this.bridge = o.bridge;
    this.profile = o.profile;
    this.symbol = o.symbol;
    this.refs = o.refs;
    this.active = o.activeIndex;
    this.fileName = o.fileName || '';
    this.dirLabel = o.dirLabel || '';
    this.labels = o.labels;
    this.isActive = o.isActive || (() => true);
    this.actionStack = o.actionStack || null;
    this.onClose = o.onClose || null;

    this.closed = false;
    this.rows = [];
    this.height = 0;
    this.top = 0;
    this.listWidth = 0;
    this.anchorPos = this.main.state.selection.main.head;
    this._lastTap = { i: -1, t: 0 };
    this._timers = { refresh: 0, raf: 0, scrollRaf: 0 };
    this._backFired = false;
  }

  /* ---------------------------------------------------------------- open */

  open() {
    ensureStyles(document);
    this.metrics = readMetrics(this.main);
    this._buildDom();

    const host = this.main.dom;
    if (getComputedStyle(host).position === 'static') {
      this._restorePosition = host.style.position;
      host.style.position = 'relative';
    }
    host.appendChild(this.root);

    const hostH = host.clientHeight || 400;
    this.height = clamp(Math.round(hostH * 0.48), 160, Math.min(380, hostH - 4));
    this._computeTop();
    this.layout();

    this._buildPeekEditor();
    this._renderList();
    this._renderTitle();
    this._markActiveRow(this.active);

    // keep the anchor line visible: if the popup would not fit below it, scroll the line up
    if (this.top + this.height > host.clientHeight) {
      try {
        this.main.dispatch({
          effects: this.cm.view.EditorView.scrollIntoView(this.anchorPos, { y: 'start', yMargin: 6 }),
        });
      } catch (_) {}
      this._timers.raf = requestAnimationFrame(() => {
        if (this.closed) return;
        this._computeTop();
        this.layout();
        this._reveal();
      });
    } else {
      this._reveal();
    }

    this._onScroll = () => {
      if (this._timers.scrollRaf) return;
      this._timers.scrollRaf = requestAnimationFrame(() => {
        this._timers.scrollRaf = 0;
        if (this.closed) return;
        this._computeTop();
        this.layout();
      });
    };
    this.main.scrollDOM.addEventListener('scroll', this._onScroll, { passive: true });

    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => !this.closed && this.layout());
      this._ro.observe(host);
    }

    if (this.actionStack && typeof this.actionStack.push === 'function') {
      try {
        this.actionStack.push({
          id: BACK_ID,
          action: () => {
            this._backFired = true;
            this.close();
          },
        });
      } catch (_) {}
    }
    return this;
  }

  /* ----------------------------------------------------------------- DOM */

  _buildDom() {
    const m = this.metrics;
    const root = el('div', 'acp-peek');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', `${this.labels.references}: ${this.symbol}`);
    root.style.setProperty('--acp-bg', m.bg);
    root.style.setProperty('--acp-fg', m.fg);

    // header: file name (+ dir) + count, close (X) on the right
    const header = el('div', 'acp-header');
    const title = el('div', 'acp-title');
    this.nameEl = el('span', 'acp-name', this.fileName);
    this.dirEl = el('span', 'acp-dir', this.dirLabel);
    this.countEl = el('span', 'acp-count');
    title.append(this.nameEl, this.dirEl, this.countEl);
    const close = el('button', 'acp-close');
    close.type = 'button';
    close.title = this.labels.close;
    close.setAttribute('aria-label', this.labels.close);
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });
    header.append(title, close);

    // body: editor | sash | list
    const body = el('div', 'acp-body');
    this.editorPane = el('div', 'acp-editor');
    this.editorPane.style.background = m.bg;
    const sashV = el('div', 'acp-sash-v');
    const list = el('div', 'acp-list');
    list.tabIndex = 0;
    if (m.fontFamily) list.style.fontFamily = m.fontFamily;
    if (m.fontSize) list.style.fontSize = m.fontSize;
    this.listEl = list;
    body.append(this.editorPane, sashV, list);

    const sashH = el('div', 'acp-sash-h');
    root.append(header, body, sashH);

    // list interaction (delegated): tap = select, double tap / Enter = go to
    list.addEventListener('click', (e) => {
      const row = e.target.closest && e.target.closest('.acp-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      const now = Date.now();
      const dbl = this._lastTap.i === i && now - this._lastTap.t < DOUBLE_TAP_MS;
      this._lastTap = { i, t: now };
      if (dbl) this.jump(i);
      else this._setActive(i, { reveal: true });
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.refs.length;
        if (!n) return;
        const next = clamp(this.active + (e.key === 'ArrowDown' ? 1 : -1), 0, n - 1);
        this._setActive(next, { reveal: true });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.jump(this.active);
      }
    });

    root.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      },
      true,
    );

    // resizing: list width (vertical sash) and popup height (bottom sash)
    enableDrag(
      sashV,
      () => ({ rect: body.getBoundingClientRect() }),
      (ev, s) => {
        const w = s.rect.right - ev.clientX;
        this.listWidth = clamp(w, 90, s.rect.width - 120);
        root.style.setProperty('--acp-list-w', this.listWidth + 'px');
      },
    );
    enableDrag(
      sashH,
      (e) => ({ y: e.clientY, h: this.height }),
      (ev, s) => {
        this.height = s.h + (ev.clientY - s.y);
        this.layout();
      },
    );

    this.root = root;
  }

  /** Popup top = just below the anchor line of the main editor. */
  _computeTop() {
    try {
      const rect = this.main.dom.getBoundingClientRect();
      const c = this.main.coordsAtPos(this.anchorPos);
      if (c) this.top = Math.max(0, Math.round(c.bottom - rect.top) + 2);
    } catch (_) {}
  }

  layout() {
    if (this.closed) return;
    const hostH = this.main.dom.clientHeight;
    if (!hostH) return;
    const height = clamp(this.height, MIN_HEIGHT, hostH - 4);
    let top = this.top;
    if (top + height > hostH) top = Math.max(0, hostH - height);
    this.root.style.top = top + 'px';
    this.root.style.height = height + 'px';
  }

  /* ------------------------------------------------------- nested editor */

  _buildPeekEditor() {
    const { cm, main, profile } = this;
    const { EditorState, StateField, StateEffect, Transaction } = cm.state;
    const { EditorView, Decoration, keymap, lineNumbers } = cm.view;
    const m = this.metrics;
    this.Transaction = Transaction;

    const hitMark = Decoration.mark({ class: 'acp-hit' });
    const hitActive = Decoration.mark({ class: 'acp-hit acp-hit-active' });
    const lineDeco = Decoration.line({ class: 'acp-active-line' });
    const setHits = StateEffect.define();
    this.setHits = setHits;

    const build = (doc, refs, active) => {
      const ranges = [];
      refs.forEach((r, i) => {
        if (r.to > r.from && r.to <= doc.length) ranges.push((i === active ? hitActive : hitMark).range(r.from, r.to));
      });
      const a = refs[active];
      if (a && a.from <= doc.length) ranges.push(lineDeco.range(doc.lineAt(a.from).from));
      return Decoration.set(ranges, true);
    };

    const initialRefs = this.refs.map((r) => ({ from: r.from, to: r.to }));
    this.hitsField = StateField.define({
      create: (state) => ({ refs: initialRefs, active: this.active, deco: build(state.doc, initialRefs, this.active) }),
      update: (v, tr) => {
        let { refs, active } = v;
        let dirty = false;
        if (tr.docChanged) {
          refs = refs.map((r) => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }));
          dirty = true;
        }
        for (const e of tr.effects) {
          if (e.is(setHits)) {
            if (e.value.refs) refs = e.value.refs;
            if (e.value.active !== undefined) active = e.value.active;
            dirty = true;
          }
        }
        return dirty ? { refs, active, deco: build(tr.newDoc, refs, active) } : v;
      },
      provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
    });

    const exts = [lineNumbers(), this.hitsField];

    const themeClasses = themeClassesOf(main);
    if (themeClasses && EditorView.editorAttributes) exts.push(EditorView.editorAttributes.of({ class: themeClasses }));
    try {
      if (EditorView.darkTheme) exts.push(EditorView.darkTheme.of(!!main.state.facet(EditorView.darkTheme)));
    } catch (_) {}

    const themeRules = { '&': { height: '100%' } };
    if (m.fontSize) themeRules['&'].fontSize = m.fontSize;
    if (m.fontFamily) themeRules['.cm-scroller'] = { fontFamily: m.fontFamily };
    if (m.lineHeight && m.lineHeight !== 'normal') themeRules['.cm-content'] = { lineHeight: m.lineHeight };
    exts.push(EditorView.theme(themeRules));

    exts.push(...buildLanguageExtensions(cm, main));

    try {
      exts.push(EditorState.tabSize.of(main.state.tabSize));
    } catch (_) {}
    if (main.contentDOM.classList.contains('cm-lineWrapping')) exts.push(EditorView.lineWrapping);
    exts.push(EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }));

    const C = cm.commands;
    if (C) {
      const maps = [];
      if (C.history) exts.push(C.history());
      if (C.historyKeymap) maps.push(...C.historyKeymap);
      if (C.defaultKeymap) maps.push(...C.defaultKeymap);
      if (C.indentWithTab) maps.push(C.indentWithTab);
      if (maps.length) exts.push(keymap.of(maps));
    }

    exts.push(EditorView.updateListener.of((u) => this._onPeekUpdate(u)));

    const first = this.refs[this.active];
    const state = EditorState.create({
      doc: main.state.doc.toString(),
      selection: first ? { anchor: first.from } : undefined,
      extensions: exts,
    });
    this.peek = new EditorView({ state, parent: this.editorPane });
  }

  _reveal() {
    const r = this.refs[this.active];
    if (!r || !this.peek) return;
    try {
      this.peek.dispatch({
        effects: this.cm.view.EditorView.scrollIntoView(r.from, { y: 'center' }),
      });
    } catch (_) {}
  }

  /* ----------------------------------------------------------- two-way sync */

  _defer(fn) {
    Promise.resolve().then(() => {
      if (!this.closed) fn();
    });
  }

  _mapAnchor(changes) {
    try {
      this.anchorPos = changes.mapPos(this.anchorPos, -1);
    } catch (_) {}
  }

  /** Popup editor changed → mirror the change into the main editor. */
  _onPeekUpdate(u) {
    if (this.closed) return;
    if (u.docChanged) {
      const mirrored = u.transactions.some((tr) => tr.annotation(this.bridge.SYNC));
      if (!mirrored) this._forwardToMain(u);
      this._scheduleRefresh();
    } else if (u.selectionSet) {
      this._defer(() => this._syncActiveFromCursor());
    }
  }

  _forwardToMain(u) {
    if (!this.isActive()) {
      // the main editor now shows another file: never write into it
      this._defer(() => this.close());
      return;
    }
    const main = this.main;
    if (u.startState.doc.length !== main.state.doc.length) {
      this._defer(() => this._resyncFromMain());
      return;
    }
    try {
      this._mapAnchor(u.changes);
      main.dispatch({ changes: u.changes, annotations: this.bridge.SYNC.of(true) });
    } catch (_) {
      this._defer(() => this._resyncFromMain());
    }
  }

  /** Called by the main editor's update listener (see createMainBridge). */
  onMainUpdate(update) {
    if (this.closed || !this.peek) return;
    if (update.transactions.some((tr) => tr.annotation(this.bridge.SYNC))) return;
    this._mapAnchor(update.changes);
    if (update.startState.doc.length !== this.peek.state.doc.length) {
      this._defer(() => this._resyncFromMain());
      return;
    }
    try {
      this.peek.dispatch({
        changes: update.changes,
        annotations: [this.bridge.SYNC.of(true), this.Transaction.addToHistory.of(false)],
      });
    } catch (_) {
      this._defer(() => this._resyncFromMain());
    }
  }

  /** Main document is the source of truth when the two ever disagree. */
  _resyncFromMain() {
    if (this.closed) return;
    this.peek.dispatch({
      changes: { from: 0, to: this.peek.state.doc.length, insert: this.main.state.doc.toString() },
      annotations: [this.bridge.SYNC.of(true), this.Transaction.addToHistory.of(false)],
    });
    this._refreshNow();
  }

  /* --------------------------------------------------- references bookkeeping */

  _scheduleRefresh() {
    clearTimeout(this._timers.refresh);
    this._timers.refresh = setTimeout(() => this._refreshNow(), REFRESH_MS);
  }

  _refreshNow() {
    if (this.closed || !this.peek) return;
    clearTimeout(this._timers.refresh);
    const code = this.peek.state.doc.toString();
    const refs = findReferences(code, this.symbol, this.profile);
    const cur = this.peek.state.field(this.hitsField);
    const prev = cur.refs[cur.active];
    const anchor = prev && prev.to > prev.from ? prev.from : this.peek.state.selection.main.head;
    const active = pickActiveIndex(refs, anchor);
    this.refs = refs;
    this.active = active;
    this.peek.dispatch({
      effects: this.setHits.of({ refs: refs.map((r) => ({ from: r.from, to: r.to })), active }),
      annotations: this.bridge.SYNC.of(true),
    });
    this._renderList();
    this._renderTitle();
    this._markActiveRow(active);
  }

  _syncActiveFromCursor() {
    if (this.closed || !this.peek) return;
    const f = this.peek.state.field(this.hitsField);
    const head = this.peek.state.selection.main.head;
    const i = f.refs.findIndex((r) => r.to > r.from && head >= r.from && head <= r.to);
    if (i >= 0 && i !== f.active) this._setActive(i, { reveal: false });
  }

  _setActive(i, { reveal }) {
    if (this.closed || !this.peek) return;
    const f = this.peek.state.field(this.hitsField);
    const r = f.refs[i];
    if (!r) return;
    this.active = i;
    const spec = { effects: [this.setHits.of({ active: i })], annotations: this.bridge.SYNC.of(true) };
    if (reveal) {
      spec.selection = { anchor: r.from };
      spec.effects.push(this.cm.view.EditorView.scrollIntoView(r.from, { y: 'center' }));
    }
    this.peek.dispatch(spec);
    this._markActiveRow(i);
  }

  /* ----------------------------------------------------------------- list */

  _renderTitle() {
    this.countEl.textContent = `- ${this.labels.references} (${this.refs.length})`;
  }

  _renderList() {
    const list = this.listEl;
    const scroll = list.scrollTop;
    list.textContent = '';
    this.rows = [];
    if (!this.refs.length) {
      list.appendChild(el('div', 'acp-empty', this.labels.noReferences || ''));
      return;
    }
    const code = this.peek.state.doc.toString();
    const frag = document.createDocumentFragment();
    this.refs.forEach((r, i) => {
      const p = buildPreview(code, r);
      const row = el('div', 'acp-row');
      row.dataset.i = String(i);
      row.title = `${r.line + 1}:${r.col + 1}`;
      row.append(document.createTextNode(p.before), el('mark', null, p.match), document.createTextNode(p.after));
      frag.appendChild(row);
      this.rows.push(row);
    });
    list.appendChild(frag);
    list.scrollTop = scroll;
  }

  _markActiveRow(i) {
    const list = this.listEl;
    this.rows.forEach((row, k) => row.classList.toggle('is-active', k === i));
    const row = this.rows[i];
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }

  /* ---------------------------------------------------------------- close */

  /** Close the popup and put the main cursor on reference `i` (double tap / Enter). */
  jump(i) {
    if (this.closed || !this.peek) return;
    const r = this.peek.state.field(this.hitsField).refs[i];
    if (!r) return;
    const main = this.main;
    const ok = this.isActive();
    this.close();
    if (!ok) return;
    try {
      main.dispatch({
        selection: { anchor: r.from, head: r.to },
        effects: this.cm.view.EditorView.scrollIntoView(r.from, { y: 'center' }),
      });
      main.focus();
    } catch (_) {}
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._timers.refresh);
    cancelAnimationFrame(this._timers.raf);
    cancelAnimationFrame(this._timers.scrollRaf);
    if (this.bridge.current === this) this.bridge.release();
    try {
      this.main.scrollDOM.removeEventListener('scroll', this._onScroll);
    } catch (_) {}
    if (this._ro) this._ro.disconnect();
    if (this.actionStack && !this._backFired && typeof this.actionStack.remove === 'function') {
      try {
        this.actionStack.remove(BACK_ID);
      } catch (_) {}
    }
    try {
      if (this.peek) this.peek.destroy();
    } catch (_) {}
    if (this.root) this.root.remove();
    if (this._restorePosition !== undefined) this.main.dom.style.position = this._restorePosition;
    if (this.onClose) this.onClose(this);
  }
}
