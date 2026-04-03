// content.js
let popups = [];
const {
  readSettings,
  isSettingsChange,
  DEFAULT_SETTINGS
} = globalThis.PreviewSettings;
const {
  getUiI18n
} = globalThis.PreviewI18n;
const {
  applyThemeMarker,
  buildThemeTokenCss,
  subscribeToSystemThemeChange
} = globalThis.PreviewTheme;
let MAX_POPUPS = DEFAULT_SETTINGS.maxPopups;
let popupIdCounter = 0;
// Hover delay before opening popup (ms)
let hoverDelay = DEFAULT_SETTINGS.hoverDelay;

// Enabled/disabled and additional settings
let enabled = DEFAULT_SETTINGS.enabled;
let interactionType = DEFAULT_SETTINGS.interactionType;
let triggerKey = DEFAULT_SETTINGS.triggerKey;
let readerModeSuggestionsEnabled = DEFAULT_SETTINGS.readerModeSuggestions;
let videoModeEnabled = DEFAULT_SETTINGS.videoModeEnabled;
let currentThemeMode = DEFAULT_SETTINGS.themeMode;
let currentI18n = getUiI18n
  ? globalThis.PreviewI18n.createFallbackUiI18n(DEFAULT_SETTINGS)
  : null;
let listenersAttached = false;
const DEBUG_PREVIEW = false;
const ORIGINAL_LIVENESS_GRACE_MS = 1000;
const POPUP_HARD_TIMEOUT_MS = 12000;
const POPUP_READER_ERROR_TIMEOUT_MS = 3500;
const {
  POPUP_MIN_WIDTH,
  POPUP_MIN_HEIGHT,
  DEFAULT_POPUP_SIZE_UNIT,
  PREVIEW_SIZE_UNIT_DEFAULTS,
  normalizePreviewSizeSettings
} = globalThis.PreviewSizeConfig;
let activePopupPointerInteractionCleanup = null;
let popupSizeSettings = {
  popupSizeUnit: DEFAULT_POPUP_SIZE_UNIT,
  popupWidth: PREVIEW_SIZE_UNIT_DEFAULTS.percent.width,
  popupHeight: PREVIEW_SIZE_UNIT_DEFAULTS.percent.height
};
const {
  PREVIEW_MESSAGE_SOURCE,
  FRAME_BRIDGE_MESSAGE_TYPE,
  POPUP_RUNTIME_MESSAGE_TYPE,
  PREVIEW_MESSAGE_VERSION,
  POPUP_RUNTIME_ACTIONS,
  parsePreviewPopupBindingFromWindowName,
  buildPreviewPopupWindowName
} = globalThis.PreviewRuntimeContract;
const PREVIEW_REQUEST_DEDUPE_TTL_MS = 30000;
const RETIRED_FRAME_SESSION_TTL_MS = 30000;
let runtimeIdentityCounter = 0;

