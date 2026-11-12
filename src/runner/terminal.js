/**
 * runner/terminal.js — shared Java Run terminal (C++ makeActive pattern)
 */
const terminal = acode.require('terminal');
const toast = acode.require('toast');

const TERM_NAME = 'Java Run';
const STORAGE_KEY = 'acode.javatools.runTerminalId';
let sharedTerminalId = null;

export async function getSharedTerminal(name = TERM_NAME) {
  if (!terminal) throw new Error('terminal module missing');

  if (sharedTerminalId && terminal.get?.(sharedTerminalId)) {
    return terminal.get(sharedTerminalId);
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && terminal.get?.(saved)) {
      sharedTerminalId = saved;
      return terminal.get(saved);
    }
  } catch (_) {}

  try {
    const all = terminal.getAll?.();
    if (all) {
      for (const [id, info] of all.entries()) {
        if (info && (info.name === name || info.name === TERM_NAME || info.name === 'Java Run')) {
          sharedTerminalId = id;
          try {
            localStorage.setItem(STORAGE_KEY, String(id));
          } catch (_) {}
          return terminal.get(id);
        }
      }
    }
  } catch (_) {}

  const term = await terminal.create({ name: name || TERM_NAME });
  const id = term?.id || term;
  if (id) {
    sharedTerminalId = id;
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch (_) {}
  }
  return typeof term === 'object' ? term : terminal.get?.(id);
}

function activateTerminalTab(term) {
  try {
    term?.file?.makeActive?.();
  } catch (_) {}
  try {
    term?.show?.();
  } catch (_) {}
  try {
    // Some Acode builds expose terminal focus API
    if (sharedTerminalId && terminal.focus) terminal.focus(sharedTerminalId);
  } catch (_) {}
}

export async function writeToTerminal(script) {
  const term = await getSharedTerminal();
  if (!term) {
    toast('Could not open terminal', 2000);
    return null;
  }
  activateTerminalTab(term);
  await new Promise((r) => setTimeout(r, 350));

  const text = String(script || '').trim();
  if (!text) return term;
  const cmd = text.endsWith('\r') || text.endsWith('\n') ? text : text + '\r';
  try {
    if (sharedTerminalId && terminal.write) {
      terminal.write(sharedTerminalId, cmd);
    } else if (typeof term.write === 'function') {
      term.write(cmd);
    } else if (typeof term.input === 'function') {
      term.input(cmd);
    }
  } catch (e) {
    console.warn('[JavaTerm]', e);
    toast('Terminal write failed', 2000);
  }
  // Ensure tab stays active after write
  activateTerminalTab(term);
  return term;
}

export async function runInTerminal(bootstrapCmd, { clearScreen = true } = {}) {
  const term = await getSharedTerminal();
  if (!term?.id && !term) {
    toast('Could not open terminal', 2000);
    return;
  }
  activateTerminalTab(term);
  toast('Compiling & running…', 1500);
  await new Promise((r) => setTimeout(r, 350));

  const parts = [];
  if (clearScreen) parts.push(`printf '\\033[2J\\033[H' 2>/dev/null || true`);
  parts.push(bootstrapCmd);
  const full = parts.join(' && ');
  const cmd = full.endsWith('\r') || full.endsWith('\n') ? full : full + '\r';
  try {
    if (sharedTerminalId && terminal.write) {
      terminal.write(sharedTerminalId, cmd);
    } else if (typeof term.write === 'function') {
      term.write(cmd);
    } else if (typeof term.input === 'function') {
      term.input(cmd);
    }
  } catch (e) {
    console.error('[JavaTerm] run', e);
    toast('Terminal run failed', 2000);
  }
  activateTerminalTab(term);
}
