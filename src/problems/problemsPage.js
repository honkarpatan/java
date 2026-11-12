/**
 * problems/problemsPage.js — C++-style page + live "4E 0W" side button
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile } from '../utils/javaFiles.js';
import { getAllProblems, getProblemCounts, subscribe } from './problemsStore.js';

const SideButton = acode.require('sideButton');
const Page = acode.require('page');
const actionStack = acode.require('actionStack');
const toast = acode.require('toast');

const PAGE_STACK_ID = 'java-problems-page';
const COPY_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

let sideButton = null;
let problemsPage = null;
let pageBody = null;
let unsubscribe = null;
let fileSwitchHandler = null;
const collapsedFiles = new Set();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function computeButtonText() {
  const { errors, warnings } = getProblemCounts();
  return errors + 'E ' + warnings + 'W';
}
function hasAnyProblems() {
  const { errors, warnings } = getProblemCounts();
  return errors + warnings > 0;
}

function applyTextToSideButtonDom(el, text) {
  if (!el) return false;
  let applied = false;
  const nodes = el.querySelectorAll('.text, .label, .side-button-text, [class*="text"], span, small');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.classList && n.classList.contains('icon')) continue;
    if (n.children && n.children.length && n.querySelector('.icon')) continue;
    n.textContent = text;
    applied = true;
  }
  if (!applied) {
    el.setAttribute('aria-label', text);
    el.title = text;
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        child.textContent = text;
        applied = true;
      }
    }
  }
  return applied;
}

function sideButtonOpts(text) {
  return {
    text: text,
    icon: 'report_problem',
    backgroundColor: 'var(--primary-color, #1e1e1e)',
    textColor: 'var(--primary-text-color, #fff)',
    onclick: function () {
      openProblemsPage();
    },
  };
}

function ensureSideButton() {
  if (sideButton) return sideButton;
  try {
    sideButton = SideButton(sideButtonOpts(computeButtonText()));
  } catch (e) {
    console.warn('[JavaProblems] SideButton failed', e);
  }
  return sideButton;
}

function recreateSideButton(text) {
  const settings = getSettings();
  const shouldShow =
    settings.showProblemsSideButton !== false &&
    isJavaFile(editorManager && editorManager.activeFile);
  try {
    if (sideButton && sideButton.hide) sideButton.hide();
  } catch (_) {}
  sideButton = null;
  try {
    sideButton = SideButton(sideButtonOpts(text));
    if (shouldShow) sideButton.show();
    else sideButton.hide();
  } catch (e) {
    console.warn('[JavaProblems] recreate', e);
  }
}

function updateSideButtonBadge() {
  ensureSideButton();
  if (!sideButton) return;
  const text = computeButtonText();
  try {
    if (typeof sideButton.setText === 'function') sideButton.setText(text);
    if (sideButton.text !== undefined) sideButton.text = text;
    if (sideButton.$text) sideButton.$text.textContent = text;
    let ok = false;
    if (sideButton.$el) ok = applyTextToSideButtonDom(sideButton.$el, text);
    if (!ok && sideButton.el) ok = applyTextToSideButtonDom(sideButton.el, text);
    if (!ok && sideButton.root) ok = applyTextToSideButtonDom(sideButton.root, text);
    if (!ok) recreateSideButton(text);
  } catch (e) {
    try {
      recreateSideButton(text);
    } catch (_) {}
  }
  try {
    const settings = getSettings();
    const show =
      settings.showProblemsSideButton !== false &&
      isJavaFile(editorManager && editorManager.activeFile);
    if (show) sideButton.show && sideButton.show();
    else sideButton.hide && sideButton.hide();
  } catch (_) {}
}


/** Open file (if needed), jump to line:col, scroll into view, flash highlight. */
async function goToProblem(fileUri, fileName, line1, column1) {
  try {
    hideProblemsPage();

    let target = null;
    const files = editorManager.files || [];
    const baseName = (fileName || '').split('/').pop();
    for (const f of files) {
      if (!f) continue;
      if (fileUri && (f.uri === fileUri || f.filename === fileUri)) {
        target = f;
        break;
      }
      if (baseName && (f.filename === baseName || f.name === baseName)) {
        target = f;
        break;
      }
      if (fileUri && f.uri && String(fileUri).includes('::')) {
        const tail = String(fileUri).split('::').pop();
        if (tail && f.uri && f.uri.indexOf(tail) >= 0) {
          target = f;
          break;
        }
      }
    }

    if (target) {
      try {
        target.makeActive?.();
      } catch (_) {}
    } else if (fileUri && fileUri !== 'untitled') {
      try {
        const openFile = acode.require('openFile');
        if (typeof openFile === 'function') await openFile(fileUri);
        else if (editorManager.openFile) await editorManager.openFile(fileUri);
      } catch (openErr) {
        console.warn('[JavaProblems] open', openErr);
        toast('Open file manually: ' + (baseName || fileUri));
      }
    }

    await new Promise(function (r) {
      setTimeout(r, 220);
    });

    const editor = editorManager && editorManager.editor;
    if (!editor) return;

    const line = Math.max(1, line1 | 0);
    const col = Math.max(0, (column1 | 0) - 1);

    if (typeof editor.dispatch === 'function' && editor.state) {
      try {
        if (typeof editor.gotoLine === 'function') {
          editor.gotoLine(line, col);
        } else {
          const doc = editor.state.doc;
          const lineObj = doc.line(Math.min(line, doc.lines));
          const pos = Math.min(lineObj.from + col, lineObj.to);
          editor.dispatch({
            selection: { anchor: pos, head: pos },
            scrollIntoView: true,
            effects: [],
          });
        }
        // Flash line highlight via temporary selection of whole line
        try {
          const doc = editor.state.doc;
          const lineObj = doc.line(Math.min(line, doc.lines));
          editor.dispatch({
            selection: { anchor: lineObj.from, head: lineObj.to },
            scrollIntoView: true,
          });
          setTimeout(function () {
            try {
              const d = editor.state.doc;
              const lo = d.line(Math.min(line, d.lines));
              const p = Math.min(lo.from + col, lo.to);
              editor.dispatch({ selection: { anchor: p, head: p } });
            } catch (_) {}
          }, 700);
        } catch (_) {}
        try {
          editor.focus?.();
        } catch (_) {}
      } catch (e) {
        console.warn('[JavaProblems] CM6 goto', e);
      }
    } else {
      try {
        if (editor.gotoLine) editor.gotoLine(line, col);
        else if (editor.moveCursorToPosition) {
          editor.moveCursorToPosition({ row: line - 1, column: col });
        }
        editor.focus?.();
        // Ace highlight line
        try {
          const Range = window.ace?.require?.('ace/range')?.Range;
          if (Range && editor.session) {
            const marker = editor.session.addMarker(
              new Range(line - 1, 0, line - 1, 1),
              'java-problem-line-flash',
              'fullLine'
            );
            setTimeout(function () {
              try {
                editor.session.removeMarker(marker);
              } catch (_) {}
            }, 900);
          }
        } catch (_) {}
      } catch (e) {
        console.warn('[JavaProblems] Ace goto', e);
      }
    }
  } catch (err) {
    console.error('[JavaProblems] goToProblem', err);
  }
}

