const byFile = new Map();
const listeners = new Set();
function notify() { for (const fn of listeners) { try { fn(byFile); } catch (_) {} } }
export function setFileProblems(fileKey, problems) {
  const key = fileKey || 'untitled';
  if (!problems?.length) byFile.delete(key); else byFile.set(key, problems.slice());
  notify();
}
export function clearFileProblems(fileKey) { byFile.delete(fileKey || 'untitled'); notify(); }
export function clearAllProblems() { byFile.clear(); notify(); }
export function getAllProblems() { return byFile; }
export function getProblemCounts() {
  let errors = 0, warnings = 0;
  for (const list of byFile.values()) {
    for (const p of list) {
      if (p.type === 'error') errors++;
      else if (p.type === 'warning') warnings++;
    }
  }
  return { errors, warnings };
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
