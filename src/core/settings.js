/**
 * core/settings.js — Hub + category settings
 * NOTE: plugin.json lives at project root (Java/plugin.json), not under src/
 */
import plugin from '../../plugin.json';
import { defaultSettings } from './settingsDefaults.js';
import { hubList, openCategory, setPluginId } from './settingsPages.js';

const appSettings = acode.require('settings');

try {
  setPluginId(plugin.id);
} catch (_) {}

function ensureSettings() {
  let value = appSettings.value[plugin.id];
  if (!value || typeof value !== 'object') {
    value = { ...defaultSettings };
    appSettings.value[plugin.id] = value;
    appSettings.update(false);
    return value;
  }
  let dirty = false;
  for (const k of Object.keys(defaultSettings)) {
    if (value[k] === undefined) {
      value[k] = defaultSettings[k];
      dirty = true;
    }
  }
  if (dirty) appSettings.update(false);
  return value;
}

export function getSettings() {
  return ensureSettings();
}

export function updateSetting(key, val) {
  const s = ensureSettings();
  s[key] = val;
  appSettings.update();
}

export const settingsList = hubList();

export function onSettingsChange(key, value) {
  if (typeof key === 'string' && key.startsWith('__cat_')) {
    openCategory(key);
    return;
  }

  const s = ensureSettings();

  if (key === '__deps_page') {
    import('../deps/depsPage.js')
      .then((m) => m.openDepsPage?.())
      .catch((e) => console.warn('[JavaTools] deps page', e));
    return;
  }

  if (key === '__deps_check' || key === '__deps_reinstall' || key === '__deps_uninstall') {
    import('../deps/jdkChecker.js')
      .then((m) => {
        if (key === '__deps_check') return m.checkJdkAction?.();
        if (key === '__deps_reinstall') return m.reinstallJdkAction?.();
        return m.uninstallHintAction?.();
      })
      .catch((e) => console.warn('[JavaTools] deps action', e));
    return;
  }

  s[key] = value;
  appSettings.update();

  if (
    key === 'lspMode' ||
    key === 'jdtlsPath' ||
    key === 'jdtlsArgs' ||
    key === 'lspDiagnosticsUi'
  ) {
    import('../intel/lspServer.js')
      .then((m) => m.reconfigureJdtls?.())
      .catch(() => {});
  }

  if (key === 'showProblemsSideButton') {
    import('../problems/problemsPage.js')
      .then((m) => m.setProblemsSideButtonVisible?.(!!value))
      .catch(() => {});
  }

  if (key === 'showToolsSideButton') {
    import('../ui/toolsPanel.js')
      .then((m) => m.setToolsSideButtonVisible?.(!!value))
      .catch(() => {});
  }

  try {
    window.dispatchEvent(
      new CustomEvent('java-tools-settings', { detail: { key, value } })
    );
  } catch (_) {}
}