function hideProblemsPage() {
  if (!problemsPage) return;
  try {
    if (problemsPage.hide) problemsPage.hide();
  } catch (_) {}
  try {
    if (actionStack && actionStack.has && actionStack.has(PAGE_STACK_ID)) {
      actionStack.remove(PAGE_STACK_ID);
    }
  } catch (_) {}
  try {
    if (problemsPage.parentElement) problemsPage.parentElement.removeChild(problemsPage);
  } catch (_) {}
}

async function copyText(text, label) {
  const t = String(text || '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
    } else {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast((label || 'Copied') + '', 1200);
  } catch (e) {
    toast('Copy failed', 1500);
  }
}

function problemLine(p) {
  return (
    (p.type || 'error').toUpperCase() +
    ' L' +
    (p.line || 1) +
    ':' +
    (p.column || 1) +
    '  ' +
    (p.message || '')
  );
}

function formatFileBlock(key, list) {
  const lines = ['// ' + key + ' (' + (list || []).length + ')'];
  (list || []).forEach(function (p) {
    lines.push(problemLine(p));
  });
  return lines.join('\n');
}

function formatAll() {
  const map = getAllProblems();
  const parts = [];
  map.forEach(function (list, key) {
    parts.push(formatFileBlock(key, list));
  });
  return parts.join('\n\n');
}

function typeClass(t) {
  if (t === 'warning') return 'java-prob-warning';
  if (t === 'info') return 'java-prob-info';
  return 'java-prob-error';
}

