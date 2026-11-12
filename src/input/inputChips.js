import { getSettings } from '../core/settings.js';
import { readActiveCode } from '../utils/javaFiles.js';
import { findLoops, getInnermostLoop, resolveLoopRounds, expandPattern } from './loopInput.js';

const prompt = acode.require('prompt');
const toast = acode.require('toast');
const select = acode.require('select');
const valueStore = new Map();
let promptOpen = false, compartment = null, refreshTimer = null, lastCodeSnapshot = '';

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
    let m = line.match(/(?:([\w.]+)\s+)?([A-Za-z_]\w*)\s*=\s*\w+\s*\.\s*(next\w*|readLine)\s*\(/);
    if (m) {
      const info = methodToType(m[3]);
      sites.push({
        line: i, kind: m[3], varName: m[2], dataType: m[1] || info.dataType,
        promptType: info.promptType, count: 1, loopRounds: 1,
        slots: [{ varName: m[2], dataType: m[1] || info.dataType, promptType: info.promptType }],
      });
      continue;
    }
    m = line.match(/\.\s*(next(?:Int|Long|Double|Float|Boolean|Line)?|readLine)\s*\(/);
    if (m) {
      const info = methodToType(m[1]);
      sites.push({
        line: i, kind: m[1], varName: 'input', dataType: info.dataType,
        promptType: info.promptType, count: 1, loopRounds: 1,
        slots: [{ varName: 'input', dataType: info.dataType, promptType: info.promptType }],
      });
    }
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
    if (pack) {
      for (const row of pack.data) lines.push((asSlotArray(row) || [''])[0]);
    } else {
      const a = asSlotArray(stored);
      lines.push(a ? a[0] : '');
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function clearChipsOnEdit() {
  if (getSettings().clearInputOnType === false) return;
  const key = fileKey(editorManager?.activeFile);
  if (valueStore.get(key)?.size) valueStore.set(key, new Map());
  scheduleRefresh();
}

async function openInputPrompt(site, key) {
  if (promptOpen) return;
  promptOpen = true;
  try {
    let rounds = site.loopRounds > 0 ? site.loopRounds : 1;
    if (site.loopUnknown || site.loopRounds === 0) {
      const asked = await prompt('Loop count', '5', 'number', { required: true });
      if (asked == null) return;
      rounds = Math.max(1, Math.min(getSettings().maxLoopInputs ?? 100, parseInt(String(asked), 10) || 1));
    }
    let mode = 'manual';
    if (rounds > 1) {
      mode = await select(`Loop ×${rounds}`, [
        ['manual', 'Each round'], ['same', 'Same value'], ['range', 'Range'], ['expr', 'Pattern'],
      ], { hideOnSelect: true });
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
      for (let r = 0; r < rounds; r++) {
        const v = await prompt(
          `${rounds > 1 ? `R${r + 1}/${rounds} · ` : ''}${slot.varName} · ${slot.dataType}`,
          '',
          slot.promptType === 'number' ? 'number' : 'text'
        );
        if (v == null) { if (r === 0) return; break; }
        data.push([String(v)]);
      }
    }
    if (!data.length) return;
    if (!valueStore.has(key)) valueStore.set(key, new Map());
    valueStore.get(key).set(site.line, data.length > 1 ? { rounds: data.length, data } : data[0]);
    toast(data.length > 1 ? `Saved ${data.length} rounds` : 'Input saved', 1200);
    scheduleRefresh();
  } finally {
    setTimeout(() => { promptOpen = false; }, 200);
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
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const now = Date.now();
        if (now - last < 320) { last = 0; openInputPrompt(this.site, key); }
        else last = now;
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
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshInputChips(); }, 50);
}

export function initInputChips() {
  lastCodeSnapshot = readActiveCode();
  scheduleRefresh();
  try { editorManager?.on?.('switch-file', () => scheduleRefresh()); } catch (_) {}
  try {
    editorManager?.editor?.on?.('change', () => {
      const code = readActiveCode();
      if (code !== lastCodeSnapshot) { lastCodeSnapshot = code; clearChipsOnEdit(); }
    });
  } catch (_) {}
}

export function destroyInputChips() {
  try {
    const editor = editorManager?.editor;
    if (editor?.dispatch && compartment) {
      editor.dispatch({ effects: compartment.reconfigure([]) });
    }
  } catch (_) {}
}
