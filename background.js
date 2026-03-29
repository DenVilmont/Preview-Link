// Background service worker responsibilities are intentionally browser-level only:
// - keep extension action icon in sync with enabled state.
const ICON_ON = {
  '16': 'icons/icon-on.png',
  '32': 'icons/icon-on.png',
  '48': 'icons/icon-on.png',
  '128': 'icons/icon-on.png'
};
const ICON_OFF = {
  '16': 'icons/icon-off.png',
  '32': 'icons/icon-off.png',
  '48': 'icons/icon-off.png',
  '128': 'icons/icon-off.png'
};
// Refresh icon based on state
function refreshIcon() {
  chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
    chrome.action.setIcon({ path: enabled ? ICON_ON : ICON_OFF });
  });
}
// On service worker startup
refreshIcon();
// On browser startup
chrome.runtime.onStartup.addListener(refreshIcon);
// On storage change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    refreshIcon();
  }
});
