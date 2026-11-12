/**
 * importAnalysis.js — accurate import diagnostics (no fake suggestions)
 * 1 missing  2 unused  3 duplicate  4 ambiguous  5 star doesn't include subpackages
 * 6 static misuse  7 invalid only for known-wrong patterns (not invent FQNs)
 */
import { STD_TYPES, JAVA_LANG } from './stdlibMap.js';

function stripCommentsAndStrings(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

export function parseImportLines(code) {
  const lines = String(code || '').split('\n');
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/);
    if (m) {
      imports.push({
        line: i + 1,
        isStatic: !!m[1],
        name: m[2],
        simple: m[2].endsWith('.*') ? null : m[2].split('.').pop(),
        isStar: m[2].endsWith('.*'),
        packagePrefix: m[2].endsWith('.*') ? m[2].slice(0, -2) : m[2].split('.').slice(0, -1).join('.'),
        raw: lines[i].trim(),
      });
    }
  }
  return imports;
}

function collectTypeUses(code) {
  const s = stripCommentsAndStrings(code);
  // remove import/package lines influence
  const body = s.replace(/^\s*package\s+[\w.]+\s*;/m, ' ').replace(/^\s*import\s+[^;]+;/gm, ' ');
  const names = new Set();
  const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

function collectStaticMemberUses(code) {
  // e.g. Math.max already language; static import use is hard — skip aggressive
  return new Set();
}

/**
 * @returns {Array<{line,column,type,message,source}>}
 */
export function analyzeImports(code) {
  const problems = [];
  const imports = parseImportLines(code);
  const used = collectTypeUses(code);
  const lines = String(code || '').split('\n');

  // 3) Duplicate import
  const seen = new Map();
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    const key = (imp.isStatic ? 'static:' : '') + imp.name;
    if (seen.has(key)) {
      problems.push({
        line: imp.line,
        column: 1,
        type: 'warning',
        message: 'Duplicate import: ' + imp.name,
        source: 'import',
      });
    } else {
      seen.set(key, imp.line);
    }
  }

  // 4) Ambiguous — same simple name from two different FQNs
  const bySimple = new Map();
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (!imp.simple || imp.isStar) continue;
    if (!bySimple.has(imp.simple)) bySimple.set(imp.simple, []);
    bySimple.get(imp.simple).push(imp);
  }
  bySimple.forEach(function (list, simple) {
    if (list.length < 2) return;
    const fqns = [...new Set(list.map(function (x) { return x.name; }))];
    if (fqns.length < 2) return;
    if (!used.has(simple)) return; // only if used
    list.forEach(function (imp) {
      problems.push({
        line: imp.line,
        column: 1,
        type: 'error',
        message:
          'Ambiguous import for ' +
          simple +
          ': ' +
          fqns.join(' vs ') +
          ' — use fully-qualified name in code',
        source: 'import',
      });
    });
  });

  // 2) Unused import (conservative: only single-type imports, not star)
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (imp.isStar || imp.isStatic) continue;
    if (imp.simple && !used.has(imp.simple)) {
      problems.push({
        line: imp.line,
        column: 1,
        type: 'warning',
        message: 'Unused import: ' + imp.name,
        source: 'import',
      });
    }
  }

  // 5) Note about star imports — info only once
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (!imp.isStar) continue;
    problems.push({
      line: imp.line,
      column: 1,
      type: 'info',
      message:
        'Star import ' +
        imp.name +
        ' does not include subpackages (e.g. java.util.* ≠ java.util.concurrent.*)',
      source: 'import',
    });
  }

  // 6) Static import syntax: import static must have member or *
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (!imp.isStatic) continue;
    // import static java.lang.Math;  — invalid, needs Math.* or Math.max
    if (!imp.isStar && imp.name.split('.').length < 3) {
      problems.push({
        line: imp.line,
        column: 1,
        type: 'error',
        message: 'Invalid static import syntax: ' + imp.raw,
        source: 'import',
      });
    }
  }

  // 7) Invalid / non-existent — only flag if clearly not a valid Java identifier path
  //    OR known typo patterns — never invent "should be X"
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    const base = imp.name.replace(/\.\*$/, '');
    if (!/^([a-zA-Z_][\w]*\.)+[a-zA-Z_][\w]*$/.test(base) && !/^\*$/.test(imp.name)) {
      if (!/^([a-zA-Z_][\w]*\.)+[a-zA-Z_*][\w]*$/.test(imp.name)) {
        problems.push({
          line: imp.line,
          column: 1,
          type: 'error',
          message: 'Malformed import: ' + imp.raw,
          source: 'import',
        });
      }
    }
  }

  // 1) Missing import — only for types in STD_TYPES (not JAVA_LANG), not already imported
  const importedSimple = new Set();
  const importedFqns = new Set();
  const starPkgs = [];
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    if (imp.simple) importedSimple.add(imp.simple);
    importedFqns.add(imp.name);
    if (imp.isStar) starPkgs.push(imp.packagePrefix);
  }
  used.forEach(function (name) {
    if (JAVA_LANG.has(name)) return;
    const fqn = STD_TYPES[name];
    if (!fqn) return; // unknown type → do NOT guess
    if (importedSimple.has(name) || importedFqns.has(fqn)) return;
    // covered by star?
    const pkg = fqn.split('.').slice(0, -1).join('.');
    if (starPkgs.indexOf(pkg) >= 0) return;
    // find a use line for message location
    let line = 1;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp('\\b' + name + '\\b').test(lines[i]) && !/^\s*import\s+/.test(lines[i])) {
        line = i + 1;
        break;
      }
    }
    problems.push({
      line: line,
      column: 1,
      type: 'error',
      message: 'Missing import: ' + fqn + ' (' + name + ')',
      source: 'import',
      suggestImport: fqn,
    });
  });

  return problems;
}

/** Only suggest imports we know from STD_TYPES — never invent */
export function accurateMissingImports(code) {
  return analyzeImports(code)
    .filter(function (p) {
      return p.suggestImport;
    })
    .map(function (p) {
      return p.suggestImport;
    });
}
