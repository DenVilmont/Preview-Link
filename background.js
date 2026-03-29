// Background service worker for the extension (currently empty) 

// background.js
// Icons for ON/OFF
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

// Store last hovered link per tab for key-trigger previews
let lastHovers = {};

// Handle messages for hover update, key-trigger open, and relay showPreview
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab && sender.tab.id >= 0) {
    if (msg.action === 'updateHover') {
      lastHovers[sender.tab.id] = { url: msg.url, x: msg.x, y: msg.y };
      return;
    }
    if (msg.action === 'openKeyPreview') {
      const data = lastHovers[sender.tab.id];
      if (data && data.url) {
        chrome.tabs.sendMessage(sender.tab.id, { action: 'showPreview', url: data.url, x: data.x, y: data.y });
      }
      return;
    }
    if (msg.action === 'bringToFront') {
      chrome.tabs.sendMessage(sender.tab.id, { action: 'bringToFront', url: msg.url });
      return;
    }
    if (msg.action === 'showPreview') {
      chrome.tabs.sendMessage(sender.tab.id, msg);
    }
  }
}); 