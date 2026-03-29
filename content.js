// content.js
let popups = [];
let MAX_POPUPS = 2;
let popupIdCounter = 0;
// Hover delay before opening popup (ms)
let hoverDelay = 2000;

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

const hoverInteraction = {
  activeLink: null,
  activeUrl: null,
  activeRect: null,
  timerId: null,
  timerPending: false,
  keyEligible: false
};

function clearHoverTimer() {
  if (hoverInteraction.timerId) {
    clearTimeout(hoverInteraction.timerId);
  }
  hoverInteraction.timerId = null;
  hoverInteraction.timerPending = false;
}

function resetHoverInteraction() {
  clearHoverTimer();
  hoverInteraction.activeLink = null;
  hoverInteraction.activeUrl = null;
  hoverInteraction.activeRect = null;
  hoverInteraction.keyEligible = false;
}

function dispatchHoverClear() {
  if (window.self === window.top) {
    chrome.runtime.sendMessage({ action: 'clearHover' });
    return;
  }
  window.parent.postMessage(
    {
      source: 'link-preview-extension',
      type: 'preview-coordinate-hop',
      version: 1,
      action: 'clearHover'
    },
    '*'
  );
}

function dispatchKeyPreviewOpen() {
  if (window.self === window.top) {
    chrome.runtime.sendMessage({ action: 'openKeyPreview' });
    return;
  }
  window.parent.postMessage(
    {
      source: 'link-preview-extension',
      type: 'preview-coordinate-hop',
      version: 1,
      action: 'triggerKeyPreviewOpen'
    },
    '*'
  );
}

function isEligibleAnchor(link) {
  return !!(link && link.href && link.offsetWidth > 0 && link.offsetHeight > 0);
}

function onContentPointerOver(e) {
  if (!enabled) return;
  const link = e.target.closest('a[href]');
  if (!isEligibleAnchor(link)) {
    return;
  }
  if (hoverInteraction.activeLink === link) return;

  clearHoverTimer();

  const rect = link.getBoundingClientRect();
  const localRect = rectToPayload(rect);
  hoverInteraction.activeLink = link;
  hoverInteraction.activeUrl = link.href;
  hoverInteraction.activeRect = localRect;
  hoverInteraction.keyEligible = interactionType === 'hoverWithKey';
  dispatchPreviewRequest('updateHover', link.href, localRect, null);

  if (interactionType === 'hover') {
    const enteredLink = link;
    const enteredUrl = link.href;
    hoverInteraction.timerPending = true;
    hoverInteraction.timerId = setTimeout(() => {
      if (hoverInteraction.activeLink !== enteredLink || hoverInteraction.activeUrl !== enteredUrl) {
        clearHoverTimer();
        return;
      }
      if (lastPreviewedLink === link.href && Date.now() - lastPreviewedTime < 500) {
        clearHoverTimer();
        return;
      }
      requestPreviewOpen(enteredUrl, hoverInteraction.activeRect || localRect, 'hover');
      lastPreviewedLink = enteredUrl;
      lastPreviewedTime = Date.now();
      clearHoverTimer();
    }, hoverDelay);
  }
}

function onContentPointerOut(e) {
  if (!enabled || !hoverInteraction.activeLink) return;
  const exitedLink = e.target.closest('a[href]');
  if (exitedLink !== hoverInteraction.activeLink) return;
  if (e.relatedTarget && hoverInteraction.activeLink.contains(e.relatedTarget)) return;
  dispatchHoverClear();
  resetHoverInteraction();
}

function rectToPayload(rect) {
  return {
    rectLeft: rect.left,
    rectTop: rect.top,
    rectRight: rect.right,
    rectBottom: rect.bottom,
    rectWidth: rect.width,
    rectHeight: rect.height
  };
}

function rectPayloadToAnchor(rectPayload) {
  return {
    x: rectPayload.rectRight,
    y: rectPayload.rectTop
  };
}

function requestPreviewOpen(url, rectPayload, trigger) {
  if (!enabled || !url) return;
  dispatchPreviewRequest('requestPreviewOpen', url, rectPayload, trigger || null);
}

function dispatchPreviewRequest(action, url, rectPayload, trigger) {
  if (!isRectPayload(rectPayload)) return;
  if (window.self === window.top) {
    const { x, y } = rectPayloadToAnchor(rectPayload);
    chrome.runtime.sendMessage({ action, url, x, y, rect: rectPayload, trigger });
    return;
  }
  window.parent.postMessage(
    {
      source: 'link-preview-extension',
      type: 'preview-coordinate-hop',
      version: 1,
      action,
      url,
      rect: rectPayload,
      trigger: trigger || null
    },
    '*'
  );
}

