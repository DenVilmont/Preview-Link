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
    const popupId = window.frameElement && window.frameElement.dataset
      ? window.frameElement.dataset.popupId
      : null;
    if (!popupId) return;
    chrome.runtime.sendMessage({
      action: 'updatePopupUrl',
      popupId,
      url: window.location.href
    });
  }

  if (document.readyState === 'complete') {
    sendPopupUrlUpdate();
  } else {
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
    chrome.runtime.sendMessage({ action: 'bringToFront', popupId, url: window.location.href });
  });
}
