/**
 * settingsDefaults.js — single source of defaults for Java Tools
 */
export const defaultSettings = {
  pluginEnabled: true,
  autoSetupOnLoad: true,

  runMode: 'ask',
  runInClearScreen: true,
  enableInlineRunLogs: true,
  feedChipsInTerminal: false,
  termShowRunning: true,
  termShowSuccess: true,
  runShowTerminal: true,
  runToastResult: true,
  runPopupAutoHideMs: 5000,

  termShowCompileInfo: true,
  termShowFilePath: true,
  termShowCommand: true,
  termShowRunBanner: true,
  termShowTiming: true,
  termShowExitCode: true,

  popupShowCompileInfo: false,
  popupShowFilePath: false,
  popupShowCommand: false,
  popupShowRunBanner: false,
  popupShowTiming: false,
  popupShowExitCode: false,

  enableInputChips: true,
  blockRunWithoutInputs: true,
  clearInputOnType: true,
  maxLoopInputs: 100,
  chipPreviewValues: 5,

  enableLinter: 'both',
  errorTrigger: 'onKeypress', // same as C++ Tools (gcc lint on type)
  showProblemsSideButton: true,
  javacLintArgs: '-Xlint:all',

  lspMode: 'off',
  jdtlsPath: '',
  jdtlsArgs: '',
  enableHover: true,
  enableGoToDefinition: true,
  enableFindReferences: true,
  enableRename: true,
  enableLspCompletion: true,
  enableInlayHints: false,
  lspDiagnosticsUi: false,

  enableAutoImport: true,
  autoImportTrigger: 'manual',
  organizeImportsOnSave: false,
  enableSnippets: true,
  enableKeywords: true,
  enableIdentifiers: true,
  enableCustomSnippets: false,
  customSnippetPath: '',

  formatOnSave: false,
  javaFormatStyle: 'google',
  javaFormatCustom: '',
  formatterTool: 'clang-wasm',

  javaHome: '',
  javacPath: 'javac',
  javaPath: 'java',
  extraClasspath: '',
  mavenCacheDir: '',
  showToolsSideButton: true,
  runButtonPlacement: 'header',

  androidSdkPath: '',
  enableAndroidClasspath: false,
  showAndroidTools: false,

  dependenciesInstalled: false,

  // Phase 4 — installed Maven coordinates (JSON array of "g:a:v")
  mavenCoordinates: '[]',
};

