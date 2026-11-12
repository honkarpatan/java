import { getSettings } from '../core/settings.js';
import { readActiveCode } from '../utils/javaFiles.js';
import { findLoops, getInnermostLoop, resolveLoopRounds, expandPattern } from './loopInput.js';

const prompt = acode.require('prompt');
const toast = acode.require('toast');
const select = acode.require('select');
const valueStore = new Map();
let promptOpen = false, promptOpenedAt = 0, lastClosedAt = 0, compartment = null, chipUpdateCompartment = null, refreshTimer = null, clearValuesTimer = null, lastCodeSnapshot = '';

function fileKey(file) {
  return file?.uri || file?.filename || 'untitled';
}

function methodToType(method) {
  if (/nextInt|nextLong|nextShort|nextByte/.test(method)) return { dataType: 'int', promptType: 'number' };
  if (/nextDouble|nextFloat/.test(method)) return { dataType: 'double', promptType: 'number' };
  if (/nextLine|readLine/.test(method)) return { dataType: 'String', promptType: 'text' };
  return { dataType: 'value', promptType: 'text' };
}

export function findInputSites(code) {
  const lines = String(code || '').split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue;
    // Collect ALL scanner calls on this line (multi-input same line)
    const slots = [];
    const reAssign = /(?:([\w.]+)\s+)?([A-Za-z_]\w*)\s*=\s*\w+\s*\.\s*(next\w*|readLine)\s*\(/g;
    let m;
    while ((m = reAssign.exec(line)) !== null) {
      const info = methodToType(m[3]);
      slots.push({
        varName: m[2],
        dataType: m[1] || info.dataType,
        promptType: info.promptType,
        kind: m[3],
      });
    }
    if (!slots.length) {
      const reCall = /\.\s*(next(?:Int|Long|Double|Float|Boolean|Line|Byte|Short)?|readLine)\s*\(/g;
      while ((m = reCall.exec(line)) !== null) {
        const info = methodToType(m[1]);
        slots.push({
          varName: slots.length ? `input${slots.length + 1}` : 'input',
          dataType: info.dataType,
          promptType: info.promptType,
          kind: m[1],
        });
      }
    }
    if (!slots.length) continue;
    // One chip per line; multiple slots → multi-value prompt / stdin lines
    sites.push({
      line: i,
      kind: slots.map((s) => s.kind).join('+'),
      varName: slots.map((s) => s.varName).join(','),
      dataType: slots.map((s) => s.dataType).join(','),
      promptType: slots[0].promptType,
      count: slots.length,
      loopRounds: 1,
      slots,
    });
  }
  try {
    const loops = findLoops(code);
    const maxLoop = getSettings().maxLoopInputs ?? 100;
    for (const site of sites) {
      const loop = getInnermostLoop(loops, site.line);
      if (!loop) continue;
      const resolved = resolveLoopRounds(loop, maxLoop, {});
      site.loopRounds = resolved.rounds != null ? Math.max(1, resolved.rounds) : 0;
      site.loopUnknown = !!resolved.unknown;
      site.loopBoundVar = resolved.boundVar || loop.boundVar;
    }
  } catch (_) {}
  return sites;
}

function asSlotArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.some((x) => x == null || x === '') ? null : v.map(String);
  return String(v) ? [String(v)] : null;
}
function getLoopPackage(s) {
  if (s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.data)) {
    return { rounds: s.rounds || s.data.length, data: s.data };
  }
  return null;
}

export function hasAllInputValues(file) {
  const map = valueStore.get(fileKey(file || editorManager?.activeFile));
  const sites = findInputSites(readActiveCode());
  if (!sites.length) return true;
  if (!map) return false;
  return sites.every((s) => {
    const expected = s.loopRounds > 1 ? s.loopRounds : 1;
    const stored = map.get(s.line);
    const pack = getLoopPackage(stored);
    if (pack) return pack.data.length >= expected && pack.data.slice(0, expected).every((r) => asSlotArray(r));
    return expected <= 1 && !!asSlotArray(stored);
  });
}

export function getMissingInputCount(file) {
  const map = valueStore.get(fileKey(file || editorManager?.activeFile));
  let missing = 0;
  for (const s of findInputSites(readActiveCode())) {
    const expected = s.loopRounds > 1 ? s.loopRounds : 1;
    const stored = map?.get(s.line);
    const pack = getLoopPackage(stored);
    for (let r = 0; r < expected; r++) {
      if (!asSlotArray(pack ? pack.data[r] : r === 0 ? stored : null)) missing++;
    }
  }
  return missing;
}

