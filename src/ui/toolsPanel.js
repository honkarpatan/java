import { getSettings } from '../core/settings.js';
import { isJavaFile } from '../utils/javaFiles.js';
import { addRelativePathComment, describeRelativePath } from '../utils/packageFromPath.js';
import { executeGoToDefinition } from '../intel/goToDefinition.js';
import { executeFindReferences } from '../intel/findReferences.js';
import { lintNow } from '../linter/javacLinter.js';
import { openProblems } from '../problems/problemsPage.js';

const SideButton = acode.require('sideButton');
const select = acode.require('select');
const toast = acode.require('toast');

let sideButton = null, fileSwitchHandler = null;

const TOOL_ACTIONS = [
  ['runFile', 'Run file (default mode)'],
  ['runTerminal', 'Run in terminal'],
  ['runPopup', 'Run · popup'],
  ['runInline', 'Run · inline logs'],
  ['lintNow', 'Lint now (javac + imports)'],
  ['format', 'Format document'],
  ['addRelativePath', 'Add relative path to Top'],
  ['organize', 'Organize imports'],
  ['autoImport', 'Auto import (stdlib only)'],
  ['gotoDef', 'Go to Definition'],
  ['findRefs', 'Go to References'],
  ['deps', 'Dependencies / JDK…'],
  ['problems', 'Open Problems'],
];

async function handleAction(id) {
  const modeMap = {
    runFile: null,
    runTerminal: 'terminal',
    runPopup: 'popup',
    runInline: 'inline',
  };
  if (id in modeMap) {
    try {
      const { runJava } = await import('../runner/javaRunner.js');
      await runJava({ mode: modeMap[id] });
    } catch (e) {
      toast('Runner: ' + (e?.message || e), 2000);
    }
    return;
  }
  if (id === 'lintNow') {
    try {
      await lintNow();
    } catch (e) {
      toast('Lint: ' + (e?.message || e), 2500);
    }
    return;
  }
  if (id === 'addRelativePath') {
    try {
      const info = describeRelativePath();
      console.log('[JavaTools] relative path', info);
      addRelativePathComment();
    } catch (e) {
      toast('Path: ' + (e?.message || e), 2000);
    }
    return;
  }
  if (id === 'format') {
    try {
      await (await import('../formatter/javaFormat.js')).formatDocument();
    } catch (e) {
      toast('Format: ' + (e?.message || e), 2000);
    }
    return;
  }
  if (id === 'organize' || id === 'autoImport') {
    try {
      const m = await import('../autoImport/autoImport.js');
      if (id === 'organize') await m.organizeImports?.();
      else await m.runAutoImport?.();
    } catch (e) {
      toast('Imports: ' + (e?.message || e), 2000);
    }
    return;
  }
  if (id === 'gotoDef') return executeGoToDefinition();
  if (id === 'findRefs') return executeFindReferences();
  if (id === 'deps') {
    try {
      const { openDepsPage } = await import('../deps/depsPage.js');
      await openDepsPage();
    } catch (e) {
      toast('Deps: ' + (e?.message || e), 2000);
    }
    return;
  }
  if (id === 'problems') openProblems();
}

async function openToolsMenu() {
  if (!isJavaFile(editorManager?.activeFile)) return toast('Open a .java file', 1200);
  try {
    const choice = await select('Java Tools', TOOL_ACTIONS, { hideOnSelect: true });
    if (choice) await handleAction(choice);
  } catch (_) {}
}

export function setToolsSideButtonVisible(visible) {
  try {
    visible ? sideButton?.show?.() : sideButton?.hide?.();
  } catch (_) {}
}

export function registerToolsPanel() {
  if (getSettings().showToolsSideButton === false) return;
  try {
    if (!sideButton && SideButton) {
      sideButton = SideButton({ text: 'Java Tools', icon: 'code', onclick: () => openToolsMenu() });
      sideButton.show();
    }
  } catch (e) {
    console.warn('[JavaTools] tools', e);
  }
  fileSwitchHandler = () => {
    setToolsSideButtonVisible(
      isJavaFile(editorManager?.activeFile) && getSettings().showToolsSideButton !== false
    );
  };
  try {
    editorManager?.on?.('switch-file', fileSwitchHandler);
  } catch (_) {}
  fileSwitchHandler();
}

export function unregisterToolsPanel() {
  try {
    if (fileSwitchHandler) editorManager?.off?.('switch-file', fileSwitchHandler);
  } catch (_) {}
  try {
    sideButton?.hide?.();
  } catch (_) {}
  sideButton = null;
  fileSwitchHandler = null;
}
