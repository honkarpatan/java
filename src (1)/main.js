/**
 * main.js — Java Tools entry (webpack: src/main.js → dist/main.js)
 */
import plugin from '../plugin.json';
import { initPlugin, destroyPlugin } from './core/initPlugin.js';
import { getSettings, settingsList, onSettingsChange } from './core/settings.js';
import './ui/styles.css';
import './ui/settings.css';

if (window.acode) {
  acode.setPluginInit(
    plugin.id,
    async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
      console.log('[JavaTools] starting...');
      try {
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        await initPlugin(baseUrl, $page, { cacheFileUrl, cacheFile });
        console.log('[JavaTools] ✅ initialized');
      } catch (err) {
        console.error('[JavaTools] ❌ init failed:', err);
      }
    },
    {
      list: settingsList,
      cb: onSettingsChange,
    }
  );

  acode.setPluginUnmount(plugin.id, () => {
    console.log('[JavaTools] 🧹 unmounting...');
    try {
      destroyPlugin();
    } catch (e) {
      console.warn('[JavaTools] destroy error', e);
    }
  });
}
