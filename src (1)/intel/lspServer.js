/**
 * intel/lspServer.js — JDTLS registration (optional; default mode = off)
 */
import { getSettings } from '../core/settings.js';

const SERVER_ID = 'jdtls-java';

function dbg(...args) {
  try {
    console.log('[JavaLSP]', ...args);
  } catch (_) {}
}

export function registerJdtlsServer() {
  const settings = getSettings();
  const mode = settings.lspMode || 'off';
  dbg('register called mode=', mode, 'path=', settings.jdtlsPath || '(default jdtls)');

  let lsp = null;
  try {
    lsp = acode.require('lsp');
  } catch (e) {
    dbg('acode.require(lsp) threw', e);
  }

  if (!lsp) {
    dbg('LSP module null — Acode version may lack built-in LSP registry');
    return;
  }
  dbg('lsp keys=', Object.keys(lsp || {}).join(','));

  if (mode === 'off') {
    dbg('mode=off → unregister and skip (expected default)');
    try {
      lsp.servers?.unregister?.(SERVER_ID);
    } catch (e) {
      dbg('unregister on off failed', e);
    }
    return;
  }

  if (!lsp.defineServer) {
    dbg('defineServer missing — cannot register');
    return;
  }

  if (lsp.clientManager && settings.lspDiagnosticsUi === false) {
    try {
      lsp.clientManager.setOptions({ diagnosticsUiExtension: [] });
      dbg('diagnosticsUiExtension muted (plugin problems UI owns display)');
    } catch (e) {
      dbg('setOptions failed', e);
    }
  }

  const jdtlsPath = String(settings.jdtlsPath || '').trim();
  const command = jdtlsPath || 'jdtls';
  const args = String(settings.jdtlsArgs || '')
    .split(/\s+/)
    .filter(Boolean);

  try {
    const server = lsp.defineServer({
      id: SERVER_ID,
      label: 'Java (JDTLS)',
      languages: ['java'],
      useWorkspaceFolders: true,
      command,
      args,
      checkCommand: jdtlsPath
        ? `test -e "${jdtlsPath}" || command -v jdtls`
        : 'command -v jdtls',
    });
    dbg('defineServer ok', server?.id || SERVER_ID);
    lsp.upsert?.(server);
    dbg('upsert done mode=', mode, 'command=', command);
  } catch (e) {
    console.error('[JavaLSP] register failed', e);
    dbg('exception', e?.message || e);
  }
}

export function unregisterJdtlsServer() {
  dbg('unregister');
  try {
    acode.require('lsp')?.servers?.unregister?.(SERVER_ID);
  } catch (e) {
    dbg('unregister err', e);
  }
}

export function reconfigureJdtls() {
  unregisterJdtlsServer();
  registerJdtlsServer();
}
