document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-enabled');
  const maxInput = document.getElementById('max-popups');
  const delaySlider = document.getElementById('hover-delay');
  const delayLabel = document.getElementById('hover-delay-label');
  const interactionHover = document.getElementById('interaction-hover');
  const interactionButton = document.getElementById('interaction-button');
  const keySelector = document.getElementById('key-selector');
  const setKeyBtn = document.getElementById('set-key-btn');
  const keyDisplay = document.getElementById('key-display');
  const delayContainer = document.getElementById('delay-container');

  // Helper para mostrar la tecla a partir de e.code
  function codeToLabel(code) {
    let disp = code;
    if (code.startsWith('Key')) {
      disp = code.slice(3);
    } else if (code.startsWith('Digit')) {
      disp = code.slice(5);
    }
    return disp.toUpperCase();
  }

  // Load initial state and settings
  chrome.storage.local.get({ enabled: true, maxPopups: 2, hoverDelay: 2000, interactionType: 'hover', interactionKey: '' }, (data) => {
    toggle.checked = data.enabled;
    maxInput.value = data.maxPopups;
    delaySlider.value = data.hoverDelay;
    delayLabel.textContent = data.hoverDelay + ' ms';
    // Initialize interaction UI y visibilidad del selector de tecla
    if (data.interactionType === 'hover') {
      interactionHover.checked = true;
      delaySlider.disabled = false;
      keySelector.style.display = 'none';
      delayContainer.style.display = 'flex';
    } else {
      interactionButton.checked = true;
      delaySlider.value = 0;
      delayLabel.textContent = '0 ms';
      delaySlider.disabled = true;
      keySelector.style.display = 'flex';
      keyDisplay.textContent = data.interactionKey ? codeToLabel(data.interactionKey) : 'None';
      delayContainer.style.display = 'none';
    }
    updateIcon(data.enabled);
  });

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
  interactionButton.addEventListener('change', () => {
    if (interactionButton.checked) {
      chrome.storage.local.set({ interactionType: 'button' });
      chrome.storage.local.set({ hoverDelay: 0 });
      delaySlider.value = 0;
      delayLabel.textContent = '0 ms';
      delaySlider.disabled = true;
      keySelector.style.display = 'flex';
      keyDisplay.textContent = ''; // hasta que se asigne
      delayContainer.style.display = 'none';
    }
  });
  // Botón de captura: escucha siguiente pulsación independientemente de layout
  setKeyBtn.addEventListener('click', () => {
    setKeyBtn.textContent = 'Press a key...';
    const handler = (e) => {
      const code = e.code;
      chrome.storage.local.set({ interactionKey: code }, () => {
        keyDisplay.textContent = codeToLabel(code);
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