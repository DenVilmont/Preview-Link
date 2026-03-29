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
  document.addEventListener('click', e => {
    if (!iframeEnabled) return;
    const link = e.target.closest('a');
    if (link && link.href) {
      window.open(link.href, '_blank');
      e.preventDefault();
    }
  });
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
    chrome.runtime.sendMessage({ action: 'bringToFront', url: window.location.href });
  });
}