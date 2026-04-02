(function(global) {
  if (global.PreviewTheme) return;

  const VALID_THEME_MODES = Object.freeze(['light', 'dark', 'auto']);
  const DOCUMENT_THEME_FOUNDATION_CSS = `
body {
  margin: 0;
  font-family: "Segoe UI", Arial, sans-serif;
  background: var(--pl-bg);
  color: var(--pl-text);
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  border: 1px solid var(--pl-border);
  border-radius: 10px;
  background: var(--pl-button-bg);
  color: var(--pl-text);
}
`;
  const DOCUMENT_THEME_BOOTSTRAP_GUARD_CSS = `
html[data-pl-theme-pending="true"] body {
  opacity: 0;
}
`;
  const THEME_TOKENS = Object.freeze({
    light: Object.freeze({
      '--pl-accent': '#4f8cff',
      '--pl-accent-hover': '#3f7df3',
      '--pl-accent-soft': '#eef4ff',
      '--pl-accent-strong': '#1d4ed8',
      '--pl-bg': '#f6f8fc',
      '--pl-panel': '#ffffff',
      '--pl-panel-subtle': '#fcfdff',
      '--pl-border': '#d8e1f0',
      '--pl-border-strong': '#bcd1f7',
      '--pl-text': '#1f2937',
      '--pl-muted': '#5f6c80',
      '--pl-button-bg': '#ffffff',
      '--pl-button-bg-hover': '#f1f5fb',
      '--pl-button-bg-active': '#e3ebf9',
      '--pl-input-bg': '#ffffff',
      '--pl-switch-track': '#c9d3e8',
      '--pl-shadow-card': 'rgba(42, 83, 144, 0.08)',
      '--pl-shadow-overlay': 'rgba(42, 83, 144, 0.16)',
      '--pl-shadow-control': 'rgba(15, 23, 42, 0.08)',
      '--pl-danger': '#b63b23',
      '--pl-danger-border': '#edc0b7',
      '--pl-warning-bg': '#fff5ea',
      '--pl-warning-border': '#f4b266',
      '--pl-warning-text': '#714318',
      '--pl-notice-bg': '#eef4ff',
      '--pl-notice-border': '#bcd1f7',
      '--pl-notice-text': '#214b96',
      '--pl-preview-canvas': '#f4f6fa',
      '--pl-attention-border': '#ffd24d',
      '--pl-attention-ring': 'rgba(255, 210, 77, 0.55)',
      '--pl-loading-start': '#4f8cff',
      '--pl-loading-end': '#00e0c6',
      '--pl-resize-start': 'rgba(79, 140, 255, 0.85)',
      '--pl-resize-end': 'rgba(0, 224, 198, 0.85)',
      '--pl-topbar-bg': '#eaf2ff'
    }),
    dark: Object.freeze({
      '--pl-accent': '#7fb0ff',
      '--pl-accent-hover': '#5f96ef',
      '--pl-accent-soft': 'rgba(127, 176, 255, 0.14)',
      '--pl-accent-strong': '#c4dbff',
      '--pl-bg': '#0f1726',
      '--pl-panel': '#172033',
      '--pl-panel-subtle': '#1b2638',
      '--pl-border': '#2c3a55',
      '--pl-border-strong': '#36537f',
      '--pl-text': '#e5edf8',
      '--pl-muted': '#a9b8cf',
      '--pl-button-bg': '#1d2940',
      '--pl-button-bg-hover': '#223250',
      '--pl-button-bg-active': '#2b4066',
      '--pl-input-bg': '#111a2b',
      '--pl-switch-track': '#47556d',
      '--pl-shadow-card': 'rgba(15, 23, 42, 0.35)',
      '--pl-shadow-overlay': 'rgba(15, 23, 42, 0.42)',
      '--pl-shadow-control': 'rgba(15, 23, 42, 0.36)',
      '--pl-danger': '#ff9f8c',
      '--pl-danger-border': '#8f6258',
      '--pl-warning-bg': '#342513',
      '--pl-warning-border': '#8f6235',
      '--pl-warning-text': '#ffd7aa',
      '--pl-notice-bg': '#162742',
      '--pl-notice-border': '#36537f',
      '--pl-notice-text': '#c4dbff',
      '--pl-preview-canvas': '#f4f6fa',
      '--pl-attention-border': '#ffe082',
      '--pl-attention-ring': 'rgba(255, 224, 130, 0.34)',
      '--pl-loading-start': '#7fb0ff',
      '--pl-loading-end': '#34d3c7',
      '--pl-resize-start': 'rgba(127, 176, 255, 0.9)',
      '--pl-resize-end': 'rgba(52, 211, 199, 0.9)',
      '--pl-topbar-bg': '#13213a'
    })
  });

  function normalizeThemeMode(themeMode) {
    return VALID_THEME_MODES.includes(themeMode) ? themeMode : 'auto';
  }

  function getSystemTheme(mediaQueryList) {
    const systemThemeQuery = mediaQueryList && typeof mediaQueryList.matches === 'boolean'
      ? mediaQueryList
      : (typeof global.matchMedia === 'function'
        ? global.matchMedia('(prefers-color-scheme: dark)')
        : null);
    return systemThemeQuery && systemThemeQuery.matches ? 'dark' : 'light';
  }

  function resolveThemeMode(themeMode, mediaQueryList) {
    const normalizedThemeMode = normalizeThemeMode(themeMode);
    if (normalizedThemeMode !== 'auto') return normalizedThemeMode;
    return getSystemTheme(mediaQueryList);
  }

  function applyThemeMarker(target, themeMode, mediaQueryList) {
    const normalizedThemeMode = normalizeThemeMode(themeMode);
    const resolvedTheme = resolveThemeMode(normalizedThemeMode, mediaQueryList);
    if (!target) return resolvedTheme;

    if (target.dataset) {
      target.dataset.theme = resolvedTheme;
      return resolvedTheme;
    }

    if (typeof target.setAttribute === 'function') {
      target.setAttribute('data-theme', resolvedTheme);
    }

    return resolvedTheme;
  }

  function applyColorScheme(target, resolvedTheme) {
    if (!target || !target.style) return resolvedTheme || '';
    target.style.colorScheme = resolvedTheme || '';
    return resolvedTheme || '';
  }

  function serializeThemeTokens(tokens) {
    return Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join('\n');
  }

  function splitSelectorList(selector) {
    if (typeof selector !== 'string') return [];
    const selectors = [];
    let currentSelector = '';
    let parenDepth = 0;

    for (const char of selector) {
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')' && parenDepth > 0) {
        parenDepth -= 1;
      }

      if (char === ',' && parenDepth === 0) {
        if (currentSelector.trim()) selectors.push(currentSelector.trim());
        currentSelector = '';
        continue;
      }

      currentSelector += char;
    }

    if (currentSelector.trim()) selectors.push(currentSelector.trim());
    return selectors;
  }

  function buildDarkThemeSelectorPart(selectorPart) {
    if (selectorPart === ':host') {
      return ':host([data-theme="dark"])';
    }

    if (selectorPart.startsWith(':host(') && selectorPart.endsWith(')')) {
      const innerSelector = selectorPart.slice(6, -1).trim();
      return innerSelector
        ? `:host([data-theme="dark"]${innerSelector})`
        : ':host([data-theme="dark"])';
    }

    return `${selectorPart}[data-theme="dark"]`;
  }

  function buildDarkThemeSelector(selector) {
    const selectorParts = splitSelectorList(selector);
    if (!selectorParts.length) return '[data-theme="dark"]';
    return selectorParts.map(buildDarkThemeSelectorPart).join(', ');
  }

  function buildThemeTokenCss(selector) {
    return `${selector} {\n${serializeThemeTokens(THEME_TOKENS.light)}\n}\n\n${buildDarkThemeSelector(selector)} {\n${serializeThemeTokens(THEME_TOKENS.dark)}\n}`;
  }

  function ensureDocumentThemeTokens(options = {}) {
    if (typeof document === 'undefined') return null;
    const styleId = options.styleId || 'preview-link-theme-tokens';
    const selector = options.selector || ':root';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) return existingStyle;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = buildThemeTokenCss(selector);
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function ensureDocumentThemeFoundation(options = {}) {
    if (typeof document === 'undefined') return null;
    const styleId = options.styleId || 'preview-link-theme-foundation';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) return existingStyle;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = DOCUMENT_THEME_FOUNDATION_CSS;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function ensureDocumentThemeBootstrapGuard(options = {}) {
    if (typeof document === 'undefined') return null;
    const styleId = options.styleId || 'preview-link-theme-bootstrap-guard';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) return existingStyle;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = DOCUMENT_THEME_BOOTSTRAP_GUARD_CSS;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function readStoredThemeMode() {
    return new Promise((resolve) => {
      if (
        typeof global.chrome === 'undefined' ||
        !global.chrome.storage ||
        !global.chrome.storage.local ||
        typeof global.chrome.storage.local.get !== 'function'
      ) {
        resolve('auto');
        return;
      }

      global.chrome.storage.local.get(['themeMode'], (items) => {
        resolve(normalizeThemeMode(items && items.themeMode));
      });
    });
  }

  async function bootstrapDocumentTheme(options = {}) {
    if (typeof document === 'undefined') return 'light';
    const markerTarget = options.markerTarget || document.documentElement;
    const colorSchemeTarget = options.colorSchemeTarget || markerTarget;
    const applyDocumentColorScheme = options.applyColorScheme !== false;
    document.documentElement.dataset.plThemePending = 'true';

    try {
      const themeMode = await readStoredThemeMode();
      const resolvedTheme = applyThemeMarker(markerTarget, themeMode);
      if (applyDocumentColorScheme) {
        applyColorScheme(colorSchemeTarget, resolvedTheme);
      }
      return resolvedTheme;
    } finally {
      delete document.documentElement.dataset.plThemePending;
    }
  }

  function subscribeToSystemThemeChange(listener) {
    if (typeof listener !== 'function' || typeof global.matchMedia !== 'function') {
      return () => {};
    }

    const mediaQueryList = global.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      listener(getSystemTheme(mediaQueryList), mediaQueryList);
    };

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handler);
      return () => mediaQueryList.removeEventListener('change', handler);
    }

    if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handler);
      return () => mediaQueryList.removeListener(handler);
    }

    return () => {};
  }

  global.PreviewTheme = {
    THEME_TOKENS,
    normalizeThemeMode,
    getSystemTheme,
    resolveThemeMode,
    applyThemeMarker,
    applyColorScheme,
    buildThemeTokenCss,
    ensureDocumentThemeTokens,
    ensureDocumentThemeFoundation,
    ensureDocumentThemeBootstrapGuard,
    bootstrapDocumentTheme,
    subscribeToSystemThemeChange
  };

  if (
    typeof document !== 'undefined' &&
    document.currentScript &&
    document.currentScript.dataset.applyDocumentTokens === 'true'
  ) {
    ensureDocumentThemeTokens({
      styleId: document.currentScript.dataset.styleId || 'preview-link-theme-tokens',
      selector: document.currentScript.dataset.themeSelector || ':root'
    });
  }

  if (
    typeof document !== 'undefined' &&
    document.currentScript &&
    document.currentScript.dataset.applyDocumentFoundation === 'true'
  ) {
    ensureDocumentThemeFoundation({
      styleId: document.currentScript.dataset.foundationStyleId || 'preview-link-theme-foundation'
    });
  }

  if (
    typeof document !== 'undefined' &&
    document.currentScript &&
    document.currentScript.dataset.bootstrapDocumentTheme === 'true'
  ) {
    ensureDocumentThemeBootstrapGuard({
      styleId: document.currentScript.dataset.bootstrapGuardStyleId || 'preview-link-theme-bootstrap-guard'
    });
    bootstrapDocumentTheme();
  }
})(globalThis);