export function buildStdinPayload(file) {
  const map = valueStore.get(fileKey(file || editorManager?.activeFile));
  const lines = [];
  for (const s of findInputSites(readActiveCode())) {
    const stored = map?.get(s.line);
    const pack = getLoopPackage(stored);
    const slotCount = Math.max(1, (s.slots || []).length);
    if (pack) {
      for (const row of pack.data) {
        const arr = asSlotArray(row) || [];
        for (let i = 0; i < slotCount; i++) lines.push(arr[i] != null ? arr[i] : '');
      }
    } else {
      const a = asSlotArray(stored) || [];
      // stored may be single value or array of slot values
      if (slotCount > 1) {
        for (let i = 0; i < slotCount; i++) lines.push(a[i] != null ? a[i] : '');
      } else {
        lines.push(a[0] != null ? a[0] : '');
      }
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function clearChipsOnEdit() {
  const settings = getSettings();
  const key = fileKey(editorManager?.activeFile);
  if (settings.clearInputOnType !== false) {
    const map = valueStore.get(key);
    if (map?.size) valueStore.set(key, new Map());
  }
  // Always refresh widgets so new/moved Scanner sites appear while typing
  scheduleRefresh();
}

function forceUnlockPrompt(opts = {}) {
  promptOpen = false;
  // only arm the "ignore next gesture" window when a dialog truly closed
  if (opts.markClosed) lastClosedAt = Date.now();
}

/** Acode select/prompt sometimes never resolves on dismiss — race with timeout. */
function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function openInputPrompt(site, key) {
  const now = Date.now();
  // In-flight only blocks briefly; after that we steal the lock and open again.
  if (promptOpen && now - promptOpenedAt < 400) return;
  if (!promptOpen && now - lastClosedAt < 250) return; // same gesture that closed UI

  promptOpen = true;
  promptOpenedAt = now;
  const unlock = () => forceUnlockPrompt({ markClosed: true });
  const watchdog = setTimeout(() => forceUnlockPrompt({ markClosed: true }), 15000);
  try {
    let rounds = site.loopRounds > 0 ? site.loopRounds : 1;
    if (site.loopUnknown || site.loopRounds === 0) {
      const asked = await withTimeout(
        prompt('Loop count', '5', 'number', { required: true }),
        120000,
        null
      );
      if (asked == null) return;
      rounds = Math.max(1, Math.min(getSettings().maxLoopInputs ?? 100, parseInt(String(asked), 10) || 1));
    }
    let mode = 'manual';
    if (rounds > 1) {
      mode = await withTimeout(
        select(`Loop ×${rounds}`, [
          ['manual', 'Each round'], ['same', 'Same value'], ['range', 'Range'], ['expr', 'Pattern'],
        ], { hideOnSelect: true }),
        120000,
        null
      );
      if (!mode) return;
    }
    const slot = site.slots[0];
    const data = [];
    const map = valueStore.get(key) || new Map();
    if (mode === 'same') {
      const v = await prompt(`${slot.varName} · ${slot.dataType}`, '', slot.promptType === 'number' ? 'number' : 'text');
      if (v == null) return;
      for (let i = 0; i < rounds; i++) data.push([String(v)]);
    } else if (mode === 'range' || mode === 'expr') {
      const start = await prompt('Start', '1', 'number', { required: true });
      if (start == null) return;
      let series;
      if (mode === 'range') {
        const end = await prompt('End', String(Number(start) + rounds - 1), 'number', { required: true });
        const step = await prompt('Step', '1', 'number', { required: true });
        if (end == null || step == null) return;
        series = expandPattern('range', { start, end, step }, rounds);
      } else {
        const op = await prompt('Op', '+1', 'text', { required: true });
        if (op == null) return;
        series = expandPattern('expr', { start, op }, rounds);
      }
      for (const v of series) data.push([String(v)]);
    } else {
      const allSlots = site.slots?.length ? site.slots : [slot];
      for (let r = 0; r < rounds; r++) {
        const row = [];
        for (const sl of allSlots) {
          const v = await prompt(
            `${rounds > 1 ? `R${r + 1}/${rounds} · ` : ''}${sl.varName} · ${sl.dataType}`,
            '',
            sl.promptType === 'number' ? 'number' : 'text'
          );
          if (v == null) { if (r === 0 && row.length === 0) return; break; }
          row.push(String(v));
        }
        if (row.length) data.push(row);
        else break;
      }
    }
    if (!data.length) return;
    if (!valueStore.has(key)) valueStore.set(key, new Map());
    valueStore.get(key).set(site.line, data.length > 1 ? { rounds: data.length, data } : data[0]);
    toast(data.length > 1 ? `Saved ${data.length} rounds` : 'Input saved', 1200);
    scheduleRefresh();
  } catch (e) {
    console.warn('[JavaChips] prompt error', e);
  } finally {
    clearTimeout(watchdog);
    unlock();
  }
}

function placeChipsCm6(editor, sites, key) {
  const cmView = acode.require('@codemirror/view');
  const cmState = acode.require('@codemirror/state');
  if (!cmView?.Decoration || !cmView?.WidgetType || !cmState?.Compartment) return false;
  if (!compartment) compartment = new cmState.Compartment();
  const map = valueStore.get(key) || new Map();
  class ChipWidget extends cmView.WidgetType {
    constructor(site, value) { super(); this.site = site; this.value = value; }
    eq(o) { return o instanceof ChipWidget && o.site.line === this.site.line && JSON.stringify(o.value) === JSON.stringify(this.value); }
    toDOM() {
      const el = document.createElement('span');
      const pack = getLoopPackage(this.value);
      const filled = !!(pack || asSlotArray(this.value));
      el.className = 'cm-java-input-chip' + (filled ? ' filled' : ' empty');
      el.textContent = pack
        ? `↻${pack.rounds}: ${(pack.data[0] || [])[0] || '…'}`
        : filled
          ? `in: ${asSlotArray(this.value)[0]}`
          : (this.site.loopRounds > 1 ? `↻${this.site.loopRounds} ▸` : 'input ▸');
      el.style.cssText = 'margin-left:0.45em;font-size:10px;padding:1px 6px;border-radius:10px;cursor:pointer;';
      let last = 0;
      const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openInputPrompt(this.site, key);
      };
      // Native dblclick (more reliable than 320ms heuristic after widget refresh)
      el.addEventListener('dblclick', open, true);
      // Keep tap-twice for touch devices where dblclick is flaky
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - last < 450) {
          last = 0;
          openInputPrompt(this.site, key);
        } else {
          last = now;
        }
      }, true);
      return el;
    }
    ignoreEvent() { return false; }
  }
  const ranges = [];
  const doc = editor.state.doc;
  for (const site of sites) {
    try {
      const line = doc.line(Math.min(site.line + 1, doc.lines));
      ranges.push(cmView.Decoration.widget({ widget: new ChipWidget(site, map.get(site.line)), side: 1 }).range(line.to));
    } catch (_) {}
  }
  ranges.sort((a, b) => a.from - b.from);
  const deco = cmView.EditorView.decorations.of(cmView.Decoration.set(ranges, true));
  try {
    const existing = compartment.get(editor.state);
    if (existing === undefined) {
      editor.dispatch({ effects: cmState.StateEffect.appendConfig.of(compartment.of(deco)) });
    } else {
      editor.dispatch({ effects: compartment.reconfigure(deco) });
    }
    return true;
  } catch (e) {
    console.warn('[JavaChips]', e);
    return false;
  }
}

