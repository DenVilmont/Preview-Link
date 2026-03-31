document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-enabled');
  const maxInput = document.getElementById('max-popups');
  const delaySlider = document.getElementById('hover-delay');
  const delayLabel = document.getElementById('hover-delay-label');
  const interactionHover = document.getElementById('interaction-hover');
  const interactionHoverWithKey = document.getElementById('interaction-hover-with-key');
  const keySelector = document.getElementById('key-selector');
  const setKeyBtn = document.getElementById('set-key-btn');
  const keyDisplay = document.getElementById('key-display');
  const delayContainer = document.getElementById('delay-container');
  const popupSizeUnitPercent = document.getElementById('popup-size-unit-percent');
  const popupSizeUnitPx = document.getElementById('popup-size-unit-px');
  const popupWidthInput = document.getElementById('popup-width');
  const popupHeightInput = document.getElementById('popup-height');
  const previewSizeHelper = document.getElementById('preview-size-helper');
  const popupWidthError = document.getElementById('popup-width-error');
  const popupHeightError = document.getElementById('popup-height-error');
  const {
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_PERCENT_MIN,
    POPUP_PERCENT_MAX,
    DEFAULT_POPUP_SIZE_UNIT,
    PREVIEW_SIZE_UNIT_DEFAULTS,
    getDefaultPreviewSizeForUnit,
    isValidPopupSizeValue,
    normalizePreviewSizeSettings
  } = globalThis.PreviewSizeConfig;

  function normalizeInteractionType(value) {
    if (value === 'button') return 'hoverWithKey';
    return value === 'hoverWithKey' ? 'hoverWithKey' : 'hover';
  }

  function normalizeTriggerKey(settings) {
    return settings.triggerKey || settings.interactionKey || '';
  }

  function migrateSettingsIfNeeded(settings) {
    const updates = {};
    if (settings.interactionType === 'button') {
      updates.interactionType = 'hoverWithKey';
    }
    if (settings.interactionKey && !settings.triggerKey) {
      updates.triggerKey = settings.interactionKey;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  }

  function getSelectedPopupSizeUnit() {
    return popupSizeUnitPx.checked ? 'px' : 'percent';
  }

  function updatePreviewSizeHelper(unit) {
    previewSizeHelper.textContent = unit === 'px'
      ? `Minimum: width ${POPUP_MIN_WIDTH}px, height ${POPUP_MIN_HEIGHT}px`
      : `Allowed range: ${POPUP_PERCENT_MIN}-${POPUP_PERCENT_MAX}%`;
  }

  function updatePreviewSizeInputAttributes(unit) {
    if (unit === 'px') {
      popupWidthInput.min = String(POPUP_MIN_WIDTH);
      popupWidthInput.max = '';
      popupHeightInput.min = String(POPUP_MIN_HEIGHT);
      popupHeightInput.max = '';
      return;
    }

    popupWidthInput.min = String(POPUP_PERCENT_MIN);
    popupWidthInput.max = String(POPUP_PERCENT_MAX);
    popupHeightInput.min = String(POPUP_PERCENT_MIN);
    popupHeightInput.max = String(POPUP_PERCENT_MAX);
  }

  function renderPreviewSizeErrors(errors) {
    const widthError = errors.popupWidth || '';
    const heightError = errors.popupHeight || '';

    popupWidthError.textContent = widthError;
    popupHeightError.textContent = heightError;
    popupWidthInput.classList.toggle('input-invalid', !!widthError);
    popupHeightInput.classList.toggle('input-invalid', !!heightError);
  }

  function renderPreviewSizeSettings(settings) {
    popupSizeUnitPercent.checked = settings.popupSizeUnit === 'percent';
    popupSizeUnitPx.checked = settings.popupSizeUnit === 'px';
    popupWidthInput.value = settings.popupWidth;
    popupHeightInput.value = settings.popupHeight;
    updatePreviewSizeHelper(settings.popupSizeUnit);
    updatePreviewSizeInputAttributes(settings.popupSizeUnit);
    renderPreviewSizeErrors({});
  }

  function parsePreviewSizeInputValue(value) {
    return Number(value);
  }

  function getPreviewSizeValidationErrors(settings) {
    const errors = {};

    if (!isValidPopupSizeValue(settings.popupSizeUnit, 'width', settings.popupWidth)) {
      errors.popupWidth = settings.popupSizeUnit === 'px'
        ? `Minimum width is ${POPUP_MIN_WIDTH}px`
        : `Enter a value from ${POPUP_PERCENT_MIN} to ${POPUP_PERCENT_MAX}`;
    }

    if (!isValidPopupSizeValue(settings.popupSizeUnit, 'height', settings.popupHeight)) {
      errors.popupHeight = settings.popupSizeUnit === 'px'
        ? `Minimum height is ${POPUP_MIN_HEIGHT}px`
        : `Enter a value from ${POPUP_PERCENT_MIN} to ${POPUP_PERCENT_MAX}`;
    }

    return errors;
  }

  function getPreviewSizeSettingsFromForm() {
    return {
      popupSizeUnit: getSelectedPopupSizeUnit(),
      popupWidth: parsePreviewSizeInputValue(popupWidthInput.value),
      popupHeight: parsePreviewSizeInputValue(popupHeightInput.value)
    };
  }

  function attemptSavePreviewSizeSettings() {
    const previewSizeSettings = getPreviewSizeSettingsFromForm();
    const errors = getPreviewSizeValidationErrors(previewSizeSettings);

    updatePreviewSizeHelper(previewSizeSettings.popupSizeUnit);
    updatePreviewSizeInputAttributes(previewSizeSettings.popupSizeUnit);
    renderPreviewSizeErrors(errors);

    if (Object.keys(errors).length > 0) {
      return false;
    }

    chrome.storage.local.set(previewSizeSettings);
    return true;
  }

  function resetPreviewSizeSettingsForUnit(unit) {
    const defaults = getDefaultPreviewSizeForUnit(unit);
    const previewSizeSettings = {
      popupSizeUnit: unit,
      popupWidth: defaults.width,
      popupHeight: defaults.height
    };

    renderPreviewSizeSettings(previewSizeSettings);
    chrome.storage.local.set(previewSizeSettings);
  }

  // Helper to display a readable label from KeyboardEvent.code
  function codeToLabel(code) {
    let display = code;
    if (code.startsWith('Key')) {
      display = code.slice(3);
    } else if (code.startsWith('Digit')) {
      display = code.slice(5);
    }
    return display.toUpperCase();
  }

  function getTriggerKeyDisplay(code) {
    return code ? codeToLabel(code) : 'No key selected';
  }

  function setKeyDisplay(code) {
    keyDisplay.textContent = getTriggerKeyDisplay(code);
  }

  function renderInteractionSettings(interactionType, hoverDelayValue, triggerKeyValue) {
    const isHover = interactionType === 'hover';
    interactionHover.checked = isHover;
    interactionHoverWithKey.checked = !isHover;
    delaySlider.disabled = !isHover;
    keySelector.style.display = isHover ? 'none' : 'flex';
    delayContainer.style.display = isHover ? 'flex' : 'none';
    delaySlider.value = hoverDelayValue;
    delayLabel.textContent = hoverDelayValue + ' ms';
    setKeyDisplay(triggerKeyValue);
  }

  // Load initial state and settings
  chrome.storage.local.get(
    {
      enabled: true,
      maxPopups: 2,
      hoverDelay: 2000,
      interactionType: 'hover',
      triggerKey: '',
      interactionKey: '',
      popupSizeUnit: DEFAULT_POPUP_SIZE_UNIT,
      popupWidth: PREVIEW_SIZE_UNIT_DEFAULTS.percent.width,
      popupHeight: PREVIEW_SIZE_UNIT_DEFAULTS.percent.height
    },
    (data) => {
      const interactionType = normalizeInteractionType(data.interactionType);
      const triggerKey = normalizeTriggerKey(data);
      const previewSizeSettings = normalizePreviewSizeSettings(data);
      migrateSettingsIfNeeded(data);

      toggle.checked = data.enabled;
      maxInput.value = data.maxPopups;
      renderInteractionSettings(interactionType, data.hoverDelay, triggerKey);
      renderPreviewSizeSettings(previewSizeSettings);
    }
  );

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ enabled });
  });

  maxInput.addEventListener('change', () => {
    let v = parseInt(maxInput.value);
    if (isNaN(v) || v < 1) v = 1;
    chrome.storage.local.set({ maxPopups: v });
  });

  delaySlider.addEventListener('input', () => {
    delayLabel.textContent = delaySlider.value + ' ms';
  });

  delaySlider.addEventListener('change', () => {
    let d = parseInt(delaySlider.value);
    chrome.storage.local.set({ hoverDelay: d });
  });

  // Radio button change handlers
  interactionHover.addEventListener('change', () => {
    if (interactionHover.checked) {
      chrome.storage.local.set({ interactionType: 'hover' });
      chrome.storage.local.get({ hoverDelay: 2000, triggerKey: '', interactionKey: '' }, (settings) => {
        const triggerKey = normalizeTriggerKey(settings);
        renderInteractionSettings('hover', settings.hoverDelay, triggerKey);
      });
    }
  });

  interactionHoverWithKey.addEventListener('change', () => {
    if (interactionHoverWithKey.checked) {
      chrome.storage.local.set({ interactionType: 'hoverWithKey' });
      chrome.storage.local.get({ hoverDelay: 2000, triggerKey: '', interactionKey: '' }, (settings) => {
        const triggerKey = normalizeTriggerKey(settings);
        renderInteractionSettings('hoverWithKey', settings.hoverDelay, triggerKey);
      });
    }
  });

  popupSizeUnitPercent.addEventListener('change', () => {
    if (popupSizeUnitPercent.checked) {
      resetPreviewSizeSettingsForUnit('percent');
    }
  });

  popupSizeUnitPx.addEventListener('change', () => {
    if (popupSizeUnitPx.checked) {
      resetPreviewSizeSettingsForUnit('px');
    }
  });

  popupWidthInput.addEventListener('change', () => {
    attemptSavePreviewSizeSettings();
  });

  popupHeightInput.addEventListener('change', () => {
    attemptSavePreviewSizeSettings();
  });

  // Key capture button: listen for the next key regardless of layout
  setKeyBtn.addEventListener('click', () => {
    setKeyBtn.textContent = 'Press a key...';
    const handler = (e) => {
      const code = e.code;
      chrome.storage.local.set({ triggerKey: code }, () => {
        setKeyDisplay(code);
        setKeyBtn.textContent = 'Set key';
      });
      document.removeEventListener('keydown', handler, true);
    };
    document.addEventListener('keydown', handler, true);
  });
});
