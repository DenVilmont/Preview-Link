// content.js
let popups = [];
let MAX_POPUPS = 2;
// Hover delay before opening popup (ms)
let hoverDelay = 2000;
let hoverTimer = null;

// Enabled/disabled and additional settings
let enabled = true;
let interactionType = 'hover';
let triggerKey = '';
let listenersAttached = false;

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

// Load initial settings
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
    enabled = data.enabled;
    MAX_POPUPS = data.maxPopups;
    hoverDelay = data.hoverDelay;
    interactionType = normalizeInteractionType(data.interactionType);
    triggerKey = normalizeTriggerKey(data);
    migrateSettingsIfNeeded(data);

    // Attach listeners if extension is enabled
    if (enabled) attachListeners();
  }
);

function onContentMouseMove(e) {
  if (!enabled) return;
  const link = e.target.closest('a');
  if (!(link && link.href && link.offsetWidth > 0 && link.offsetHeight > 0)) {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    lastHoveredLink = null;
    lastSentHoverUrl = null;
    return;
  }
  const rect = link.getBoundingClientRect();
  const x = Math.min(window.innerWidth - window.innerWidth / 3, rect.right + 10);
  const y = Math.min(window.innerHeight - window.innerHeight / 3, rect.top);
  lastHoveredLink = link;
  lastHoveredX = x;
  lastHoveredY = y;
  if (lastSentHoverUrl !== link.href) {
    lastSentHoverUrl = link.href;
    chrome.runtime.sendMessage({ action: 'updateHover', url: link.href, x, y });
  }
  if (interactionType === 'hover') {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (lastPreviewedLink === link.href && Date.now() - lastPreviewedTime < 500) {
        hoverTimer = null;
        return;
      }
      if (window.self === window.top) {
        createPopup(link.href, x, y);
      } else {
        chrome.runtime.sendMessage({ action: 'showPreview', url: link.href, x, y });
      }
      lastPreviewedLink = link.href;
      lastPreviewedTime = Date.now();
      hoverTimer = null;
    }, hoverDelay);
  }
}

function onContentKeyDown(e) {
  if (!enabled) return;
  if (interactionType === 'hover') return;
  if (interactionType === 'hoverWithKey') {
    if (triggerKey && e.code === triggerKey) {
      chrome.runtime.sendMessage({ action: 'openKeyPreview' });
    }
    return;
  }

  const modKey = interactionType + 'Key';
  if (e[modKey]) {
    chrome.runtime.sendMessage({ action: 'openKeyPreview' });
  }
}

function handleRuntimeMessage(msg) {
  if (!enabled || window.self !== window.top) return;

  switch (msg.action) {
    case 'showPreview':
      createPopup(msg.url, msg.x, msg.y);
      break;
    case 'bringToFront':
      bringToFront(msg.url);
      break;
    default:
      break;
  }
}

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('mousemove', onContentMouseMove);
  document.addEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('mousemove', onContentMouseMove);
  document.removeEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  listenersAttached = false;
}

// Update settings on change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    if (enabled) {
      attachListeners();
    } else {
      detachListeners();
      popups.slice().forEach((p) => closePopup(p.popup));
      popups = [];
    }
  }
  if (changes.maxPopups) {
    MAX_POPUPS = changes.maxPopups.newValue;
  }
  if (changes.hoverDelay) {
    hoverDelay = changes.hoverDelay.newValue;
  }
  if (changes.interactionType) {
    interactionType = normalizeInteractionType(changes.interactionType.newValue);
  }
  if (changes.triggerKey) {
    triggerKey = changes.triggerKey.newValue || '';
  } else if (changes.interactionKey) {
    triggerKey = changes.interactionKey.newValue || '';
  }
});

// z-index counter to manage popup stacking
let zIndexCounter = 1000;

