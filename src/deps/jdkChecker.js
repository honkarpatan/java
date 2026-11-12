/**
 * deps/jdkChecker.js — Verify java / javac (Phase 4)
 */
import { alpineExec, shellEscape } from '../utils/alpineExec.js';
import { getSettings } from '../core/settings.js';

const toast = acode.require('toast');
const confirm = acode.require('confirm');

export async function checkJdkAction() {
  const settings = getSettings();
  const java = settings.javaPath || 'java';
  const javac = settings.javacPath || 'javac';
  const home = String(settings.javaHome || '').trim();
  let prefix = '';
  if (home) {
    prefix = `export JAVA_HOME='${shellEscape(home)}'; export PATH="$JAVA_HOME/bin:$PATH"; `;
  }
  try {
    const out = await alpineExec(
      `${prefix}${shellEscape(java)} -version 2>&1; echo '---'; ${shellEscape(javac)} -version 2>&1; echo '---'; command -v java; command -v javac`
    );
    const text = String(out || '').trim() || '(empty)';
    console.log('[JavaDeps] JDK check\n', text);
    toast(text.split('\n').slice(0, 4).join(' · ').slice(0, 160), 4000);
    return text;
  } catch (e) {
    toast('JDK check failed: ' + (e?.message || e), 3000);
    return null;
  }
}

export async function reinstallJdkAction() {
  const ok = await confirm(
    'Install OpenJDK?',
    'Will try: apk add openjdk17 (Alpine) or pkg install openjdk-17 (Termux). Continue?'
  );
  if (!ok) return;
  toast('Installing OpenJDK… (may take a while)', 2500);
  const script = `#!/bin/sh
if command -v apk >/dev/null 2>&1; then
  apk add --no-cache openjdk17-jdk 2>&1 || apk add --no-cache openjdk11-jdk 2>&1
elif command -v pkg >/dev/null 2>&1; then
  pkg install -y openjdk-17 2>&1 || pkg install -y openjdk-21 2>&1
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update && apt-get install -y openjdk-17-jdk 2>&1
else
  echo NO_PKG_MANAGER
  exit 1
fi
java -version 2>&1
javac -version 2>&1
`;
  try {
    const { alpineExecScript } = await import('../utils/alpineExec.js');
    const out = await alpineExecScript(script);
    toast(String(out).slice(-200) || 'Done', 3500);
  } catch (e) {
    toast(String(e?.message || e), 3000);
  }
}

export async function uninstallHintAction() {
  toast('Uninstall manually: apk del openjdk17-jdk  |  pkg uninstall openjdk-17', 3500);
}
