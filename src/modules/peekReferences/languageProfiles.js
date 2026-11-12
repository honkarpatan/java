/**
 * languageProfiles.js — tiny lexical descriptions used by the reference finder.
 *
 * A profile only tells the scanner what is NOT code (comments / strings) and what an
 * identifier looks like, so references inside comments or string literals are ignored.
 * Pure data — no DOM, no `acode` — so it can be reused by any plugin (C++, PHP, ...).
 *
 * Profile shape:
 * {
 *   id: string,
 *   lineComments: Array<string | { open: string, notFollowedBy?: string }>,
 *   blockComments: Array<[open, close]>,
 *   strings: Array<{ open, close, escape?, multiline? }>,
 *   identStart: RegExp (single char), identPart: RegExp (single char),
 *   numberPart: RegExp (single char) — characters swallowed after a leading digit,
 *   keywords: string[]  — never treated as "symbols" when the cursor is on them
 * }
 */

const DEFAULTS = {
  id: 'generic',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  strings: [
    { open: '"', close: '"', escape: '\\' },
    { open: "'", close: "'", escape: '\\' },
  ],
  identStart: /[A-Za-z_$À-￿]/,
  identPart: /[A-Za-z0-9_$À-￿]/,
  numberPart: /[0-9A-Za-z_.]/,
  keywords: [],
};

/** Merge a partial profile with defaults and pre-sort what the scanner needs. */
export function createProfile(partial = {}) {
  const p = { ...DEFAULTS, ...partial };
  p.lineComments = (p.lineComments || []).map((c) => (typeof c === 'string' ? { open: c } : c));
  // longest opener first so `"""` wins over `"`
  p.strings = [...(p.strings || [])].sort((a, b) => b.open.length - a.open.length);
  p.keywordSet = new Set(p.keywords || []);
  return p;
}

export const JAVA_PROFILE = createProfile({
  id: 'java',
  strings: [
    { open: '"""', close: '"""', escape: '\\', multiline: true }, // text block
    { open: '"', close: '"', escape: '\\' },
    { open: "'", close: "'", escape: '\\' },
  ],
  keywords: [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
    'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
    'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
    'volatile', 'while', 'true', 'false', 'null',
  ],
});

export const CPP_PROFILE = createProfile({
  id: 'cpp',
  strings: [
    { open: 'R"(', close: ')"', multiline: true }, // raw string (no custom delimiter)
    { open: '"', close: '"', escape: '\\' },
    { open: "'", close: "'", escape: '\\' },
  ],
  numberPart: /[0-9A-Za-z_.']/, // digit separators: 1'000'000
  keywords: [
    'alignas', 'alignof', 'and', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class',
    'const', 'constexpr', 'continue', 'decltype', 'default', 'delete', 'do', 'double', 'else',
    'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if',
    'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'nullptr',
    'operator', 'or', 'private', 'protected', 'public', 'register', 'return', 'short', 'signed',
    'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef',
    'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while',
  ],
});

export const PHP_PROFILE = createProfile({
  id: 'php',
  lineComments: ['//', { open: '#', notFollowedBy: '[' }], // `#[Attribute]` is not a comment
  strings: [
    { open: '"', close: '"', escape: '\\', multiline: true },
    { open: "'", close: "'", escape: '\\', multiline: true },
    { open: '`', close: '`', escape: '\\', multiline: true },
  ],
  // `$name` is one token, so references to `$x` never match `x`
  keywords: [
    'abstract', 'and', 'array', 'as', 'break', 'case', 'catch', 'class', 'clone', 'const',
    'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare',
    'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'extends', 'final', 'finally',
    'fn', 'for', 'foreach', 'function', 'global', 'if', 'implements', 'include', 'include_once',
    'instanceof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print',
    'private', 'protected', 'public', 'require', 'require_once', 'return', 'static', 'switch',
    'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield', 'true', 'false',
    'null',
  ],
});

export const JAVASCRIPT_PROFILE = createProfile({
  id: 'javascript',
  strings: [
    { open: '"', close: '"', escape: '\\' },
    { open: "'", close: "'", escape: '\\' },
    { open: '`', close: '`', escape: '\\', multiline: true },
  ],
});

export const PROFILES = {
  java: JAVA_PROFILE,
  cpp: CPP_PROFILE,
  c: CPP_PROFILE,
  php: PHP_PROFILE,
  javascript: JAVASCRIPT_PROFILE,
};

export function getProfile(id) {
  return PROFILES[String(id || '').toLowerCase()] || createProfile({ id: String(id || 'generic') });
}