function renderBody() {
  if (!pageBody) return;
  const map = getAllProblems();
  const { errors, warnings } = getProblemCounts();
  let infos = 0;
  map.forEach(function (list) {
    (list || []).forEach(function (p) {
      if (p.type === 'info') infos++;
    });
  });
  const total = errors + warnings + infos;
  const files = map.size;

  let html =
    '<div class="java-problems-root">' +
    '<div class="java-problems-toolbar">' +
    '<div class="java-problems-summary">' +
    '<span class="java-prob-count java-prob-error" title="Errors">' +
    errors +
    '</span>' +
    '<span class="java-prob-count java-prob-warning" title="Warnings">' +
    warnings +
    '</span>' +
    '<span class="java-prob-count java-prob-info" title="Info">' +
    infos +
    '</span>' +
    '<span class="java-prob-count-label">' +
    total +
    ' problem' +
    (total === 1 ? '' : 's') +
    ' in ' +
    files +
    ' file' +
    (files === 1 ? '' : 's') +
    '</span></div>' +
    '<button type="button" class="java-prob-search-toggle" title="Filter problems" aria-label="Filter">⌕</button>' +
    '<button type="button" class="java-prob-copy-btn java-prob-copy-all" title="Copy all problems" ' +
    (total ? '' : 'disabled') +
    '>' +
    COPY_SVG +
    '</button></div>' +
    '<div class="java-prob-search-bar" hidden>' +
    '<input type="search" class="java-prob-search-input" placeholder="Filter problems…" />' +
    '<span class="java-prob-search-count"></span>' +
    '<button type="button" class="java-prob-search-clear" title="Clear filter">✕</button>' +
    '</div>';

  if (!total) {
    html +=
      '<div class="java-problems-empty">' +
      '<div class="java-problems-empty-icon">✓</div>' +
      '<div>No problems</div>' +
      '<div class="java-problems-empty-hint">javac + import diagnostics appear here.</div>' +
      '</div>';
  } else {
    html += '<div class="java-problems-tree">';
    let fi = 0;
    map.forEach(function (list, key) {
      const pathLabel = String(key).split('/').pop() || key;
      const isCollapsed = collapsedFiles.has(key);
      const errN = (list || []).filter(function (p) {
        return p.type === 'error';
      }).length;
      const warnN = (list || []).filter(function (p) {
        return p.type === 'warning';
      }).length;
      const infoN = (list || []).filter(function (p) {
        return p.type === 'info';
      }).length;
      html +=
        '<div class="java-problems-file' +
        (isCollapsed ? ' is-collapsed' : '') +
        '" data-file-key="' +
        escapeAttr(key) +
        '" data-file-idx="' +
        fi +
        '">' +
        '<div class="java-problems-file-bar">' +
        '<button type="button" class="java-problems-file-header" aria-expanded="' +
        (!isCollapsed) +
        '">' +
        '<span class="java-problems-twist' +
        (isCollapsed ? ' is-collapsed' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="java-problems-file-icon" aria-hidden="true"></span>' +
        '<span class="java-problems-file-name" title="' +
        escapeAttr(pathLabel) +
        '">' +
        escapeHtml(pathLabel) +
        '</span>' +
        '<span class="java-problems-file-counts">' +
        (errN
          ? '<span class="java-prob-pill java-prob-error">' + errN + '</span>'
          : '') +
        (warnN
          ? '<span class="java-prob-pill java-prob-warning">' + warnN + '</span>'
          : '') +
        (infoN
          ? '<span class="java-prob-pill java-prob-info">' + infoN + '</span>'
          : '') +
        '</span></button>' +
        '<button type="button" class="java-prob-copy-btn java-prob-copy-file" title="Copy this file\'s problems" data-file-idx="' +
        fi +
        '">' +
        COPY_SVG +
        '</button></div>' +
        '<div class="java-problems-list"' +
        (isCollapsed ? ' hidden' : '') +
        '>';
      (list || []).forEach(function (p, pi) {
        const tc = typeClass(p.type);
        const fileLabel = String(key).split('/').pop() || key;
        html +=
          '<div class="java-problems-item ' +
          tc +
          '" data-uri="' +
          escapeAttr(key) +
          '" data-name="' +
          escapeAttr(fileLabel) +
          '" data-line="' +
          (p.line || 1) +
          '" data-col="' +
          (p.column || 1) +
          '" data-file-idx="' +
          fi +
          '" data-pi="' +
          pi +
          '" data-msg="' +
          escapeAttr(p.message || '') +
          '">' +
          '<button type="button" class="java-problems-item-goto" title="Go to problem">' +
          '<span class="java-problems-item-marker ' +
          tc +
          '" aria-hidden="true"></span>' +
          '<span class="java-problems-item-msg user-select-text">' +
          escapeHtml(p.message || '') +
          '</span>' +
          '<span class="java-problems-item-loc">:' +
          (p.line || 1) +
          ':' +
          (p.column || 1) +
          '</span></button>' +
          '<button type="button" class="java-prob-copy-btn java-prob-copy-item" title="Copy this problem" data-file-idx="' +
          fi +
          '" data-pi="' +
          pi +
          '">' +
          COPY_SVG +
          '</button></div>';
      });
      html += '</div></div>';
      fi++;
    });
    html += '</div>';
  }
  html += '</div>';
  pageBody.innerHTML = html;

  // snapshot for copy handlers
  const entries = [];
  map.forEach(function (list, key) {
    entries.push({ key: key, list: list || [] });
  });

  const copyAll = pageBody.querySelector('.java-prob-copy-all');
  if (copyAll) {
    copyAll.onclick = function (e) {
      e.stopPropagation();
      copyText(formatAll(), 'All problems copied');
    };
  }

  pageBody.querySelectorAll('.java-prob-copy-file').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-file-idx') || '0', 10);
      const ent = entries[idx];
      if (ent) copyText(formatFileBlock(ent.key, ent.list), 'File problems copied');
    };
  });

  pageBody.querySelectorAll('.java-prob-copy-item').forEach(function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation();
      const fi = parseInt(btn.getAttribute('data-file-idx') || '0', 10);
      const pi = parseInt(btn.getAttribute('data-pi') || '0', 10);
      const p = entries[fi] && entries[fi].list[pi];
      if (p) copyText(problemLine(p), 'Copied');
    };
  });

  pageBody.querySelectorAll('.java-problems-file-header').forEach(function (hdr) {
    hdr.onclick = function () {
      const group = hdr.closest('.java-problems-file');
      if (!group) return;
      const key = group.getAttribute('data-file-key') || '';
      const list = group.querySelector('.java-problems-list');
      const twist = group.querySelector('.java-problems-twist');
      const nowCollapsed = !group.classList.contains('is-collapsed');
      group.classList.toggle('is-collapsed', nowCollapsed);
      if (twist) twist.classList.toggle('is-collapsed', nowCollapsed);
      if (list) {
        if (nowCollapsed) list.setAttribute('hidden', '');
        else list.removeAttribute('hidden');
      }
      hdr.setAttribute('aria-expanded', String(!nowCollapsed));
      if (key) {
        if (nowCollapsed) collapsedFiles.add(key);
        else collapsedFiles.delete(key);
      }
    };
  });

  pageBody.querySelectorAll('.java-problems-item-goto').forEach(function (btn) {
    btn.onclick = function (e) {
      try {
        e && e.preventDefault && e.preventDefault();
      } catch (_) {}
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length > 0) return;
      const row = btn.closest('.java-problems-item');
      if (!row) return;
      const uri = row.getAttribute('data-uri') || '';
      const name = row.getAttribute('data-name') || '';
      const line = parseInt(row.getAttribute('data-line') || '1', 10);
      const col = parseInt(row.getAttribute('data-col') || '1', 10);
      goToProblem(uri, name, line, col);
    };
  });

  bindSearchFilter();
}

