/**
 * runner/runButtonManager.js — Header tile play button (C++ pattern)
 * Visible only on .java files.
 */
import { getSettings } from '../core/settings.js';
import { isJavaFile } from '../utils/javaFiles.js';
import { runJava } from './javaRunner.js';

const toast = acode.require('toast');

class RunButtonManager {
  constructor() {
    this.checkFile = this.checkFile.bind(this);
    this.handleIconClick = this.handleIconClick.bind(this);
    this.removeBtnTimeout = null;
    this.sourceFile = null;
    this.$runBtn = null;
  }

  init() {
    this.setupPlayButton();
    try {
      editorManager.on('switch-file', this.checkFile);
      editorManager.on('rename-file', this.checkFile);
    } catch (_) {}
    this.checkFile();
  }

  setupPlayButton() {
    this.$runBtn = document.createElement('span');
    this.setButtonState('run');
    this.$runBtn.onclick = this.handleIconClick;
  }

  setButtonState(mode) {
    if (!this.$runBtn) return;
    if (mode === 'run') {
      this.$runBtn.className = 'icon play_arrow java-run-button';
      this.$runBtn.setAttribute('action', 'run-java');
      this.$runBtn.title = 'Compile & Run Java';
    } else if (mode === 'back') {
      this.$runBtn.className = 'icon arrow_back java-run-button';
      this.$runBtn.setAttribute('action', 'back-to-java');
      this.$runBtn.title = 'Back to Source Code';
    }
  }

  async handleIconClick() {
    const action = this.$runBtn?.getAttribute('action');
    if (action === 'run-java') {
      const fileToRun = editorManager.activeFile;
      if (!fileToRun || !isJavaFile(fileToRun)) {
        toast('Open a .java file', 1500);
        return;
      }
      this.sourceFile = fileToRun;
      try {
        if (fileToRun.isUnsaved && typeof fileToRun.save === 'function') {
          await fileToRun.save();
        }
        const settings = getSettings();
        await runJava({ mode: settings.runMode || 'ask' });
        setTimeout(() => this.checkFile(), 400);
      } catch (err) {
        console.error('[Java Run]', err);
        toast('Error executing code. Check console.', 2500);
      }
    } else if (action === 'back-to-java') {
      try {
        this.sourceFile?.makeActive?.();
      } catch (_) {}
    }
  }

  checkFile() {
    if (this.removeBtnTimeout) clearTimeout(this.removeBtnTimeout);

    const placement = getSettings().runButtonPlacement || 'header';
    if (placement === 'none') {
      if (this.$runBtn?.isConnected) this.$runBtn.remove();
      return;
    }

    const activeFile = editorManager?.activeFile;
    const javaOk = isJavaFile(activeFile);
    const isTerminalPage =
      activeFile &&
      (String(activeFile.filename || '').includes('Terminal') ||
        String(activeFile.uri || '').includes('terminal'));

    if (isTerminalPage && this.sourceFile) {
      this.setButtonState('back');
    } else if (javaOk) {
      this.setButtonState('run');
      this.sourceFile = activeFile;
    } else {
      this.removeBtnTimeout = setTimeout(() => {
        if (this.$runBtn?.isConnected) this.$runBtn.remove();
      }, 200);
    }

    if (
      this.$runBtn &&
      !this.$runBtn.isConnected &&
      (javaOk || (isTerminalPage && this.sourceFile))
    ) {
      const header = document.querySelector('#root > header.tile');
      if (header) {
        try {
          header.insertBefore(this.$runBtn, header.lastChild);
        } catch (_) {
          header.appendChild(this.$runBtn);
        }
      }
    }

    // Hide Acode default run on Java files so only our button shows
    setTimeout(() => {
      try {
        const mainHeaderRunBtn = document.querySelector(
          '#root > header.tile > span.icon.play_arrow[action="run"]'
        );
        if (mainHeaderRunBtn) {
          mainHeaderRunBtn.style.display =
            javaOk || (isTerminalPage && this.sourceFile) ? 'none' : '';
        }
      } catch (_) {}
    }, 100);
  }

  destroy() {
    if (this.removeBtnTimeout) clearTimeout(this.removeBtnTimeout);
    try {
      this.$runBtn?.remove?.();
    } catch (_) {}
    try {
      editorManager.off('switch-file', this.checkFile);
      editorManager.off('rename-file', this.checkFile);
    } catch (_) {}
    this.sourceFile = null;
    this.$runBtn = null;
  }
}

const runButtonManager = new RunButtonManager();
export default runButtonManager;
export { runButtonManager };
