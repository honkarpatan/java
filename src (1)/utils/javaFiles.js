const JAVA_EXT = /\.java$/i;

export function isJavaFile(file) {
  if (!file) return false;
  return JAVA_EXT.test(file.filename || file.name || '');
}

export function isJavaPath(path) {
  return JAVA_EXT.test(String(path || ''));
}

export function readActiveCode() {
  const editor = editorManager?.editor;
  if (!editor) return '';
  if (typeof editor.dispatch === 'function' && editor.state?.doc) {
    return editor.state.doc.toString();
  }
  if (editor.session?.getValue) return editor.session.getValue();
  return '';
}

export function detectMainClass(code) {
  const src = String(code || '');
  let packageName = '';
  const pkg = src.match(/^\s*package\s+([\w.]+)\s*;/m);
  if (pkg) packageName = pkg[1];
  let className = '';
  const pub = src.match(/public\s+class\s+(\w+)/);
  if (pub) className = pub[1];
  if (!className) {
    const any = src.match(/class\s+(\w+)/);
    if (any) className = any[1];
  }
  const hasMain = /public\s+static\s+void\s+main\s*\(\s*String\s*(?:\[\s*\]\s*\w+|\w+\s*\[\s*\])/.test(src);
  const fqn = packageName ? `${packageName}.${className}` : className;
  return { packageName, className, fqn, hasMain };
}
