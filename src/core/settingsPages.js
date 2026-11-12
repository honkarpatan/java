/**
 * core/settingsPages.js — Category settings UI (C++ Tools design)
 * Uses Acode theme CSS variables via ui/settings.css
 */
import { defaultSettings } from './settingsDefaults.js';

const Page = acode.require('page');
const actionStack = acode.require('actionStack');
const select = acode.require('select');
const prompt = acode.require('prompt');

let PLUGIN_ID = 'acode.plugin.javatools';
const PAGE_STACK_PREFIX = 'java-tools-settings-';

/** @type {HTMLElement|null} */
let activePage = null;
/** @type {string|null} */
let activeStackId = null;
/** @type {HTMLElement|null} */
let activeBody = null;
/** @type {(() => object[])|null} */
let activeListFn = null;

export function setPluginId(id) {
  if (id) PLUGIN_ID = id;
}

function store() {
  return acode.require('settings');
}

function getSettings() {
  const appSettings = store();
  let value = appSettings.value[PLUGIN_ID];
  if (!value || typeof value !== 'object') {
    value = { ...defaultSettings };
    appSettings.value[PLUGIN_ID] = value;
  }
  return value;
}

function updateSetting(key, val) {
  const appSettings = store();
  if (!appSettings.value[PLUGIN_ID]) {
    appSettings.value[PLUGIN_ID] = { ...defaultSettings };
  }
  appSettings.value[PLUGIN_ID][key] = val;
  appSettings.update();
}

