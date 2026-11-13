export function shellEscape(s) {
  return String(s).replace(/'/g, `'\"'\"'`);
}

export function wrapSh(script) {
  const s = String(script || '').trim();
  if (!s) return "sh -c 'true'";
  if (/^sh\s+-c\s+/i.test(s)) return s;
  return `sh -c '${shellEscape(s)}'`;
}

function stripProotNoise(s) {
  return String(s || '')
    .split('\n')
    .filter((line) => !/proot warning:/i.test(line))
    .join('\n');
}

function normalizeOutput(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return stripProotNoise(raw);
  if (typeof raw === 'object') {
    const parts = [raw.stdout, raw.stderr, raw.output, raw.message]
      .filter((x) => x != null && x !== '')
      .map(String);
    if (parts.length) return stripProotNoise(parts.join('\n'));
    try { return stripProotNoise(JSON.stringify(raw)); } catch (_) { return stripProotNoise(String(raw)); }
  }
  return stripProotNoise(String(raw));
}

export function toBase64(str) {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch (_) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
}

export async function alpineExec(command) {
  const terminal = acode.require('terminal');
  const executor = window.Executor || terminal?.Executor || globalThis.Executor;
  if (!executor?.execute) {
    console.warn('[AlpineExec] Executor missing', {
      hasTerminal: !!terminal,
      hasWindowExec: !!window.Executor,
      hasGlobal: !!globalThis.Executor,
    });
    throw new Error('Executor API not available — open Terminal once to install Alpine');
  }
  try {
    const wrapped = wrapSh(command);
    console.log('[AlpineExec] run len=', wrapped.length);
    const raw = await executor.execute(wrapped, true);
    const out = normalizeOutput(raw);
    console.log('[AlpineExec] ok len=', out.length);
    return out;
  } catch (e) {
    const out = normalizeOutput(e) || (e && e.message) || String(e);
    console.warn('[AlpineExec] catch → output', String(out).slice(0, 200));
    return out;
  }
}

export async function alpineExecScript(scriptBody) {
  const b64 = toBase64(String(scriptBody || ''));
  return alpineExec(`echo '${shellEscape(b64)}' | base64 -d | sh`);
}
