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
      interactionKey: ''
    },
    (data) => {
      const interactionType = normalizeInteractionType(data.interactionType);
      const triggerKey = normalizeTriggerKey(data);
      migrateSettingsIfNeeded(data);

      toggle.checked = data.enabled;
      maxInput.value = data.maxPopups;
      renderInteractionSettings(interactionType, data.hoverDelay, triggerKey);
      updateIcon(data.enabled);
    }
  );

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ enabled });
    updateIcon(enabled);
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

function updateIcon(enabled) {
  const path = enabled ? {
    '16': 'icons/icon-on.png',
    '32': 'icons/icon-on.png',
    '48': 'icons/icon-on.png',
    '128': 'icons/icon-on.png'
  } : {
    '16': 'icons/icon-off.png',
    '32': 'icons/icon-off.png',
    '48': 'icons/icon-off.png',
    '128': 'icons/icon-off.png'
  };
  chrome.action.setIcon({ path });
}
