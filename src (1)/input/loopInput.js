export function estimateForIterations(header) {
  const m = String(header || '').match(/for\s*\(([\s\S]*)\)/i);
  const body = m ? m[1] : header;
  const parts = String(body || '').split(';');
  if (parts.length < 2) return { iterations: null, unbounded: true, boundVar: null };
  const init = parts[0].trim();
  const cond = parts[1].trim();
  const initEq = init.match(/(?:int|long)?\s*([A-Za-z_]\w*)\s*=\s*(\d+)/);
  let start = initEq ? parseInt(initEq[2], 10) : null;
  let varName = initEq ? initEq[1] : null;
  let end = null, boundVar = null, op = null, inclusive = false;
  const condM = cond.match(/([A-Za-z_]\w*)\s*(<=|<|>|>=)\s*(\w+)/);
  if (condM) {
    varName = varName || condM[1];
    op = condM[2];
    inclusive = op === '<=' || op === '>=';
    if (/^\d+$/.test(condM[3])) end = parseInt(condM[3], 10);
    else boundVar = condM[3];
  }
  if (start == null || end == null) {
    return { iterations: null, unbounded: true, boundVar, varName, start, op, inclusive, est: null };
  }
  const last = inclusive ? end : end - 1;
  const count = last < start ? 0 : last - start + 1;
  return { iterations: count, unbounded: false, boundVar: null, varName, detail: `${varName}:${start}→${end}` };
}

export function findLoops(code) {
  const src = String(code || '');
  const lines = src.split('\n');
  const loops = [];
  for (let i = 0; i < lines.length; i++) {
    if (/\bfor\s*\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
      let end = i;
      let depth = 0;
      let seen = false;
      for (let j = i; j < lines.length; j++) {
        for (const c of lines[j]) {
          if (c === '{') { depth++; seen = true; }
          if (c === '}') depth--;
        }
        if (seen && depth <= 0) { end = j; break; }
        if (!seen && j > i && /;/.test(lines[j]) && !/\{/.test(lines.slice(i, j + 1).join('\n'))) {
          end = j; break;
        }
      }
      const header = lines[i].match(/for\s*\([^)]*\)/)?.[0] || lines[i];
      const est = estimateForIterations(header);
      loops.push({
        startLine: i, endLine: end, kind: 'for',
        iterations: est.iterations, unbounded: est.unbounded,
        boundVar: est.boundVar, detail: est.detail, est,
      });
    }
  }
  return loops;
}

export function getInnermostLoop(loops, line0) {
  let best = null;
  for (const L of loops) {
    if (line0 >= L.startLine && line0 <= L.endLine) {
      if (!best || L.endLine - L.startLine < best.endLine - best.startLine) best = L;
    }
  }
  return best;
}

export function resolveLoopRounds(loop, maxLoopInputs = 100, env = null) {
  const max = Math.max(1, Math.min(10000, maxLoopInputs | 0 || 100));
  if (!loop) return { rounds: 1, unknown: false };
  let iterations = loop.iterations;
  if (iterations == null && env && loop.est?.boundVar && env[loop.est.boundVar] != null) {
    const end = Number(env[loop.est.boundVar]);
    const start = loop.est.start ?? 0;
    const inclusive = !!loop.est.inclusive;
    if (Number.isFinite(end)) {
      const last = inclusive ? end : end - 1;
      iterations = Math.max(0, last - start + 1);
    }
  }
  if (iterations != null && Number.isFinite(iterations)) {
    const n = Math.floor(iterations);
    return n > max ? { rounds: max, capped: true, total: n } : { rounds: n, capped: false, total: n };
  }
  return { rounds: null, unknown: true, boundVar: loop.boundVar };
}

export function expandPattern(mode, opts, rounds) {
  const n = Math.max(0, rounds | 0);
  const out = [];
  if (mode === 'same') {
    for (let i = 0; i < n; i++) out.push(String(opts.value ?? ''));
    return out;
  }
  if (mode === 'range') {
    let cur = Number(opts.start) || 0;
    const step = Number(opts.step) || 1;
    const end = Number(opts.end);
    for (let i = 0; i < n; i++) {
      out.push(String(cur));
      const next = cur + step;
      if (Number.isFinite(end) && ((step > 0 && next > end) || (step < 0 && next < end))) {
        while (out.length < n) out.push(out[out.length - 1]);
        break;
      }
      cur = next;
    }
    return out;
  }
  if (mode === 'expr') {
    let cur = Number(opts.start) || 0;
    const om = String(opts.op || '+1').match(/^([+*\-\/])\s*([+-]?\d+)/);
    for (let i = 0; i < n; i++) {
      out.push(String(cur));
      if (!om) { cur += 1; continue; }
      const k = Number(om[2]);
      if (om[1] === '+') cur += k;
      else if (om[1] === '-') cur -= k;
      else if (om[1] === '*') cur *= k;
      else if (k) cur /= k;
    }
    return out;
  }
  return out;
}
