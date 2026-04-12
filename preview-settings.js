(function(global) {
  if (global.PreviewSettings) return;

  const {
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_PERCENT_MIN,
    POPUP_PERCENT_MAX,
    DEFAULT_POPUP_SIZE_UNIT,
    PREVIEW_SIZE_UNIT_DEFAULTS,
    normalizePreviewSizeSettings,
    isValidPopupSizeUnit,
    isValidPopupSizeValue
  } = global.PreviewSizeConfig;

  const HOVER_DELAY_MIN = 100;
  const HOVER_DELAY_MAX = 3000;
  const HOVER_DELAY_STEP = 100;
  const MAX_POPUPS_MIN = 1;
  const LEGACY_DEFAULT_MAX_POPUPS = 2;
  const SETTINGS_MODEL_VERSION = 1;
  const SETTINGS_MODEL_VERSION_KEY = 'settingsModelVersion';
  const INTERACTION_TYPES = Object.freeze(['hover', 'hoverWithKey']);
  const THEME_MODES = Object.freeze(['light', 'dark', 'auto']);
  const LANGUAGE_SETTINGS = Object.freeze(['auto', 'en', 'ru', 'es', 'zh_CN']);
  const TRIGGER_KEY_MESSAGE_KEYS = Object.freeze({
    Backquote: 'triggerKey_key_backquote',
    ArrowLeft: 'triggerKey_key_arrowLeft',
    ArrowRight: 'triggerKey_key_arrowRight',
    ArrowUp: 'triggerKey_key_arrowUp',
    ArrowDown: 'triggerKey_key_arrowDown',
    Escape: 'triggerKey_key_escape',
    Space: 'triggerKey_key_space',
    Enter: 'triggerKey_key_enter',
    Tab: 'triggerKey_key_tab',
    Backspace: 'triggerKey_key_backspace',
    ShiftLeft: 'triggerKey_key_shift',
    ShiftRight: 'triggerKey_key_shift',
    ControlLeft: 'triggerKey_key_control',
    ControlRight: 'triggerKey_key_control',
    AltLeft: 'triggerKey_key_alt',
    AltRight: 'triggerKey_key_alt',
    MetaLeft: 'triggerKey_key_meta',
    MetaRight: 'triggerKey_key_meta',
    Insert: 'triggerKey_key_insert',
    Delete: 'triggerKey_key_delete',
    Home: 'triggerKey_key_home',
    End: 'triggerKey_key_end',
    PageUp: 'triggerKey_key_pageUp',
    PageDown: 'triggerKey_key_pageDown',
    CapsLock: 'triggerKey_key_capsLock'
  });
  const CANONICAL_KEYS = Object.freeze([
    'enabled',
    'maxPopups',
    'hoverDelay',
    'interactionType',
    'triggerKey',
    'popupSizeUnit',
    'popupWidth',
    'popupHeight',
    'themeMode',
    'language',
    'readerModeSuggestions',
    'videoModeEnabled'
  ]);
  const LEGACY_KEYS = Object.freeze(['interactionKey']);
  const OBSOLETE_KEYS = Object.freeze(['aggressiveCompatibilityMode']);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    maxPopups: 5,
    hoverDelay: 2000,
    interactionType: 'hover',
    triggerKey: '',
    popupSizeUnit: DEFAULT_POPUP_SIZE_UNIT,
    popupWidth: PREVIEW_SIZE_UNIT_DEFAULTS.percent.width,
    popupHeight: PREVIEW_SIZE_UNIT_DEFAULTS.percent.height,
    themeMode: 'auto',
    language: 'auto',
    readerModeSuggestions: true,
    videoModeEnabled: true
  });

  function createMessageDescriptor(messageKey, substitutions = []) {
    return { messageKey, substitutions };
  }

  function cloneDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
  }

  function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function normalizeInteractionType(value) {
    if (value === 'button') return 'hoverWithKey';
    return INTERACTION_TYPES.includes(value) ? value : DEFAULT_SETTINGS.interactionType;
  }

  function normalizeTriggerKey(settings) {
    if (typeof settings.triggerKey === 'string') return settings.triggerKey;
    return typeof settings.interactionKey === 'string' ? settings.interactionKey : DEFAULT_SETTINGS.triggerKey;
  }

  function normalizeInteger(value, fallback, min, max) {
    if (!Number.isInteger(value)) return fallback;
    if (typeof min === 'number' && value < min) return fallback;
    if (typeof max === 'number' && value > max) return fallback;
    return value;
  }

  function normalizeThemeMode(value) {
    return THEME_MODES.includes(value) ? value : DEFAULT_SETTINGS.themeMode;
  }

  function normalizeLanguageSetting(value) {
    return LANGUAGE_SETTINGS.includes(value) ? value : DEFAULT_SETTINGS.language;
  }

  function normalizeSettings(rawSettings = {}) {
    const previewSizeSettings = normalizePreviewSizeSettings(rawSettings);
    const maxPopupsFallback = rawSettings[SETTINGS_MODEL_VERSION_KEY] === SETTINGS_MODEL_VERSION
      ? DEFAULT_SETTINGS.maxPopups
      : LEGACY_DEFAULT_MAX_POPUPS;
    return {
      enabled: normalizeBoolean(rawSettings.enabled, DEFAULT_SETTINGS.enabled),
      maxPopups: normalizeInteger(rawSettings.maxPopups, maxPopupsFallback, MAX_POPUPS_MIN),
      hoverDelay: normalizeInteger(rawSettings.hoverDelay, DEFAULT_SETTINGS.hoverDelay, HOVER_DELAY_MIN, HOVER_DELAY_MAX),
      interactionType: normalizeInteractionType(rawSettings.interactionType),
      triggerKey: normalizeTriggerKey(rawSettings),
      popupSizeUnit: previewSizeSettings.popupSizeUnit,
      popupWidth: previewSizeSettings.popupWidth,
      popupHeight: previewSizeSettings.popupHeight,
      themeMode: normalizeThemeMode(rawSettings.themeMode),
      language: normalizeLanguageSetting(rawSettings.language),
      readerModeSuggestions: normalizeBoolean(rawSettings.readerModeSuggestions, DEFAULT_SETTINGS.readerModeSuggestions),
      videoModeEnabled: normalizeBoolean(rawSettings.videoModeEnabled, DEFAULT_SETTINGS.videoModeEnabled)
    };
  }

  function getValidationErrors(candidateSettings = {}) {
    const errors = {};

    if (
      candidateSettings.interactionType !== undefined &&
      candidateSettings.interactionType !== 'button' &&
      !INTERACTION_TYPES.includes(candidateSettings.interactionType)
    ) {
      errors.interactionType = createMessageDescriptor('validation_interactionType_invalid');
    }

    if (
      candidateSettings.hoverDelay !== undefined &&
      !Number.isInteger(candidateSettings.hoverDelay)
    ) {
      errors.hoverDelay = createMessageDescriptor('validation_hoverDelay_range', [HOVER_DELAY_MIN, HOVER_DELAY_MAX]);
    } else if (
      candidateSettings.hoverDelay !== undefined &&
      (candidateSettings.hoverDelay < HOVER_DELAY_MIN || candidateSettings.hoverDelay > HOVER_DELAY_MAX)
    ) {
      errors.hoverDelay = createMessageDescriptor('validation_hoverDelay_range', [HOVER_DELAY_MIN, HOVER_DELAY_MAX]);
    }

    if (
      candidateSettings.maxPopups !== undefined &&
      (!Number.isInteger(candidateSettings.maxPopups) || candidateSettings.maxPopups < MAX_POPUPS_MIN)
    ) {
      errors.maxPopups = createMessageDescriptor('validation_maxPopups_min', [MAX_POPUPS_MIN]);
    }

    if (
      candidateSettings.popupSizeUnit !== undefined &&
      !isValidPopupSizeUnit(candidateSettings.popupSizeUnit)
    ) {
      errors.popupSizeUnit = createMessageDescriptor('validation_popupSizeUnit_invalid');
    }

    const popupSizeUnit = isValidPopupSizeUnit(candidateSettings.popupSizeUnit)
      ? candidateSettings.popupSizeUnit
      : DEFAULT_SETTINGS.popupSizeUnit;

    if (
      candidateSettings.popupWidth !== undefined &&
      !isValidPopupSizeValue(popupSizeUnit, 'width', candidateSettings.popupWidth)
    ) {
      errors.popupWidth = popupSizeUnit === 'px'
        ? createMessageDescriptor('validation_popupWidth_min_px', [POPUP_MIN_WIDTH])
        : createMessageDescriptor('validation_popupWidth_range_percent', [POPUP_PERCENT_MIN, POPUP_PERCENT_MAX]);
    }

    if (
      candidateSettings.popupHeight !== undefined &&
      !isValidPopupSizeValue(popupSizeUnit, 'height', candidateSettings.popupHeight)
    ) {
      errors.popupHeight = popupSizeUnit === 'px'
        ? createMessageDescriptor('validation_popupHeight_min_px', [POPUP_MIN_HEIGHT])
        : createMessageDescriptor('validation_popupHeight_range_percent', [POPUP_PERCENT_MIN, POPUP_PERCENT_MAX]);
    }

    if (
      candidateSettings.themeMode !== undefined &&
      !THEME_MODES.includes(candidateSettings.themeMode)
    ) {
      errors.themeMode = createMessageDescriptor('validation_themeMode_invalid');
    }

    return errors;
  }

  function getTriggerKeyLabelDescriptor(code) {
    if (!code) return createMessageDescriptor('triggerKey_none');
    if (TRIGGER_KEY_MESSAGE_KEYS[code]) {
      return createMessageDescriptor(TRIGGER_KEY_MESSAGE_KEYS[code]);
    }
    if (code.startsWith('Key')) return { text: code.slice(3).toUpperCase() };
    if (code.startsWith('Digit')) return { text: code.slice(5) };
    return {
      text: code
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^(.)/, (match) => match.toUpperCase())
    };
  }

  function getTriggerKeyButtonLabelDescriptor(code, isCapturing) {
    if (isCapturing) return createMessageDescriptor('triggerKey_button_capturing');
    return createMessageDescriptor(code ? 'triggerKey_button_change' : 'triggerKey_button_set');
  }

  function createTriggerKeyCaptureController(options = {}) {
    const eventTarget = options.eventTarget;
    const lifecycleTarget = options.lifecycleTarget;
    const onCapture = typeof options.onCapture === 'function' ? options.onCapture : async () => {};
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
    let activeCleanup = null;
    let isCapturing = false;

    function updateState(nextState) {
      if (isCapturing === nextState) return;
      isCapturing = nextState;
      onStateChange(isCapturing);
    }

    function stopCapture() {
      if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
      }
      updateState(false);
    }

    function startCapture() {
      if (!eventTarget || typeof eventTarget.addEventListener !== 'function') return false;
      if (isCapturing) return true;

      const handleCancel = () => {
        stopCapture();
      };

      const handleKeydown = async (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          stopCapture();
          return;
        }

        event.preventDefault();
        const capturedCode = event.code;
        stopCapture();
        await onCapture(capturedCode, event);
      };

      eventTarget.addEventListener('keydown', handleKeydown, true);
      if (lifecycleTarget && typeof lifecycleTarget.addEventListener === 'function') {
        lifecycleTarget.addEventListener('blur', handleCancel);
        lifecycleTarget.addEventListener('pagehide', handleCancel);
        lifecycleTarget.addEventListener('unload', handleCancel);
      }

      activeCleanup = () => {
        eventTarget.removeEventListener('keydown', handleKeydown, true);
        if (lifecycleTarget && typeof lifecycleTarget.removeEventListener === 'function') {
          lifecycleTarget.removeEventListener('blur', handleCancel);
          lifecycleTarget.removeEventListener('pagehide', handleCancel);
          lifecycleTarget.removeEventListener('unload', handleCancel);
        }
      };

      updateState(true);
      return true;
    }

    return {
      startCapture,
      stopCapture,
      isCapturing: () => isCapturing
    };
  }

  function getStorageItems(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function setStorageItems(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  }

  function removeStorageItems(keys) {
    if (!keys.length) return Promise.resolve();
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  function getCanonicalStoragePayload(settings) {
    const normalizedSettings = normalizeSettings(settings);
    return CANONICAL_KEYS.reduce((payload, key) => {
      payload[key] = normalizedSettings[key];
      return payload;
    }, {});
  }

  function getCanonicalizationPlan(rawSettings, normalizedSettings) {
    const canonicalPayload = {
      ...getCanonicalStoragePayload(normalizedSettings),
      [SETTINGS_MODEL_VERSION_KEY]: SETTINGS_MODEL_VERSION
    };
    const needsCanonicalWrite = Object.keys(canonicalPayload).some((key) => rawSettings[key] !== canonicalPayload[key]);
    const keysToRemove = [...LEGACY_KEYS, ...OBSOLETE_KEYS].filter((key) => rawSettings[key] !== undefined);

    return {
      canonicalPayload,
      needsCanonicalWrite,
      keysToRemove,
      needsCanonicalization: needsCanonicalWrite || keysToRemove.length > 0
    };
  }

  function getMigrationOperations(rawSettings, normalizedSettings) {
    const updates = {};
    const removals = [];

    if (rawSettings.interactionType === 'button') {
      updates.interactionType = normalizedSettings.interactionType;
    }

    if (rawSettings.interactionKey !== undefined) {
      if (typeof rawSettings.triggerKey !== 'string' && normalizedSettings.triggerKey !== DEFAULT_SETTINGS.triggerKey) {
        updates.triggerKey = normalizedSettings.triggerKey;
      }
      removals.push('interactionKey');
    }

    return { updates, removals };
  }

  async function readRawSettings() {
    return getStorageItems([...CANONICAL_KEYS, ...LEGACY_KEYS, ...OBSOLETE_KEYS, SETTINGS_MODEL_VERSION_KEY]);
  }

  async function readSettings() {
    const rawSettings = await readRawSettings();
    const normalizedSettings = normalizeSettings(rawSettings);
    const { updates, removals } = getMigrationOperations(rawSettings, normalizedSettings);

    if (Object.keys(updates).length > 0) {
      await setStorageItems(updates);
    }
    const keysToRemove = [...removals, ...OBSOLETE_KEYS.filter((key) => rawSettings[key] !== undefined)];
    if (keysToRemove.length > 0) {
      await removeStorageItems(keysToRemove);
    }

    return normalizedSettings;
  }

  async function writeSettingsPatch(patch) {
    const rawSettings = await readRawSettings();
    const normalizedSettings = normalizeSettings({
      ...rawSettings,
      ...patch
    });

    await setStorageItems({
      ...getCanonicalStoragePayload(normalizedSettings),
      [SETTINGS_MODEL_VERSION_KEY]: SETTINGS_MODEL_VERSION
    });
    const keysToRemove = [...LEGACY_KEYS, ...OBSOLETE_KEYS].filter((key) => rawSettings[key] !== undefined);
    if (keysToRemove.length > 0) {
      await removeStorageItems(keysToRemove);
    }

    return normalizedSettings;
  }

  async function resetSettings() {
    const defaults = cloneDefaultSettings();
    await setStorageItems({
      ...getCanonicalStoragePayload(defaults),
      [SETTINGS_MODEL_VERSION_KEY]: SETTINGS_MODEL_VERSION
    });
    const rawSettings = await readRawSettings();
    const keysToRemove = [...LEGACY_KEYS, ...OBSOLETE_KEYS].filter((key) => rawSettings[key] !== undefined);
    if (keysToRemove.length > 0) {
      await removeStorageItems(keysToRemove);
    }
    return defaults;
  }

  async function persistCanonicalSettingsIfNeeded(rawSettings, normalizedSettings) {
    const {
      canonicalPayload,
      needsCanonicalWrite,
      keysToRemove
    } = getCanonicalizationPlan(rawSettings, normalizedSettings);

    if (needsCanonicalWrite) {
      await setStorageItems(canonicalPayload);
    }
    if (keysToRemove.length > 0) {
      await removeStorageItems(keysToRemove);
    }

    return normalizedSettings;
  }

  function isSettingsChange(changes) {
    return [...CANONICAL_KEYS, ...LEGACY_KEYS, ...OBSOLETE_KEYS].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    const handler = async (changes, area) => {
      if (area !== 'local' || !isSettingsChange(changes)) return;
      listener(await readSettings(), changes);
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  async function initializeSettingsForInstall() {
    const rawSettings = await readRawSettings();
    const hasAnyCanonicalSetting = CANONICAL_KEYS.some((key) => rawSettings[key] !== undefined);
    if (hasAnyCanonicalSetting || rawSettings[SETTINGS_MODEL_VERSION_KEY] === SETTINGS_MODEL_VERSION) {
      return readSettings();
    }
    return resetSettings();
  }

  async function initializeSettingsForLifecycle(reason) {
    if (reason === 'install') {
      return initializeSettingsForInstall();
    }

    const rawSettings = await readRawSettings();
    const normalizedSettings = normalizeSettings(rawSettings);
    return persistCanonicalSettingsIfNeeded(rawSettings, normalizedSettings);
  }

  global.PreviewSettings = {
    DEFAULT_SETTINGS,
    INTERACTION_TYPES,
    HOVER_DELAY_MIN,
    HOVER_DELAY_MAX,
    HOVER_DELAY_STEP,
    MAX_POPUPS_MIN,
    LEGACY_DEFAULT_MAX_POPUPS,
    SETTINGS_MODEL_VERSION,
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_PERCENT_MIN,
    POPUP_PERCENT_MAX,
    DEFAULT_POPUP_SIZE_UNIT,
    PREVIEW_SIZE_UNIT_DEFAULTS,
    THEME_MODES,
    LANGUAGE_SETTINGS,
    cloneDefaultSettings,
    normalizeSettings,
    normalizeInteractionType,
    normalizeTriggerKey,
    normalizeThemeMode,
    normalizeLanguageSetting,
    getTriggerKeyLabelDescriptor,
    getTriggerKeyButtonLabelDescriptor,
    createTriggerKeyCaptureController,
    getValidationErrors,
    readSettings,
    writeSettingsPatch,
    resetSettings,
    initializeSettingsForInstall,
    initializeSettingsForLifecycle,
    isSettingsChange,
    subscribe
  };
})(globalThis);
