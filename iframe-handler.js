// iframe-handler.js: intercept link clicks and handle scrolling within iframe
// Track extension enabled state within iframe
let iframeEnabled = true;
chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
  iframeEnabled = enabled;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    iframeEnabled = changes.enabled.newValue;
  }
});
if (window.self !== window.top) {
  function sendPopupUrlUpdate() {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'updatePopupUrl',
        url: window.location.href
      },
      '*'
    );
  }

  function sendPreviewFrameAlive() {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'previewFrameAlive',
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

  // Re-emit liveness after full frame load so fast startups do not rely on a single early signal.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', sendPostLoadBridgeSignals, { once: true });
  } else {
    setTimeout(sendPostLoadBridgeSignals, 0);
  }

  // Handle wheel events within iframe: allow native smooth scrolling and prevent propagation to host
  document.addEventListener('wheel', e => {
    if (!iframeEnabled) return;
    // Stop propagation so scrolling only affects the iframe
    e.stopPropagation();
    // Do not call preventDefault to allow native smooth scrolling within the iframe
  }, { passive: true });
  // Bring this popup to front when clicking inside its iframe
  document.addEventListener('mousedown', () => {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'bringToFront',
        url: window.location.href
      },
      '*'
    );
  });
}