function val(key) {
  const s = getSettings();
  return s[key] !== undefined ? s[key] : defaultSettings[key];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayValue(item) {
  const s = getSettings();
  if (item.checkbox) return !!s[item.key];
  if (item.select) {
    const cur = s[item.key] !== undefined ? s[item.key] : item.value;
    const opt = (item.select || []).find((o) => (Array.isArray(o) ? o[0] : o.value) === cur);
    if (!opt) return String(cur ?? '');
    return Array.isArray(opt) ? opt[1] : opt.text || opt.value;
  }
  const v = s[item.key] !== undefined ? s[item.key] : item.value;
  return v === '' || v == null ? '' : String(v);
}

function subCb(key, value) {
  updateSetting(key, value);
  if (activeBody && activeListFn) renderList(activeBody, activeListFn());
  try {
    window.dispatchEvent(new CustomEvent('java-tools-settings', { detail: { key, value } }));
  } catch (_) {}
}

function renderList(body, list) {
  const s = getSettings();
  let html = '<section class="settings-section"><div class="settings-section-card">';

  for (const item of list) {
    const key = item.key;
    const isCheck = !!item.checkbox;
    const isSelect = !!(item.select && Array.isArray(item.select));
    const isCat = typeof key === 'string' && key.startsWith('__cat_');
    const isAction =
      !!item.actionOnly ||
      (typeof key === 'string' && (key.startsWith('__deps_') || key.startsWith('__action_')));
    const checked = isCheck && !!s[key];
    const info = item.info
      ? `<small class="value setting-info">${escapeHtml(item.info)}</small>`
      : '';

    let classes = 'list-item no-leading-icon';
    if (item.info) classes += ' has-subtitle';
    if (isCheck) {
      /* switch only */
    } else if (isSelect) {
      classes += ' has-tail-value has-tail-select';
    } else {
      classes += ' has-tail-value';
    }

    let tail = '';
    if (isCheck) {
      tail = `<div class="setting-tail">
        <label class="input-checkbox switch">
          <input type="checkbox" data-key="${escapeHtml(key)}"${checked ? ' checked' : ''}>
          <span class="box"><span class="handle"></span></span>
        </label>
      </div>`;
    } else if (isSelect) {
      tail = `<div class="setting-tail">
        <div class="setting-value-display is-select">
          <small class="setting-trailing-value is-select">${escapeHtml(displayValue(item))}</small>
          <span class="icon keyboard_arrow_down setting-value-icon"></span>
        </div>
      </div>`;
    } else if (isCat || isAction) {
      tail = `<div class="setting-tail">
        <span class="icon keyboard_arrow_right settings-chevron"></span>
      </div>`;
    } else {
      tail = `<div class="setting-tail">
        <div class="setting-value-display">
          <small class="setting-trailing-value">${escapeHtml(displayValue(item))}</small>
        </div>
        <span class="icon keyboard_arrow_right settings-chevron"></span>
      </div>`;
    }

    const dataType = isCheck
      ? 'check'
      : isSelect
        ? 'select'
        : isCat
          ? 'cat'
          : isAction
            ? 'action'
            : 'prompt';

    html += `
      <div tabindex="0" data-key="${escapeHtml(key)}" data-type="${dataType}" data-action="list-item"
        class="${classes}" role="button">
        <span class="icon no-icon"></span>
        <div class="container">
          <div class="text">${escapeHtml(item.text || key)}</div>
          ${info}
        </div>
        ${tail}
      </div>`;
  }
  html += '</div></section>';
  body.innerHTML = html;

  body.querySelectorAll('.list-item[data-action="list-item"]').forEach((row) => {
    row.addEventListener('click', async (e) => {
      const key = row.getAttribute('data-key');
      const type = row.getAttribute('data-type');
      const item = list.find((x) => x.key === key);
      if (!item) return;

      if (type === 'check') {
        if (e.target.closest('label.input-checkbox')) return;
        if (e.target.matches('input[type="checkbox"]')) return;
        const input = row.querySelector('input[type="checkbox"]');
        if (input) {
          input.checked = !input.checked;
          subCb(key, !!input.checked);
        }
        return;
      }

      if (type === 'cat') {
        openCategory(key);
        return;
      }

      if (type === 'action') {
        if (key === '__deps_page') {
          import('../deps/depsPage.js').then((m) => m.openDepsPage?.()).catch((e) => console.warn(e));
          return;
        }
        if (key === '__deps_check') {
          import('../deps/jdkChecker.js').then((m) => m.checkJdkAction?.()).catch((e) => console.warn(e));
          return;
        }
        try {
          window.dispatchEvent(
            new CustomEvent('java-tools-settings', { detail: { key, value: true } })
          );
        } catch (_) {}
        return;
      }

      if (type === 'select' && item.select) {
        const choice = await select(item.text || key, item.select, {
          hideOnSelect: true,
          default: val(key),
        });
        if (choice != null) subCb(key, choice);
        return;
      }

      if (item.promptType || item.prompt) {
        const cur = val(key);
        const result = await prompt(
          item.prompt || item.text || key,
          cur == null ? '' : String(cur),
          item.promptType === 'number'
            ? 'number'
            : item.promptType === 'textarea'
              ? 'textarea'
              : 'text'
        );
        if (result != null) {
          let out = result;
          if (item.promptType === 'number') {
            const n = parseInt(String(result), 10);
            out = Number.isFinite(n) ? n : result;
          }
          subCb(key, out);
        }
      }
    });
  });

  body.querySelectorAll('label.input-checkbox input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      subCb(input.getAttribute('data-key'), !!input.checked);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });
}

function openPage(title, listFn, stackId) {
  const back = document.createElement('span');
  back.className = 'icon arrow_back';
  back.dataset.action = 'back';
  back.style.cssText = 'pointer-events:auto;cursor:pointer;';
  const page = Page(title, { lead: back });
  try {
    page.classList.add('detail-settings-page', 'java-tools-settings-page');
  } catch (_) {}
  const body = document.createElement('div');
  body.className = 'main java-tools-settings-body';
  body.style.cssText = 'overflow:auto;height:100%';
  try {
    page.appendBody(body);
  } catch (_) {
    page.appendChild?.(body);
  }

  const close = () => {
    try {
      page.hide?.();
      page.parentElement?.removeChild(page);
    } catch (_) {}
    try {
      actionStack.remove(stackId);
    } catch (_) {}
    if (activeStackId === stackId) {
      activePage = null;
      activeStackId = null;
      activeBody = null;
      activeListFn = null;
    }
  };

  const onBack = (e) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
    close();
  };
  back.onclick = onBack;
  back.addEventListener('click', onBack, true);
  back.addEventListener('touchend', onBack, true);
  try {
    if (actionStack?.has?.(stackId)) actionStack.remove(stackId);
    actionStack.push({ id: stackId, action: close });
  } catch (_) {}

  activePage = page;
  activeStackId = stackId;
  activeBody = body;
  activeListFn = listFn;
  renderList(body, listFn());

  try {
    if (typeof app !== 'undefined' && app.append) app.append(page);
    else document.body.appendChild(page);
  } catch (e) {
    console.error('[JavaSettings] append failed', e);
  }
}

export function openCategory(catKey) {
  const map = {
    __cat_runner: { title: 'Runner', list: runnerList },
    __cat_input: { title: 'Input chips & loops', list: inputList },
    __cat_linter: { title: 'Linter & problems', list: linterList },
    __cat_lsp: { title: 'LSP (JDTLS)', list: lspList },
    __cat_imports: { title: 'Imports & completion', list: importsList },
    __cat_formatter: { title: 'Formatter', list: formatterList },
    __cat_completion: { title: 'Completion & snippets', list: completionList },
    __cat_jdk: { title: 'JDK & packages', list: jdkList },
    __cat_android: { title: 'Android (optional)', list: androidList },
  };
  const entry = map[catKey];
  if (!entry) return;
  openPage(entry.title, entry.list, PAGE_STACK_PREFIX + catKey);
}

export function hubList() {
  return [
    { key: 'pluginEnabled', text: 'Enable Java Tools', checkbox: true, info: 'Master switch' },
    { key: '__cat_runner', text: 'Runner', value: '›', info: 'Run modes, terminal, popup, inline' },
    { key: '__cat_input', text: 'Input chips & loops', value: '›', info: 'Scanner chips, loop rounds' },
    { key: '__cat_linter', text: 'Linter & problems', value: '›' },
    { key: '__cat_lsp', text: 'LSP (JDTLS)', value: '›', info: 'Optional — uses RAM' },
    { key: '__cat_imports', text: 'Imports & completion', value: '›' },
    { key: '__cat_completion', text: 'Completion & snippets', value: '›' },
    { key: '__cat_formatter', text: 'Formatter', value: '›' },
    { key: '__cat_jdk', text: 'JDK & packages', value: '›' },
    { key: '__cat_android', text: 'Android (optional)', value: '›' },
  ];
}

function runnerList() {
  return [
    {
      key: 'runMode',
      text: 'Default run mode',
      value: val('runMode'),
      select: [
        ['ask', 'Always ask'],
        ['terminal', 'Terminal'],
        ['popup', 'Popup'],
        ['inline', 'Inline logs'],
      ],
      info: 'Chips controlled separately under Input chips',
    },
    { key: 'runInClearScreen', text: 'Clear terminal on run', checkbox: true },
    { key: 'enableInlineRunLogs', text: 'Show inline run logs', checkbox: true },
    { key: 'feedChipsInTerminal', text: 'Feed chip values in terminal', checkbox: true },
    { key: 'termShowRunning', text: 'Terminal: show [running] line', checkbox: true, info: 'Blue ■ [running] + pink command' },
    { key: 'termShowSuccess', text: 'Terminal: show [success]/[failed]', checkbox: true, info: 'Footer with time + exit code' },
    { key: 'termShowCompileInfo', text: 'Popup legacy: [compile]', checkbox: true },
    { key: 'termShowFilePath', text: 'Popup legacy: [file]', checkbox: true },
    { key: 'termShowCommand', text: 'Popup legacy: [cmd]', checkbox: true },
    { key: 'termShowRunBanner', text: 'Popup legacy: [run]', checkbox: true },
    { key: 'termShowTiming', text: 'Popup legacy: timing', checkbox: true },
    { key: 'termShowExitCode', text: 'Popup legacy: exit code', checkbox: true },
    { key: 'popupShowCompileInfo', text: 'Popup: show [compile]', checkbox: true },
    { key: 'popupShowFilePath', text: 'Popup: show [file]', checkbox: true },
    { key: 'popupShowCommand', text: 'Popup: show [cmd]', checkbox: true },
    { key: 'popupShowRunBanner', text: 'Popup: show [run]', checkbox: true },
    { key: 'popupShowTiming', text: 'Popup: show timing', checkbox: true },
    { key: 'popupShowExitCode', text: 'Popup: show exit code', checkbox: true },
  ];
}

function inputList() {
  return [
    { key: 'enableInputChips', text: 'Enable input chips', checkbox: true },
    { key: 'clearInputOnType', text: 'Clear input on type', checkbox: true },
    { key: 'maxLoopInputs', text: 'Max inputs in loop', value: val('maxLoopInputs'), promptType: 'number' },
    { key: 'chipPreviewValues', text: 'Chip preview value count', value: val('chipPreviewValues'), promptType: 'number' },
    { key: 'blockRunWithoutInputs', text: 'Block popup/inline if inputs missing', checkbox: true },
  ];
}

function linterList() {
  return [
    {
      key: 'enableLinter',
      text: 'Error UI mode',
      value: val('enableLinter'),
      select: [
        ['disable', 'Disable'],
        ['linter', 'Gutter'],
        ['inline', 'Inline'],
        ['both', 'Both'],
      ],
    },
    {
      key: 'errorTrigger',
      text: 'Lint trigger',
      value: val('errorTrigger'),
      select: [
        ['onSave', 'On save'],
        ['onKeypress', 'On type'],
        ['manual', 'Manual'],
      ],
    },
    { key: 'showProblemsSideButton', text: 'Show Problems side button', checkbox: true },
    { key: 'javacLintArgs', text: 'javac lint args', value: val('javacLintArgs'), promptType: 'text' },
  ];
}

function lspList() {
  return [
    {
      key: 'lspMode',
      text: 'LSP mode',
      value: val('lspMode'),
      select: [
        ['off', 'Off (low RAM)'],
        ['builtin', 'Acode built-in JDTLS'],
        ['external', 'External Language Client'],
      ],
    },
    { key: 'jdtlsPath', text: 'JDTLS path', value: val('jdtlsPath') || '(auto)', promptType: 'text' },
    { key: 'jdtlsArgs', text: 'JDTLS args', value: val('jdtlsArgs'), promptType: 'text' },
    { key: 'lspDiagnosticsUi', text: 'Show JDTLS diagnostics UI', checkbox: true },
    { key: 'enableLspCompletion', text: 'LSP completion', checkbox: true },
    { key: 'enableHover', text: 'Hover', checkbox: true },
    { key: 'enableGoToDefinition', text: 'Go to definition', checkbox: true },
    { key: 'enableFindReferences', text: 'Find references', checkbox: true },
    { key: 'enableRename', text: 'Rename', checkbox: true },
    { key: 'enableInlayHints', text: 'Inlay hints', checkbox: true },
  ];
}

function importsList() {
  return [
    { key: 'enableAutoImport', text: 'Enable auto-import', checkbox: true, info: 'Stdlib only — no invented FQNs' },
    {
      key: 'autoImportTrigger',
      text: 'Auto-import trigger',
      value: val('autoImportTrigger'),
      select: [
        ['manual', 'Manual'],
        ['onSave', 'On save'],
      ],
    },
    { key: 'organizeImportsOnSave', text: 'Organize imports on save', checkbox: true },
  ];
}

function completionList() {
  return [
    { key: 'enableSnippets', text: 'Builtin snippets', checkbox: true },
    { key: 'enableKeywords', text: 'Keywords', checkbox: true },
    { key: 'enableIdentifiers', text: 'File identifiers', checkbox: true },
    { key: 'enableCustomSnippets', text: 'Custom snippets file', checkbox: true, info: 'java_snippets.json in path below' },
    {
      key: 'customSnippetPath',
      text: 'Custom snippets folder',
      value: val('customSnippetPath') || '(unset)',
      promptType: 'text',
      info: 'Folder containing java_snippets.json',
    },
  ];
}

function formatterList() {
  return [
    { key: 'formatOnSave', text: 'Format on save', checkbox: true },
    {
      key: 'formatterTool',
      text: 'Formatter',
      value: val('formatterTool'),
      select: [
        ['clang-wasm', 'Enabled'],
        ['none', 'Disabled'],
      ],
    },
    {
      key: 'javaFormatStyle',
      text: 'Style',
      value: val('javaFormatStyle'),
      select: [
        ['Google', 'Google'],
        ['LLVM', 'LLVM'],
        ['Chromium', 'Chromium'],
        ['Microsoft', 'Microsoft'],
      ],
    },
    {
      key: 'javaFormatCustom',
      text: 'Custom style (optional)',
      value: val('javaFormatCustom') ? '(set)' : '(empty)',
      promptType: 'textarea',
    },
  ];
}

function jdkList() {
  return [
    { key: 'javaHome', text: 'JAVA_HOME', value: val('javaHome') || '(system)', promptType: 'text' },
    { key: 'javacPath', text: 'javac path', value: val('javacPath'), promptType: 'text' },
    { key: 'javaPath', text: 'java path', value: val('javaPath'), promptType: 'text' },
    { key: 'extraClasspath', text: 'Extra classpath', value: val('extraClasspath'), promptType: 'textarea' },
    { key: 'showToolsSideButton', text: 'Show Tools side button', checkbox: true },
    {
      key: 'runButtonPlacement',
      text: 'Run button',
      value: val('runButtonPlacement'),
      select: [
        ['header', 'Header'],
        ['side', 'Side'],
        ['none', 'Hidden'],
      ],
    },
    { key: '__deps_check', text: 'Check JDK / javac', value: '›' },
    { key: '__deps_page', text: 'Dependencies page (Maven…)', value: '›' },
  ];
}

function androidList() {
  return [
    { key: 'enableAndroidClasspath', text: 'Add android.jar to classpath', checkbox: true },
    { key: 'androidSdkPath', text: 'Android SDK path', value: val('androidSdkPath') || '(not set)', promptType: 'text' },
    { key: 'showAndroidTools', text: 'Show Android tools in menu', checkbox: true },
  ];
}
