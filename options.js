document.addEventListener('DOMContentLoaded', async () => {
  const {
    readSettings,
    writeSettingsPatch,
    resetSettings,
    subscribe,
    getValidationErrors,
    getTriggerKeyLabelDescriptor,
    getTriggerKeyButtonLabelDescriptor,
    createTriggerKeyCaptureController,
    HOVER_DELAY_MIN,
    HOVER_DELAY_MAX,
    HOVER_DELAY_STEP,
    MAX_POPUPS_MIN,
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_PERCENT_MIN,
    POPUP_PERCENT_MAX,
    PREVIEW_SIZE_UNIT_DEFAULTS
  } = globalThis.PreviewSettings;
  const {
    applyThemeMarker,
    applyColorScheme,
    subscribeToSystemThemeChange
  } = globalThis.PreviewTheme;

  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

  const form = {
    status: document.getElementById('settings-status'),
    enabled: document.getElementById('setting-enabled'),
    interactionHover: document.getElementById('setting-interaction-hover'),
    interactionHoverWithKey: document.getElementById('setting-interaction-hover-with-key'),
    hoverDelayRow: document.getElementById('setting-hover-delay-row'),
    hoverDelay: document.getElementById('setting-hover-delay'),
    hoverDelayError: document.getElementById('setting-hover-delay-error'),
    triggerKeyRow: document.getElementById('setting-trigger-key-row'),
    triggerKeyDisplay: document.getElementById('setting-trigger-key-display'),
    triggerKeyButton: document.getElementById('setting-trigger-key-btn'),
    maxPopups: document.getElementById('setting-max-popups'),
    maxPopupsError: document.getElementById('setting-max-popups-error'),
    popupSizeUnitPercent: document.getElementById('setting-popup-size-unit-percent'),
    popupSizeUnitPx: document.getElementById('setting-popup-size-unit-px'),
    popupWidth: document.getElementById('setting-popup-width'),
    popupWidthError: document.getElementById('setting-popup-width-error'),
    popupHeight: document.getElementById('setting-popup-height'),
    popupHeightError: document.getElementById('setting-popup-height-error'),
    popupSizeHelper: document.getElementById('setting-popup-size-helper'),
    themeMode: document.getElementById('setting-theme-mode'),
    language: document.getElementById('setting-language'),
    readerModeSuggestions: document.getElementById('setting-reader-mode-suggestions'),
    videoModeEnabled: document.getElementById('setting-video-mode-enabled'),
    resetButton: document.getElementById('reset-settings-btn')
  };

  form.hoverDelay.min = String(HOVER_DELAY_MIN);
  form.hoverDelay.max = String(HOVER_DELAY_MAX);
  form.hoverDelay.step = String(HOVER_DELAY_STEP);
  form.maxPopups.min = String(MAX_POPUPS_MIN);
  form.popupWidth.step = '1';
  form.popupHeight.step = '1';

  let currentSettings = await readSettings();
  let i18n = globalThis.PreviewI18n.createFallbackUiI18n(currentSettings);
  i18n.apply(document);
  try {
    i18n = await globalThis.PreviewI18n.getUiI18n(currentSettings);
    i18n.apply(document);
  } catch (error) {
    console.warn('[Preview Link] Settings localization failed. Falling back gracefully.', error);
  }
  let statusTimeoutId = null;

  const triggerKeyCapture = createTriggerKeyCaptureController({
    eventTarget: document,
    lifecycleTarget: window,
    onStateChange: () => {
      render(currentSettings);
    },
    onCapture: async (code) => {
      currentSettings = await writeSettingsPatch({ triggerKey: code });
      render(currentSettings);
    }
  });

  function setActiveTab(tabName) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === tabName;
      button.classList.toggle('tab-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.tabPanel === tabName;
      panel.hidden = !isActive;
      panel.setAttribute('aria-hidden', String(!isActive));
      panel.tabIndex = isActive ? 0 : -1;
    });
  }

  function renderFieldError(element, message) {
    element.textContent = message || '';
  }

  function updatePopupSizeHelper(unit) {
    form.popupSizeHelper.textContent = unit === 'px'
      ? i18n.t('settings_previewSize_helper_px', [POPUP_MIN_WIDTH, POPUP_MIN_HEIGHT])
      : i18n.t('settings_previewSize_helper_percent', [POPUP_PERCENT_MIN, POPUP_PERCENT_MAX]);
  }

  function updatePopupSizeInputAttributes(unit) {
    if (unit === 'px') {
      form.popupWidth.min = String(POPUP_MIN_WIDTH);
      form.popupWidth.max = '';
      form.popupHeight.min = String(POPUP_MIN_HEIGHT);
      form.popupHeight.max = '';
      return;
    }

    form.popupWidth.min = String(POPUP_PERCENT_MIN);
    form.popupWidth.max = String(POPUP_PERCENT_MAX);
    form.popupHeight.min = String(POPUP_PERCENT_MIN);
    form.popupHeight.max = String(POPUP_PERCENT_MAX);
  }

  function render(settings) {
    currentSettings = settings;
    if (settings.interactionType !== 'hoverWithKey' && triggerKeyCapture.isCapturing()) {
      triggerKeyCapture.stopCapture();
      return;
    }
    form.enabled.checked = settings.enabled;
    form.interactionHover.checked = settings.interactionType === 'hover';
    form.interactionHoverWithKey.checked = settings.interactionType === 'hoverWithKey';
    form.hoverDelayRow.hidden = settings.interactionType !== 'hover';
    form.triggerKeyRow.hidden = settings.interactionType !== 'hoverWithKey';
    form.hoverDelay.value = String(settings.hoverDelay);
    form.triggerKeyDisplay.textContent = i18n.tDescriptor(getTriggerKeyLabelDescriptor(settings.triggerKey));
    form.triggerKeyButton.textContent = i18n.tDescriptor(getTriggerKeyButtonLabelDescriptor(settings.triggerKey, triggerKeyCapture.isCapturing()));
    form.maxPopups.value = String(settings.maxPopups);
    form.popupSizeUnitPercent.checked = settings.popupSizeUnit === 'percent';
    form.popupSizeUnitPx.checked = settings.popupSizeUnit === 'px';
    form.popupWidth.value = String(settings.popupWidth);
    form.popupHeight.value = String(settings.popupHeight);
    form.themeMode.value = settings.themeMode;
    form.language.value = settings.language;
    form.readerModeSuggestions.checked = settings.readerModeSuggestions;
    form.videoModeEnabled.checked = settings.videoModeEnabled;
    updatePopupSizeHelper(settings.popupSizeUnit);
    updatePopupSizeInputAttributes(settings.popupSizeUnit);
    renderFieldError(form.hoverDelayError, '');
    renderFieldError(form.maxPopupsError, '');
    renderFieldError(form.popupWidthError, '');
    renderFieldError(form.popupHeightError, '');
    applyTheme(settings);
  }

  function applyTheme(settings) {
    const resolvedTheme = applyThemeMarker(document.documentElement, settings.themeMode);
    applyColorScheme(document.documentElement, resolvedTheme);
  }

  async function savePatch(patch) {
    render(await writeSettingsPatch(patch));
  }

  function showStatus(message) {
    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
    }
    form.status.textContent = message;
    form.status.hidden = false;
    statusTimeoutId = window.setTimeout(() => {
      form.status.hidden = true;
      form.status.textContent = '';
      statusTimeoutId = null;
    }, 2800);
  }

  function parseIntegerInput(input) {
    return Number(input.value);
  }

  function validateAndRender(fieldValues) {
    const errors = getValidationErrors(fieldValues);
    renderFieldError(form.hoverDelayError, i18n.tDescriptor(errors.hoverDelay));
    renderFieldError(form.maxPopupsError, i18n.tDescriptor(errors.maxPopups));
    renderFieldError(form.popupWidthError, i18n.tDescriptor(errors.popupWidth));
    renderFieldError(form.popupHeightError, i18n.tDescriptor(errors.popupHeight));
    return errors;
  }

  render(currentSettings);
  setActiveTab('general');
  const unsubscribe = subscribe(render);
  const unsubscribeSystemTheme = subscribeToSystemThemeChange(() => {
    if (currentSettings.themeMode !== 'auto') return;
    applyTheme(currentSettings);
  });
  window.addEventListener('unload', unsubscribe, { once: true });
  window.addEventListener('unload', unsubscribeSystemTheme, { once: true });
  window.addEventListener('unload', () => {
    triggerKeyCapture.stopCapture();
    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
    }
  }, { once: true });

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tabTarget);
    });
  });

  form.enabled.addEventListener('change', async () => {
    await savePatch({ enabled: form.enabled.checked });
  });

  form.interactionHover.addEventListener('change', async () => {
    if (!form.interactionHover.checked) return;
    await savePatch({ interactionType: 'hover' });
  });

  form.interactionHoverWithKey.addEventListener('change', async () => {
    if (!form.interactionHoverWithKey.checked) return;
    await savePatch({ interactionType: 'hoverWithKey' });
  });

  form.hoverDelay.addEventListener('input', () => {
    validateAndRender({ hoverDelay: parseIntegerInput(form.hoverDelay) });
  });

  form.hoverDelay.addEventListener('change', async () => {
    const hoverDelay = parseIntegerInput(form.hoverDelay);
    const errors = validateAndRender({ hoverDelay });
    if (errors.hoverDelay) {
      render(currentSettings);
      return;
    }
    await savePatch({ hoverDelay });
  });

  form.triggerKeyButton.addEventListener('click', () => {
    triggerKeyCapture.startCapture();
  });

  form.maxPopups.addEventListener('input', () => {
    validateAndRender({ maxPopups: parseIntegerInput(form.maxPopups) });
  });

  form.maxPopups.addEventListener('change', async () => {
    const maxPopups = parseIntegerInput(form.maxPopups);
    const errors = validateAndRender({ maxPopups });
    if (errors.maxPopups) {
      render(currentSettings);
      return;
    }
    await savePatch({ maxPopups });
  });

  form.popupSizeUnitPercent.addEventListener('change', async () => {
    if (!form.popupSizeUnitPercent.checked) return;
    const defaults = PREVIEW_SIZE_UNIT_DEFAULTS.percent;
    await savePatch({
      popupSizeUnit: 'percent',
      popupWidth: defaults.width,
      popupHeight: defaults.height
    });
  });

  form.popupSizeUnitPx.addEventListener('change', async () => {
    if (!form.popupSizeUnitPx.checked) return;
    const defaults = PREVIEW_SIZE_UNIT_DEFAULTS.px;
    await savePatch({
      popupSizeUnit: 'px',
      popupWidth: defaults.width,
      popupHeight: defaults.height
    });
  });

  form.popupWidth.addEventListener('input', () => {
    validateAndRender({
      popupSizeUnit: form.popupSizeUnitPx.checked ? 'px' : 'percent',
      popupWidth: parseIntegerInput(form.popupWidth)
    });
  });

  form.popupWidth.addEventListener('change', async () => {
    const popupSizeUnit = form.popupSizeUnitPx.checked ? 'px' : 'percent';
    const popupWidth = parseIntegerInput(form.popupWidth);
    const errors = validateAndRender({ popupSizeUnit, popupWidth });
    if (errors.popupWidth) {
      render(currentSettings);
      return;
    }
    await savePatch({ popupSizeUnit, popupWidth });
  });

  form.popupHeight.addEventListener('input', () => {
    validateAndRender({
      popupSizeUnit: form.popupSizeUnitPx.checked ? 'px' : 'percent',
      popupHeight: parseIntegerInput(form.popupHeight)
    });
  });

  form.popupHeight.addEventListener('change', async () => {
    const popupSizeUnit = form.popupSizeUnitPx.checked ? 'px' : 'percent';
    const popupHeight = parseIntegerInput(form.popupHeight);
    const errors = validateAndRender({ popupSizeUnit, popupHeight });
    if (errors.popupHeight) {
      render(currentSettings);
      return;
    }
    await savePatch({ popupSizeUnit, popupHeight });
  });

  form.themeMode.addEventListener('change', async () => {
    await savePatch({ themeMode: form.themeMode.value });
  });

  form.language.addEventListener('change', async () => {
    await writeSettingsPatch({ language: form.language.value });
    window.location.reload();
  });

  form.readerModeSuggestions.addEventListener('change', async () => {
    await savePatch({ readerModeSuggestions: form.readerModeSuggestions.checked });
  });

  form.videoModeEnabled.addEventListener('change', async () => {
    await savePatch({ videoModeEnabled: form.videoModeEnabled.checked });
  });

  form.resetButton.addEventListener('click', async () => {
    render(await resetSettings());
    showStatus(i18n.t('settings_status_reset'));
  });

  document.getElementById('hover-delay-range').textContent = i18n.t('settings_hoverDelay_range', [HOVER_DELAY_MIN, HOVER_DELAY_MAX]);
  document.getElementById('max-popups-min').textContent = i18n.t('settings_maxPopups_minimum', [MAX_POPUPS_MIN]);
});
