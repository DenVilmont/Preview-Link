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
    return value === 'button' ? 'hoverWithKey' : value;
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

  function setKeyDisplay(code) {
    keyDisplay.textContent = code ? codeToLabel(code) : 'None';
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
      delaySlider.value = data.hoverDelay;
      delayLabel.textContent = data.hoverDelay + ' ms';

      // Initialize interaction UI and key selector visibility
      if (interactionType === 'hover') {
        interactionHover.checked = true;
        delaySlider.disabled = false;
        keySelector.style.display = 'none';
        delayContainer.style.display = 'flex';
      } else {
        interactionHoverWithKey.checked = true;
        delaySlider.value = 0;
        delayLabel.textContent = '0 ms';
        delaySlider.disabled = true;
        keySelector.style.display = 'flex';
        setKeyDisplay(triggerKey);
        delayContainer.style.display = 'none';
      }
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
      const defaultDelay = 1500;
      chrome.storage.local.set({ hoverDelay: defaultDelay });
      delaySlider.value = defaultDelay;
      delayLabel.textContent = defaultDelay + ' ms';
      delaySlider.disabled = false;
      keySelector.style.display = 'none';
      delayContainer.style.display = 'flex';
    }
  });

  interactionHoverWithKey.addEventListener('change', () => {
    if (interactionHoverWithKey.checked) {
      chrome.storage.local.set({ interactionType: 'hoverWithKey' });
      chrome.storage.local.set({ hoverDelay: 0 });
      delaySlider.value = 0;
      delayLabel.textContent = '0 ms';
      delaySlider.disabled = true;
      keySelector.style.display = 'flex';
      chrome.storage.local.get({ triggerKey: '', interactionKey: '' }, (settings) => {
        setKeyDisplay(normalizeTriggerKey(settings));
      });
      delayContainer.style.display = 'none';
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
