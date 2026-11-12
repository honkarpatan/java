import { getSettings } from '../core/settings.js';
import { isJavaFile, readActiveCode, detectMainClass } from '../utils/javaFiles.js';
import { alpineExec, alpineExecScript, shellEscape, toBase64 } from '../utils/alpineExec.js';
import { runInTerminal } from './terminal.js';
import { showPopupOutput, hideBottomPopup, isErrorOutput } from './popupOutput.js';
import { showInlineRunOutput, clearInlineRunOutput } from './inlineRunOutput.js';
import {
  hasAllInputValues, getMissingInputCount, buildStdinPayload, findInputSites,
} from '../input/inputChips.js';
import { parseJavacOutput } from '../linter/javacLinter.js';
import { setFileProblems } from '../problems/problemsStore.js';
import { buildClasspathString } from '../deps/classpath.js';

const toast = acode.require('toast');
const select = acode.require('select');
const WORK = '/tmp/acode-java-tools/run';
let registered = false;

function checkInputsOrBlock(file, mode) {
  const settings = getSettings();
  if (settings.enableInputChips === false || settings.blockRunWithoutInputs === false) return true;
  if (mode === 'terminal') return true;
  const sites = findInputSites(readActiveCode());
  if (!sites.length) return true;
  if (hasAllInputValues(file)) return true;
  toast(`Missing ${getMissingInputCount(file)} input(s) — double-tap chips`, 2500);
  return false;
}

function buildClasspath(settings) {
  // Phase 4: extraClasspath + Maven cache jars + android.jar
  try {
    return buildClasspathString();
  } catch (_) {
    const parts = ['.'];
    for (const p of String(settings.extraClasspath || '').split(/[:;]/)) {
      if (p.trim()) parts.push(p.trim());
    }
    return parts.join(':');
  }
}