let searchQuery = '';
let searchOpen = false;

function bindSearchFilter() {
  if (!pageBody) return;
  const toggle = pageBody.querySelector('.java-prob-search-toggle');
  const bar = pageBody.querySelector('.java-prob-search-bar');
  const input = pageBody.querySelector('.java-prob-search-input');
  const clearBtn = pageBody.querySelector('.java-prob-search-clear');
  if (!toggle || !bar || !input) return;

  const applyFilter = function () {
    const q = String(input.value || '').trim().toLowerCase();
    searchQuery = q;
    const items = pageBody.querySelectorAll('.java-problems-item');
    let visible = 0;
    items.forEach(function (el) {
      const msg = (el.getAttribute('data-msg') || el.textContent || '').toLowerCase();
      const name = (el.getAttribute('data-name') || '').toLowerCase();
      const loc = (el.getAttribute('data-line') || '') + ':' + (el.getAttribute('data-col') || '');
      const hit = !q || msg.indexOf(q) >= 0 || name.indexOf(q) >= 0 || loc.indexOf(q) >= 0;
      el.style.display = hit ? '' : 'none';
      el.classList.toggle('java-prob-search-hit', !!(hit && q));
      if (hit) visible++;
    });
    // hide empty file groups
    pageBody.querySelectorAll('.java-problems-file').forEach(function (g) {
      const any = g.querySelector('.java-problems-item:not([style*="display: none"])');
      g.style.display = any || !q ? '' : 'none';
    });
    const countEl = pageBody.querySelector('.java-prob-search-count');
    if (countEl) {
      countEl.textContent = q ? visible + ' match' + (visible === 1 ? '' : 'es') : '';
    }
  };

  toggle.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    searchOpen = !searchOpen;
    if (searchOpen) {
      bar.hidden = false;
      bar.removeAttribute('hidden');
      input.focus();
      if (searchQuery) input.value = searchQuery;
      applyFilter();
    } else {
      bar.hidden = true;
      input.value = '';
      searchQuery = '';
      applyFilter();
    }
  };

  if (clearBtn) {
    clearBtn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      searchQuery = '';
      searchOpen = false;
      bar.hidden = true;
      applyFilter();
    };
  }

  input.oninput = applyFilter;
  input.onkeydown = function (e) {
    if (e.key === 'Escape') {
      input.value = '';
      searchQuery = '';
      searchOpen = false;
      bar.hidden = true;
      applyFilter();
    }
  };

  if (searchOpen && searchQuery) {
    bar.hidden = false;
    input.value = searchQuery;
    applyFilter();
  }
}