function isRectPayload(rect) {
  if (!rect || typeof rect !== 'object') return false;
  const keys = ['rectLeft', 'rectTop', 'rectRight', 'rectBottom', 'rectWidth', 'rectHeight'];
  return keys.every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]));
}

function isDirectChildWindow(sourceWindow) {
  if (!sourceWindow || sourceWindow === window) return false;
  for (let i = 0; i < window.frames.length; i += 1) {
    if (window.frames[i] === sourceWindow) return true;
  }
  return false;
}

function addFrameOffsetToRect(rect, frameRect) {
  return {
    rectLeft: rect.rectLeft + frameRect.left,
    rectTop: rect.rectTop + frameRect.top,
    rectRight: rect.rectRight + frameRect.left,
    rectBottom: rect.rectBottom + frameRect.top,
    rectWidth: rect.rectWidth,
    rectHeight: rect.rectHeight
  };
}

function onCoordinateHopMessage(event) {
  if (!enabled) return;
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.source !== 'link-preview-extension' || data.type !== 'preview-coordinate-hop' || data.version !== 1) return;
  if (!isDirectChildWindow(event.source)) return;
  if (data.action === 'triggerKeyPreviewOpen') {
    if (window.self === window.top) {
      chrome.runtime.sendMessage({ action: 'openKeyPreview' });
      return;
    }
    window.parent.postMessage(data, '*');
    return;
  }
  if (data.action === 'clearHover') {
    if (window.self === window.top) {
      chrome.runtime.sendMessage({ action: 'clearHover' });
      return;
    }
    window.parent.postMessage(data, '*');
    return;
  }
  if (!data.url || !isRectPayload(data.rect)) return;
  if (data.action !== 'updateHover' && data.action !== 'requestPreviewOpen') return;

  let rect = data.rect;
  if (window.self !== window.top && window.frameElement) {
    const frameRect = window.frameElement.getBoundingClientRect();
    rect = addFrameOffsetToRect(rect, frameRect);
  }

  if (window.self === window.top) {
    const { x, y } = rectPayloadToAnchor(rect);
    chrome.runtime.sendMessage({
      action: data.action,
      url: data.url,
      x,
      y,
      trigger: data.trigger || null
    });
    return;
  }

  window.parent.postMessage(
    {
      source: 'link-preview-extension',
      type: 'preview-coordinate-hop',
      version: 1,
      action: data.action,
      url: data.url,
      rect,
      trigger: data.trigger || null
    },
    '*'
  );
}

function onContentKeyDown(e) {
  if (!enabled) return;
  if (interactionType === 'hover') return;
  if (interactionType === 'hoverWithKey') {
    if (triggerKey && e.code === triggerKey) {
      dispatchKeyPreviewOpen();
    }
    return;
  }

  const modKey = interactionType + 'Key';
  if (e[modKey]) {
    dispatchKeyPreviewOpen();
  }
}

function handleRuntimeMessage(msg) {
  if (!enabled || window.self !== window.top) return;

  switch (msg.action) {
    case 'requestPreviewOpen':
      handlePreviewOpenRequest(msg);
      break;
    case 'showPreview':
      // Legacy relay path: normalize to the single preview-open handler.
      handlePreviewOpenRequest(msg);
      break;
    case 'bringToFront':
      bringToFront(msg.popupId, msg.url);
      break;
    case 'updatePopupUrl':
      syncPopupCurrentUrl(msg.popupId, msg.url);
      break;
    default:
      break;
  }
}

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('pointerover', onContentPointerOver);
  document.addEventListener('pointerout', onContentPointerOut);
  document.addEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener('message', onCoordinateHopMessage);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('pointerover', onContentPointerOver);
  document.removeEventListener('pointerout', onContentPointerOut);
  document.removeEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  window.removeEventListener('message', onCoordinateHopMessage);
  dispatchHoverClear();
  resetHoverInteraction();
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
      popups.slice().forEach((p) => closePopup(p.popupId));
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
    dispatchHoverClear();
    interactionType = normalizeInteractionType(changes.interactionType.newValue);
    resetHoverInteraction();
  }
  if (changes.triggerKey) {
    triggerKey = changes.triggerKey.newValue || '';
  } else if (changes.interactionKey) {
    triggerKey = changes.interactionKey.newValue || '';
  }
});

// z-index counter to manage popup stacking
let zIndexCounter = 1000;

