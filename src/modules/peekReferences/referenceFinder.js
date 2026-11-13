/**
 * referenceFinder.js — lexical "find all references" (pure functions, no DOM / acode).
 *
 * It tokenises the source once, skipping comments and string literals, and returns every
 * identifier token that equals the symbol. This is text-level (not semantic) but is exact
 * on token boundaries: `slots` never matches `slotsCount`, `$` / `_` are identifier chars,
 * and occurrences inside comments or strings are ignored.
 */
import { createProfile } from './languageProfiles.js';

function ensureProfile(profile) {
  return profile && profile.keywordSet ? profile : createProfile(profile || {});
}

/** Offsets of every line start (index 0 is always 0). */
export function buildLineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** 0-based line number containing `offset` (binary search over line starts). */
export function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function skipString(code, i, st) {
  const n = code.length;
  let j = i + st.open.length;
  while (j < n) {
    const c = code[j];
    if (st.escape && c === st.escape) {
      j += 2;
      continue;
    }
    // unterminated single-line string ends at EOL — keeps half-typed code from
    // swallowing the rest of the file while the user is typing
    if (!st.multiline && c === '\n') return j;
    if (code.startsWith(st.close, j)) return j + st.close.length;
    j++;
  }
  return n;
}

/**
 * Walk all identifier tokens that are real code.
 * `visit(from, to)` may return `false` to stop early.
 */
export function scanIdentifiers(code, profile, visit) {
  const p = ensureProfile(profile);
  const src = String(code || '');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];

    // line comments
    let handled = false;
    for (const lc of p.lineComments) {
      if (src.startsWith(lc.open, i) && !(lc.notFollowedBy && src.startsWith(lc.notFollowedBy, i + lc.open.length))) {
        const nl = src.indexOf('\n', i + lc.open.length);
        i = nl < 0 ? n : nl;
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // block comments
    for (const [open, close] of p.blockComments) {
      if (src.startsWith(open, i)) {
        const end = src.indexOf(close, i + open.length);
        i = end < 0 ? n : end + close.length;
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // strings / char literals
    for (const st of p.strings) {
      if (src.startsWith(st.open, i)) {
        i = skipString(src, i, st);
        handled = true;
        break;
      }
    }
    if (handled) continue;

    if (p.identStart.test(ch)) {
      let j = i + 1;
      while (j < n && p.identPart.test(src[j])) j++;
      if (visit(i, j) === false) return;
      i = j;
      continue;
    }

    // numeric literal: `1L`, `0x1F`, `1e5`, `2.5f` must not yield identifiers `L`, `x1F`...
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < n && p.numberPart.test(src[j])) j++;
      i = j;
      continue;
    }

    i++;
  }
}

/**
 * The identifier token under (or directly before) `offset`, ignoring comments/strings.
 * @returns {{ symbol: string, from: number, to: number, isKeyword: boolean } | null}
 */
export function symbolAt(code, offset, profile) {
  const p = ensureProfile(profile);
  const src = String(code || '');
  let found = null;
  scanIdentifiers(src, p, (from, to) => {
    if (from > offset) return false;
    if (offset >= from && offset <= to) {
      found = { symbol: src.slice(from, to), from, to };
      return false;
    }
    return undefined;
  });
  if (!found) return null;
  found.isKeyword = p.keywordSet.has(found.symbol);
  return found;
}

/** True when `text` is exactly one identifier token for this profile. */
export function isIdentifier(text, profile) {
  const p = ensureProfile(profile);
  const s = String(text || '');
  if (!s || !p.identStart.test(s[0])) return false;
  for (let i = 1; i < s.length; i++) if (!p.identPart.test(s[i])) return false;
  return true;
}

/**
 * All references of `symbol` in `code`, in document order.
 * @returns {Array<{ from, to, line, col, lineFrom, lineTo }>}  (line/col are 0-based)
 */
export function findReferences(code, symbol, profile, opts = {}) {
  const src = String(code || '');
  const sym = String(symbol || '');
  if (!sym) return [];
  const max = opts.max > 0 ? opts.max : 5000;
  const starts = buildLineIndex(src);
  const out = [];
  scanIdentifiers(src, profile, (from, to) => {
    if (to - from !== sym.length || !src.startsWith(sym, from)) return undefined;
    const line = lineAt(starts, from);
    const lineFrom = starts[line];
    let lineTo = line + 1 < starts.length ? starts[line + 1] - 1 : src.length;
    if (lineTo > lineFrom && src[lineTo - 1] === '\r') lineTo--;
    out.push({ from, to, line, col: from - lineFrom, lineFrom, lineTo });
    return out.length >= max ? false : undefined;
  });
  return out;
}

/**
 * Text of the reference's line split around the match, leading indentation removed and
 * very long lines windowed — this is what the right-hand list shows.
 * @returns {{ before: string, match: string, after: string }}
 */
export function buildPreview(code, ref, opts = {}) {
  const maxBefore = opts.maxBefore ?? 48;
  const maxAfter = opts.maxAfter ?? 120;
  const line = String(code || '').slice(ref.lineFrom, ref.lineTo);
  const lead = line.length - line.replace(/^\s+/, '').length;
  const mStart = Math.max(0, ref.from - ref.lineFrom - lead);
  const text = line.slice(lead);
  const mEnd = mStart + (ref.to - ref.from);
  let before = text.slice(0, mStart);
  let after = text.slice(mEnd);
  if (before.length > maxBefore) before = '…' + before.slice(before.length - maxBefore);
  if (after.length > maxAfter) after = after.slice(0, maxAfter) + '…';
  return { before, match: text.slice(mStart, mEnd), after };
}

/** Index of the reference to select first: the one at the cursor, else the next, else the last. */
export function pickActiveIndex(refs, offset) {
  if (!refs.length) return -1;
  for (let i = 0; i < refs.length; i++) {
    if (offset >= refs[i].from && offset <= refs[i].to) return i;
  }
  for (let i = 0; i < refs.length; i++) {
    if (refs[i].from >= offset) return i;
  }
  return refs.length - 1;
}