export function refreshInputChips() {
  const settings = getSettings();
  const editor = editorManager?.editor;
  const file = editorManager?.activeFile;
  if (settings.enableInputChips === false || !file || !editor) return;
  const sites = findInputSites(readActiveCode());
  if (typeof editor.dispatch === 'function') placeChipsCm6(editor, sites, fileKey(file));
}



export function scheduleRefresh() {
  // Coalesce rapid keystrokes — always run after last edit (C++ pattern)
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshInputChips();
  }, 80);
}

function isEditorTypingTarget(target) {
  if (!target || !target.closest) return false;
  return !!(
    target.closest('.cm-content') ||
    target.closest('.cm-editor') ||
    target.closest('.ace_editor') ||
    target.closest('.ace_content') ||
    target.closest('[contenteditable="true"]')
  );
}

/** Debounced: on any doc change, clear values (if setting) + refresh chip widgets. */
function scheduleClearOnEdit() {
  if (clearValuesTimer) return;
  clearValuesTimer = setTimeout(() => {
    clearValuesTimer = null;
    const code = readActiveCode();
    if (lastCodeSnapshot && code === lastCodeSnapshot) return;
    lastCodeSnapshot = code;
    try {
      clearChipsOnEdit();
    } catch (_) {}
    // clearChipsOnEdit may no-op when clearInputOnType=false — still refresh sites
    scheduleRefresh();
  }, 0);
}