function createRunScript({ fileName, code, fqn, packageName, className, mode, stdinText, settings }) {
  const isInline = mode === 'inline';
  const isPopup = mode === 'popup';
  const isTerm = mode === 'terminal';
  const show = (tk, pk) => {
    if (isInline) return false;
    if (isPopup) return settings[pk] === true;
    return settings[tk] !== false;
  };
  // Terminal banners (user-toggleable)
  const showRunning = isTerm && settings.termShowRunning !== false;
  const showSuccess = isTerm && settings.termShowSuccess !== false;
  const javac = settings.javacPath || 'javac';
  const java = settings.javaPath || 'java';
  const cp = buildClasspath(settings);
  const safeName = String(fileName || 'Main.java').replace(/[^a-zA-Z0-9._-]/g, '_');
  const javaHome = String(settings.javaHome || '').trim();
  let script = '#!/bin/sh\nset +e\n';
  if (javaHome) {
    script += `export JAVA_HOME='${shellEscape(javaHome)}'\nexport PATH="$JAVA_HOME/bin:$PATH"\n`;
  }
  script += `WORKDIR='${WORK}'\nmkdir -p "$WORKDIR" && cd "$WORKDIR" || exit 1\n`;
  script += 'rm -rf classes 2>/dev/null; mkdir -p classes\n';
  if (packageName) {
    const dir = packageName.replace(/\./g, '/');
    script += `mkdir -p '${shellEscape(dir)}'\nSRC='${shellEscape(dir)}/${shellEscape(className)}.java'\n`;
  } else {
    script += `SRC='${shellEscape(safeName)}'\n`;
  }
  script += `echo '${toBase64(code)}' | base64 -d > "$SRC"\n`;
  if (stdinText) script += `echo '${toBase64(stdinText)}' | base64 -d > .stdin_payload\n`;
  script += 'START=$(date +%s 2>/dev/null || echo 0)\n';

  // ── Meta banners (popup / legacy toggles) — not used in new terminal layout ──
  if (!isTerm) {
    if (show('termShowCompileInfo', 'popupShowCompileInfo')) script += `echo "[compile] ${javac}"\n`;
    if (show('termShowFilePath', 'popupShowFilePath')) script += 'echo "[file] $SRC"\n';
    if (show('termShowCommand', 'popupShowCommand')) script += `echo "[cmd] ${javac} -d classes $SRC"\n`;
  }

  // Compile
  script += `${shellEscape(javac)} -d classes -cp '${shellEscape(cp)}' "$SRC"\n`;
  script += 'COMPILE=$?\n';
  script += 'if [ "$COMPILE" -ne 0 ]; then\n';
  if (isTerm && showSuccess) {
    script += '  END=$(date +%s 2>/dev/null || echo 0)\n';
    script += '  echo -e "\\033[1;31m[failed]\\033[0m  took $((END-START))s  exit $COMPILE"\n';
  } else if (!isTerm) {
    script += '  echo "[compile failed] exit=$COMPILE"\n';
  }
  if (!isTerm) script += '  echo JAVA_RUN_END\n';
  script += '  exit $COMPILE\n';
  script += 'fi\n';

  const runCp = `classes${cp && cp !== '.' ? ':' + cp : ''}`;
  const mainClass = fqn || className;
  const displayCmd = javac + ' -d classes && ' + java + ' -cp classes ' + mainClass;
  const safeDisplay = String(displayCmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  if (isTerm && showRunning) {
    // Blue square + [running] + pink/magenta command
    script += 'echo -e "\\033[1;34m■\\033[0m \\033[1;34m[running]\\033[0m \\033[1;35m' + safeDisplay + '\\033[0m"\n';
    } else if (!isTerm && show('termShowRunBanner', 'popupShowRunBanner')) {
    script += 'echo "[run]"\n';
  }

  // Program stdout — reset color only in interactive terminal (avoid [0m in popup capture)
  if (isTerm) script += 'echo -ne "\\033[0m"\n';
  if (stdinText) {
    script += `${shellEscape(java)} -cp '${shellEscape(runCp)}' '${shellEscape(mainClass)}' < .stdin_payload\n`;
  } else {
    script += `${shellEscape(java)} -cp '${shellEscape(runCp)}' '${shellEscape(mainClass)}'\n`;
  }
  script += 'EXIT=$?\nEND=$(date +%s 2>/dev/null || echo 0)\n';

  if (isTerm && showSuccess) {
    script += 'if [ "$EXIT" -eq 0 ]; then\n';
    script += '  echo -e "\n\\033[1;32m[success]\\033[0m  \\033[1;36m took $((END-START))s  exit $EXIT \\033[0m"\n';
    script += 'else\n';
    script += '  echo -e "\n\\033[1;31m[failed]\\033[0m  \\033[1;36m took $((END-START))s  exit $EXIT \\033[0m"\n';
    script += 'fi\n';
  } else if (!isTerm) {
    if (show('termShowTiming', 'popupShowTiming')) script += 'echo "[time] $((END-START))s"\n';
    if (show('termShowExitCode', 'popupShowExitCode')) script += 'echo "[exit $EXIT]"\n';
    script += 'echo JAVA_RUN_END\n';
  }
  script += 'exit $EXIT\n';
  return script;
}

async function runViaExecutor(script) {
  const outPath = `/tmp/acode_java_out_${Date.now()}.txt`;
  const inner = script.replace(/^#!\/bin\/sh\n/, '');
  const body = `#!/bin/sh\nOUTFILE='${outPath}'\n(\n${inner}\n) >"$OUTFILE" 2>&1 || true\ncat "$OUTFILE" 2>/dev/null || true\nexit 0\n`;
  let out = await alpineExecScript(body);
  if (!String(out || '').trim()) {
    out = await alpineExec(`cat '${outPath}' 2>/dev/null || echo '(empty output)'`);
  }
  return String(out || '');
}

function stripMeta(out) {
  return String(out || '')
    .replace(/\r\n/g, '\n')
    .replace(/JAVA_RUN_END[\s\S]*$/m, '')
    // full CSI sequences
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\([A-B]/g, '')
    // orphan fragments when ESC was lost: [0m  [1;32m
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, '')
    .replace(/^\s+/, '');
}

export async function runJava(opts = {}) {
  const settings = getSettings();
  if (settings.pluginEnabled === false) return toast('Java Tools disabled', 1500);
  const file = editorManager?.activeFile;
  if (!isJavaFile(file)) return toast('Open a .java file', 1500);

  let mode = opts.mode || settings.runMode || 'ask';
  if (mode === 'ask') {
    try {
      const choice = await select('Run Java', [
        ['terminal', 'Terminal'],
        ['popup', 'Popup'],
        ['inline', 'Inline logs'],
      ], { hideOnSelect: true });
      if (!choice) return;
      mode = choice;
    } catch (_) { return; }
  }
  if (!checkInputsOrBlock(file, mode)) return;

  const code = readActiveCode();
  const { packageName, className, fqn, hasMain } = detectMainClass(code);
  if (!className) return toast('No class found', 1800);
  if (!hasMain) toast(`No main() in ${className}`, 2000);

  // Input chips: only when enableInputChips — not a separate run mode
  let stdinText = '';
  if (settings.enableInputChips !== false) {
    if (mode === 'popup' || mode === 'inline' || (mode === 'terminal' && settings.feedChipsInTerminal)) {
      stdinText = buildStdinPayload(file) || '';
    }
  }
  // Legacy alias if something still passes inline-input
  if (mode === 'inline-input') mode = 'inline';

  const fileName = file.filename || file.name || `${className}.java`;
  const script = createRunScript({
    fileName, code, fqn, packageName, className, mode,
    stdinText: stdinText || null, settings,
  });

  clearInlineRunOutput();
  hideBottomPopup(false);

  try {
    if (mode === 'terminal') {
      // CRITICAL: do NOT use `echo b64 | base64 -d | sh`.
      // That attaches the script stream to sh's stdin; after the script is read,
      // stdin is EOF — so Java Scanner.hasNextLine() is immediately false.
      // Write the script to a file, then `sh file` so java inherits the real TTY.
      const runnerPath = `/tmp/acode_java_run_${Date.now()}.sh`;
      const bootstrap =
        `echo '${toBase64(script)}' | base64 -d > '${runnerPath}' ` +
        `&& chmod +x '${runnerPath}' ` +
        `&& sh '${runnerPath}'`;
      await runInTerminal(bootstrap, {
        clearScreen: settings.runInClearScreen !== false,
      });
      return toast('Running in terminal…', 1200);
    }
    toast('Compiling…', 800);
    const raw = await runViaExecutor(script);
    const out = stripMeta(raw);
    try {
      const probs = parseJavacOutput(raw, fileName);
      if (probs.length) setFileProblems(file.uri || fileName, probs);
    } catch (_) {}
    const err = isErrorOutput(raw) || /\[compile failed\]/.test(raw);
    if (mode === 'popup') {
      showPopupOutput('Java', out || '(no output)', { isError: err });
    } else {
      if (err) showPopupOutput('Java error', out, { isError: true });
      else {
        showInlineRunOutput(code, out);
        if (settings.runToastResult !== false) {
          toast(out.trim() ? 'Inline logs updated' : 'Run finished', 1500);
        }
      }
    }
  } catch (e) {
    console.error('[JavaRunner]', e);
    toast(String(e?.message || e).slice(0, 160), 3000);
    showPopupOutput('Java error', String(e?.message || e), { isError: true });
  }
}

export function registerRunner() {
  if (registered) return;
  registered = true;
  try {
    acode.require('commands')?.add?.({
      name: 'java-tools.run', description: 'Java: Run file', exec: () => runJava({}),
    });
  } catch (_) {}
}

export function unregisterRunner() {
  registered = false;
  try { acode.require('commands')?.remove?.('java-tools.run'); } catch (_) {}
  try { hideBottomPopup(false); clearInlineRunOutput(); } catch (_) {}
}