function createPopup(url, x, y) {
    // Limit to max popups: do not open new ones when limit reached
    if (popups.length >= MAX_POPUPS) return;
    // Prevent opening the same link multiple times
    if (popups.some(p => p.url === url)) return;

    let popup = document.createElement('div');
    // Assign initial stacking order
    popup.style.zIndex = ++zIndexCounter;
    popup.className = 'link-preview-popup';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.style.opacity = '0';
    popup.style.transition = 'opacity 0.3s';

    // Top bar
    let topBar = document.createElement('div');
    topBar.className = 'link-preview-topbar';
    popup.appendChild(topBar);

    // Prepare iframe variable for later use
    let iframe;

    // Create scrollable body container
    let bodyContainer = document.createElement('div');
    bodyContainer.className = 'link-preview-body';
    popup.appendChild(bodyContainer);

    // Loading bar
    let loadingBar = document.createElement('div');
    loadingBar.className = 'link-preview-loading-bar';
    bodyContainer.appendChild(loadingBar);

    // New tab button
    let newTabBtn = document.createElement('button');
    newTabBtn.className = 'link-preview-newtab';
    newTabBtn.innerText = '↗';
    newTabBtn.onclick = () => {
        window.open(url, '_blank');
        closePopup(popup);
    };
    topBar.appendChild(newTabBtn);

    // Reload button
    let reloadBtn = document.createElement('button');
    reloadBtn.className = 'link-preview-reload';
    reloadBtn.innerText = '⟳';
    reloadBtn.onclick = () => {
        // Restart loading bar simulation on reload
        simulateLoadingBar(loadingBar, iframe);
        // Replace iframe element to force reload even on cross-origin
        const currentUrl = iframe.src;
        // Remove old iframe
        bodyContainer.removeChild(iframe);
        // Create and insert new iframe
        const newIframe = document.createElement('iframe');
        newIframe.className = 'link-preview-iframe';
        newIframe.src = currentUrl;
        // Reattach load and error handlers
        newIframe.onload = () => {
            loadingBar.style.width = '100%';
            setTimeout(() => loadingBar.style.opacity = '0', 500);
        };
        newIframe.onerror = () => {
            loadingBar.style.background = 'red';
        };
        // Insert new iframe before resize handle
        bodyContainer.insertBefore(newIframe, handle);
        // Update reference
        iframe = newIframe;
    };
    topBar.appendChild(reloadBtn);

    // Close button
    let closeBtn = document.createElement('button');
    closeBtn.className = 'link-preview-close';
    closeBtn.innerText = '✖';
    closeBtn.onclick = () => closePopup(popup);
    topBar.appendChild(closeBtn);

    // Iframe element
    iframe = document.createElement('iframe');
    iframe.className = 'link-preview-iframe';
    iframe.src = url;
    iframe.onload = () => {
        loadingBar.style.width = '100%';
        setTimeout(() => loadingBar.style.opacity = '0', 500);
    };
    iframe.onerror = () => {
        loadingBar.style.background = 'red';
    };
    bodyContainer.appendChild(iframe);

    document.body.appendChild(popup);
    // Bring this popup to front when clicking on its container (including top bar)
    popup.addEventListener('mousedown', () => bringToFront(url));
    setTimeout(() => { popup.style.opacity = '1'; }, 10);
    simulateLoadingBar(loadingBar, iframe);

    // Make popup draggable via the top bar
    topBar.addEventListener('mousedown', function(e) {
        // Only initiate drag when clicking on the empty top bar area (not buttons)
        if (e.currentTarget !== e.target) return;
        e.preventDefault();
        // Prevent text selection during drag
        document.body.style.userSelect = 'none';
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = popup.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        function onMouseMove(e) {
            let newLeft = startLeft + (e.clientX - startX);
            let newTop = startTop + (e.clientY - startY);
            // Maintain viewport bounds
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - popup.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - popup.offsetHeight));
            popup.style.left = newLeft + 'px';
            popup.style.top = newTop + 'px';
            const entry = popups.find(p => p.popup === popup);
            if (entry) { entry.x = newLeft; entry.y = newTop; }
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Restore text selection
            document.body.style.userSelect = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Add resize handle
    let handle = document.createElement('div');
    handle.className = 'link-preview-resize-handle';
    bodyContainer.appendChild(handle);
    handle.addEventListener('mousedown', function(e) {
        // Prevent text selection during resize
        e.preventDefault();
        e.stopPropagation();
        document.body.style.userSelect = 'none';
        // Disable pointer-events for iframe
        iframe.style.pointerEvents = 'none';
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = popup.offsetWidth;
        const startHeight = popup.offsetHeight;
        function onMouseMove(e) {
            let newWidth = startWidth + (e.clientX - startX);
            let newHeight = startHeight + (e.clientY - startY);
            // Enforce minimum dimensions
            const MIN_WIDTH = 256;
            const MIN_HEIGHT = 128;
            if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
            if (newHeight < MIN_HEIGHT) newHeight = MIN_HEIGHT;
            popup.style.width = newWidth + 'px';
            popup.style.height = newHeight + 'px';
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Restore pointer-events and text selection after resize
            iframe.style.pointerEvents = '';
            document.body.style.userSelect = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Store popup reference with position
    popups.push({popup, url, x, y, closePopup: () => closePopup(popup)});
}

function closePopup(popup) {
    if (!popup) return;
    popup.style.opacity = '0';
    setTimeout(() => {
        popup.remove();
        popups = popups.filter(p => p.popup !== popup);
    }, 300);
}

function simulateLoadingBar(loadingBar, iframe) {
    if (!loadingBar) return;
    loadingBar.style.width = '0%';
    loadingBar.style.opacity = '1';
    let progress = 0;
    let loading = true;
    function step() {
        if (!loading) return;
        progress += Math.random() * 10;
        if (progress > 90) progress = 90;
        loadingBar.style.width = progress + '%';
        if (progress < 90 && !iframe.complete) setTimeout(step, 80);
    }
    iframe.onload = () => { loading = false; loadingBar.style.width = '100%'; setTimeout(() => loadingBar.style.opacity = '0', 500); };
    step();
}

// Track last hovered link and its position
let lastHoveredLink = null;
let lastHoveredX = 0;
let lastHoveredY = 0;
// Variable to dedupe hover update messages for openKeyPreview
let lastSentHoverUrl = null;

// Debounce to prevent double opening
let lastPreviewedLink = null;
let lastPreviewedTime = 0;

// Bring popup to front when requested: move it atop other popups
function bringToFront(url) {
    const entry = popups.find(p => p.url === url);
    if (entry) {
        entry.popup.style.zIndex = ++zIndexCounter;
    }
}
