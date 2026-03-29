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
    const frameDataset = window.frameElement && window.frameElement.dataset
      ? window.frameElement.dataset
      : null;
    const popupId = frameDataset ? frameDataset.popupId : null;
    const attemptId = frameDataset ? frameDataset.attemptId : null;
    if (!popupId || !attemptId) return;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'updatePopupUrl',
        popupId,
        attemptId,
        url: window.location.href
      },
      '*'
    );
  }

  function sendPopupRuntimeReady() {
    if (!iframeEnabled) return;
    const frameDataset = window.frameElement && window.frameElement.dataset
      ? window.frameElement.dataset
      : null;
    const popupId = frameDataset ? frameDataset.popupId : null;
    const attemptId = frameDataset ? frameDataset.attemptId : null;
    if (!popupId || !attemptId) return;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'previewRuntimeReady',
        popupId,
        attemptId,
        url: window.location.href
      },
      '*'
    );
  }

  // Child script liveness handshake: emit as soon as this content script runs.
  sendPopupRuntimeReady();
  sendPopupUrlUpdate();

  // Keep a later URL sync for freshness after document load.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', sendPopupUrlUpdate, { once: true });
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
    const popupId = window.frameElement && window.frameElement.dataset
      ? window.frameElement.dataset.popupId
      : null;
    window.parent.postMessage(
      {
        source: 'link-preview-extension',
        type: 'popup-runtime-bridge',
        version: 1,
        action: 'bringToFront',
        popupId,
        url: window.location.href
      },
      '*'
    );
  });
}