function onDocChange() {
  scheduleClearOnEdit();
}

/** CM6: fire on every document change (typing, paste, undo). */
function attachCm6ChipListener(editor) {
  if (!editor || typeof editor.dispatch !== 'function' || !editor.state?.doc) return;
  try {
    const cmView = acode.require('@codemirror/view');
    const cmState = acode.require('@codemirror/state');
    if (!cmView?.EditorView?.updateListener || !cmState?.Compartment) return;
    if (!chipUpdateCompartment) chipUpdateCompartment = new cmState.Compartment();
    const listener = cmView.EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChange();
    });
    const existing = chipUpdateCompartment.get(editor.state);
    if (existing === undefined) {
      editor.dispatch({
        effects: cmState.StateEffect.appendConfig.of(chipUpdateCompartment.of(listener)),
      });
    } else {
      editor.dispatch({ effects: chipUpdateCompartment.reconfigure(listener) });
    }
  } catch (e) {
    console.warn('[JavaChips] cm6 listener', e);
  }
}

let changeClearAttached = false;

export function initInputChips() {
  lastCodeSnapshot = readActiveCode();
  forceUnlockPrompt();
  scheduleRefresh();

  try {
    editorManager?.on?.('switch-file', () => {
      forceUnlockPrompt();
      lastCodeSnapshot = readActiveCode();
      scheduleRefresh();
      try {
        attachCm6ChipListener(editorManager?.editor);
      } catch (_) {}
    });
  } catch (_) {}

  try {
    editorManager?.on?.('file-loaded', () => {
      lastCodeSnapshot = readActiveCode();
      scheduleRefresh();
      try {
        attachCm6ChipListener(editorManager?.editor);
      } catch (_) {}
    });
  } catch (_) {}

  try {
    editorManager?.on?.('rename-file', () => scheduleRefresh());
  } catch (_) {}

  if (!changeClearAttached) {
    changeClearAttached = true;

    const docHandler = (e) => {
      if (isEditorTypingTarget(e.target)) onDocChange();
    };

    document.addEventListener('beforeinput', docHandler, true);
    document.addEventListener('input', docHandler, true);
    document.addEventListener(
      'keydown',
      (e) => {
        const k = e.key || '';
        if (
          k.length === 1 ||
          k === 'Backspace' ||
          k === 'Delete' ||
          k === 'Enter' ||
          k === 'Tab' ||
          (e.ctrlKey && (k === 'v' || k === 'x' || k === 'z')) ||
          (e.metaKey && (k === 'v' || k === 'x' || k === 'z'))
        ) {
          if (isEditorTypingTarget(e.target)) onDocChange();
        }
      },
      true
    );
    document.addEventListener('paste', docHandler, true);

    try {
      const editor = editorManager?.editor;
      if (editor?.session?.on) {
        editor.session.on('change', onDocChange);
        editor.session.on('changeScrollTop', () => scheduleRefresh());
      }
      if (typeof editor?.on === 'function') {
        editor.on('change', onDocChange);
      }
      attachCm6ChipListener(editor);
    } catch (_) {}

    window.addEventListener('scroll', () => scheduleRefresh(), true);
  } else {
    try {
      attachCm6ChipListener(editorManager?.editor);
    } catch (_) {}
  }

  scheduleRefresh();
}

export function destroyInputChips() {
  try {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  } catch (_) {}
  try {
    if (clearValuesTimer) clearTimeout(clearValuesTimer);
    clearValuesTimer = null;
  } catch (_) {}
  forceUnlockPrompt();
  try {
    const editor = editorManager?.editor;
    if (editor?.dispatch && compartment) {
      const cmState = acode.require('@codemirror/state');
      editor.dispatch({ effects: compartment.reconfigure([]) });
    }
  } catch (_) {}
}