function handlePreviewOpenRequest(msg) {
  if (!msg || !msg.url) return;
  const x = typeof msg.x === 'number' ? msg.x : 0;
  const y = typeof msg.y === 'number' ? msg.y : 0;
  const anchorRect = isRectPayload(msg.rect) ? msg.rect : null;
  createPopup(msg.url, x, y, anchorRect);
}

function showLimitReachedNotice() {
    const existing = document.getElementById('link-preview-limit-notice');
    if (existing) {
        existing.style.opacity = '1';
        clearTimeout(existing._hideTimer);
        existing._hideTimer = setTimeout(() => {
            existing.style.opacity = '0';
        }, 1800);
        return;
    }

    const notice = document.createElement('div');
    notice.id = 'link-preview-limit-notice';
    notice.textContent = `Preview limit reached (${MAX_POPUPS}). Close an existing preview to open another.`;
    notice.style.position = 'fixed';
    notice.style.top = '16px';
    notice.style.left = '50%';
    notice.style.transform = 'translateX(-50%)';
    notice.style.zIndex = '2147483647';
    notice.style.background = 'rgba(24, 24, 24, 0.92)';
    notice.style.color = '#fff';
    notice.style.padding = '8px 12px';
    notice.style.borderRadius = '8px';
    notice.style.fontSize = '13px';
    notice.style.lineHeight = '1.2';
    notice.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
    notice.style.pointerEvents = 'none';
    notice.style.opacity = '0';
    notice.style.transition = 'opacity 0.2s ease';
    document.body.appendChild(notice);
    requestAnimationFrame(() => {
        notice.style.opacity = '1';
    });
    notice._hideTimer = setTimeout(() => {
        notice.style.opacity = '0';
    }, 1800);
}

function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function calculatePopupPosition(anchorRect, popupWidth, popupHeight) {
    const GAP = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fallbackAnchor = {
        rectLeft: 0,
        rectTop: 0,
        rectRight: 0,
        rectBottom: 0
    };
    const anchor = anchorRect || fallbackAnchor;

    const rightX = anchor.rectRight + GAP;
    const leftX = anchor.rectLeft - popupWidth - GAP;
    const canFitRight = rightX + popupWidth <= viewportWidth;
    const canFitLeft = leftX >= 0;
    let x = canFitRight ? rightX : leftX;

    if (!canFitRight && !canFitLeft) {
        x = clamp(rightX, 0, viewportWidth - popupWidth);
    }

    const y = clamp(anchor.rectTop, 0, viewportHeight - popupHeight);
    return { x, y };
}

function createPopup(url, x, y, anchorRect) {
    // Limit to max popups: do not open new ones when limit reached
    if (popups.length >= MAX_POPUPS) {
        showLimitReachedNotice();
        return;
    }
    // Prevent opening the same link multiple times
    if (popups.some(p => p.requestedUrl === url || p.currentUrl === url)) return;

    const popupId = `popup-${++popupIdCounter}`;
    const popupEntry = {
        popupId,
        requestedUrl: url,
        currentUrl: url,
        state: 'loading',
        popup: null,
        topBar: null,
        bodyContainer: null,
        iframe: null,
        loadingBar: null,
        x,
        y
    };

    let popup = document.createElement('div');
    // Assign initial stacking order
    popup.style.zIndex = ++zIndexCounter;
    popup.className = 'link-preview-popup';
    popup.style.left = '-10000px';
    popup.style.top = '-10000px';
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
    popupEntry.loadingBar = loadingBar;

    // New tab button
    let newTabBtn = document.createElement('button');
    newTabBtn.className = 'link-preview-newtab';
    newTabBtn.innerText = '↗';
    newTabBtn.onclick = () => {
        window.open(popupEntry.currentUrl || popupEntry.requestedUrl, '_blank');
        closePopup(popupEntry.popupId);
    };
    topBar.appendChild(newTabBtn);

    // Reload button
    let reloadBtn = document.createElement('button');
    reloadBtn.className = 'link-preview-reload';
    reloadBtn.innerText = '⟳';
    reloadBtn.onclick = () => {
        reloadPopup(popupEntry.popupId);
    };
    topBar.appendChild(reloadBtn);

    // Close button
    let closeBtn = document.createElement('button');
    closeBtn.className = 'link-preview-close';
    closeBtn.innerText = '✖';
    closeBtn.onclick = () => closePopup(popupEntry.popupId);
    topBar.appendChild(closeBtn);

    // Iframe element
    iframe = document.createElement('iframe');
    iframe.className = 'link-preview-iframe';
    iframe.dataset.popupId = popupId;
    iframe.src = url;
    popupEntry.iframe = iframe;
    bindIframeStateHandlers(popupEntry);
    bodyContainer.appendChild(iframe);

    document.body.appendChild(popup);

    const measuredWidth = popup.offsetWidth || popup.getBoundingClientRect().width || 0;
    const measuredHeight = popup.offsetHeight || popup.getBoundingClientRect().height || 0;
    const fallbackRect = {
        rectLeft: x,
        rectTop: y,
        rectRight: x,
        rectBottom: y
    };
    const position = calculatePopupPosition(anchorRect || fallbackRect, measuredWidth, measuredHeight);
    popup.style.left = position.x + 'px';
    popup.style.top = position.y + 'px';
    popupEntry.x = position.x;
    popupEntry.y = position.y;

    popupEntry.popup = popup;
    popupEntry.topBar = topBar;
    popupEntry.bodyContainer = bodyContainer;
    // Bring this popup to front when clicking on its container (including top bar)
    popup.addEventListener('mousedown', () => bringToFront(popupEntry.popupId));
    setTimeout(() => { popup.style.opacity = '1'; }, 10);
    simulateLoadingBar(popupEntry);

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
            popupEntry.x = newLeft;
            popupEntry.y = newTop;
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
        popupEntry.iframe.style.pointerEvents = 'none';
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
            popupEntry.iframe.style.pointerEvents = '';
            document.body.style.userSelect = '';
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // Store popup reference with position
    popups.push(popupEntry);
}

function closePopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry || !entry.popup) return;
    entry.popup.style.opacity = '0';
    setTimeout(() => {
        if (entry.popup) entry.popup.remove();
        popups = popups.filter(p => p.popupId !== popupId);
    }, 300);
}

function simulateLoadingBar(popupEntry) {
    const loadingBar = popupEntry.loadingBar;
    const iframe = popupEntry.iframe;
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
        if (progress < 90 && loading) setTimeout(step, 80);
    }
    const stopLoading = () => {
        loading = false;
        loadingBar.style.width = '100%';
        setTimeout(() => loadingBar.style.opacity = '0', 500);
    };
    iframe.addEventListener('load', stopLoading, { once: true });
    iframe.addEventListener('error', () => { loading = false; }, { once: true });
    step();
}

// Debounce to prevent double opening
let lastPreviewedLink = null;
let lastPreviewedTime = 0;

// Bring popup to front when requested: move it atop other popups
function bringToFront(popupId, urlFallback) {
    let entry = popupId ? getPopupById(popupId) : null;
    if (!entry && urlFallback) {
        entry = popups.find(p => p.currentUrl === urlFallback || p.requestedUrl === urlFallback);
    }
    if (entry) {
        entry.popup.style.zIndex = ++zIndexCounter;
    }
}

function getPopupById(popupId) {
    return popups.find(p => p.popupId === popupId);
}

function bindIframeStateHandlers(popupEntry) {
    const { iframe, loadingBar } = popupEntry;
    iframe.onload = () => {
        const loadedUrl = iframe.src || popupEntry.currentUrl;
        popupEntry.currentUrl = loadedUrl;
        const isBlockedAboutBlank = loadedUrl === 'about:blank' && popupEntry.requestedUrl !== 'about:blank';
        popupEntry.state = isBlockedAboutBlank ? 'blocked' : 'ready';
        loadingBar.style.width = '100%';
        setTimeout(() => loadingBar.style.opacity = '0', 500);
    };
    iframe.onerror = () => {
        popupEntry.state = 'error';
        loadingBar.style.background = 'red';
    };
}

function reloadPopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry || !entry.iframe || !entry.bodyContainer) return;
    entry.state = 'loading';
    if (entry.loadingBar) {
        entry.loadingBar.style.background = '';
    }
    const reloadUrl = entry.currentUrl || entry.requestedUrl;
    const newIframe = document.createElement('iframe');
    newIframe.className = 'link-preview-iframe';
    newIframe.dataset.popupId = entry.popupId;
    newIframe.src = reloadUrl;
    entry.bodyContainer.replaceChild(newIframe, entry.iframe);
    entry.iframe = newIframe;
    bindIframeStateHandlers(entry);
    simulateLoadingBar(entry);
}

function syncPopupCurrentUrl(popupId, currentUrl) {
    if (!popupId || !currentUrl) return;
    const entry = getPopupById(popupId);
    if (!entry) return;
    entry.currentUrl = currentUrl;
}
