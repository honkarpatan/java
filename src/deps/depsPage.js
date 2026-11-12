/**
 * deps/depsPage.js — JDK status + Maven search/install UI
 */
import { checkJdkAction, reinstallJdkAction } from './jdkChecker.js';
import {
  searchMaven,
  installMavenCoord,
  removeMavenCoord,
  jarPathForCoord,
  defaultCacheDir,
} from './mavenClient.js';
import { listInstalledCoordinates } from './classpath.js';
import { getSettings } from '../core/settings.js';

const Page = acode.require('page');
const actionStack = acode.require('actionStack');
const prompt = acode.require('prompt');
const toast = acode.require('toast');
const confirm = acode.require('confirm');

const STACK_ID = 'java-tools-deps-page';

function el(name, attrs = {}, children = []) {
  const n = document.createElement(name);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') n.className = v;
    else if (k === 'textContent') n.textContent = v;
    else if (k === 'style' && typeof v === 'string') n.setAttribute('style', v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function btn(label, onClick, primary) {
  const b = el('button', {
    type: 'button',
    className: primary ? 'java-deps-btn primary' : 'java-deps-btn',
    textContent: label,
  });
  b.onclick = (e) => {
    e.preventDefault();
    onClick();
  };
  return b;
}

export async function openDepsPage() {
  const back = el('span', {
    className: 'icon arrow_back',
    style: 'pointer-events:auto;cursor:pointer;',
  });
  back.dataset.action = 'back';
  const page = Page('Java Dependencies', { lead: back });
  try {
    page.classList.add('detail-settings-page', 'java-deps-page');
  } catch (_) {}
  const body = el('div', {
    className: 'main java-deps-body',
    style: 'overflow:hidden;height:100%;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;',
  });
  try {
    page.appendBody(body);
  } catch (_) {
    page.appendChild?.(body);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { actionStack.remove(STACK_ID); } catch (_) {}
    try { page.hide?.(); } catch (_) {}
    try { page.remove?.(); } catch (_) {}
    try {
      if (page.parentElement) page.parentElement.removeChild(page);
    } catch (_) {}
    try {
      // Acode global stack pop fallback
      if (actionStack?.pop && actionStack?.has?.(STACK_ID) === false) {
        /* already removed */
      }
    } catch (_) {}
  };
  const onBack = (e) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
    close();
  };
  back.onclick = onBack;
  back.addEventListener('click', onBack, true);
  back.addEventListener('touchend', onBack, true);
  try {
    page.onclick = (e) => {
      if (e?.target?.closest?.('[data-action="back"]')) onBack(e);
    };
  } catch (_) {}
  try {
    if (actionStack?.has?.(STACK_ID)) actionStack.remove(STACK_ID);
    actionStack.push({ id: STACK_ID, action: close });
  } catch (_) {}


  // Inject page styles (border-radius ≤ 3px)
  if (!document.getElementById('java-deps-style')) {
    const st = document.createElement('style');
    st.id = 'java-deps-style';
    st.textContent = `
.java-deps-page .java-deps-btn,
.java-deps-body .java-deps-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 6px 12px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(127,127,127,.4);
  border-radius: 3px !important;
  background: rgba(127,127,127,.12); color: inherit;
}
.java-deps-page .java-deps-btn.primary,
.java-deps-body .java-deps-btn.primary {
  background: rgba(33,150,243,.22);
  border-color: rgba(33,150,243,.55);
}
.java-deps-page input[type="search"],
.java-deps-body input[type="search"] {
  border-radius: 3px !important;
  padding: 8px 10px;
  border: 1px solid rgba(127,127,127,.35);
  background: transparent; color: inherit; font-size: 13px;
  flex: 1; min-width: 0;
}
.java-deps-status {
  font-size: 11px; white-space: pre-wrap; opacity: .85;
  margin: 0 0 10px; padding: 8px;
  border-radius: 3px !important;
  background: rgba(127,127,127,.12);
}
.java-deps-results {
  flex: 1 1 auto;
  min-height: 120px;
  max-height: 45vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.java-deps-results p, .java-deps-list p { font-size: 12px; opacity: .75; }
.java-deps-body { display: flex; flex-direction: column; overflow: hidden; }
`;
    document.head.appendChild(st);
  }

  // ── JDK section ──
  body.appendChild(el('h3', { textContent: 'JDK', style: 'margin:0 0 8px;font-size:15px;' }));
  const jdkStatus = el('pre', {
    className: 'java-deps-status',
    style: 'font-size:11px;white-space:pre-wrap;opacity:.85;margin:0 0 10px;padding:8px;border-radius:3px;background:rgba(127,127,127,.12);',
    textContent: 'Tap Check…',
  });
  body.appendChild(jdkStatus);
  const jdkRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;' });
  jdkRow.appendChild(
    btn('Check java / javac', async () => {
      jdkStatus.textContent = 'Checking…';
      const t = await checkJdkAction();
      jdkStatus.textContent = t || 'Failed';
    }, true)
  );
  jdkRow.appendChild(
    btn('Install OpenJDK', () => reinstallJdkAction())
  );
  body.appendChild(jdkRow);

  // ── Installed ──
  body.appendChild(el('h3', { textContent: 'Installed jars (Maven)', style: 'margin:0 0 8px;font-size:15px;' }));
  const listHost = el('div', { className: 'java-deps-list' });
  body.appendChild(listHost);

  function refreshInstalled() {
    listHost.innerHTML = '';
    const coords = listInstalledCoordinates();
    const cache = (getSettings().mavenCacheDir || '').trim() || defaultCacheDir();
    if (!coords.length) {
      listHost.appendChild(
        el('p', { textContent: 'None yet — search below to add.', style: 'opacity:.7;font-size:12px;' })
      );
      return;
    }
    for (const c of coords) {
      const row = el('div', {
        style:
          'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.2);',
      });
      const info = el('div', { style: 'flex:1;min-width:0;' });
      info.appendChild(el('div', { textContent: c, style: 'font-size:12px;font-weight:600;word-break:break-all;' }));
      info.appendChild(
        el('div', {
          textContent: jarPathForCoord(c, cache) || '',
          style: 'font-size:10px;opacity:.55;word-break:break-all;',
        })
      );
      row.appendChild(info);
      row.appendChild(
        btn('Remove', async () => {
          const ok = await confirm('Remove dependency?', c);
          if (!ok) return;
          await removeMavenCoord(c);
          toast('Removed', 1200);
          refreshInstalled();
        })
      );
      listHost.appendChild(row);
    }
  }
  refreshInstalled();

  // ── Search ──
  body.appendChild(el('h3', { textContent: 'Search Maven Central', style: 'margin:16px 0 8px;font-size:15px;' }));
  const searchRow = el('div', { style: 'display:flex;gap:8px;margin-bottom:10px;' });
  const input = el('input', {
    type: 'search',
    placeholder: 'e.g. guava, gson, org.json',
    style:
      'flex:1;padding:8px 10px;border-radius:3px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;',
  });
  const results = el('div', {
    className: 'java-deps-results',
    style: 'flex:1 1 auto;min-height:120px;max-height:45vh;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:8px;border:1px solid rgba(127,127,127,.2);border-radius:3px;padding:4px 8px;',
  });
  searchRow.appendChild(input);
  searchRow.appendChild(
    btn('Search', async () => {
      const q = input.value.trim();
      if (!q) return toast('Enter a query', 1200);
      results.innerHTML = '<p class="java-deps-searching" style="opacity:.7;font-size:12px">Searching…</p>';
      try {
        const docs = await searchMaven(q, 15);
        results.innerHTML = '';
        if (!docs.length) {
          results.appendChild(el('p', {
            textContent: 'No results (check network / Maven Central)',
            style: 'opacity:.7;font-size:12px;',
          }));
          return;
        }
        for (const d of docs) {
          const row = el('div', {
            style:
              'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15);',
          });
          row.appendChild(
            el('div', {
              textContent: d.text,
              style: 'flex:1;font-size:12px;word-break:break-all;',
            })
          );
          row.appendChild(
            btn('Add', async () => {
              toast('Downloading…', 1200);
              try {
                await installMavenCoord(d.text);
                toast('Installed ' + d.text, 2000);
                refreshInstalled();
              } catch (e) {
                toast(String(e?.message || e).slice(0, 140), 3000);
              }
            }, true)
          );
          results.appendChild(row);
        }
      } catch (e) {
        results.innerHTML = '';
        results.appendChild(el('p', {
          textContent: 'Search failed: ' + String(e?.message || e).slice(0, 120),
          style: 'opacity:.85;font-size:12px;color:#e57373;',
        }));
        toast('Search failed: ' + (e?.message || e), 2500);
      }
    }, true)
  );
  body.appendChild(searchRow);
  body.appendChild(
    btn('Add coordinate manually (g:a:v)', async () => {
      const c = await prompt('Maven coordinate', 'com.google.code.gson:gson:2.11.0', 'text', {
        required: true,
      });
      if (!c) return;
      try {
        toast('Downloading…', 1000);
        await installMavenCoord(c.trim());
        toast('Installed', 1500);
        refreshInstalled();
      } catch (e) {
        toast(String(e?.message || e).slice(0, 140), 3000);
      }
    })
  );
  body.appendChild(results);

  try {
    if (typeof app !== 'undefined' && app.append) app.append(page);
    else document.body.appendChild(page);
  } catch (e) {
    console.error('[DepsPage]', e);
    toast('Could not open deps page', 2000);
  }
}
