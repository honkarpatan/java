// import { getSettings } from './settings.js';
// import { registerJdtlsServer, unregisterJdtlsServer } from '../intel/lspServer.js';
// import { registerGoToDefinition, unregisterGoToDefinition } from '../intel/goToDefinition.js';
// import { registerFindReferences, unregisterFindReferences } from '../intel/findReferences.js';
// import { registerLinter, unregisterLinter } from '../linter/javacLinter.js';
// import { registerProblemsUI, destroyProblemsUI } from '../problems/problemsPage.js';
// import { registerToolsPanel, unregisterToolsPanel } from '../ui/toolsPanel.js';
// import { registerRunner, unregisterRunner } from '../runner/javaRunner.js';
// import runButtonManager from '../runner/runButtonManager.js';
// import { registerCompleter, unregisterCompleter } from '../snippets/completer.js';
// import { initFormatter, destroyFormatter } from '../formatter/javaFormat.js';
// import { registerAutoImport, unregisterAutoImport } from '../autoImport/autoImport.js';
// import { initInputChips, destroyInputChips, scheduleRefresh as refreshInputChips } from '../input/inputChips.js';
// import { initInlineRunOutput, destroyInlineRunOutput } from '../runner/inlineRunOutput.js';
// import { isJavaFile } from '../utils/javaFiles.js';

// let baseUrl = '';
// let fileSwitchHandler = null;
// let settingsHandler = null;

// export async function initPlugin(_baseUrl) {
//   baseUrl = _baseUrl || '';
//   const settings = getSettings();
//   if (settings.pluginEnabled === false) {
//     console.log('[JavaTools] pluginEnabled=false');
//   }

//   const safe = (fn, name) => {
//     try { fn(); } catch (e) { console.warn('[JavaTools]', name, e); }
//   };

//   safe(registerProblemsUI, 'problems');
//   safe(registerToolsPanel, 'tools');
//   safe(() => registerRunner(baseUrl), 'runner');
//   safe(() => runButtonManager.init(), 'runButton');
//   safe(registerLinter, 'linter');
//   safe(registerCompleter, 'completer');
//   safe(() => initFormatter(baseUrl), 'formatter');
//   safe(registerAutoImport, 'autoImport');
//   safe(initInputChips, 'inputChips');
//   safe(initInlineRunOutput, 'inline');
//   safe(registerGoToDefinition, 'gotoDef');
//   safe(registerFindReferences, 'findRefs');
//   safe(registerJdtlsServer, 'jdtls');

//   fileSwitchHandler = () => {
//     try {
//       if (isJavaFile(editorManager?.activeFile)) refreshInputChips();
//     } catch (_) {}
//   };
//   try { editorManager?.on?.('switch-file', fileSwitchHandler); } catch (_) {}
//   setTimeout(fileSwitchHandler, 400);

//   settingsHandler = (ev) => {
//     const k = ev?.detail?.key || '';
//     if (k === 'lspMode' || k === 'jdtlsPath' || k === 'jdtlsArgs' || k === 'lspDiagnosticsUi') {
//       try { registerJdtlsServer(); } catch (_) {}
//     }
//   };
//   window.addEventListener('java-tools-settings', settingsHandler);
//   const s = getSettings();
//   console.log('[JavaTools] modules registered', {
//     enableLinter: s.enableLinter,
//     errorTrigger: s.errorTrigger,
//     lspMode: s.lspMode,
//     pluginEnabled: s.pluginEnabled,
//     javacPath: s.javacPath,
//   });
// }

// export function pauseFeatures() {}

// export function destroyPlugin() {
//   try { if (fileSwitchHandler) editorManager?.off?.('switch-file', fileSwitchHandler); } catch (_) {}
//   try { if (settingsHandler) window.removeEventListener('java-tools-settings', settingsHandler); } catch (_) {}
//   fileSwitchHandler = null;
//   settingsHandler = null;
//   for (const fn of [
//     unregisterJdtlsServer, unregisterGoToDefinition, unregisterFindReferences,
//     unregisterLinter, destroyProblemsUI, unregisterToolsPanel, unregisterRunner,
//     () => { try { runButtonManager.destroy(); } catch (_) {} },
//     unregisterCompleter, destroyFormatter, unregisterAutoImport,
//     destroyInputChips, destroyInlineRunOutput,
//   ]) {
//     try { fn(); } catch (_) {}
//   }
//   console.log('[JavaTools] destroyed');
// }

// export function getBaseUrl() { return baseUrl; }




