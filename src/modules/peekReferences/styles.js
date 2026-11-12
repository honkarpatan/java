/**
 * styles.js — CSS for the peek popup, injected at runtime (no CSS loader needed, so the
 * module can be dropped into any Acode plugin regardless of its webpack setup).
 *
 * Colours come from three places, so the popup follows both themes:
 *   - editor theme: --acp-bg / --acp-fg are measured from the live editor (set by JS)
 *   - app theme:    --active-color / --border-color … (Acode CSS variables)
 */
const STYLE_ID = 'acode-peek-references-style';

export const PEEK_CSS = `
.acp-peek {
  --acp-accent: var(--active-color, #3794ff);
  --acp-title-bg: var(--secondary-color, color-mix(in srgb, var(--acp-accent) 10%, var(--acp-bg)));
  --acp-title-fg: var(--secondary-text-color, var(--acp-fg));
  --acp-list-bg: color-mix(in srgb, var(--acp-fg) 5%, var(--acp-bg));
  --acp-border: var(--border-color, color-mix(in srgb, var(--acp-fg) 20%, var(--acp-bg)));
  --acp-sel-bg: color-mix(in srgb, var(--acp-accent) 24%, var(--acp-list-bg));
  --acp-hit-bg: rgba(234, 160, 40, 0.36);
  --acp-hit-active-bg: rgba(234, 160, 40, 0.66);
  --acp-line-bg: color-mix(in srgb, var(--acp-accent) 11%, transparent);
  position: absolute;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--acp-bg);
  color: var(--acp-fg);
  border-top: 2px solid var(--acp-accent);
  border-bottom: 2px solid var(--acp-accent);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.acp-peek *, .acp-peek *::before, .acp-peek *::after { box-sizing: border-box; }

.acp-header {
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 0 12px;
  background: var(--acp-title-bg);
  color: var(--acp-title-fg);
  border-bottom: 1px solid var(--acp-border);
  font-size: 14px;
  user-select: none;
  -webkit-user-select: none;
}
.acp-title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acp-name { font-weight: 500; }
.acp-dir, .acp-count { opacity: 0.7; }
.acp-close {
  flex: 0 0 auto;
  width: 32px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.acp-close:hover, .acp-close:focus-visible { background: color-mix(in srgb, var(--acp-fg) 14%, transparent); outline: none; }
.acp-close:active { opacity: 0.7; }

.acp-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
.acp-editor {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
.acp-editor > .cm-editor { height: 100%; width: 100%; }
.acp-editor .cm-scroller { overflow: auto; }

.acp-hit { background: var(--acp-hit-bg); border-radius: 2px; }
.acp-hit-active { background: var(--acp-hit-active-bg); outline: 1px solid rgba(234, 160, 40, 0.9); }
.cm-line.acp-active-line { background: var(--acp-line-bg); }

.acp-sash-v {
  flex: 0 0 5px;
  position: relative;
  cursor: col-resize;
  touch-action: none;
  background: var(--acp-border);
}
.acp-sash-v::before { content: ''; position: absolute; top: 0; bottom: 0; left: -8px; right: -8px; }
.acp-sash-v:hover, .acp-sash-v.is-dragging { background: var(--acp-accent); }

.acp-list {
  flex: 0 0 var(--acp-list-w, 38%);
  position: relative;
  min-width: 0;
  overflow: auto;
  padding: 4px 0;
  background: var(--acp-list-bg);
  font-size: 14px;
  outline: none;
  -webkit-overflow-scrolling: touch;
}
.acp-row {
  margin: 1px 4px;
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  line-height: 20px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.acp-row:hover { background: color-mix(in srgb, var(--acp-fg) 8%, transparent); }
.acp-row.is-active { background: var(--acp-sel-bg); border-color: var(--acp-accent); }
.acp-row mark {
  background: var(--acp-hit-bg);
  color: inherit;
  padding: 0;
  border-radius: 2px;
}
.acp-row.is-active mark { background: var(--acp-hit-active-bg); }
.acp-empty { padding: 14px 12px; opacity: 0.7; }

.acp-sash-h {
  flex: 0 0 7px;
  position: relative;
  cursor: row-resize;
  touch-action: none;
  background: transparent;
}
.acp-sash-h::before { content: ''; position: absolute; left: 0; right: 0; top: -8px; bottom: 0; }
.acp-sash-h::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 2px;
  width: 36px;
  height: 3px;
  margin-left: -18px;
  border-radius: 2px;
  background: var(--acp-border);
}
.acp-sash-h.is-dragging::after { background: var(--acp-accent); }
`;

/** Inject the stylesheet once per document. */
export function ensureStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = PEEK_CSS;
  (doc.head || doc.documentElement).appendChild(el);
}

export function removeStyles(doc = document) {
  const el = doc.getElementById(STYLE_ID);
  if (el) el.remove();
}