function generateRuntimeId(prefix) {
  runtimeIdentityCounter += 1;
  return `${prefix}-${Date.now()}-${runtimeIdentityCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

const runtimeContext = {
  isTopWindow: window.self === window.top,
  sourceContextId: generateRuntimeId('context'),
  frameSessionId: generateRuntimeId('frame'),
  previewPopupBinding: parsePreviewPopupBindingFromWindowName()
};
runtimeContext.isPreviewPopupRuntime = !!runtimeContext.previewPopupBinding;

function logPreviewDebug(event, details) {
  if (!DEBUG_PREVIEW) return;
  console.debug('[link-preview]', event, details);
}

function ownsVisibleThemeSurfaces() {
  return runtimeContext.isTopWindow && !runtimeContext.isPreviewPopupRuntime;
}

function applyStoredSettings(settings) {
  enabled = settings.enabled;
  MAX_POPUPS = settings.maxPopups;
  hoverDelay = settings.hoverDelay;
  interactionType = settings.interactionType;
  triggerKey = settings.triggerKey;
  readerModeSuggestionsEnabled = settings.readerModeSuggestions;
  videoModeEnabled = settings.videoModeEnabled;
  popupSizeSettings = normalizePreviewSizeSettings(settings);
  currentThemeMode = settings.themeMode;
}

async function updateUiI18n(settings) {
  currentI18n = await getUiI18n(settings);
  return currentI18n;
}

function t(messageKey, substitutions = []) {
  if (!currentI18n) {
    return globalThis.chrome?.i18n?.getMessage?.(messageKey, substitutions) || '';
  }
  return currentI18n.t(messageKey, substitutions);
}

function refreshUiI18n(settings) {
  return updateUiI18n(settings).catch((error) => {
    console.warn('[Preview Link] UI localization failed in content runtime. Core preview behavior will continue.', error);
    return currentI18n;
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
readSettings().then((settings) => {
  applyStoredSettings(settings);
  if (ownsVisibleThemeSurfaces()) {
    applyThemeToMountedSurfaces();
  }

  // Preview popups can still act as source/bridge contexts even though they do not own popup lifecycle.
  if (enabled) attachListeners();
  refreshUiI18n(settings);
});

const unsubscribeSystemThemeChange = ownsVisibleThemeSurfaces()
  ? subscribeToSystemThemeChange(() => {
      if (currentThemeMode !== 'auto') return;
      applyThemeToMountedSurfaces();
    })
  : () => {};
window.addEventListener('pagehide', unsubscribeSystemThemeChange, { once: true });

const hoverInteraction = {
  activeLink: null,
  activeUrl: null,
  activeRect: null,
  previewRequestId: null,
  timerId: null,
  timerPending: false,
  keyEligible: false
};
const sharedHoverCandidates = new Map();
const handledPreviewRequests = new Map();
const retiredFrameSessions = new Map();
const popupSessionBindings = new Map();

function getFrameSessionKey(sourceContextId, frameSessionId) {
  return `${sourceContextId}::${frameSessionId}`;
}

function pruneHandledPreviewRequests() {
  const now = Date.now();
  handledPreviewRequests.forEach((entry, previewRequestId) => {
    if (!entry || now - entry.timestamp > PREVIEW_REQUEST_DEDUPE_TTL_MS) {
      handledPreviewRequests.delete(previewRequestId);
    }
  });
}

function pruneRetiredFrameSessions() {
  const now = Date.now();
  retiredFrameSessions.forEach((timestamp, sessionKey) => {
    if (!timestamp || now - timestamp > RETIRED_FRAME_SESSION_TTL_MS) {
      retiredFrameSessions.delete(sessionKey);
    }
  });
}

function isRetiredFrameSession(sourceContextId, frameSessionId) {
  if (!sourceContextId || !frameSessionId) return false;
  pruneRetiredFrameSessions();
  return retiredFrameSessions.has(getFrameSessionKey(sourceContextId, frameSessionId));
}

function rememberHandledPreviewRequest(previewRequest) {
  if (!previewRequest || typeof previewRequest.previewRequestId !== 'string') return false;
  pruneHandledPreviewRequests();
  if (handledPreviewRequests.has(previewRequest.previewRequestId)) {
    return false;
  }
  handledPreviewRequests.set(previewRequest.previewRequestId, {
    sourceContextId: previewRequest.sourceContextId,
    frameSessionId: previewRequest.frameSessionId,
    timestamp: Date.now()
  });
  return true;
}

function clearHandledPreviewRequestsForSource(sourceContextId, frameSessionId) {
  if (!sourceContextId || !frameSessionId) return;
  handledPreviewRequests.forEach((entry, previewRequestId) => {
    if (!entry) return;
    if (entry.sourceContextId === sourceContextId && entry.frameSessionId === frameSessionId) {
      handledPreviewRequests.delete(previewRequestId);
    }
  });
}

function retireFrameSession(sourceContextId, frameSessionId) {
  if (!sourceContextId || !frameSessionId) return;
  retiredFrameSessions.set(getFrameSessionKey(sourceContextId, frameSessionId), Date.now());
  clearSharedHoverCandidate(sourceContextId, frameSessionId);
  clearHandledPreviewRequestsForSource(sourceContextId, frameSessionId);
}

function updateSharedHoverCandidate(previewRequest) {
  if (!runtimeContext.isTopWindow || !previewRequest) return;
  sharedHoverCandidates.set(previewRequest.sourceContextId, {
    ...previewRequest,
    updatedAt: Date.now()
  });
}

function clearSharedHoverCandidate(sourceContextId, frameSessionId) {
  if (!runtimeContext.isTopWindow || !sourceContextId) return;
  const existingCandidate = sharedHoverCandidates.get(sourceContextId);
  if (!existingCandidate) return;
  if (frameSessionId && existingCandidate.frameSessionId !== frameSessionId) return;
  sharedHoverCandidates.delete(sourceContextId);
}

function getMostRecentSharedHoverCandidate() {
  if (!runtimeContext.isTopWindow) return null;
  let activeCandidate = null;
  sharedHoverCandidates.forEach((candidate) => {
    if (!candidate || !isRectPayload(candidate.rect) || !candidate.requestedUrl) return;
    if (!activeCandidate || candidate.updatedAt > activeCandidate.updatedAt) {
      activeCandidate = candidate;
    }
  });
  return activeCandidate;
}

function clearHoverTimer() {
  if (hoverInteraction.timerId) {
    clearTimeout(hoverInteraction.timerId);
  }
  hoverInteraction.timerId = null;
  hoverInteraction.timerPending = false;
}

function createFrameBridgeMessage(action, payload = {}) {
  return {
    source: PREVIEW_MESSAGE_SOURCE,
    type: FRAME_BRIDGE_MESSAGE_TYPE,
    version: PREVIEW_MESSAGE_VERSION,
    action,
    sourceContextId: runtimeContext.sourceContextId,
    frameSessionId: runtimeContext.frameSessionId,
    ...payload
  };
}

function createLocalPreviewRequest(url, rectPayload, trigger) {
  if (!url || !isRectPayload(rectPayload)) return null;
  if (!hoverInteraction.previewRequestId) {
    hoverInteraction.previewRequestId = generateRuntimeId('request');
  }
  return {
    previewRequestId: hoverInteraction.previewRequestId,
    sourceContextId: runtimeContext.sourceContextId,
    frameSessionId: runtimeContext.frameSessionId,
    requestedUrl: url,
    trigger: trigger || null,
    rect: rectPayload
  };
}

function resetHoverInteraction() {
  clearHoverTimer();
  hoverInteraction.activeLink = null;
  hoverInteraction.activeUrl = null;
  hoverInteraction.activeRect = null;
  hoverInteraction.previewRequestId = null;
  hoverInteraction.keyEligible = false;
}

function dispatchHoverClear() {
  if (runtimeContext.isTopWindow) {
    clearSharedHoverCandidate(runtimeContext.sourceContextId, runtimeContext.frameSessionId);
    return;
  }
  window.parent.postMessage(
    createFrameBridgeMessage('clearHover'),
    '*'
  );
}

function dispatchSourceContextTeardown() {
  if (runtimeContext.isTopWindow) {
    retireFrameSession(runtimeContext.sourceContextId, runtimeContext.frameSessionId);
    return;
  }
  window.parent.postMessage(
    createFrameBridgeMessage('sourceContextTeardown'),
    '*'
  );
}

function dispatchKeyPreviewOpen() {
  if (runtimeContext.isTopWindow) {
    openKeyPreviewFromSharedHover();
    return;
  }
  window.parent.postMessage(
    createFrameBridgeMessage('requestSharedHoverOpen'),
    '*'
  );
}

function isEligibleAnchor(link) {
  return !!(link && link.href && link.offsetWidth > 0 && link.offsetHeight > 0);
}

function getActiveElementChain(root = document) {
  const activeElementChain = [];
  let activeElement = root && 'activeElement' in root ? root.activeElement : null;
  while (activeElement && !activeElementChain.includes(activeElement)) {
    activeElementChain.push(activeElement);
    const nextRoot = activeElement.shadowRoot;
    if (!nextRoot || !nextRoot.activeElement) break;
    activeElement = nextRoot.activeElement;
  }
  return activeElementChain;
}

function getFocusedPreviewPopupContext() {
  const activeElementChain = getActiveElementChain(document);
  if (!activeElementChain.length) return null;

  for (const popupEntry of popups) {
    if (!popupEntry || popupEntry.isClosing) continue;
    const matchesPopupFocus = activeElementChain.some((element) => {
      if (!element) return false;
      if (element === popupEntry.popup || element === popupEntry.iframe) return true;
      if (!popupEntry.shadowRoot || typeof element.getRootNode !== 'function') return false;
      return element.getRootNode() === popupEntry.shadowRoot;
    });
    if (!matchesPopupFocus) continue;
    return {
      popupEntry,
      activeElementChain,
      effectiveActiveElement: activeElementChain[activeElementChain.length - 1]
    };
  }

  return null;
}

function normalizeFocusForMainPageHoverIntent() {
  if (!runtimeContext.isTopWindow || runtimeContext.isPreviewPopupRuntime) return;
  if (interactionType !== 'hoverWithKey') return;
  const focusedPreviewContext = getFocusedPreviewPopupContext();
  if (!focusedPreviewContext) return;

  const activeElement = focusedPreviewContext.effectiveActiveElement;

  if (typeof activeElement.blur === 'function') {
    activeElement.blur();
  }

  const focusTarget = document.body || document.documentElement;
  if (!focusTarget || typeof focusTarget.focus !== 'function') return;
  const hadTabIndex = typeof focusTarget.hasAttribute === 'function' && focusTarget.hasAttribute('tabindex');
  if (!hadTabIndex && focusTarget.tabIndex < 0 && typeof focusTarget.setAttribute === 'function') {
    focusTarget.setAttribute('tabindex', '-1');
  }
  try {
    focusTarget.focus({ preventScroll: true });
  } catch (_) {
    focusTarget.focus();
  }
  if (!hadTabIndex && document.activeElement === focusTarget && typeof focusTarget.removeAttribute === 'function') {
    focusTarget.removeAttribute('tabindex');
  }
}

function onContentPointerOver(e) {
  if (!enabled) return;
  const link = e.target.closest('a[href]');
  if (!isEligibleAnchor(link)) {
    return;
  }
  normalizeFocusForMainPageHoverIntent();
  if (hoverInteraction.activeLink === link) return;

  clearHoverTimer();

  const rect = link.getBoundingClientRect();
  const localRect = rectToPayload(rect);
  hoverInteraction.activeLink = link;
  hoverInteraction.activeUrl = link.href;
  hoverInteraction.activeRect = localRect;
  hoverInteraction.previewRequestId = generateRuntimeId('request');
  hoverInteraction.keyEligible = interactionType === 'hoverWithKey';
  const hoverPreviewRequest = createLocalPreviewRequest(link.href, localRect, null);
  if (hoverPreviewRequest) {
    dispatchPreviewRequest('updateHover', hoverPreviewRequest);
  }

  if (interactionType === 'hover') {
    const enteredLink = link;
    const enteredUrl = link.href;
    const enteredPreviewRequestId = hoverInteraction.previewRequestId;
    hoverInteraction.timerPending = true;
    hoverInteraction.timerId = setTimeout(() => {
      if (
        hoverInteraction.activeLink !== enteredLink ||
        hoverInteraction.activeUrl !== enteredUrl ||
        hoverInteraction.previewRequestId !== enteredPreviewRequestId
      ) {
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
  const previewRequest = createLocalPreviewRequest(url, rectPayload, trigger || null);
  if (!previewRequest) return;
  dispatchPreviewRequest('requestPreviewOpen', previewRequest);
}

function openKeyPreviewFromSharedHover() {
  if (!enabled) return;
  const hoverCandidate = getMostRecentSharedHoverCandidate();
  if (!hoverCandidate) return;
  handlePreviewOpenRequest({
    ...hoverCandidate,
    trigger: 'key'
  });
}

function dispatchPreviewRequest(action, previewRequest) {
  if (!previewRequest || !isRectPayload(previewRequest.rect)) return;
  if (runtimeContext.isTopWindow) {
    if (action === 'updateHover') {
      updateSharedHoverCandidate(previewRequest);
      return;
    }
    if (action === 'requestPreviewOpen') {
      handlePreviewOpenRequest(previewRequest);
      return;
    }
    return;
  }
  window.parent.postMessage(
    createFrameBridgeMessage(action, previewRequest),
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

function getDirectChildFrameElement(sourceWindow) {
  if (!sourceWindow) return null;
  const frameElements = document.querySelectorAll('iframe, frame');
  for (const frameElement of frameElements) {
    try {
      if (frameElement.contentWindow === sourceWindow) {
        return frameElement;
      }
    } catch (_) {
      // Ignore inaccessible frame elements and keep scanning.
    }
  }
  return null;
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

function normalizeFrameBridgeMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.source !== PREVIEW_MESSAGE_SOURCE || data.type !== FRAME_BRIDGE_MESSAGE_TYPE || data.version !== PREVIEW_MESSAGE_VERSION) {
    return null;
  }
  if (typeof data.action !== 'string') return null;
  if (typeof data.sourceContextId !== 'string' || typeof data.frameSessionId !== 'string') return null;

  if (data.action === 'clearHover' || data.action === 'sourceContextTeardown' || data.action === 'requestSharedHoverOpen') {
    return {
      action: data.action,
      sourceContextId: data.sourceContextId,
      frameSessionId: data.frameSessionId
    };
  }

  if (data.action !== 'updateHover' && data.action !== 'requestPreviewOpen') return null;
  const requestedUrl = typeof data.requestedUrl === 'string'
    ? data.requestedUrl
    : (typeof data.url === 'string' ? data.url : null);
  if (!requestedUrl || !isRectPayload(data.rect) || typeof data.previewRequestId !== 'string') return null;

  return {
    action: data.action,
    previewRequestId: data.previewRequestId,
    sourceContextId: data.sourceContextId,
    frameSessionId: data.frameSessionId,
    requestedUrl,
    trigger: typeof data.trigger === 'string' ? data.trigger : null,
    rect: data.rect
  };
}

function relayFrameBridgeMessage(message) {
  if (runtimeContext.isTopWindow) return;
  window.parent.postMessage(
    {
      source: PREVIEW_MESSAGE_SOURCE,
      type: FRAME_BRIDGE_MESSAGE_TYPE,
      version: PREVIEW_MESSAGE_VERSION,
      ...message
    },
    '*'
  );
}

function routeFrameBridgeMessage(event, message) {
  if (!isDirectChildWindow(event.source)) return;
  if (isRetiredFrameSession(message.sourceContextId, message.frameSessionId)) return;

  if (message.action === 'clearHover') {
    if (runtimeContext.isTopWindow) {
      clearSharedHoverCandidate(message.sourceContextId, message.frameSessionId);
      return;
    }
    relayFrameBridgeMessage(message);
    return;
  }

  if (message.action === 'sourceContextTeardown') {
    if (runtimeContext.isTopWindow) {
      retireFrameSession(message.sourceContextId, message.frameSessionId);
      return;
    }
    relayFrameBridgeMessage(message);
    return;
  }

  if (message.action === 'requestSharedHoverOpen') {
    if (runtimeContext.isTopWindow) {
      openKeyPreviewFromSharedHover();
      return;
    }
    relayFrameBridgeMessage(message);
    return;
  }

  const sourceFrameElement = getDirectChildFrameElement(event.source);
  if (!sourceFrameElement) return;
  const rect = addFrameOffsetToRect(message.rect, sourceFrameElement.getBoundingClientRect());

  const propagatedRequest = {
    ...message,
    rect
  };
  if (runtimeContext.isTopWindow) {
    if (message.action === 'updateHover') {
      updateSharedHoverCandidate(propagatedRequest);
      return;
    }
    if (message.action === 'requestPreviewOpen') {
      handlePreviewOpenRequest(propagatedRequest);
    }
    return;
  }

  relayFrameBridgeMessage(propagatedRequest);
}

function normalizePopupRuntimeMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.source !== PREVIEW_MESSAGE_SOURCE || data.type !== POPUP_RUNTIME_MESSAGE_TYPE || data.version !== PREVIEW_MESSAGE_VERSION) {
    return null;
  }
  if (typeof data.action !== 'string' || typeof data.popupId !== 'string' || typeof data.popupSessionId !== 'string') {
    return null;
  }
  if (
    data.action === POPUP_RUNTIME_ACTIONS.BRING_TO_FRONT ||
    data.action === POPUP_RUNTIME_ACTIONS.NAVIGATE_PREVIEW ||
    data.action === POPUP_RUNTIME_ACTIONS.UPDATE_URL ||
    data.action === POPUP_RUNTIME_ACTIONS.FRAME_ALIVE
  ) {
    return {
      action: data.action,
      popupId: data.popupId,
      popupSessionId: data.popupSessionId,
      url: typeof data.url === 'string' ? data.url : null
    };
  }
  if (data.action === POPUP_RUNTIME_ACTIONS.REPORT_READERABILITY) {
    return {
      action: data.action,
      popupId: data.popupId,
      popupSessionId: data.popupSessionId,
      url: typeof data.url === 'string' ? data.url : null,
      readerable: data.readerable === true
    };
  }
  if (data.action === POPUP_RUNTIME_ACTIONS.READER_MODE_RESULT && typeof data.requestId === 'string') {
    return {
      action: data.action,
      popupId: data.popupId,
      popupSessionId: data.popupSessionId,
      url: typeof data.url === 'string' ? data.url : null,
      requestId: data.requestId,
      success: data.success === true,
      article: data.article && typeof data.article === 'object' ? data.article : null
    };
  }
  return null;
}

function routePopupRuntimeMessage(message) {
  if (!runtimeContext.isTopWindow) return;
  const popupEntry = getPopupByRuntimeBinding(message.popupId, message.popupSessionId);
  if (!popupEntry) return;

  if (message.action === POPUP_RUNTIME_ACTIONS.BRING_TO_FRONT) {
    bringToFront(popupEntry.popupId);
    return;
  }
  if (message.action === POPUP_RUNTIME_ACTIONS.NAVIGATE_PREVIEW) {
    if (!message.url) return;
    bringToFront(popupEntry.popupId);
    loadPopupUrl(popupEntry, message.url, { preserveSourceContext: true });
    return;
  }
  if (message.action === POPUP_RUNTIME_ACTIONS.UPDATE_URL) {
    syncPopupCurrentUrlForEntry(popupEntry, message.url || null);
    return;
  }
  if (message.action === POPUP_RUNTIME_ACTIONS.FRAME_ALIVE) {
    markPopupFrameAliveForEntry(popupEntry, message.url || null);
    return;
  }
  if (message.action === POPUP_RUNTIME_ACTIONS.REPORT_READERABILITY) {
    handlePopupReaderabilityReport(popupEntry, message.url || popupEntry.currentUrl || '', message.readerable);
    return;
  }
  if (message.action === POPUP_RUNTIME_ACTIONS.READER_MODE_RESULT) {
    handlePopupReaderModeResult(popupEntry, message);
  }
}

function onWindowMessage(event) {
  if (!enabled) return;
  const data = event && event.data;
  const frameBridgeMessage = normalizeFrameBridgeMessage(data);
  if (frameBridgeMessage) {
    routeFrameBridgeMessage(event, frameBridgeMessage);
    return;
  }
  if (!runtimeContext.isTopWindow) return;
  const popupRuntimeMessage = normalizePopupRuntimeMessage(data);
  if (popupRuntimeMessage) {
    routePopupRuntimeMessage(popupRuntimeMessage);
  }
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

function onContextPageHide(event) {
  dispatchHoverClear();
  resetHoverInteraction();
  if (event && event.persisted) return;
  dispatchSourceContextTeardown();
}

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('pointerover', onContentPointerOver);
  document.addEventListener('pointerout', onContentPointerOut);
  document.addEventListener('keydown', onContentKeyDown);
  window.addEventListener('message', onWindowMessage);
  window.addEventListener('pagehide', onContextPageHide);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('pointerover', onContentPointerOver);
  document.removeEventListener('pointerout', onContentPointerOut);
  document.removeEventListener('keydown', onContentKeyDown);
  window.removeEventListener('message', onWindowMessage);
  window.removeEventListener('pagehide', onContextPageHide);
  dispatchHoverClear();
  resetHoverInteraction();
  listenersAttached = false;
}

// Update settings on change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !isSettingsChange(changes)) return;

  readSettings().then((settings) => {
    const wasEnabled = enabled;
    const previousInteractionType = interactionType;

    applyStoredSettings(settings);

    if (previousInteractionType !== interactionType) {
      dispatchHoverClear();
      resetHoverInteraction();
    }

    if (enabled) {
      attachListeners();
    } else {
      detachListeners();
      if (wasEnabled && !enabled && runtimeContext.isTopWindow) {
        popups.slice().forEach((p) => closePopup(p.popupId));
        popups = [];
      }
    }

    if (ownsVisibleThemeSurfaces()) {
      applyThemeToMountedSurfaces();
    }
    refreshUiI18n(settings).then(() => {
      popups.forEach((popupEntry) => {
        syncPopupVideoModeBadge(popupEntry);
        updatePopupReaderUi(popupEntry);
      });
    });
  });
});

// z-index counter to manage popup stacking
let zIndexCounter = 1000;

function handlePreviewOpenRequest(msg) {
  if (!runtimeContext.isTopWindow || runtimeContext.isPreviewPopupRuntime) return;
  if (!msg || typeof msg.previewRequestId !== 'string' || typeof msg.sourceContextId !== 'string' || typeof msg.frameSessionId !== 'string') {
    return;
  }
  if (isRetiredFrameSession(msg.sourceContextId, msg.frameSessionId)) return;
  const requestedUrl = typeof msg.requestedUrl === 'string'
    ? msg.requestedUrl
    : (typeof msg.url === 'string' ? msg.url : null);
  if (!requestedUrl) return;
  const anchorRect = isRectPayload(msg.rect) ? msg.rect : null;
  if (!rememberHandledPreviewRequest({
    previewRequestId: msg.previewRequestId,
    sourceContextId: msg.sourceContextId,
    frameSessionId: msg.frameSessionId
  })) {
    return;
  }
  const anchorPoint = anchorRect ? rectPayloadToAnchor(anchorRect) : { x: 0, y: 0 };
  createPopup(requestedUrl, anchorPoint.x, anchorPoint.y, anchorRect, {
    previewRequestId: msg.previewRequestId,
    sourceContextId: msg.sourceContextId,
    trigger: typeof msg.trigger === 'string' ? msg.trigger : null
  });
}

const CONTENT_THEME_SURFACE_STYLES = `
${buildThemeTokenCss('.link-preview-theme-surface')}

.link-preview-limit-notice {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    padding: 8px 12px;
    border: 1px solid var(--pl-notice-border);
    border-radius: 8px;
    background: var(--pl-notice-bg);
    color: var(--pl-notice-text);
    box-shadow: 0 4px 16px var(--pl-shadow-overlay);
    font: 13px/1.2 "Segoe UI", Arial, sans-serif;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
}
`;

function ensureContentThemeSurfaceStyles() {
    if (!ownsVisibleThemeSurfaces()) return;
    if (document.getElementById('link-preview-theme-surface-styles')) return;
    const style = document.createElement('style');
    style.id = 'link-preview-theme-surface-styles';
    style.textContent = CONTENT_THEME_SURFACE_STYLES;
    (document.head || document.documentElement).appendChild(style);
}

function applyThemeToPopupEntry(popupEntry) {
    if (!popupEntry || !popupEntry.popup) return;
    applyThemeMarker(popupEntry.popup, currentThemeMode);
}

function applyThemeToMountedSurfaces() {
    if (!ownsVisibleThemeSurfaces()) return;
    const limitNotice = document.getElementById('link-preview-limit-notice');
    if (!popups.length && !limitNotice) return;
    ensureContentThemeSurfaceStyles();
    popups.forEach((popupEntry) => {
        applyThemeToPopupEntry(popupEntry);
    });
    if (limitNotice) {
        applyThemeMarker(limitNotice, currentThemeMode);
    }
}

function clearLimitNoticeLifecycle(notice) {
    if (!notice) return;
    clearTimeout(notice._fadeTimer);
    clearTimeout(notice._removeTimer);
    notice._fadeTimer = null;
    notice._removeTimer = null;
}

function scheduleLimitNoticeRemoval(notice) {
    if (!notice) return;
    clearLimitNoticeLifecycle(notice);
    notice._fadeTimer = setTimeout(() => {
        notice.style.opacity = '0';
        notice._removeTimer = setTimeout(() => {
            if (notice.parentNode) {
                notice.remove();
            }
        }, 220);
    }, 1800);
}

function showLimitReachedNotice() {
    ensureContentThemeSurfaceStyles();
    const message = t('notice_previewLimitReached', [MAX_POPUPS]);
    const existing = document.getElementById('link-preview-limit-notice');
    if (existing) {
        existing.textContent = message;
        applyThemeMarker(existing, currentThemeMode);
        existing.style.opacity = '1';
        scheduleLimitNoticeRemoval(existing);
        return;
    }

    const notice = document.createElement('div');
    notice.id = 'link-preview-limit-notice';
    notice.className = 'link-preview-theme-surface link-preview-limit-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.textContent = message;
    applyThemeMarker(notice, currentThemeMode);
    document.body.appendChild(notice);
    requestAnimationFrame(() => {
        notice.style.opacity = '1';
    });
    scheduleLimitNoticeRemoval(notice);
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
${buildThemeTokenCss(':host')}

:host {
    all: initial;
    position: fixed;
    z-index: 999999;
    min-width: ${POPUP_MIN_WIDTH}px;
    min-height: ${POPUP_MIN_HEIGHT}px;
    display: flex;
    flex-direction: column;
    background: var(--pl-panel);
    border: 2px solid var(--pl-accent);
    border-radius: 12px;
    box-shadow: 0 8px 32px var(--pl-shadow-overlay);
    overflow: hidden;
    box-sizing: border-box;
    pointer-events: auto;
    opacity: 0;
    transform: scale(1);
    transition: opacity 0.3s, transform 0.3s, border-color 0.2s ease, box-shadow 0.2s ease;
    color: var(--pl-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.4;
    --pl-reader-surface: #fffdf9;
    --pl-reader-surface-subtle: #f6f1e8;
    --pl-reader-border: #ddd3c3;
    --pl-reader-border-strong: #bea98b;
    --pl-reader-text: #1f2933;
    --pl-reader-muted: #625b51;
    --pl-reader-link: #1f5fbf;
    --pl-reader-link-visited: #6f42c1;
    --pl-reader-code-text: #2f3b4d;
}

:host(.link-preview-popup--attention) {
    border-color: var(--pl-attention-border);
    box-shadow: 0 0 0 4px var(--pl-attention-ring), 0 8px 32px var(--pl-shadow-overlay);
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
    background: var(--pl-topbar-bg);
    border-bottom: 1px solid var(--pl-border-strong);
    user-select: none;
    touch-action: none;
    cursor: move;
}

.link-preview-topbar-action {
    position: absolute;
    top: 4px;
    left: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    margin: 0;
    padding: 0 10px;
    border: 1px solid var(--pl-border);
    border-radius: 999px;
    background: var(--pl-button-bg);
    box-shadow: 0 1px 4px var(--pl-shadow-control);
    color: var(--pl-accent-strong);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
}

.link-preview-topbar-action:hover {
    background: var(--pl-button-bg-hover);
    border-color: var(--pl-border-strong);
    color: var(--pl-accent-strong);
}

.link-preview-topbar-action:focus-visible {
    outline: 2px solid var(--pl-accent);
    outline-offset: 1px;
}

.link-preview-topbar-action:active {
    background: var(--pl-button-bg-active);
}

.link-preview-topbar-action[hidden] {
    display: none !important;
}

.link-preview-topbar-action:disabled {
    pointer-events: none;
}

.link-preview-topbar-badge {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: calc(100% - 210px);
    min-height: 22px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--pl-accent) 18%, var(--pl-border) 82%);
    border-radius: 999px;
    background: color-mix(in srgb, var(--pl-accent) 10%, var(--pl-button-bg) 90%);
    color: var(--pl-accent-strong);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
}

.link-preview-topbar-badge[hidden] {
    display: none !important;
}

.link-preview-curtain {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--pl-border);
    background: color-mix(in srgb, var(--pl-accent) 10%, var(--pl-panel) 90%);
    color: var(--pl-text);
}

.link-preview-curtain[hidden] {
    display: none !important;
}

.link-preview-curtain--error {
    background: color-mix(in srgb, var(--pl-notice-bg) 72%, var(--pl-panel) 28%);
}

.link-preview-curtain-message {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
}

.link-preview-curtain-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
}

.link-preview-curtain-button,
.link-preview-curtain-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    margin: 0;
    border: 1px solid var(--pl-border);
    background: var(--pl-button-bg);
    color: var(--pl-text);
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
}

.link-preview-curtain-button {
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
}

.link-preview-curtain-button--primary {
    border-color: var(--pl-accent);
    background: var(--pl-accent);
    color: #ffffff;
}

.link-preview-curtain-button:hover,
.link-preview-curtain-dismiss:hover {
    background: var(--pl-button-bg-hover);
}

.link-preview-curtain-button--primary:hover {
    background: var(--pl-accent-hover);
}

.link-preview-curtain-button:focus-visible,
.link-preview-curtain-dismiss:focus-visible {
    outline: 2px solid var(--pl-accent);
    outline-offset: 1px;
}

.link-preview-curtain-dismiss {
    width: 28px;
    padding: 0;
    border-radius: 999px;
}

.link-preview-curtain-dismiss svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
}

.link-preview-body {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: var(--pl-preview-canvas);
}

.link-preview-loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    height: 4px;
    width: 0%;
    background: linear-gradient(90deg, var(--pl-loading-start), var(--pl-loading-end));
    transition: width 0.2s, opacity 0.5s;
    opacity: 1;
    pointer-events: none;
}

.link-preview-iframe {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    border: none;
    background: var(--pl-preview-canvas);
}

.link-preview-reader {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: var(--pl-reader-surface);
}

.link-preview-reader-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 0;
}

.link-preview-reader-article {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 10px 18px 28px;
    background: var(--pl-reader-surface);
    color: var(--pl-reader-text);
}

.link-preview-reader-title {
    margin: 0 0 10px;
    color: var(--pl-reader-text);
    font-size: 24px;
    line-height: 1.2;
}

.link-preview-reader-meta {
    margin: 0 0 12px;
    color: var(--pl-reader-muted);
    font-size: 12px;
}

.link-preview-reader-excerpt {
    margin: 0 0 18px;
    color: var(--pl-reader-text);
    font-size: 14px;
    line-height: 1.5;
}

.link-preview-reader-content {
    color: var(--pl-reader-text);
    font-size: 15px;
    line-height: 1.7;
}

.link-preview-reader-content :where(h1, h2, h3, h4, h5, h6, strong, b, th) {
    color: var(--pl-reader-text);
}

.link-preview-reader-content :where(p, li, td, figcaption, small) {
    color: inherit;
}

.link-preview-reader-content > *:first-child {
    margin-top: 0;
}

.link-preview-reader-content > *:last-child {
    margin-bottom: 0;
}

.link-preview-reader-content a {
    color: var(--pl-reader-link);
}

.link-preview-reader-content a:visited {
    color: var(--pl-reader-link-visited);
}

.link-preview-reader-content img,
.link-preview-reader-content picture {
    display: block;
    max-width: 100%;
    height: auto;
}

.link-preview-reader-content pre,
.link-preview-reader-content code {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    color: var(--pl-reader-code-text);
}

.link-preview-reader-content code {
    padding: 0.08em 0.3em;
    border-radius: 4px;
    background: var(--pl-reader-surface-subtle);
}

.link-preview-reader-content pre {
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--pl-reader-border);
    border-radius: 8px;
    background: var(--pl-reader-surface-subtle);
}

.link-preview-reader-content pre code {
    padding: 0;
    background: transparent;
}

.link-preview-reader-content blockquote {
    margin: 1.25em 0;
    padding-left: 14px;
    border-left: 3px solid var(--pl-reader-border-strong);
    color: var(--pl-reader-muted);
}

.link-preview-reader-content table {
    border-collapse: collapse;
}

.link-preview-reader-content :where(th, td) {
    border: 1px solid var(--pl-reader-border);
    padding: 0.45em 0.6em;
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
    border: 1px solid var(--pl-border);
    border-radius: 999px;
    background: var(--pl-button-bg);
    box-shadow: 0 2px 8px var(--pl-shadow-control);
    color: var(--pl-accent-strong);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
}

.link-preview-control:hover {
    background: var(--pl-button-bg-hover);
}

.link-preview-control:focus-visible {
    outline: 2px solid var(--pl-accent);
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
    background: linear-gradient(135deg, var(--pl-resize-start), var(--pl-resize-end));
    touch-action: none;
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
    background: var(--pl-panel-subtle);
    color: var(--pl-text);
    font-size: 13px;
    line-height: 1.35;
}

.link-preview-fallback-url {
    padding: 8px;
    border: 1px solid var(--pl-border);
    border-radius: 6px;
    background: var(--pl-input-bg);
    color: var(--pl-muted);
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
    border: 1px solid var(--pl-border);
    border-radius: 8px;
    background: var(--pl-button-bg);
    color: var(--pl-text);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
}

.link-preview-fallback-action:hover {
    background: var(--pl-button-bg-hover);
}

.link-preview-fallback-action:focus-visible {
    outline: 2px solid var(--pl-accent);
    outline-offset: 1px;
}

.link-preview-fallback-action--primary {
    border-color: var(--pl-accent);
    background: var(--pl-accent);
    color: #ffffff;
}

.link-preview-fallback-action--primary:hover {
    background: var(--pl-accent-hover);
}
`;
const POPUP_CONTROL_ICON_MARKUP = {
    newtab: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 13L14 6"></path><path d="M9 6h5v5"></path><path d="M6 9v5h5"></path></svg>',
    reload: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-2.1-4.58"></path><path d="M16 4v4h-4"></path></svg>',
    close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8"></path><path d="M14 6l-8 8"></path></svg>'
};

const popupReaderMode = globalThis.PreviewPopupReaderMode.createController({
    t,
    isReaderModeSuggestionsEnabled: () => readerModeSuggestionsEnabled,
    readerErrorTimeoutMs: POPUP_READER_ERROR_TIMEOUT_MS,
    popupControlCloseIconMarkup: POPUP_CONTROL_ICON_MARKUP.close,
    generateRuntimeId,
    loadPopupUrl,
    postPopupRuntimeMessage,
    requestReaderModeAction: POPUP_RUNTIME_ACTIONS.REQUEST_READER_MODE
});
const normalizePopupPageContextKey = popupReaderMode.normalizePageContextKey;
const createPopupReaderState = popupReaderMode.createState;
const getPopupReaderState = popupReaderMode.getState;
const clearPopupReaderErrorTimer = popupReaderMode.clearErrorTimer;
const removePopupReaderView = popupReaderMode.removeView;
const syncPopupReaderPageContext = popupReaderMode.syncPageContext;
const updatePopupReaderUi = popupReaderMode.updateUi;
const openPopupReaderMode = popupReaderMode.openMode;
const handlePopupReaderabilityReport = popupReaderMode.handleReaderabilityReport;
const handlePopupReaderModeResult = popupReaderMode.handleReaderModeResult;

function getPopupHeaderLabels() {
    return {
        openInNewTab: t('preview_openInNewTab'),
        reloadPreview: t('preview_reload'),
        closePreview: t('preview_close'),
        closeAllText: t('preview_closeAll'),
        closeAllAriaLabel: t('preview_closeAllAriaLabel')
    };
}
function postPopupRuntimeMessage(popupEntry, action, payload = {}) {
    if (!popupEntry?.iframe?.contentWindow || !popupEntry.popupSessionId) return false;
    popupEntry.iframe.contentWindow.postMessage({
        source: PREVIEW_MESSAGE_SOURCE,
        type: POPUP_RUNTIME_MESSAGE_TYPE,
        version: PREVIEW_MESSAGE_VERSION,
        action,
        popupId: popupEntry.popupId,
        popupSessionId: popupEntry.popupSessionId,
        ...payload
    }, '*');
    return true;
}

function applyPopupCoordinates(popupEntry, left, top) {
    if (!popupEntry || !popupEntry.popup) return;
    popupEntry.popup.style.left = left + 'px';
    popupEntry.popup.style.top = top + 'px';
    popupEntry.x = left;
    popupEntry.y = top;
}

function startPopupPointerInteraction(popupEntry, pointerDownEvent, options) {
    if (!popupEntry || typeof options?.onMove !== 'function') {
        return () => {};
    }

    const interactionTarget = options?.target;
    if (!interactionTarget || typeof interactionTarget.setPointerCapture !== 'function') {
        return () => {};
    }

    if (typeof activePopupPointerInteractionCleanup === 'function') {
        activePopupPointerInteractionCleanup();
    }

    const {
        onMove,
        onEnd
    } = options;
    const pointerId = pointerDownEvent.pointerId;
    const bodyStyle = document.body && document.body.style;
    const previousUserSelect = bodyStyle ? bodyStyle.userSelect : '';
    let cleanedUp = false;

    function cleanup(event) {
        if (cleanedUp) return;
        cleanedUp = true;

        interactionTarget.removeEventListener('pointermove', onPointerMove);
        interactionTarget.removeEventListener('pointerup', onPointerUp);
        interactionTarget.removeEventListener('pointercancel', onPointerCancel);
        interactionTarget.removeEventListener('lostpointercapture', onLostPointerCapture);
        window.removeEventListener('blur', onWindowBlur);

        if (bodyStyle) {
            bodyStyle.userSelect = previousUserSelect;
        }

        if (interactionTarget.isConnected && interactionTarget.hasPointerCapture(pointerId)) {
            interactionTarget.releasePointerCapture(pointerId);
        }

        if (popupEntry.activePointerInteractionCleanup === cleanup) {
            popupEntry.activePointerInteractionCleanup = null;
        }
        if (activePopupPointerInteractionCleanup === cleanup) {
            activePopupPointerInteractionCleanup = null;
        }

        if (typeof onEnd === 'function') {
            onEnd(event);
        }
    }

    function onPointerMove(event) {
        if (event.pointerId !== pointerId) return;
        onMove(event, cleanup);
    }

    function onPointerUp(event) {
        if (event.pointerId !== pointerId) return;
        cleanup(event);
    }

    function onPointerCancel(event) {
        if (event.pointerId !== pointerId) return;
        cleanup(event);
    }

    function onLostPointerCapture(event) {
        if (event.pointerId !== pointerId) return;
        cleanup(event);
    }

    function onWindowBlur() {
        cleanup();
    }

    popupEntry.activePointerInteractionCleanup = cleanup;
    activePopupPointerInteractionCleanup = cleanup;

    if (bodyStyle) {
        bodyStyle.userSelect = 'none';
    }

    interactionTarget.addEventListener('pointermove', onPointerMove);
    interactionTarget.addEventListener('pointerup', onPointerUp);
    interactionTarget.addEventListener('pointercancel', onPointerCancel);
    interactionTarget.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('blur', onWindowBlur);
    interactionTarget.setPointerCapture(pointerId);

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

function parseDurationToSeconds(value) {
    const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : String(value || '').trim().toLowerCase();
    if (!normalizedValue) return null;
    if (/^\d+$/.test(normalizedValue)) {
        const seconds = Number(normalizedValue);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    let totalSeconds = 0;
    let consumedLength = 0;
    const durationPattern = /(\d+)(h|m|s)/g;
    let match;
    while ((match = durationPattern.exec(normalizedValue)) !== null) {
        if (match.index !== consumedLength) return null;
        consumedLength = durationPattern.lastIndex;
        const amount = Number(match[1]);
        if (!Number.isFinite(amount)) return null;
        if (match[2] === 'h') totalSeconds += amount * 3600;
        if (match[2] === 'm') totalSeconds += amount * 60;
        if (match[2] === 's') totalSeconds += amount;
    }

    if (!consumedLength || consumedLength !== normalizedValue.length || totalSeconds <= 0) {
        return null;
    }

    return totalSeconds;
}

function getHashQueryParam(url, paramName) {
    if (!url || typeof paramName !== 'string') return null;
    const normalizedHash = String(url.hash || '').replace(/^#/, '').trim();
    if (!normalizedHash) return null;
    const hashParams = new URLSearchParams(normalizedHash);
    const paramValue = hashParams.get(paramName);
    if (paramValue) return paramValue;
    if (!normalizedHash.includes('=') && paramName === 't') {
        return normalizedHash;
    }
    return null;
}

function getYouTubeStartTimeSeconds(url) {
    const candidates = [
        url.searchParams.get('start'),
        url.searchParams.get('t'),
        getHashQueryParam(url, 'start'),
        getHashQueryParam(url, 't')
    ];
    for (const candidate of candidates) {
        const seconds = parseDurationToSeconds(candidate);
        if (seconds) return seconds;
    }
    return null;
}

function getPreservedVimeoTimestampHash(url) {
    const hash = typeof url?.hash === 'string' ? url.hash.trim() : '';
    return /^#t=.+/i.test(hash) ? hash : '';
}

function resolveSupportedVideoPreviewTarget(originalUrl) {
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
        const canonicalUrl = new URL('https://www.youtube.com/watch');
        canonicalUrl.searchParams.set('v', ytVideoId);

        const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${ytVideoId}`);
        const startTimeSeconds = getYouTubeStartTimeSeconds(parsed);
        if (startTimeSeconds) {
            canonicalUrl.searchParams.set('start', String(startTimeSeconds));
            embedUrl.searchParams.set('start', String(startTimeSeconds));
        }

        return {
            mode: 'video',
            provider: 'youtube',
            providerLabel: 'YouTube',
            canonicalPageUrl: canonicalUrl.toString(),
            embedUrl: embedUrl.toString(),
            previewIdentityKey: `youtube:${ytVideoId}`
        };
    }

    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
        const vimeoMatch = pathname.match(/^\/(\d+)\/?$/);
        if (vimeoMatch && vimeoMatch[1]) {
            const videoId = vimeoMatch[1];
            const canonicalUrl = new URL(`https://vimeo.com/${videoId}`);
            const embedUrl = new URL(`https://player.vimeo.com/video/${videoId}`);
            const timestampHash = getPreservedVimeoTimestampHash(parsed);
            if (timestampHash) {
                canonicalUrl.hash = timestampHash;
                embedUrl.hash = timestampHash;
            }
            return {
                mode: 'video',
                provider: 'vimeo',
                providerLabel: 'Vimeo',
                canonicalPageUrl: canonicalUrl.toString(),
                embedUrl: embedUrl.toString(),
                previewIdentityKey: `vimeo:${videoId}`
            };
        }
    }

    if (host === 'www.tiktok.com' || host === 'tiktok.com') {
        const tiktokMatch = pathname.match(/^\/(@[^/]+)\/video\/([^/?#]+)/);
        if (tiktokMatch && tiktokMatch[1] && tiktokMatch[2]) {
            const userHandle = tiktokMatch[1];
            const postId = tiktokMatch[2];
            return {
                mode: 'video',
                provider: 'tiktok',
                providerLabel: 'TikTok',
                canonicalPageUrl: `https://www.tiktok.com/${userHandle}/video/${postId}`,
                embedUrl: `https://www.tiktok.com/player/v1/${postId}`,
                previewIdentityKey: `tiktok:${postId}`
            };
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

function buildLegacyPreviewCandidates(originalUrl) {
    const candidates = [originalUrl];
    const alternateUrl = resolveAlternatePreviewUrl(originalUrl);
    if (alternateUrl && alternateUrl !== originalUrl) {
        candidates.push(alternateUrl);
    }
    return candidates;
}

function buildPreviewPlan(originalUrl, options = {}) {
    const explicitVideoModeEnabled = !!options.enableExplicitVideoMode;
    const supportedVideoTarget = resolveSupportedVideoPreviewTarget(originalUrl);

    if (supportedVideoTarget && explicitVideoModeEnabled) {
        return {
            sourceCanonicalUrl: supportedVideoTarget.canonicalPageUrl,
            previewIdentityKey: supportedVideoTarget.previewIdentityKey,
            supportedVideoTarget,
            explicitVideoModeTarget: supportedVideoTarget,
            previewCandidates: [supportedVideoTarget.embedUrl, supportedVideoTarget.canonicalPageUrl],
            previewCandidateMetadata: [
                {
                    kind: 'video-embed',
                    quickFailoverOnLoad: false,
                    isExplicitVideoMode: true,
                    providerLabel: supportedVideoTarget.providerLabel
                },
                {
                    kind: 'canonical-page',
                    quickFailoverOnLoad: false,
                    isExplicitVideoMode: false,
                    providerLabel: supportedVideoTarget.providerLabel
                }
            ]
        };
    }

    const previewCandidates = buildLegacyPreviewCandidates(originalUrl);
    return {
        sourceCanonicalUrl: supportedVideoTarget ? supportedVideoTarget.canonicalPageUrl : originalUrl,
        previewIdentityKey: supportedVideoTarget ? supportedVideoTarget.previewIdentityKey : getPreviewIdentityKey(originalUrl),
        supportedVideoTarget,
        explicitVideoModeTarget: null,
        previewCandidates,
        previewCandidateMetadata: previewCandidates.map((candidateUrl, index) => ({
            kind: index === 0 ? 'requested-page' : 'compatibility-alternate',
            quickFailoverOnLoad: index === 0 && previewCandidates.length > 1,
            isExplicitVideoMode: false,
            providerLabel: null
        }))
    };
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
    const supportedVideoTarget = resolveSupportedVideoPreviewTarget(originalUrl);
    if (supportedVideoTarget) return supportedVideoTarget.previewIdentityKey;

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

function createPopupTextActionButton(modifierClass, text, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `link-preview-topbar-action ${modifierClass}`;
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', onClick);
    return button;
}

function createPopupModeBadge() {
    const badge = document.createElement('div');
    badge.className = 'link-preview-topbar-badge';
    badge.hidden = true;
    return badge;
}

function getActivePreviewCandidateMetadata(popupEntry) {
    if (!popupEntry || !Array.isArray(popupEntry.previewCandidateMetadata)) return null;
    return popupEntry.previewCandidateMetadata[popupEntry.activeCandidateIndex] || null;
}

function syncPopupVideoModeBadge(popupEntry) {
    if (!popupEntry?.videoModeBadge) return;
    const activeCandidateMetadata = getActivePreviewCandidateMetadata(popupEntry);
    const shouldShowBadge = !!(activeCandidateMetadata && activeCandidateMetadata.isExplicitVideoMode && activeCandidateMetadata.providerLabel);
    popupEntry.videoModeBadge.hidden = !shouldShowBadge;
    popupEntry.videoModeBadge.textContent = shouldShowBadge
        ? t('preview_videoBadge', [activeCandidateMetadata.providerLabel])
        : '';
}

function applyPreviewPlanToPopupEntry(popupEntry, previewPlan, options = {}) {
    if (!popupEntry || !previewPlan) return;
    const preserveSourceContext = options.preserveSourceContext !== false;
    if (!preserveSourceContext || !popupEntry.sourceCanonicalUrl) {
        popupEntry.sourceCanonicalUrl = previewPlan.sourceCanonicalUrl;
    }
    if (!preserveSourceContext || !popupEntry.previewIdentityKey) {
        popupEntry.previewIdentityKey = previewPlan.previewIdentityKey;
    }
    popupEntry.supportedVideoTarget = previewPlan.supportedVideoTarget || null;
    popupEntry.explicitVideoModeTarget = previewPlan.explicitVideoModeTarget || null;
    popupEntry.previewCandidates = previewPlan.previewCandidates.slice();
    popupEntry.previewCandidateMetadata = previewPlan.previewCandidateMetadata.slice();
}

function syncPopupCollectionActions() {
    const activePopupCount = popups.reduce((count, popupEntry) => {
        return popupEntry.isClosing ? count : count + 1;
    }, 0);
    const shouldShowCloseAll = activePopupCount >= 2;
    popups.forEach((popupEntry) => {
        if (popupEntry.closeAllButton) {
            popupEntry.closeAllButton.hidden = !shouldShowCloseAll;
            popupEntry.closeAllButton.disabled = !shouldShowCloseAll;
        }
    });
}

function closeAllPopups() {
    popups.slice().forEach((popupEntry) => closePopup(popupEntry.popupId));
}

function getPopupExternalOpenUrl(popupEntry) {
    if (!popupEntry) return null;
    const candidateUrls = [
        popupEntry.sourceCanonicalUrl,
        popupEntry.originalUrl,
        popupEntry.requestedUrl,
        popupEntry.currentUrl,
        popupEntry.currentPreviewUrl
    ];
    for (const candidateUrl of candidateUrls) {
        if (typeof candidateUrl === 'string' && candidateUrl.trim()) {
            return candidateUrl;
        }
    }
    return null;
}

function createPopup(url, x, y, anchorRect, options = {}) {
    if (!runtimeContext.isTopWindow || runtimeContext.isPreviewPopupRuntime) return;
    const previewPlan = buildPreviewPlan(url, { enableExplicitVideoMode: videoModeEnabled });
    const previewIdentityKey = previewPlan.previewIdentityKey;
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
        sourceCanonicalUrl: previewPlan.sourceCanonicalUrl,
        currentUrl: url,
        sourceContextId: options.sourceContextId || null,
        lastPreviewRequestId: options.previewRequestId || null,
        trigger: options.trigger || null,
        anchorRect: anchorRect || null,
        currentPreviewUrl: previewPlan.previewCandidates[0] || url,
        previewCandidates: previewPlan.previewCandidates.slice(),
        previewCandidateMetadata: previewPlan.previewCandidateMetadata.slice(),
        supportedVideoTarget: previewPlan.supportedVideoTarget || null,
        explicitVideoModeTarget: previewPlan.explicitVideoModeTarget || null,
        activeCandidateIndex: 0,
        activeAttemptId: 0,
        state: 'loading',
        popupSessionId: null,
        iframeGeneration: 0,
        popup: null,
        shadowRoot: null,
        topBar: null,
        bodyContainer: null,
        iframe: null,
        fallback: null,
        curtain: null,
        videoModeBadge: null,
        readerView: null,
        loadingBar: null,
        closeAllButton: null,
        loadingAnimationTimer: null,
        blockedTimeoutTimer: null,
        postLoadGraceTimer: null,
        readerErrorTimer: null,
        activeCandidateLoaded: false,
        activeCandidateFrameAlive: false,
        attentionTimer: null,
        activePointerInteractionCleanup: null,
        isClosing: false,
        x,
        y,
        readerState: createPopupReaderState()
    };

    let popup = document.createElement('div');
    const shadowRoot = popup.attachShadow({ mode: 'open' });
    const popupHeaderLabels = getPopupHeaderLabels();
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
    applyThemeMarker(popup, currentThemeMode);
    shadowRoot.appendChild(createPopupShadowStyle());

    // Top bar
    let topBar = document.createElement('div');
    topBar.className = 'link-preview-topbar';
    shadowRoot.appendChild(topBar);

    let closeAllBtn = createPopupTextActionButton(
        'link-preview-topbar-action--close-all',
        popupHeaderLabels.closeAllText,
        popupHeaderLabels.closeAllAriaLabel,
        () => {
            closeAllPopups();
        }
    );
    closeAllBtn.hidden = true;
    closeAllBtn.disabled = true;
    topBar.appendChild(closeAllBtn);

    let videoModeBadge = createPopupModeBadge();
    topBar.appendChild(videoModeBadge);

    let curtain = document.createElement('div');
    curtain.className = 'link-preview-curtain';
    curtain.hidden = true;
    shadowRoot.appendChild(curtain);

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
    let newTabBtn = createPopupControlButton('link-preview-control--newtab', popupHeaderLabels.openInNewTab, 'newtab', () => {
        const externalOpenUrl = getPopupExternalOpenUrl(popupEntry);
        if (externalOpenUrl) {
            window.open(externalOpenUrl, '_blank');
        }
        closePopup(popupEntry.popupId);
    });
    topBar.appendChild(newTabBtn);

    // Reload button
    let reloadBtn = createPopupControlButton('link-preview-control--reload', popupHeaderLabels.reloadPreview, 'reload', () => {
        reloadPopup(popupEntry.popupId);
    });
    topBar.appendChild(reloadBtn);

    // Close button
    let closeBtn = createPopupControlButton('link-preview-control--close', popupHeaderLabels.closePreview, 'close', () => {
        closePopup(popupEntry.popupId);
    });
    topBar.appendChild(closeBtn);

    document.body.appendChild(popup);
    popupEntry.popup = popup;
    popupEntry.shadowRoot = shadowRoot;
    popupEntry.topBar = topBar;
    popupEntry.curtain = curtain;
    popupEntry.bodyContainer = bodyContainer;
    popupEntry.closeAllButton = closeAllBtn;
    popupEntry.videoModeBadge = videoModeBadge;
    popups.push(popupEntry);
    syncPopupCollectionActions();
    syncPopupVideoModeBadge(popupEntry);
    syncPopupReaderPageContext(popupEntry, url);

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
    popup.addEventListener('pointerdown', () => bringToFront(popupEntry.popupId));
    setTimeout(() => { popup.style.opacity = '1'; }, 10);
    loadPopupUrl(popupEntry, url, { preserveSourceContext: false });

    // Make popup draggable via the top bar
    topBar.addEventListener('pointerdown', function(e) {
        // Only initiate drag when clicking on the empty top bar area (not buttons)
        if (e.currentTarget !== e.target) return;
        if (!e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = popup.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        startPopupPointerInteraction(popupEntry, e, {
            target: topBar,
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
    handle.addEventListener('pointerdown', function(e) {
        if (!e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = popup.offsetWidth;
        const startHeight = popup.offsetHeight;
        startPopupPointerInteraction(popupEntry, e, {
            target: handle,
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
    if (!entry || !entry.popup || entry.isClosing) return;
    entry.isClosing = true;
    entry.state = 'closing';
    syncPopupCollectionActions();
    if (typeof entry.activePointerInteractionCleanup === 'function') {
        entry.activePointerInteractionCleanup();
    }
    if (entry.attentionTimer) {
        clearTimeout(entry.attentionTimer);
        entry.attentionTimer = null;
    }
    clearPopupReaderErrorTimer(entry);
    clearPopupLoadLifecycle(entry);
    clearPopupBodyContent(entry);
    if (entry.curtain) {
        entry.curtain.hidden = true;
    }
    entry.popup.style.pointerEvents = 'none';
    entry.popup.style.opacity = '0';
    setTimeout(() => {
        if (entry.popup) entry.popup.remove();
        popups = popups.filter(p => p.popupId !== popupId);
        syncPopupCollectionActions();
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
    updatePopupReaderUi(popupEntry);
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
    const fallbackUrl = getPopupExternalOpenUrl(popupEntry) || popupEntry.originalUrl || popupEntry.requestedUrl;
    const openLabel = t('fallback_openInNewTab');
    const copyLabel = t('fallback_copyLink');
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
    openBtn.textContent = openLabel;
    openBtn.setAttribute('aria-label', openLabel);
    openBtn.title = openLabel;
    openBtn.onclick = () => window.open(fallbackUrl, '_blank');
    actions.appendChild(openBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'link-preview-fallback-action';
    copyBtn.textContent = copyLabel;
    copyBtn.setAttribute('aria-label', copyLabel);
    copyBtn.title = copyLabel;
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(fallbackUrl);
            const successLabel = t('fallback_copySuccess');
            copyBtn.textContent = successLabel;
            copyBtn.setAttribute('aria-label', successLabel);
            copyBtn.title = successLabel;
            setTimeout(() => {
                copyBtn.textContent = copyLabel;
                copyBtn.setAttribute('aria-label', copyLabel);
                copyBtn.title = copyLabel;
            }, 1200);
        } catch (_) {
            const failedLabel = t('fallback_copyFailed');
            copyBtn.textContent = failedLabel;
            copyBtn.setAttribute('aria-label', failedLabel);
            copyBtn.title = failedLabel;
            setTimeout(() => {
                copyBtn.textContent = copyLabel;
                copyBtn.setAttribute('aria-label', copyLabel);
                copyBtn.title = copyLabel;
            }, 1200);
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
    clearPopupRuntimeBinding(popupEntry);
    removePopupReaderView(popupEntry, { preserveArticle: false });
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
    const activeCandidateMetadata = getActivePreviewCandidateMetadata(popupEntry);
    return {
        candidateIndex,
        totalCandidates,
        activeCandidateMetadata,
        hasAlternate: totalCandidates > 1,
        isOriginalCandidate: candidateIndex === 0,
        isAlternateCandidate: candidateIndex > 0,
        quickFailoverOnLoad: !!activeCandidateMetadata?.quickFailoverOnLoad,
        requiresFrameLiveness: candidateIndex === 0 && totalCandidates === 1
    };
}

function finalizePopupReady(popupEntry, iframe) {
    popupEntry.currentUrl = getLoadedIframeUrl(popupEntry, iframe);
    popupEntry.currentPreviewUrl = popupEntry.previewCandidates[popupEntry.activeCandidateIndex] || popupEntry.currentPreviewUrl;
    popupEntry.state = 'ready';
    syncPopupReaderPageContext(popupEntry, popupEntry.currentUrl);
    logPreviewDebug('finalize ready', {
        popupId: popupEntry.popupId,
        attemptId: popupEntry.activeAttemptId,
        candidateIndex: popupEntry.activeCandidateIndex,
        url: popupEntry.currentPreviewUrl
    });
    finishPopupLoadingState(popupEntry);
    syncPopupVideoModeBadge(popupEntry);
    updatePopupReaderUi(popupEntry);
}

function finalizePopupBlocked(popupEntry, messageKey) {
    const message = t(messageKey || 'fallback_blocked');
    logPreviewDebug('finalize blocked', {
        popupId: popupEntry.popupId,
        attemptId: popupEntry.activeAttemptId,
        candidateIndex: popupEntry.activeCandidateIndex,
        url: popupEntry.currentPreviewUrl,
        message
    });
    finishPopupLoadingState(popupEntry);
    clearPopupBodyContent(popupEntry);
    renderPopupFallback(
        popupEntry,
        message,
        'blocked'
    );
    syncPopupVideoModeBadge(popupEntry);
    updatePopupReaderUi(popupEntry);
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
    finalizePopupBlocked(
        popupEntry,
        reason === 'error' ? 'fallback_loadFailed' : 'fallback_blocked'
    );
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
    syncPopupVideoModeBadge(popupEntry);
    logPreviewDebug('candidate mount', {
        popupId: popupEntry.popupId,
        attemptId,
        candidateIndex: candidateState.candidateIndex,
        totalCandidates: candidateState.totalCandidates,
        url
    });

    const iframe = document.createElement('iframe');
    iframe.className = 'link-preview-iframe';
    popupEntry.iframeGeneration += 1;
    const popupSessionId = generateRuntimeId('popup-session');
    iframe.name = buildPreviewPopupWindowName(popupEntry.popupId, popupSessionId);
    iframe.src = url;
    bindPopupRuntimeSession(popupEntry, iframe, popupSessionId);
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
        if (activeCandidateState.quickFailoverOnLoad) {
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
    const { preserveCandidateIndex = false, preserveSourceContext = true } = options;
    const previewPlan = buildPreviewPlan(url, { enableExplicitVideoMode: videoModeEnabled });
    syncPopupReaderPageContext(popupEntry, popupEntry.currentUrl || url, { forceRefresh: true });
    if (!popupEntry.requestedUrl) popupEntry.requestedUrl = url;
    if (!popupEntry.originalUrl) popupEntry.originalUrl = url;
    applyPreviewPlanToPopupEntry(popupEntry, previewPlan, { preserveSourceContext });
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
    if (entry && entry.popup && !entry.isClosing) {
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

function bindPopupRuntimeSession(popupEntry, iframe, popupSessionId) {
    clearPopupRuntimeBinding(popupEntry);
    popupEntry.iframe = iframe;
    popupEntry.popupSessionId = popupSessionId;
    popupSessionBindings.set(popupSessionId, popupEntry.popupId);
}

function clearPopupRuntimeBinding(popupEntry) {
    if (!popupEntry) return;
    if (popupEntry.popupSessionId) {
        popupSessionBindings.delete(popupEntry.popupSessionId);
    }
    popupEntry.popupSessionId = null;
}

function getPopupByRuntimeBinding(popupId, popupSessionId) {
    if (!popupId || !popupSessionId) return null;
    const boundPopupId = popupSessionBindings.get(popupSessionId);
    if (!boundPopupId || boundPopupId !== popupId) return null;
    const popupEntry = getPopupById(popupId);
    if (!popupEntry || popupEntry.isClosing || popupEntry.popupSessionId !== popupSessionId) return null;
    return popupEntry;
}

function reloadPopup(popupId) {
    const entry = getPopupById(popupId);
    if (!entry) return;
    const reloadUrl = entry.currentUrl || entry.currentPreviewUrl || entry.sourceCanonicalUrl || entry.requestedUrl;
    if (!reloadUrl) return;
    syncPopupReaderPageContext(entry, entry.currentUrl || reloadUrl, { forceRefresh: true });
    setPopupLoadingState(entry);
    mountPopupIframe(entry, reloadUrl);
}

function syncPopupCurrentUrlForEntry(popupEntry, currentUrl) {
    if (!popupEntry || !currentUrl) return;
    popupEntry.currentUrl = currentUrl;
    syncPopupReaderPageContext(popupEntry, currentUrl);
}

function markPopupFrameAliveForEntry(popupEntry, currentUrl) {
    if (!popupEntry || !popupEntry.iframe) return;
    if (currentUrl) syncPopupCurrentUrlForEntry(popupEntry, currentUrl);
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
