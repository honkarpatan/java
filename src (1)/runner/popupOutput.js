import { getSettings } from '../core/settings.js';
const toast = acode.require('toast');
let bottomPopupEl = null, bottomPopupTimer = null, bottomPopupTouched = false, bottomPopupOutsideHandler = null;

export function hideBottomPopup(animate = true) {
  if (bottomPopupTimer) { clearTimeout(bottomPopupTimer); bottomPopupTimer = null; }
  if (bottomPopupOutsideHandler) {
    try {
      document.removeEventListener('pointerdown', bottomPopupOutsideHandler, true);
      document.removeEventListener('touchstart', bottomPopupOutsideHandler, true);
      document.removeEventListener('mousedown', bottomPopupOutsideHandler, true);
    } catch (_) {}
    bottomPopupOutsideHandler = null;
  }
  const el = bottomPopupEl;
  bottomPopupEl = null;
  if (!el) return;
  if (!animate) { el.remove(); return; }
  el.style.transform = 'translateY(110%)';
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 220);
}

export function isErrorOutput(text) {
  return /error:|cannot find symbol|compilation failed|Exception in thread|javac:/i.test(String(text || ''));
}

export function showPopupOutput(_title, text, opts = {}) {
  try {
    hideBottomPopup(false);
    const isError = !!opts.isError || isErrorOutput(text);
    const el = document.createElement('div');
    el.className = 'java-run-bottom-popup' + (isError ? ' is-error' : '');
    el.style.cssText = `position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;max-height:${isError ? 'min(42vh,280px)' : '150px'};overflow:auto;border-radius:3px;padding:10px 12px;background:var(--secondary-color,#1e1e1e);color:var(--popup-text-color,#eee);border:1px solid var(--border-color,rgba(255,255,255,.12));box-shadow:0 4px 20px rgba(0,0,0,.35);transform:translateY(110%);opacity:0;transition:transform .22s ease,opacity .22s ease;`;
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;font-family:ui-monospace,monospace;';
    for (const line of String(text || '').split('\n')) {
      const row = document.createElement('div');
      if (/error:/i.test(line)) row.style.color = '#ef5350';
      else if (/warning:/i.test(line)) row.style.color = '#ffb74d';
      row.textContent = line || ' ';
      pre.appendChild(row);
    }
    el.appendChild(pre);
    document.body.appendChild(el);
    bottomPopupEl = el;
    bottomPopupTouched = false;
    requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; el.style.opacity = '1'; });
    const mark = () => { bottomPopupTouched = true; if (bottomPopupTimer) { clearTimeout(bottomPopupTimer); bottomPopupTimer = null; } };
    el.addEventListener('pointerdown', mark, true);
    bottomPopupOutsideHandler = (e) => {
      if (!bottomPopupEl || bottomPopupEl.contains(e.target)) return;
      hideBottomPopup(true);
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', bottomPopupOutsideHandler, true);
      document.addEventListener('touchstart', bottomPopupOutsideHandler, true);
    }, 80);
    const hideMs = opts.hideMs ?? (isError ? 12000 : getSettings().runPopupAutoHideMs || 5000);
    bottomPopupTimer = setTimeout(() => { if (!bottomPopupTouched) hideBottomPopup(true); }, hideMs);
  } catch (e) {
    toast(String(text).slice(0, 180));
  }
}