// src/core/initPlugin.js
import { getSettings } from './settings.js';
import { registerJdtlsServer, unregisterJdtlsServer } from '../intel/lspServer.js';
import { registerGoToDefinition, unregisterGoToDefinition } from '../intel/goToDefinition.js';
import { registerFindReferences, unregisterFindReferences } from '../intel/findReferences.js';
import { registerLinter, unregisterLinter } from '../linter/javacLinter.js';
import { registerProblemsUI, destroyProblemsUI } from '../problems/problemsPage.js';
import { registerToolsPanel, unregisterToolsPanel } from '../ui/toolsPanel.js';
import { registerRunner, unregisterRunner } from '../runner/javaRunner.js';
import runButtonManager from '../runner/runButtonManager.js';
import { registerCompleter, unregisterCompleter } from '../snippets/completer.js';
import { initFormatter, destroyFormatter } from '../formatter/javaFormat.js';
import { registerAutoImport, unregisterAutoImport } from '../autoImport/autoImport.js';
import { initInputChips, destroyInputChips, scheduleRefresh as refreshInputChips } from '../input/inputChips.js';
import { initInlineRunOutput, destroyInlineRunOutput } from '../runner/inlineRunOutput.js';
import { isJavaFile } from '../utils/javaFiles.js';
// নতুন ইমপোর্ট
import { findReferences } from '../intel/findReferences.js';
import { registerReferencePeekModule, closeReferencePeek } from '../referencePeek/referencePeek.js';

let baseUrl = '';
let fileSwitchHandler = null;
let settingsHandler = null;

export async function initPlugin(_baseUrl) {
  baseUrl = _baseUrl || '';
  const settings = getSettings();
  if (settings.pluginEnabled === false) {
    console.log('[JavaTools] pluginEnabled=false');
  }

  const safe = (fn, name) => {
    try { fn(); } catch (e) { console.warn('[JavaTools]', name, e); }
  };

  safe(registerProblemsUI, 'problems');
  safe(registerToolsPanel, 'tools');
  safe(() => registerRunner(baseUrl), 'runner');
  safe(() => runButtonManager.init(), 'runButton');
  safe(registerLinter, 'linter');
  safe(registerCompleter, 'completer');
  safe(() => initFormatter(baseUrl), 'formatter');
  safe(registerAutoImport, 'autoImport');
  safe(initInputChips, 'inputChips');
  safe(initInlineRunOutput, 'inline');
  safe(registerGoToDefinition, 'gotoDef');
  safe(registerFindReferences, 'findRefs');
  safe(registerJdtlsServer, 'jdtls');
  // নতুন ফিচার ইনিশিয়ালাইজ
  safe(initJavaReferenceFeature, 'referencePeek');

  fileSwitchHandler = () => {
    try {
      if (isJavaFile(editorManager?.activeFile)) refreshInputChips();
    } catch (_) {}
  };
  try { editorManager?.on?.('switch-file', fileSwitchHandler); } catch (_) {}
  setTimeout(fileSwitchHandler, 400);

  settingsHandler = (ev) => {
    const k = ev?.detail?.key || '';
    if (k === 'lspMode' || k === 'jdtlsPath' || k === 'jdtlsArgs' || k === 'lspDiagnosticsUi') {
      try { registerJdtlsServer(); } catch (_) {}
    }
  };
  window.addEventListener('java-tools-settings', settingsHandler);
  const s = getSettings();
  console.log('[JavaTools] modules registered', {
    enableLinter: s.enableLinter,
    errorTrigger: s.errorTrigger,
    lspMode: s.lspMode,
    pluginEnabled: s.pluginEnabled,
    javacPath: s.javacPath,
  });
}

// নতুন ইনিশিয়ালাইজেশন ফাংশন
export async function initJavaReferenceFeature() {
  registerReferencePeekModule();

  const editor = window.editorManager?.editor;
  if (editor && editor.commands) {
    editor.commands.addCommand({
      name: "javaGoToReference",
      description: "Java: Go to Reference",
      bindKey: { win: "Shift-F12", mac: "Shift-F12" },
      exec: () => {
        const activeFile = window.editorManager?.activeFile;
        if (activeFile?.filename?.endsWith(".java")) {
          findReferences(editor);
        }
      },
    });
  }

  if (window.editorManager) {
    window.editorManager.on("switch-file", closeReferencePeek);
  }
}

export function pauseFeatures() {}

export function destroyPlugin() {
  try { if (fileSwitchHandler) editorManager?.off?.('switch-file', fileSwitchHandler); } catch (_) {}
  try { if (settingsHandler) window.removeEventListener('java-tools-settings', settingsHandler); } catch (_) {}
  fileSwitchHandler = null;
  settingsHandler = null;
  for (const fn of [
    unregisterJdtlsServer, unregisterGoToDefinition, unregisterFindReferences,
    unregisterLinter, destroyProblemsUI, unregisterToolsPanel, unregisterRunner,
    () => { try { runButtonManager.destroy(); } catch (_) {} },
    unregisterCompleter, destroyFormatter, unregisterAutoImport,
    destroyInputChips, destroyInlineRunOutput,
    destroyJavaReferenceFeature // নতুন ফাংশন
  ]) {
    try { fn(); } catch (_) {}
  }
  console.log('[JavaTools] destroyed');
}

// নতুন ডিস্ট্রয় ফাংশন
export function destroyJavaReferenceFeature() {
  closeReferencePeek();
  const editor = window.editorManager?.editor;
  if (editor && editor.commands) {
    editor.commands.removeCommand("javaGoToReference");
  }
  if (window.editorManager) {
    window.editorManager.off("switch-file", closeReferencePeek);
  }
}

export function getBaseUrl() { return baseUrl; }