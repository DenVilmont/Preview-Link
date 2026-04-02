(function(global) {
  if (global.PreviewI18n) return;

  const DEFAULT_LOCALE = 'en';
  const SUPPORTED_LOCALES = Object.freeze(['en', 'ru', 'es', 'zh_CN']);
  const LANGUAGE_SETTINGS = Object.freeze(['auto', ...SUPPORTED_LOCALES]);
  const DOCUMENT_LANG_MAP = Object.freeze({
    en: 'en',
    ru: 'ru',
    es: 'es',
    zh_CN: 'zh-CN'
  });
  const catalogPromiseCache = new Map();
  const translatorPromiseCache = new Map();

  function normalizeLanguageSetting(value) {
    return LANGUAGE_SETTINGS.includes(value) ? value : 'auto';
  }

  function normalizeUiLocale(value) {
    return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
  }

  function resolveSystemLocale(browserLocale) {
    const normalizedLocale = String(browserLocale || '')
      .trim()
      .replace(/-/g, '_')
      .toLowerCase();

    if (normalizedLocale === 'zh_cn') return 'zh_CN';
    if (normalizedLocale === 'en' || normalizedLocale.startsWith('en_')) return 'en';
    if (normalizedLocale === 'ru' || normalizedLocale.startsWith('ru_')) return 'ru';
    if (normalizedLocale === 'es' || normalizedLocale.startsWith('es_')) return 'es';
    return DEFAULT_LOCALE;
  }

  function getBrowserLocale() {
    if (global.chrome?.i18n?.getUILanguage) {
      return global.chrome.i18n.getUILanguage();
    }
    if (typeof navigator !== 'undefined') {
      return navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '') || DEFAULT_LOCALE;
    }
    return DEFAULT_LOCALE;
  }

  function resolveLocale(languageSetting, browserLocale) {
    const normalizedLanguageSetting = normalizeLanguageSetting(languageSetting);
    if (normalizedLanguageSetting !== 'auto') {
      return normalizedLanguageSetting;
    }
    return resolveSystemLocale(browserLocale || getBrowserLocale());
  }

  function substituteMessage(message, substitutions) {
    if (!Array.isArray(substitutions)) {
      substitutions = substitutions === undefined ? [] : [substitutions];
    }

    return String(message || '').replace(/\$([1-9]\d*)/g, (_, rawIndex) => {
      const substitution = substitutions[Number(rawIndex) - 1];
      return substitution === undefined || substitution === null ? '' : String(substitution);
    });
  }

  function getPlatformMessage(messageKey, substitutions = []) {
    if (!global.chrome?.i18n?.getMessage) {
      return '';
    }

    const normalizedSubstitutions = Array.isArray(substitutions)
      ? substitutions.map((value) => String(value))
      : substitutions === undefined
        ? []
        : [String(substitutions)];
    const message = global.chrome.i18n.getMessage(messageKey, normalizedSubstitutions);
    return typeof message === 'string' ? message : '';
  }

  function logCatalogLoadWarning(locale, error) {
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[Preview Link] Failed to load locale catalog "${locale}". Falling back gracefully.`, error);
  }

  async function loadCatalog(locale) {
    const normalizedLocale = normalizeUiLocale(locale);
    if (!catalogPromiseCache.has(normalizedLocale)) {
      const catalogUrl = global.chrome?.runtime?.getURL
        ? global.chrome.runtime.getURL(`_locales/${normalizedLocale}/messages.json`)
        : `./_locales/${normalizedLocale}/messages.json`;
      const catalogPromise = fetch(catalogUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load locale catalog: ${normalizedLocale}`);
          }
          return response.json();
        });
      catalogPromiseCache.set(normalizedLocale, catalogPromise);
    }
    return catalogPromiseCache.get(normalizedLocale).catch((error) => {
      catalogPromiseCache.delete(normalizedLocale);
      throw error;
    });
  }

  function getDocumentLang(locale) {
    return DOCUMENT_LANG_MAP[normalizeUiLocale(locale)] || DOCUMENT_LANG_MAP[DEFAULT_LOCALE];
  }

  function createFallbackUiI18n(settingsOrLanguage) {
    const requestedLanguage = typeof settingsOrLanguage === 'object'
      ? settingsOrLanguage?.language
      : settingsOrLanguage;
    const languageSetting = normalizeLanguageSetting(requestedLanguage);
    const locale = resolveLocale(languageSetting);
    return createTranslator(locale, languageSetting, {}, {});
  }

  function translateDescriptor(translator, descriptor) {
    if (!descriptor) return '';
    if (typeof descriptor === 'string') return descriptor;
    if (typeof descriptor.text === 'string') return descriptor.text;
    if (typeof descriptor.messageKey === 'string') {
      return translator.t(descriptor.messageKey, descriptor.substitutions || []);
    }
    return '';
  }

  function localizeElement(element, translator) {
    if (!element || typeof element.getAttribute !== 'function') return;

    const messageKey = element.getAttribute('data-i18n');
    if (messageKey) {
      element.textContent = translator.t(messageKey);
    }

    Array.from(element.attributes).forEach((attribute) => {
      if (!attribute.name.startsWith('data-i18n-') || attribute.name === 'data-i18n') return;
      const targetAttribute = attribute.name.slice('data-i18n-'.length);
      if (!targetAttribute) return;
      element.setAttribute(targetAttribute, translator.t(attribute.value));
    });
  }

  function applyToDocument(root, translator) {
    if (!root || !translator) return root;

    const elements = [];
    if (root.nodeType === 1 && root.attributes) {
      const hasTranslatedAttribute = Array.from(root.attributes).some((attribute) => {
        return attribute.name === 'data-i18n' || attribute.name.startsWith('data-i18n-');
      });
      if (hasTranslatedAttribute) {
        elements.push(root);
      }
    }

    if (typeof root.querySelectorAll === 'function') {
      elements.push(...root.querySelectorAll('[data-i18n], [data-i18n-aria-label], [data-i18n-title], [data-i18n-placeholder]'));
    }

    elements.forEach((element) => localizeElement(element, translator));

    if (typeof document !== 'undefined' && root === document) {
      document.documentElement.lang = getDocumentLang(translator.locale);
    }

    return root;
  }

  function createTranslator(locale, languageSetting, catalog, fallbackCatalog) {
    return {
      locale,
      languageSetting,
      t(messageKey, substitutions = []) {
        const entry = catalog[messageKey] || fallbackCatalog[messageKey];
        if (entry && typeof entry.message === 'string') {
          return substituteMessage(entry.message, substitutions);
        }
        return getPlatformMessage(messageKey, substitutions) || '';
      },
      tDescriptor(descriptor) {
        return translateDescriptor(this, descriptor);
      },
      apply(root = document) {
        return applyToDocument(root, this);
      }
    };
  }

  function getTranslatorCacheKey(languageSetting, locale) {
    return `${normalizeLanguageSetting(languageSetting)}::${normalizeUiLocale(locale)}`;
  }

  function readStoredLanguageSetting() {
    return new Promise((resolve) => {
      if (
        !global.chrome ||
        !global.chrome.storage ||
        !global.chrome.storage.local ||
        typeof global.chrome.storage.local.get !== 'function'
      ) {
        resolve('auto');
        return;
      }

      global.chrome.storage.local.get({ language: 'auto' }, (items) => {
        resolve(normalizeLanguageSetting(items?.language));
      });
    });
  }

  async function getUiI18n(settingsOrLanguage) {
    const requestedLanguage = typeof settingsOrLanguage === 'object'
      ? settingsOrLanguage?.language
      : settingsOrLanguage;
    const languageSetting = requestedLanguage
      ? normalizeLanguageSetting(requestedLanguage)
      : await readStoredLanguageSetting();
    const locale = resolveLocale(languageSetting);
    const cacheKey = getTranslatorCacheKey(languageSetting, locale);

    if (!translatorPromiseCache.has(cacheKey)) {
      const translatorPromise = Promise.allSettled([
        loadCatalog(locale),
        loadCatalog(DEFAULT_LOCALE)
      ]).then(([catalogResult, fallbackCatalogResult]) => {
        if (catalogResult.status === 'rejected') {
          logCatalogLoadWarning(locale, catalogResult.reason);
        }
        if (fallbackCatalogResult.status === 'rejected') {
          logCatalogLoadWarning(DEFAULT_LOCALE, fallbackCatalogResult.reason);
        }
        const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : {};
        const fallbackCatalog = fallbackCatalogResult.status === 'fulfilled' ? fallbackCatalogResult.value : {};
        return createTranslator(locale, languageSetting, catalog, fallbackCatalog);
      });
      translatorPromiseCache.set(cacheKey, translatorPromise);
    }

    return translatorPromiseCache.get(cacheKey);
  }

  global.PreviewI18n = {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    LANGUAGE_SETTINGS,
    normalizeLanguageSetting,
    resolveSystemLocale,
    resolveLocale,
    getUiI18n,
    createFallbackUiI18n,
    getDocumentLang
  };
})(globalThis);
