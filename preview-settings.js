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
  const TRIGGER_KEY_LABELS = Object.freeze({
    Backquote: 'Backquote (`)',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    Escape: 'Esc',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    MetaLeft: 'Meta',
    MetaRight: 'Meta'
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
    'readerModeSuggestions',
    'videoModeEnabled',
    'aggressiveCompatibilityMode'
  ]);
  const LEGACY_KEYS = Object.freeze(['interactionKey']);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    maxPopups: 5,
    hoverDelay: 2000,
    interactionType: 'hover',
    triggerKey: '',
    popupSizeUnit: DEFAULT_POPUP_SIZE_UNIT,
    popupWidth: PREVIEW_SIZE_UNIT_DEFAULTS.percent.width,
    popupHeight: PREVIEW_SIZE_UNIT_DEFAULTS.percent.height,
    readerModeSuggestions: true,
    videoModeEnabled: true,
    aggressiveCompatibilityMode: false
  });

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
      readerModeSuggestions: normalizeBoolean(rawSettings.readerModeSuggestions, DEFAULT_SETTINGS.readerModeSuggestions),
      videoModeEnabled: normalizeBoolean(rawSettings.videoModeEnabled, DEFAULT_SETTINGS.videoModeEnabled),
      aggressiveCompatibilityMode: normalizeBoolean(rawSettings.aggressiveCompatibilityMode, DEFAULT_SETTINGS.aggressiveCompatibilityMode)
    };
  }

  function getValidationErrors(candidateSettings = {}) {
    const errors = {};

    if (
      candidateSettings.interactionType !== undefined &&
      candidateSettings.interactionType !== 'button' &&
      !INTERACTION_TYPES.includes(candidateSettings.interactionType)
    ) {
      errors.interactionType = 'Choose a valid interaction mode.';
    }

    if (
      candidateSettings.hoverDelay !== undefined &&
      !Number.isInteger(candidateSettings.hoverDelay)
    ) {
      errors.hoverDelay = `Enter a whole number from ${HOVER_DELAY_MIN} to ${HOVER_DELAY_MAX}.`;
    } else if (
      candidateSettings.hoverDelay !== undefined &&
      (candidateSettings.hoverDelay < HOVER_DELAY_MIN || candidateSettings.hoverDelay > HOVER_DELAY_MAX)
    ) {
      errors.hoverDelay = `Enter a whole number from ${HOVER_DELAY_MIN} to ${HOVER_DELAY_MAX}.`;
    }

    if (
      candidateSettings.maxPopups !== undefined &&
      (!Number.isInteger(candidateSettings.maxPopups) || candidateSettings.maxPopups < MAX_POPUPS_MIN)
    ) {
      errors.maxPopups = `Enter a whole number of at least ${MAX_POPUPS_MIN}.`;
    }

    if (
      candidateSettings.popupSizeUnit !== undefined &&
      !isValidPopupSizeUnit(candidateSettings.popupSizeUnit)
    ) {
      errors.popupSizeUnit = 'Choose percent or pixels.';
    }

    const popupSizeUnit = isValidPopupSizeUnit(candidateSettings.popupSizeUnit)
      ? candidateSettings.popupSizeUnit
      : DEFAULT_SETTINGS.popupSizeUnit;

    if (
      candidateSettings.popupWidth !== undefined &&
      !isValidPopupSizeValue(popupSizeUnit, 'width', candidateSettings.popupWidth)
    ) {
      errors.popupWidth = popupSizeUnit === 'px'
        ? `Minimum width is ${POPUP_MIN_WIDTH}px.`
        : `Enter a value from ${POPUP_PERCENT_MIN} to ${POPUP_PERCENT_MAX}.`;
    }

    if (
      candidateSettings.popupHeight !== undefined &&
      !isValidPopupSizeValue(popupSizeUnit, 'height', candidateSettings.popupHeight)
    ) {
      errors.popupHeight = popupSizeUnit === 'px'
        ? `Minimum height is ${POPUP_MIN_HEIGHT}px.`
        : `Enter a value from ${POPUP_PERCENT_MIN} to ${POPUP_PERCENT_MAX}.`;
    }

    return errors;
  }

  function formatTriggerKeyLabel(code) {
    if (!code) return 'No key set';
    if (TRIGGER_KEY_LABELS[code]) return TRIGGER_KEY_LABELS[code];
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    return code
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^(.)/, (match) => match.toUpperCase());
  }

  function getTriggerKeyButtonLabel(code, isCapturing) {
    if (isCapturing) return 'Press a key...';
    return code ? 'Change key' : 'Set key';
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
    const legacyKeysToRemove = LEGACY_KEYS.filter((key) => rawSettings[key] !== undefined);

    return {
      canonicalPayload,
      needsCanonicalWrite,
      legacyKeysToRemove,
      needsCanonicalization: needsCanonicalWrite || legacyKeysToRemove.length > 0
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
    return getStorageItems([...CANONICAL_KEYS, ...LEGACY_KEYS, SETTINGS_MODEL_VERSION_KEY]);
  }

  async function readSettings() {
    const rawSettings = await readRawSettings();
    const normalizedSettings = normalizeSettings(rawSettings);
    const { updates, removals } = getMigrationOperations(rawSettings, normalizedSettings);

    if (Object.keys(updates).length > 0) {
      await setStorageItems(updates);
    }
    if (removals.length > 0) {
      await removeStorageItems(removals);
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
    if (rawSettings.interactionKey !== undefined) {
      await removeStorageItems(['interactionKey']);
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
    const legacyKeysToRemove = LEGACY_KEYS.filter((key) => rawSettings[key] !== undefined);
    if (legacyKeysToRemove.length > 0) {
      await removeStorageItems(legacyKeysToRemove);
    }
    return defaults;
  }

  async function persistCanonicalSettingsIfNeeded(rawSettings, normalizedSettings) {
    const {
      canonicalPayload,
      needsCanonicalWrite,
      legacyKeysToRemove
    } = getCanonicalizationPlan(rawSettings, normalizedSettings);

    if (needsCanonicalWrite) {
      await setStorageItems(canonicalPayload);
    }
    if (legacyKeysToRemove.length > 0) {
      await removeStorageItems(legacyKeysToRemove);
    }

    return normalizedSettings;
  }

  function isSettingsChange(changes) {
    return [...CANONICAL_KEYS, ...LEGACY_KEYS].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
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
    cloneDefaultSettings,
    normalizeSettings,
    normalizeInteractionType,
    normalizeTriggerKey,
    formatTriggerKeyLabel,
    getTriggerKeyButtonLabel,
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
