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
    if (action === 'requestPreviewOpen' || action === 'showPreview') {
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
      syncPopupCurrentUrl(msg.popupId, msg.url, msg.attemptId || null);
      break;
    case 'previewFrameAlive':
    case 'previewRuntimeReady':
      markPopupRuntimeReady(msg.popupId, msg.attemptId, msg.url || null);
      break;
    default:
      break;
  }
}

function onPopupRuntimeMessage(event) {
  if (!enabled || window.self !== window.top) return;
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.source !== 'link-preview-extension' || data.type !== 'popup-runtime-bridge' || data.version !== 1) return;
  if (!isDirectChildWindow(event.source)) return;

  if (data.action === 'bringToFront') {
    bringToFront(data.popupId || null, data.url);
    return;
  }
  if (data.action === 'updatePopupUrl') {
    syncPopupCurrentUrl(data.popupId || null, data.url, data.attemptId || null);
    return;
  }
  if (data.action === 'previewFrameAlive') {
    markPopupRuntimeReady(data.popupId || null, data.attemptId || null, data.url || null);
    return;
  }
  if (data.action === 'previewRuntimeReady') {
    markPopupRuntimeReady(data.popupId || null, data.attemptId || null, data.url || null);
  }
}

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('pointerover', onContentPointerOver);
  document.addEventListener('pointerout', onContentPointerOut);
  document.addEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  window.addEventListener('message', onCoordinateHopMessage);
  window.addEventListener('message', onPopupRuntimeMessage);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('pointerover', onContentPointerOver);
  document.removeEventListener('pointerout', onContentPointerOut);
  document.removeEventListener('keydown', onContentKeyDown);
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
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

function applyPopupCoordinates(popupEntry, left, top) {
    if (!popupEntry || !popupEntry.popup) return;
    popupEntry.popup.style.left = left + 'px';
    popupEntry.popup.style.top = top + 'px';
    popupEntry.x = left;
    popupEntry.y = top;
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

    const hitEl = document.elementFromPoint(point.x, point.y);
    return !!(hitEl && popupEntry.topBar.contains(hitEl));
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

        const blockerEl = document.elementFromPoint(point.x, point.y);
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
        window.open(popupEntry.originalUrl || popupEntry.requestedUrl, '_blank');
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

    document.body.appendChild(popup);
    popupEntry.popup = popup;
    popupEntry.topBar = topBar;
    popupEntry.bodyContainer = bodyContainer;

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
            applyPopupCoordinates(popupEntry, newLeft, newTop);
        }
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Restore text selection
            document.body.style.userSelect = '';
            ensurePopupAccessibleTopBar(popupEntry);
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
        if (popupEntry.iframe) {
            popupEntry.iframe.style.pointerEvents = 'none';
        }
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
            if (popupEntry.iframe) {
                popupEntry.iframe.style.pointerEvents = '';
            }
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
    fallback.style.display = 'flex';
    fallback.style.flexDirection = 'column';
    fallback.style.gap = '10px';
    fallback.style.padding = '14px';
    fallback.style.fontSize = '13px';
    fallback.style.lineHeight = '1.35';
    fallback.style.color = '#1f2937';
    fallback.style.background = '#f8fafc';
    fallback.style.height = '100%';
    fallback.style.boxSizing = 'border-box';

    const messageNode = document.createElement('div');
    messageNode.textContent = message;
    fallback.appendChild(messageNode);

    const urlNode = document.createElement('div');
    urlNode.textContent = fallbackUrl;
    urlNode.style.wordBreak = 'break-all';
    urlNode.style.padding = '8px';
    urlNode.style.borderRadius = '6px';
    urlNode.style.background = '#ffffff';
    urlNode.style.border = '1px solid #d1d5db';
    fallback.appendChild(urlNode);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const openBtn = document.createElement('button');
    openBtn.className = 'link-preview-fallback-open';
    openBtn.textContent = 'Open in new tab';
    openBtn.onclick = () => window.open(fallbackUrl, '_blank');
    actions.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'link-preview-fallback-copy';
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
    iframe.dataset.popupId = popupEntry.popupId;
    iframe.dataset.attemptId = String(attemptId);
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

function reloadPopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry) return;
    const reloadUrl = entry.originalUrl || entry.requestedUrl;
    loadPopupUrl(entry, reloadUrl);
}

function syncPopupCurrentUrl(popupId, currentUrl, attemptId) {
    if (!popupId || !currentUrl) return;
    const entry = getPopupById(popupId);
    if (!entry) return;
    if (attemptId && Number(attemptId) !== entry.activeAttemptId) return;
    entry.currentUrl = currentUrl;
}

function markPopupFrameAlive(popupId, attemptId, currentUrl) {
    if (!popupId || !attemptId) return;
    const entry = getPopupById(popupId);
    if (!entry || Number(attemptId) !== entry.activeAttemptId) return;
    if (currentUrl) entry.currentUrl = currentUrl;
    if (!entry.activeCandidateFrameAlive) {
        entry.activeCandidateFrameAlive = true;
        const candidateState = getActiveCandidateState(entry);
        if (candidateState.requiresFrameLiveness) {
            logPreviewDebug('original/no-alternate liveness confirmation', {
                popupId: entry.popupId,
                attemptId: Number(attemptId),
                candidateIndex: candidateState.candidateIndex,
                url: entry.currentPreviewUrl
            });
        }
    }
    const candidateState = getActiveCandidateState(entry);
    if (!candidateState.requiresFrameLiveness || entry.state !== 'loading' || !entry.activeCandidateLoaded) return;
    if (!entry.iframe) return;
    finalizePopupReady(entry, entry.iframe);
}

function markPopupRuntimeReady(popupId, attemptId, currentUrl) {
    markPopupFrameAlive(popupId, attemptId, currentUrl);
}
