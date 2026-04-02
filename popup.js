document.addEventListener('DOMContentLoaded', async () => {
  const {
    readSettings,
    writeSettingsPatch,
    subscribe,
    getTriggerKeyLabelDescriptor,
    getTriggerKeyButtonLabelDescriptor,
    createTriggerKeyCaptureController,
    HOVER_DELAY_MIN,
    HOVER_DELAY_MAX,
    HOVER_DELAY_STEP
  } = globalThis.PreviewSettings;
  const {
    applyThemeMarker,
    applyColorScheme,
    subscribeToSystemThemeChange
  } = globalThis.PreviewTheme;

  const toggle = document.getElementById('toggle-enabled');
  const interactionHover = document.getElementById('interaction-hover');
  const interactionHoverWithKey = document.getElementById('interaction-hover-with-key');
  const delayRow = document.getElementById('delay-row');
  const delaySlider = document.getElementById('hover-delay');
  const delayLabel = document.getElementById('hover-delay-label');
  const keyRow = document.getElementById('key-row');
  const setKeyBtn = document.getElementById('set-key-btn');
  const keyDisplay = document.getElementById('key-display');
  const openSettingsBtn = document.getElementById('open-settings-btn');

  delaySlider.min = String(HOVER_DELAY_MIN);
  delaySlider.max = String(HOVER_DELAY_MAX);
  delaySlider.step = String(HOVER_DELAY_STEP);
  let currentSettings = await readSettings();
  let i18n = globalThis.PreviewI18n.createFallbackUiI18n(currentSettings);
  i18n.apply(document);
  try {
    i18n = await globalThis.PreviewI18n.getUiI18n(currentSettings);
    i18n.apply(document);
  } catch (error) {
    console.warn('[Preview Link] Popup localization failed. Falling back gracefully.', error);
  }

  function applyTheme(settings) {
    const resolvedTheme = applyThemeMarker(document.documentElement, settings.themeMode);
    applyColorScheme(document.documentElement, resolvedTheme);
  }

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

  function render(settings) {
    currentSettings = settings;
    if (settings.interactionType !== 'hoverWithKey' && triggerKeyCapture.isCapturing()) {
      triggerKeyCapture.stopCapture();
      return;
    }
    toggle.checked = settings.enabled;
    interactionHover.checked = settings.interactionType === 'hover';
    interactionHoverWithKey.checked = settings.interactionType === 'hoverWithKey';
    delaySlider.value = String(settings.hoverDelay);
    delayLabel.textContent = i18n.t('common_millisecondsValue', [settings.hoverDelay]);
    keyDisplay.textContent = i18n.tDescriptor(getTriggerKeyLabelDescriptor(settings.triggerKey));
    setKeyBtn.textContent = i18n.tDescriptor(getTriggerKeyButtonLabelDescriptor(settings.triggerKey, triggerKeyCapture.isCapturing()));
    delayRow.hidden = settings.interactionType !== 'hover';
    keyRow.hidden = settings.interactionType !== 'hoverWithKey';
    applyTheme(settings);
  }

  render(currentSettings);
  const unsubscribe = subscribe(render);
  const unsubscribeSystemTheme = subscribeToSystemThemeChange(() => {
    if (currentSettings.themeMode !== 'auto') return;
    applyTheme(currentSettings);
  });
  window.addEventListener('unload', unsubscribe, { once: true });
  window.addEventListener('unload', unsubscribeSystemTheme, { once: true });
  window.addEventListener('unload', () => {
    triggerKeyCapture.stopCapture();
  }, { once: true });

  toggle.addEventListener('change', async () => {
    render(await writeSettingsPatch({ enabled: toggle.checked }));
  });

  interactionHover.addEventListener('change', async () => {
    if (!interactionHover.checked) return;
    render(await writeSettingsPatch({ interactionType: 'hover' }));
  });

  interactionHoverWithKey.addEventListener('change', async () => {
    if (!interactionHoverWithKey.checked) return;
    render(await writeSettingsPatch({ interactionType: 'hoverWithKey' }));
  });

  delaySlider.addEventListener('input', () => {
    delayLabel.textContent = i18n.t('common_millisecondsValue', [delaySlider.value]);
  });

  delaySlider.addEventListener('change', async () => {
    render(await writeSettingsPatch({ hoverDelay: Number(delaySlider.value) }));
  });

  setKeyBtn.addEventListener('click', () => {
    triggerKeyCapture.startCapture();
  });

  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