function ensurePage() {
  if (problemsPage) return problemsPage;
  const backBtn = document.createElement('span');
  backBtn.className = 'icon arrow_back';
  backBtn.dataset.action = 'back';
  backBtn.style.cssText = 'pointer-events:auto;cursor:pointer;';
  const onBack = function (e) {
    try { e && e.preventDefault && e.preventDefault(); e && e.stopPropagation && e.stopPropagation(); } catch (_) {}
    hideProblemsPage();
  };
  backBtn.onclick = onBack;
  backBtn.addEventListener('click', onBack, true);
  backBtn.addEventListener('touchend', onBack, true);
  problemsPage = Page('Java Problems', { lead: backBtn });
  try {
    problemsPage.addEventListener('click', function (e) {
      if (e && e.target && e.target.closest && e.target.closest('[data-action="back"]')) onBack(e);
    });
  } catch (_) {}
  try {
    problemsPage.classList.add('java-problems-page');
  } catch (_) {}
  pageBody = document.createElement('div');
  pageBody.className = 'java-problems-body';
  try {
    problemsPage.appendBody(pageBody);
  } catch (_) {
    if (problemsPage.appendChild) problemsPage.appendChild(pageBody);
  }
  problemsPage.show = function () {
    try {
      if (actionStack && actionStack.has && actionStack.has(PAGE_STACK_ID)) {
        actionStack.remove(PAGE_STACK_ID);
      }
      actionStack.push({
        id: PAGE_STACK_ID,
        action: function () {
          hideProblemsPage();
        },
      });
    } catch (_) {}
    renderBody();
    try {
      if (typeof app !== 'undefined' && app.append) app.append(problemsPage);
      else document.body.appendChild(problemsPage);
    } catch (e) {
      console.error('[JavaProblems] append', e);
      toast('Could not open problems page');
    }
  };
  return problemsPage;
}

export function openProblemsPage() {
  try {
    const page = ensurePage();
    if (typeof page.show === 'function') page.show();
    else toast('Problems page error');
  } catch (e) {
    console.error('[JavaProblems] open', e);
    toast(String((e && e.message) || e));
  }
}

export function setProblemsSideButtonVisible(visible) {
  try {
    if (visible) sideButton && sideButton.show && sideButton.show();
    else sideButton && sideButton.hide && sideButton.hide();
  } catch (_) {}
}

export function registerProblemsUI() {
  if (getSettings().showProblemsSideButton === false) return;
  try {
    ensureSideButton();
    updateSideButtonBadge();
  } catch (e) {
    console.warn('[JavaProblems]', e);
  }
  if (!unsubscribe) {
    unsubscribe = subscribe(function () {
      updateSideButtonBadge();
      if (problemsPage && problemsPage.parentElement) renderBody();
    });
  }
  fileSwitchHandler = function () {
    updateSideButtonBadge();
  };
  try {
    if (editorManager && editorManager.on) editorManager.on('switch-file', fileSwitchHandler);
  } catch (_) {}
  fileSwitchHandler();
}

export function destroyProblemsUI() {
  try {
    if (fileSwitchHandler && editorManager && editorManager.off) {
      editorManager.off('switch-file', fileSwitchHandler);
    }
  } catch (_) {}
  try {
    if (unsubscribe) unsubscribe();
  } catch (_) {}
  try {
    hideProblemsPage();
  } catch (_) {}
  try {
    if (sideButton && sideButton.hide) sideButton.hide();
  } catch (_) {}
  sideButton = null;
  problemsPage = null;
  pageBody = null;
  unsubscribe = null;
  fileSwitchHandler = null;
}

export function openProblems() {
  openProblemsPage();
}
