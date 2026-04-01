(() => {
  // iframe-handler.js: preview iframe runtime bridge and scroll containment
  if (window.self === window.top) return;

  const {
    PREVIEW_MESSAGE_SOURCE,
    POPUP_RUNTIME_MESSAGE_TYPE,
    PREVIEW_MESSAGE_VERSION,
    POPUP_RUNTIME_ACTIONS,
    parsePreviewPopupBindingFromWindowName
  } = globalThis.PreviewRuntimeContract;
  const popupRuntimeBinding = parsePreviewPopupBindingFromWindowName();
  if (!popupRuntimeBinding) return;

  // Track extension enabled state only in actual preview iframe runtime contexts.
  let iframeEnabled = true;
  chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
    iframeEnabled = enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      iframeEnabled = changes.enabled.newValue;
    }
  });

  function containPreviewOverscroll(target) {
    if (!target) return;
    const styles = window.getComputedStyle(target);
    if (styles.overscrollBehaviorX === 'auto') {
      target.style.overscrollBehaviorX = 'contain';
    }
    if (styles.overscrollBehaviorY === 'auto') {
      target.style.overscrollBehaviorY = 'contain';
    }
  }

  function applyPreviewScrollContainment() {
    containPreviewOverscroll(document.documentElement);
    containPreviewOverscroll(document.body);
  }

  function getPreviewNavigationAnchor(event) {
    if (!event || !event.target || typeof event.target.closest !== 'function') return null;
    const anchor = event.target.closest('a[href]');
    if (!anchor || !anchor.href) return null;
    return anchor;
  }

  function isPreviewDocumentProtocol(protocol) {
    return protocol === 'http:' || protocol === 'https:';
  }

  function normalizePreviewLinkTarget(anchor) {
    const rawTarget = typeof anchor?.getAttribute === 'function' ? anchor.getAttribute('target') : '';
    return (rawTarget || '').trim().toLowerCase();
  }

  function classifyPreviewNavigation(event) {
    const anchor = getPreviewNavigationAnchor(event);
    if (!anchor) return null;
    if (anchor.hasAttribute('download')) {
      return { anchor, kind: 'special', reason: 'download' };
    }

    let url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch (_) {
      return { anchor, kind: 'special', reason: 'invalid-url' };
    }

    const protocol = (url.protocol || '').toLowerCase();
    if (protocol === 'javascript:') {
      return { anchor, url, kind: 'special', reason: 'javascript' };
    }
    if (!isPreviewDocumentProtocol(protocol)) {
      return { anchor, url, kind: 'special', reason: 'unsupported-protocol' };
    }

    const target = normalizePreviewLinkTarget(anchor);
    const isModifiedClick = !!(event && (event.metaKey || event.ctrlKey || event.shiftKey));
    const isMiddleClick = !!(event && event.type === 'auxclick' && event.button === 1);
    const opensOutsidePreview = !!(target && target !== '_self');

    return {
      anchor,
      url,
      kind: 'document',
      target,
      initialHref: window.location.href,
      shouldForceSamePreview: opensOutsidePreview || isModifiedClick || isMiddleClick
    };
  }

  function schedulePreviewNavigationUpdateCheck() {
    setTimeout(() => {
      sendPopupUrlUpdate();
    }, 0);
    setTimeout(() => {
      sendPopupUrlUpdate();
    }, 150);
  }

  function navigatePreviewInPlace(url) {
    if (!url) return;
    window.location.assign(typeof url === 'string' ? url : url.toString());
  }

  applyPreviewScrollContainment();
  if (!document.body) {
    window.addEventListener('DOMContentLoaded', applyPreviewScrollContainment, { once: true });
  }

  function sendPopupUrlUpdate() {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: PREVIEW_MESSAGE_SOURCE,
        type: POPUP_RUNTIME_MESSAGE_TYPE,
        version: PREVIEW_MESSAGE_VERSION,
        action: POPUP_RUNTIME_ACTIONS.UPDATE_URL,
        popupId: popupRuntimeBinding.popupId,
        popupSessionId: popupRuntimeBinding.popupSessionId,
        url: window.location.href
      },
      '*'
    );
  }

  function sendPreviewFrameAlive() {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: PREVIEW_MESSAGE_SOURCE,
        type: POPUP_RUNTIME_MESSAGE_TYPE,
        version: PREVIEW_MESSAGE_VERSION,
        action: POPUP_RUNTIME_ACTIONS.FRAME_ALIVE,
        popupId: popupRuntimeBinding.popupId,
        popupSessionId: popupRuntimeBinding.popupSessionId,
        url: window.location.href
      },
      '*'
    );
  }

  // Child script liveness handshake: emit as soon as this content script runs.
  sendPreviewFrameAlive();
  sendPopupUrlUpdate();

  function sendPostLoadBridgeSignals() {
    sendPreviewFrameAlive();
    sendPopupUrlUpdate();
  }

  function sendPreviewNavigationUpdate() {
    sendPopupUrlUpdate();
  }

  // Re-emit liveness after full frame load so fast startups do not rely on a single early signal.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', sendPostLoadBridgeSignals, { once: true });
  } else {
    setTimeout(sendPostLoadBridgeSignals, 0);
  }
  window.addEventListener('hashchange', sendPreviewNavigationUpdate);
  window.addEventListener('popstate', sendPreviewNavigationUpdate);

  document.addEventListener('click', (event) => {
    const navigation = classifyPreviewNavigation(event);
    if (!navigation || navigation.kind !== 'document') return;
    if (navigation.shouldForceSamePreview && event.cancelable) {
      event.preventDefault();
      schedulePreviewNavigationUpdateCheck();
      queueMicrotask(() => {
        if (window.location.href !== navigation.initialHref) return;
        navigatePreviewInPlace(navigation.url);
      });
      return;
    }
    schedulePreviewNavigationUpdateCheck();
  }, true);

  document.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const navigation = classifyPreviewNavigation(event);
    if (!navigation || navigation.kind !== 'document' || !event.cancelable) return;
    event.preventDefault();
    schedulePreviewNavigationUpdateCheck();
    queueMicrotask(() => {
      if (window.location.href !== navigation.initialHref) return;
      navigatePreviewInPlace(navigation.url);
    });
  }, true);

  // Bring this popup to front when clicking inside its iframe
  document.addEventListener('pointerdown', () => {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: PREVIEW_MESSAGE_SOURCE,
        type: POPUP_RUNTIME_MESSAGE_TYPE,
        version: PREVIEW_MESSAGE_VERSION,
        action: POPUP_RUNTIME_ACTIONS.BRING_TO_FRONT,
        popupId: popupRuntimeBinding.popupId,
        popupSessionId: popupRuntimeBinding.popupSessionId,
        url: window.location.href
      },
      '*'
    );
  });
})();
