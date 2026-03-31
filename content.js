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
const DEBUG_PREVIEW = false;
const ORIGINAL_LIVENESS_GRACE_MS = 1000;
const POPUP_HARD_TIMEOUT_MS = 12000;
const {
  POPUP_MIN_WIDTH,
  POPUP_MIN_HEIGHT,
  DEFAULT_POPUP_SIZE_UNIT,
  PREVIEW_SIZE_UNIT_DEFAULTS,
  normalizePreviewSizeSettings
} = globalThis.PreviewSizeConfig;
let activePopupMouseInteractionCleanup = null;
let popupSizeSettings = {
  popupSizeUnit: DEFAULT_POPUP_SIZE_UNIT,
  popupWidth: PREVIEW_SIZE_UNIT_DEFAULTS.percent.width,
  popupHeight: PREVIEW_SIZE_UNIT_DEFAULTS.percent.height
};

function logPreviewDebug(event, details) {
  if (!DEBUG_PREVIEW) return;
  console.debug('[link-preview]', event, details);
}

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

function getUpdatedPreviewSizeSettings(changes, currentSettings) {
  return normalizePreviewSizeSettings({
    popupSizeUnit: changes.popupSizeUnit ? changes.popupSizeUnit.newValue : currentSettings.popupSizeUnit,
    popupWidth: changes.popupWidth ? changes.popupWidth.newValue : currentSettings.popupWidth,
    popupHeight: changes.popupHeight ? changes.popupHeight.newValue : currentSettings.popupHeight
  });
}

function getInitialPopupSize(settings) {
  const normalizedSettings = normalizePreviewSizeSettings(settings || popupSizeSettings);
  const width = normalizedSettings.popupSizeUnit === 'percent'
    ? Math.round(window.innerWidth * (normalizedSettings.popupWidth / 100))
    : normalizedSettings.popupWidth;
  const height = normalizedSettings.popupSizeUnit === 'percent'
    ? Math.round(window.innerHeight * (normalizedSettings.popupHeight / 100))
    : normalizedSettings.popupHeight;

  return {
    width: Math.max(POPUP_MIN_WIDTH, width),
    height: Math.max(POPUP_MIN_HEIGHT, height)
  };
}

// Load initial settings
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
    enabled = data.enabled;
    MAX_POPUPS = data.maxPopups;
    hoverDelay = data.hoverDelay;
    interactionType = normalizeInteractionType(data.interactionType);
    triggerKey = normalizeTriggerKey(data);
    popupSizeSettings = normalizePreviewSizeSettings(data);
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
const sharedHoverCandidate = {
  url: null,
  rect: null
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
    sharedHoverCandidate.url = null;
    sharedHoverCandidate.rect = null;
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
    openKeyPreviewFromSharedHover();
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
  if (window.self === window.top) {
    sharedHoverCandidate.url = link.href;
    sharedHoverCandidate.rect = localRect;
  } else {
    dispatchPreviewRequest('updateHover', link.href, localRect, null);
  }

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

function openKeyPreviewFromSharedHover() {
  if (!enabled) return;
  if (!sharedHoverCandidate.url || !isRectPayload(sharedHoverCandidate.rect)) return;
  const { x, y } = rectPayloadToAnchor(sharedHoverCandidate.rect);
  handlePreviewOpenRequest({
    action: 'requestPreviewOpen',
    url: sharedHoverCandidate.url,
    x,
    y,
    rect: sharedHoverCandidate.rect,
    trigger: 'key'
  });
}

function dispatchPreviewRequest(action, url, rectPayload, trigger) {
  if (!isRectPayload(rectPayload)) return;
  if (window.self === window.top) {
    if (action === 'updateHover') {
      sharedHoverCandidate.url = url;
      sharedHoverCandidate.rect = rectPayload;
      return;
    }
    if (action === 'requestPreviewOpen') {
      const { x, y } = rectPayloadToAnchor(rectPayload);
      handlePreviewOpenRequest({ action: 'requestPreviewOpen', url, x, y, rect: rectPayload, trigger });
      return;
    }
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
      openKeyPreviewFromSharedHover();
      return;
    }
    window.parent.postMessage(data, '*');
    return;
  }
  if (data.action === 'clearHover') {
    if (window.self === window.top) {
      sharedHoverCandidate.url = null;
      sharedHoverCandidate.rect = null;
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
    if (data.action === 'updateHover') {
      sharedHoverCandidate.url = data.url;
      sharedHoverCandidate.rect = rect;
      return;
    }
    if (data.action === 'requestPreviewOpen') {
      const { x, y } = rectPayloadToAnchor(rect);
      handlePreviewOpenRequest({
        action: 'requestPreviewOpen',
        url: data.url,
        x,
        y,
        rect,
        trigger: data.trigger || null
      });
    }
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

function onPopupRuntimeMessage(event) {
  if (!enabled || window.self !== window.top) return;
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.source !== 'link-preview-extension' || data.type !== 'popup-runtime-bridge' || data.version !== 1) return;
  const popupEntry = getPopupByIframeWindow(event.source);
  if (!popupEntry) return;

  if (data.action === 'bringToFront') {
    bringToFront(popupEntry.popupId, data.url);
    return;
  }
  if (data.action === 'updatePopupUrl') {
    syncPopupCurrentUrlForEntry(popupEntry, data.url || null);
    return;
  }
  if (data.action === 'previewFrameAlive') {
    markPopupFrameAliveForEntry(popupEntry, data.url || null);
    return;
  }
}

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('pointerover', onContentPointerOver);
  document.addEventListener('pointerout', onContentPointerOut);
  document.addEventListener('keydown', onContentKeyDown);
  window.addEventListener('message', onCoordinateHopMessage);
  window.addEventListener('message', onPopupRuntimeMessage);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('pointerover', onContentPointerOver);
  document.removeEventListener('pointerout', onContentPointerOut);
  document.removeEventListener('keydown', onContentKeyDown);
  window.removeEventListener('message', onCoordinateHopMessage);
  window.removeEventListener('message', onPopupRuntimeMessage);
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
  if (changes.popupSizeUnit || changes.popupWidth || changes.popupHeight) {
    popupSizeSettings = getUpdatedPreviewSizeSettings(changes, popupSizeSettings);
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

const POPUP_GAP_PX = 10;
const TOP_BAR_PROBE_LEFT_OFFSETS_PX = [16, 56];
const TOP_BAR_RESCUE_MARGIN_PX = 4;
const VIEWPORT_HIT_TEST_PADDING_PX = 1;
const POPUP_CHROME_SHADOW_STYLES = `
:host {
    all: initial;
    position: fixed;
    z-index: 999999;
    min-width: ${POPUP_MIN_WIDTH}px;
    min-height: ${POPUP_MIN_HEIGHT}px;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border: 2px solid #4f8cff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    box-sizing: border-box;
    pointer-events: auto;
    opacity: 0;
    transform: scale(1);
    transition: opacity 0.3s, transform 0.3s, border-color 0.2s ease, box-shadow 0.2s ease;
    color: #0f172a;
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.4;
}

:host(.link-preview-popup--attention) {
    border-color: #ffd24d;
    box-shadow: 0 0 0 4px rgba(255, 210, 77, 0.55), 0 8px 32px rgba(0, 0, 0, 0.25);
}

*, *::before, *::after {
    box-sizing: border-box;
}

button {
    font: inherit;
}

.link-preview-topbar {
    position: relative;
    flex: 0 0 32px;
    background: #eaf2ff;
    border-bottom: 1px solid #b3d1ff;
    user-select: none;
    cursor: move;
}

.link-preview-body {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: #ffffff;
}

.link-preview-loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    height: 4px;
    width: 0%;
    background: linear-gradient(90deg, #4f8cff, #00e0c6);
    transition: width 0.2s, opacity 0.5s;
    opacity: 1;
    pointer-events: none;
}

.link-preview-iframe {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    border: none;
    background: #f8fafc;
}

.link-preview-control {
    position: absolute;
    top: 2px;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 1px solid rgba(79, 140, 255, 0.18);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    color: #1d4ed8;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
}

.link-preview-control:hover {
    background: #dbeafe;
}

.link-preview-control:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
}

.link-preview-control svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
}

.link-preview-control--newtab {
    right: 76px;
}

.link-preview-control--reload {
    right: 44px;
}

.link-preview-control--close {
    right: 12px;
}

.link-preview-resize-handle {
    position: absolute;
    right: 4px;
    bottom: 4px;
    z-index: 3;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: linear-gradient(135deg, rgba(79, 140, 255, 0.85), rgba(0, 224, 198, 0.85));
    cursor: se-resize;
}

.link-preview-resize-handle::before {
    content: "";
    position: absolute;
    inset: 3px;
    border-right: 1.5px solid rgba(255, 255, 255, 0.95);
    border-bottom: 1.5px solid rgba(255, 255, 255, 0.95);
}

.link-preview-fallback {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    height: 100%;
    padding: 14px;
    background: #f8fafc;
    color: #1f2937;
    font-size: 13px;
    line-height: 1.35;
}

.link-preview-fallback-url {
    padding: 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #ffffff;
    word-break: break-all;
}

.link-preview-fallback-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.link-preview-fallback-action {
    min-height: 32px;
    padding: 0 12px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #ffffff;
    color: #0f172a;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
}

.link-preview-fallback-action:hover {
    background: #f1f5f9;
}

.link-preview-fallback-action:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
}

.link-preview-fallback-action--primary {
    border-color: #2563eb;
    background: #2563eb;
    color: #ffffff;
}

.link-preview-fallback-action--primary:hover {
    background: #1d4ed8;
}
`;
const POPUP_CONTROL_ICON_MARKUP = {
    newtab: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 13L14 6"></path><path d="M9 6h5v5"></path><path d="M6 9v5h5"></path></svg>',
    reload: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-2.1-4.58"></path><path d="M16 4v4h-4"></path></svg>',
    close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8"></path><path d="M14 6l-8 8"></path></svg>'
};

function applyPopupCoordinates(popupEntry, left, top) {
    if (!popupEntry || !popupEntry.popup) return;
    popupEntry.popup.style.left = left + 'px';
    popupEntry.popup.style.top = top + 'px';
    popupEntry.x = left;
    popupEntry.y = top;
}

function startPopupMouseInteraction(popupEntry, options) {
    if (!popupEntry || typeof options?.onMove !== 'function') {
        return () => {};
    }

    if (typeof activePopupMouseInteractionCleanup === 'function') {
        activePopupMouseInteractionCleanup();
    }

    const {
        onMove,
        onEnd,
        disableIframePointerEvents = false
    } = options;

    const bodyStyle = document.body && document.body.style;
    const previousUserSelect = bodyStyle ? bodyStyle.userSelect : '';
    const activeIframe = disableIframePointerEvents ? popupEntry.iframe : null;
    const previousIframePointerEvents = activeIframe ? activeIframe.style.pointerEvents : '';
    let cleanedUp = false;

    function cleanup(event) {
        if (cleanedUp) return;
        cleanedUp = true;

        document.removeEventListener('mousemove', onDocumentMouseMove);
        window.removeEventListener('mouseup', onWindowMouseUp, true);
        window.removeEventListener('blur', onWindowBlur);

        if (bodyStyle) {
            bodyStyle.userSelect = previousUserSelect;
        }

        if (activeIframe && popupEntry.iframe === activeIframe) {
            activeIframe.style.pointerEvents = previousIframePointerEvents;
        }

        if (popupEntry.activeMouseInteractionCleanup === cleanup) {
            popupEntry.activeMouseInteractionCleanup = null;
        }
        if (activePopupMouseInteractionCleanup === cleanup) {
            activePopupMouseInteractionCleanup = null;
        }

        if (typeof onEnd === 'function') {
            onEnd(event);
        }
    }

    function onDocumentMouseMove(event) {
        if ((event.buttons & 1) !== 1) {
            cleanup(event);
            return;
        }

        onMove(event, cleanup);
    }

    function onWindowMouseUp(event) {
        cleanup(event);
    }

    function onWindowBlur() {
        cleanup();
    }

    popupEntry.activeMouseInteractionCleanup = cleanup;
    activePopupMouseInteractionCleanup = cleanup;

    if (bodyStyle) {
        bodyStyle.userSelect = 'none';
    }

    if (activeIframe) {
        // Keep the top-level document receiving drag events even when the cursor crosses the preview iframe.
        activeIframe.style.pointerEvents = 'none';
    }

    document.addEventListener('mousemove', onDocumentMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp, true);
    window.addEventListener('blur', onWindowBlur);

    return cleanup;
}

function getTopBarDragProbePoints(topBarEl) {
    if (!topBarEl) return [];
    const rect = topBarEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const probeY = rect.top + (rect.height / 2);

    return TOP_BAR_PROBE_LEFT_OFFSETS_PX
        .map((offset) => {
            const maxOffset = Math.max(
                VIEWPORT_HIT_TEST_PADDING_PX,
                Math.min(rect.width - VIEWPORT_HIT_TEST_PADDING_PX, rect.width / 3)
            );
            const probeX = rect.left + Math.min(offset, maxOffset);
            return { x: probeX, y: probeY };
        })
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function getPopupHitElementAtPoint(popupEntry, point) {
    if (!point) return null;
    const hitEl = document.elementFromPoint(point.x, point.y);
    if (!popupEntry || !popupEntry.popup || hitEl !== popupEntry.popup) {
        return hitEl;
    }
    const shadowRoot = popupEntry.shadowRoot;
    if (shadowRoot && typeof shadowRoot.elementFromPoint === 'function') {
        return shadowRoot.elementFromPoint(point.x, point.y) || hitEl;
    }
    return hitEl;
}

function isTopBarProbeAccessible(popupEntry, point) {
    if (!popupEntry || !popupEntry.topBar || !point) return false;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (
        point.x < VIEWPORT_HIT_TEST_PADDING_PX ||
        point.y < VIEWPORT_HIT_TEST_PADDING_PX ||
        point.x > viewportWidth - VIEWPORT_HIT_TEST_PADDING_PX ||
        point.y > viewportHeight - VIEWPORT_HIT_TEST_PADDING_PX
    ) {
        return false;
    }

    const hitEl = getPopupHitElementAtPoint(popupEntry, point);
    return !!(hitEl && (hitEl === popupEntry.topBar || popupEntry.topBar.contains(hitEl)));
}

function getRequiredAccessibleTop(popupEntry) {
    if (!popupEntry || !popupEntry.popup || !popupEntry.topBar) return 0;

    const popupRect = popupEntry.popup.getBoundingClientRect();
    const popupHeight = popupEntry.popup.offsetHeight || popupRect.height || 0;
    const currentTop = Number.isFinite(popupEntry.y) ? popupEntry.y : popupRect.top;
    const probePoints = getTopBarDragProbePoints(popupEntry.topBar);
    const viewportMaxTop = Math.max(0, window.innerHeight - popupHeight);
    let requiredTop = currentTop;
    let rescueNeeded = false;

    probePoints.forEach((point) => {
        const relativeProbeY = point.y - popupRect.top;

        if (point.y < VIEWPORT_HIT_TEST_PADDING_PX) {
            requiredTop = Math.max(
                requiredTop,
                VIEWPORT_HIT_TEST_PADDING_PX - relativeProbeY
            );
            rescueNeeded = true;
            return;
        }

        if (isTopBarProbeAccessible(popupEntry, point)) return;

        const blockerEl = getPopupHitElementAtPoint(popupEntry, point);
        if (!blockerEl) return;

        const blockerRect = blockerEl.getBoundingClientRect();
        requiredTop = Math.max(
            requiredTop,
            blockerRect.bottom + TOP_BAR_RESCUE_MARGIN_PX - relativeProbeY
        );
        rescueNeeded = true;
    });

    if (!rescueNeeded) return currentTop;
    return clamp(requiredTop, 0, viewportMaxTop);
}

function ensurePopupAccessibleTopBar(popupEntry) {
    if (!popupEntry || !popupEntry.popup) return;
    const popupRect = popupEntry.popup.getBoundingClientRect();
    const left = Number.isFinite(popupEntry.x) ? popupEntry.x : popupRect.left;
    const currentTop = Number.isFinite(popupEntry.y) ? popupEntry.y : popupRect.top;
    const requiredTop = getRequiredAccessibleTop(popupEntry);
    if (requiredTop <= currentTop || Math.abs(requiredTop - currentTop) < 1) return;
    applyPopupCoordinates(popupEntry, left, requiredTop);
}

function calculatePopupPosition(anchorRect, popupWidth, popupHeight) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fallbackAnchor = {
        rectLeft: 0,
        rectTop: 0,
        rectRight: 0,
        rectBottom: 0
    };
    const anchor = anchorRect || fallbackAnchor;

    const rightX = anchor.rectRight + POPUP_GAP_PX;
    const leftX = anchor.rectLeft - popupWidth - POPUP_GAP_PX;
    const canFitRight = rightX + popupWidth <= viewportWidth;
    const canFitLeft = leftX >= 0;
    let x = canFitRight ? rightX : leftX;

    if (!canFitRight && !canFitLeft) {
        x = clamp(rightX, 0, viewportWidth - popupWidth);
    }

    const y = clamp(anchor.rectTop, 0, viewportHeight - popupHeight);
    return { x, y };
}

function extractYouTubeVideoId(url) {
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname || '';
    if (host === 'youtu.be') {
        const firstSegment = pathname.split('/').filter(Boolean)[0];
        return firstSegment || null;
    }
    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
        if (pathname === '/watch') {
            return url.searchParams.get('v') || null;
        }
        const parts = pathname.split('/').filter(Boolean);
        if (parts[0] === 'shorts' || parts[0] === 'live') {
            return parts[1] || null;
        }
    }
    return null;
}

function buildRutubeEmbedUrl(videoId, sourceUrl) {
    const embedUrl = new URL(`https://rutube.ru/play/embed/${videoId}`);
    const safeParams = ['p', 'play', 'access_token', 'token'];
    safeParams.forEach((param) => {
        const value = sourceUrl.searchParams.get(param);
        if (value) embedUrl.searchParams.set(param, value);
    });
    return embedUrl.toString();
}

function resolveAlternatePreviewUrl(originalUrl) {
    let parsed;
    try {
        parsed = new URL(originalUrl);
    } catch (_) {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '';

    const ytVideoId = extractYouTubeVideoId(parsed);
    if (ytVideoId) {
        return `https://www.youtube.com/embed/${ytVideoId}`;
    }

    if (host === 'www.tiktok.com' || host === 'tiktok.com') {
        const tiktokMatch = pathname.match(/^\/@[^/]+\/video\/([^/?#]+)/);
        if (tiktokMatch && tiktokMatch[1]) {
            return `https://www.tiktok.com/player/v1/${tiktokMatch[1]}`;
        }
    }

    if (host === 'rutube.ru') {
        const rutubeMatch = pathname.match(/^\/(video|shorts)\/([^/]+)\/?$/);
        if (rutubeMatch && rutubeMatch[2]) {
            return buildRutubeEmbedUrl(rutubeMatch[2], parsed);
        }
    }

    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
        const vimeoMatch = pathname.match(/^\/(\d+)\/?$/);
        if (vimeoMatch && vimeoMatch[1]) {
            return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
        }
    }

    return null;
}

function buildPreviewCandidates(originalUrl) {
    const candidates = [originalUrl];
    const alternateUrl = resolveAlternatePreviewUrl(originalUrl);
    if (alternateUrl && alternateUrl !== originalUrl) {
        candidates.push(alternateUrl);
    }
    return candidates;
}

function normalizePreviewIdentityFallback(originalUrl) {
    try {
        const parsed = new URL(originalUrl);
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return originalUrl;
    }
}

function getPreviewIdentityKey(originalUrl) {
    let parsed;
    try {
        parsed = new URL(originalUrl);
    } catch (_) {
        return normalizePreviewIdentityFallback(originalUrl);
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '';
    const ytVideoId = extractYouTubeVideoId(parsed);
    if (ytVideoId) return `youtube:${ytVideoId}`;

    if (host === 'www.tiktok.com' || host === 'tiktok.com') {
        const tiktokMatch = pathname.match(/^\/@[^/]+\/video\/([^/?#]+)/);
        if (tiktokMatch && tiktokMatch[1]) return `tiktok:${tiktokMatch[1]}`;
    }

    if (host === 'rutube.ru') {
        const rutubeMatch = pathname.match(/^\/(video|shorts)\/([^/]+)\/?$/);
        if (rutubeMatch && rutubeMatch[2]) return `rutube:${rutubeMatch[2]}`;
    }

    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
        const vimeoMatch = pathname.match(/^\/(\d+)\/?$/);
        if (vimeoMatch && vimeoMatch[1]) return `vimeo:${vimeoMatch[1]}`;
    }

    return normalizePreviewIdentityFallback(originalUrl);
}

function createPopupShadowStyle() {
    const style = document.createElement('style');
    style.textContent = POPUP_CHROME_SHADOW_STYLES;
    return style;
}

function createPopupControlButton(modifierClass, label, iconName, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `link-preview-control ${modifierClass}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = POPUP_CONTROL_ICON_MARKUP[iconName];
    button.addEventListener('click', onClick);
    return button;
}

function createPopup(url, x, y, anchorRect) {
    const previewIdentityKey = getPreviewIdentityKey(url);
    const existingPopup = popups.find((p) => p.previewIdentityKey === previewIdentityKey);
    if (existingPopup) {
        bringToFront(existingPopup.popupId);
        flashPopupAttention(existingPopup);
        return;
    }
    // Limit to max popups: do not open new ones when limit reached
    if (popups.length >= MAX_POPUPS) {
        showLimitReachedNotice();
        return;
    }

    const popupId = `popup-${++popupIdCounter}`;
    const popupEntry = {
        popupId,
        originalUrl: url,
        previewIdentityKey,
        requestedUrl: url,
        currentUrl: url,
        currentPreviewUrl: url,
        previewCandidates: buildPreviewCandidates(url),
        activeCandidateIndex: 0,
        activeAttemptId: 0,
        state: 'loading',
        popup: null,
        shadowRoot: null,
        topBar: null,
        bodyContainer: null,
        iframe: null,
        fallback: null,
        loadingBar: null,
        loadingAnimationTimer: null,
        blockedTimeoutTimer: null,
        postLoadGraceTimer: null,
        activeCandidateLoaded: false,
        activeCandidateFrameAlive: false,
        attentionTimer: null,
        activeMouseInteractionCleanup: null,
        x,
        y
    };

    let popup = document.createElement('div');
    const shadowRoot = popup.attachShadow({ mode: 'open' });
    const initialSize = getInitialPopupSize(popupSizeSettings);
    // Assign initial stacking order
    popup.style.zIndex = ++zIndexCounter;
    popup.className = 'link-preview-popup';
    popup.style.left = '-10000px';
    popup.style.top = '-10000px';
    popup.style.width = initialSize.width + 'px';
    popup.style.height = initialSize.height + 'px';
    popup.style.opacity = '0';
    popup.style.transition = 'opacity 0.3s, transform 0.3s, border-color 0.2s ease, box-shadow 0.2s ease';
    shadowRoot.appendChild(createPopupShadowStyle());

    // Top bar
    let topBar = document.createElement('div');
    topBar.className = 'link-preview-topbar';
    shadowRoot.appendChild(topBar);

    // Create scrollable body container
    let bodyContainer = document.createElement('div');
    bodyContainer.className = 'link-preview-body';
    shadowRoot.appendChild(bodyContainer);

    // Loading bar
    let loadingBar = document.createElement('div');
    loadingBar.className = 'link-preview-loading-bar';
    bodyContainer.appendChild(loadingBar);
    popupEntry.loadingBar = loadingBar;

    // New tab button
    let newTabBtn = createPopupControlButton('link-preview-control--newtab', 'Open preview in new tab', 'newtab', () => {
        window.open(popupEntry.originalUrl || popupEntry.requestedUrl, '_blank');
        closePopup(popupEntry.popupId);
    });
    topBar.appendChild(newTabBtn);

    // Reload button
    let reloadBtn = createPopupControlButton('link-preview-control--reload', 'Reload preview', 'reload', () => {
        reloadPopup(popupEntry.popupId);
    });
    topBar.appendChild(reloadBtn);

    // Close button
    let closeBtn = createPopupControlButton('link-preview-control--close', 'Close preview', 'close', () => {
        closePopup(popupEntry.popupId);
    });
    topBar.appendChild(closeBtn);

    document.body.appendChild(popup);
    popupEntry.popup = popup;
    popupEntry.shadowRoot = shadowRoot;
    popupEntry.topBar = topBar;
    popupEntry.bodyContainer = bodyContainer;
    popups.push(popupEntry);

    const measuredWidth = popup.offsetWidth || popup.getBoundingClientRect().width || 0;
    const measuredHeight = popup.offsetHeight || popup.getBoundingClientRect().height || 0;
    const fallbackRect = {
        rectLeft: x,
        rectTop: y,
        rectRight: x,
        rectBottom: y
    };
    const position = calculatePopupPosition(anchorRect || fallbackRect, measuredWidth, measuredHeight);
    applyPopupCoordinates(popupEntry, position.x, position.y);

    requestAnimationFrame(() => {
        ensurePopupAccessibleTopBar(popupEntry);
    });
    // Bring this popup to front when clicking on its container (including top bar)
    popup.addEventListener('mousedown', () => bringToFront(popupEntry.popupId));
    setTimeout(() => { popup.style.opacity = '1'; }, 10);
    loadPopupUrl(popupEntry, url);

    // Make popup draggable via the top bar
    topBar.addEventListener('mousedown', function(e) {
        // Only initiate drag when clicking on the empty top bar area (not buttons)
        if (e.currentTarget !== e.target) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = popup.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        startPopupMouseInteraction(popupEntry, {
            disableIframePointerEvents: true,
            onMove(event) {
                let newLeft = startLeft + (event.clientX - startX);
                let newTop = startTop + (event.clientY - startY);
                // Maintain viewport bounds
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - popup.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - popup.offsetHeight));
                applyPopupCoordinates(popupEntry, newLeft, newTop);
            },
            onEnd() {
                ensurePopupAccessibleTopBar(popupEntry);
            }
        });
    });

    // Add resize handle
    let handle = document.createElement('div');
    handle.className = 'link-preview-resize-handle';
    bodyContainer.appendChild(handle);
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = popup.offsetWidth;
        const startHeight = popup.offsetHeight;
        startPopupMouseInteraction(popupEntry, {
            disableIframePointerEvents: true,
            onMove(event) {
                let newWidth = startWidth + (event.clientX - startX);
                let newHeight = startHeight + (event.clientY - startY);
                // Enforce minimum dimensions
                if (newWidth < POPUP_MIN_WIDTH) newWidth = POPUP_MIN_WIDTH;
                if (newHeight < POPUP_MIN_HEIGHT) newHeight = POPUP_MIN_HEIGHT;
                popup.style.width = newWidth + 'px';
                popup.style.height = newHeight + 'px';
            }
        });
    });

}

function closePopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry || !entry.popup) return;
    if (typeof entry.activeMouseInteractionCleanup === 'function') {
        entry.activeMouseInteractionCleanup();
    }
    if (entry.attentionTimer) {
        clearTimeout(entry.attentionTimer);
        entry.attentionTimer = null;
    }
    clearPopupLoadLifecycle(entry);
    entry.popup.style.opacity = '0';
    setTimeout(() => {
        if (entry.popup) entry.popup.remove();
        popups = popups.filter(p => p.popupId !== popupId);
    }, 300);
}

function clearPopupLoadLifecycle(popupEntry) {
    if (popupEntry.loadingAnimationTimer) {
        clearInterval(popupEntry.loadingAnimationTimer);
        popupEntry.loadingAnimationTimer = null;
    }
    if (popupEntry.blockedTimeoutTimer) {
        clearTimeout(popupEntry.blockedTimeoutTimer);
        popupEntry.blockedTimeoutTimer = null;
    }
    if (popupEntry.postLoadGraceTimer) {
        clearTimeout(popupEntry.postLoadGraceTimer);
        popupEntry.postLoadGraceTimer = null;
    }
}

function setPopupLoadingState(popupEntry) {
    clearPopupLoadLifecycle(popupEntry);
    popupEntry.state = 'loading';
    if (!popupEntry.loadingBar) return;
    const loadingBar = popupEntry.loadingBar;
    loadingBar.style.background = '';
    loadingBar.style.width = '0%';
    loadingBar.style.opacity = '1';
    let progress = 0;
    popupEntry.loadingAnimationTimer = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) progress = 90;
        loadingBar.style.width = progress + '%';
    }, 80);
}

function finishPopupLoadingState(popupEntry) {
    if (!popupEntry.loadingBar) return;
    clearPopupLoadLifecycle(popupEntry);
    popupEntry.loadingBar.style.width = '100%';
    setTimeout(() => {
        if (popupEntry.loadingBar) popupEntry.loadingBar.style.opacity = '0';
    }, 500);
}

function renderPopupFallback(popupEntry, message, state) {
    const fallbackUrl = popupEntry.originalUrl || popupEntry.requestedUrl;
    const fallback = document.createElement('div');
    fallback.className = 'link-preview-fallback';

    const messageNode = document.createElement('div');
    messageNode.textContent = message;
    fallback.appendChild(messageNode);

    const urlNode = document.createElement('div');
    urlNode.className = 'link-preview-fallback-url';
    urlNode.textContent = fallbackUrl;
    fallback.appendChild(urlNode);

    const actions = document.createElement('div');
    actions.className = 'link-preview-fallback-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'link-preview-fallback-action link-preview-fallback-action--primary';
    openBtn.textContent = 'Open in new tab';
    openBtn.onclick = () => window.open(fallbackUrl, '_blank');
    actions.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'link-preview-fallback-action';
    copyBtn.textContent = 'Copy link';
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(fallbackUrl);
            copyBtn.textContent = 'Copied';
            setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200);
        } catch (_) {
            copyBtn.textContent = 'Copy failed';
            setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200);
        }
    };
    actions.appendChild(copyBtn);
    fallback.appendChild(actions);

    popupEntry.state = state;
    popupEntry.fallback = fallback;
    if (popupEntry.bodyContainer) {
        popupEntry.bodyContainer.appendChild(fallback);
    }
    requestAnimationFrame(() => {
        ensurePopupAccessibleTopBar(popupEntry);
    });
}

function clearPopupBodyContent(popupEntry) {
    if (!popupEntry.bodyContainer) return;
    if (popupEntry.iframe && popupEntry.iframe.parentNode === popupEntry.bodyContainer) {
        popupEntry.bodyContainer.removeChild(popupEntry.iframe);
    }
    if (popupEntry.fallback && popupEntry.fallback.parentNode === popupEntry.bodyContainer) {
        popupEntry.bodyContainer.removeChild(popupEntry.fallback);
    }
    popupEntry.iframe = null;
    popupEntry.fallback = null;
}

function getLoadedIframeUrl(popupEntry, iframe) {
    try {
        const href = iframe.contentWindow && iframe.contentWindow.location && iframe.contentWindow.location.href;
        if (href && href !== 'about:blank') return href;
    } catch (_) {
        // Cross-origin access errors are expected; fallback to known URL values.
    }
    return iframe.src || popupEntry.currentUrl || popupEntry.requestedUrl;
}

function getActiveCandidateState(popupEntry) {
    const candidateIndex = popupEntry.activeCandidateIndex;
    const totalCandidates = popupEntry.previewCandidates.length;
    return {
        candidateIndex,
        totalCandidates,
        hasAlternate: totalCandidates > 1,
        isOriginalCandidate: candidateIndex === 0,
        isAlternateCandidate: candidateIndex > 0,
        requiresFrameLiveness: candidateIndex === 0 && totalCandidates === 1
    };
}

function finalizePopupReady(popupEntry, iframe) {
    popupEntry.currentUrl = getLoadedIframeUrl(popupEntry, iframe);
    popupEntry.currentPreviewUrl = popupEntry.previewCandidates[popupEntry.activeCandidateIndex] || popupEntry.currentPreviewUrl;
    popupEntry.state = 'ready';
    logPreviewDebug('finalize ready', {
        popupId: popupEntry.popupId,
        attemptId: popupEntry.activeAttemptId,
        candidateIndex: popupEntry.activeCandidateIndex,
        url: popupEntry.currentPreviewUrl
    });
    finishPopupLoadingState(popupEntry);
}

function finalizePopupBlocked(popupEntry, message) {
    logPreviewDebug('finalize blocked', {
        popupId: popupEntry.popupId,
        attemptId: popupEntry.activeAttemptId,
        candidateIndex: popupEntry.activeCandidateIndex,
        url: popupEntry.currentPreviewUrl,
        message: message || 'This page cannot be shown in an embedded preview.'
    });
    finishPopupLoadingState(popupEntry);
    clearPopupBodyContent(popupEntry);
    renderPopupFallback(
        popupEntry,
        message || 'This page cannot be shown in an embedded preview.',
        'blocked'
    );
}

function advanceToNextCandidate(popupEntry, attemptId) {
    if (!popupEntry || popupEntry.activeAttemptId !== attemptId || popupEntry.state !== 'loading') return false;
    clearPopupLoadLifecycle(popupEntry);
    popupEntry.activeCandidateIndex += 1;
    if (popupEntry.activeCandidateIndex < popupEntry.previewCandidates.length) {
        mountPopupIframe(popupEntry, popupEntry.previewCandidates[popupEntry.activeCandidateIndex]);
        return true;
    }
    return false;
}

function failActiveCandidate(popupEntry, attemptId, reason) {
    if (!popupEntry || popupEntry.activeAttemptId !== attemptId || popupEntry.state !== 'loading') return;
    if (reason === 'error') {
        logPreviewDebug('iframe error', {
            popupId: popupEntry.popupId,
            attemptId,
            candidateIndex: popupEntry.activeCandidateIndex,
            url: popupEntry.currentPreviewUrl
        });
    } else if (reason === 'timeout') {
        logPreviewDebug('hard timeout', {
            popupId: popupEntry.popupId,
            attemptId,
            candidateIndex: popupEntry.activeCandidateIndex,
            url: popupEntry.currentPreviewUrl
        });
    }
    if (advanceToNextCandidate(popupEntry, attemptId)) {
        return;
    }
    const message = reason === 'error'
        ? 'Preview failed to load. Try opening the page in a new tab.'
        : 'This page cannot be shown in an embedded preview.';
    finalizePopupBlocked(popupEntry, message);
}

function mountPopupIframe(popupEntry, url) {
    clearPopupBodyContent(popupEntry);
    popupEntry.currentPreviewUrl = url;
    popupEntry.currentUrl = url;
    const attemptId = popupEntry.activeAttemptId + 1;
    popupEntry.activeAttemptId = attemptId;
    popupEntry.activeCandidateLoaded = false;
    popupEntry.activeCandidateFrameAlive = false;
    const candidateState = getActiveCandidateState(popupEntry);
    logPreviewDebug('candidate mount', {
        popupId: popupEntry.popupId,
        attemptId,
        candidateIndex: candidateState.candidateIndex,
        totalCandidates: candidateState.totalCandidates,
        url
    });

    const iframe = document.createElement('iframe');
    iframe.className = 'link-preview-iframe';
    iframe.src = url;
    popupEntry.iframe = iframe;
    popupEntry.bodyContainer.appendChild(iframe);

    iframe.addEventListener('load', () => {
        if (popupEntry.iframe !== iframe || popupEntry.activeAttemptId !== attemptId) return;
        const activeCandidateState = getActiveCandidateState(popupEntry);
        popupEntry.activeCandidateLoaded = true;
        logPreviewDebug('iframe load', {
            popupId: popupEntry.popupId,
            attemptId,
            candidateIndex: activeCandidateState.candidateIndex,
            totalCandidates: activeCandidateState.totalCandidates,
            url: popupEntry.currentPreviewUrl
        });
        if (activeCandidateState.isOriginalCandidate && activeCandidateState.hasAlternate) {
            logPreviewDebug('quick failover from original to alternate', {
                popupId: popupEntry.popupId,
                attemptId,
                candidateIndex: activeCandidateState.candidateIndex,
                url: popupEntry.currentPreviewUrl
            });
            advanceToNextCandidate(popupEntry, attemptId);
            return;
        }
        if (activeCandidateState.requiresFrameLiveness) {
            if (popupEntry.activeCandidateFrameAlive) {
                finalizePopupReady(popupEntry, iframe);
                return;
            }
            popupEntry.postLoadGraceTimer = setTimeout(() => {
                failActiveCandidate(popupEntry, attemptId, 'no-frame-liveness-after-load');
            }, ORIGINAL_LIVENESS_GRACE_MS);
            return;
        }
        finalizePopupReady(popupEntry, iframe);
    }, { once: true });

    iframe.addEventListener('error', () => {
        if (popupEntry.iframe !== iframe || popupEntry.activeAttemptId !== attemptId) return;
        failActiveCandidate(popupEntry, attemptId, 'error');
    }, { once: true });

    popupEntry.blockedTimeoutTimer = setTimeout(() => {
        failActiveCandidate(popupEntry, attemptId, 'timeout');
    }, POPUP_HARD_TIMEOUT_MS);
}

function loadPopupUrl(popupEntry, url, options = {}) {
    if (!popupEntry || !url || !popupEntry.bodyContainer) return;
    const { preserveCandidateIndex = false } = options;
    popupEntry.requestedUrl = url;
    popupEntry.originalUrl = url;
    popupEntry.previewIdentityKey = getPreviewIdentityKey(url);
    popupEntry.previewCandidates = buildPreviewCandidates(url);
    popupEntry.activeCandidateIndex = preserveCandidateIndex
        ? Math.min(popupEntry.activeCandidateIndex, popupEntry.previewCandidates.length - 1)
        : 0;
    setPopupLoadingState(popupEntry);
    mountPopupIframe(popupEntry, popupEntry.previewCandidates[popupEntry.activeCandidateIndex]);
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

function flashPopupAttention(popupEntry) {
    if (!popupEntry || !popupEntry.popup) return;
    const popup = popupEntry.popup;
    popup.classList.remove('link-preview-popup--attention');
    void popup.offsetWidth;
    popup.classList.add('link-preview-popup--attention');
    clearTimeout(popupEntry.attentionTimer);
    popupEntry.attentionTimer = setTimeout(() => {
        popup.classList.remove('link-preview-popup--attention');
        popupEntry.attentionTimer = null;
    }, 350);
}

function getPopupById(popupId) {
    return popups.find(p => p.popupId === popupId);
}

function getPopupByIframeWindow(sourceWindow) {
    return popups.find((popupEntry) => popupEntry.iframe && popupEntry.iframe.contentWindow === sourceWindow) || null;
}

function reloadPopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry) return;
    const reloadUrl = entry.originalUrl || entry.requestedUrl;
    loadPopupUrl(entry, reloadUrl);
}

function syncPopupCurrentUrlForEntry(popupEntry, currentUrl) {
    if (!popupEntry || !currentUrl) return;
    popupEntry.currentUrl = currentUrl;
}

function markPopupFrameAliveForEntry(popupEntry, currentUrl) {
    if (!popupEntry || !popupEntry.iframe) return;
    if (currentUrl) popupEntry.currentUrl = currentUrl;
    if (!popupEntry.activeCandidateFrameAlive) {
        popupEntry.activeCandidateFrameAlive = true;
        const candidateState = getActiveCandidateState(popupEntry);
        if (candidateState.requiresFrameLiveness) {
            logPreviewDebug('original/no-alternate liveness confirmation', {
                popupId: popupEntry.popupId,
                attemptId: popupEntry.activeAttemptId,
                candidateIndex: candidateState.candidateIndex,
                url: popupEntry.currentPreviewUrl
            });
        }
    }
    const candidateState = getActiveCandidateState(popupEntry);
    if (!candidateState.requiresFrameLiveness || popupEntry.state !== 'loading' || !popupEntry.activeCandidateLoaded) return;
    finalizePopupReady(popupEntry, popupEntry.iframe);
}
