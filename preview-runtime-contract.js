(() => {
  if (globalThis.PreviewRuntimeContract) return;

  const PREVIEW_MESSAGE_SOURCE = 'link-preview-extension';
  const FRAME_BRIDGE_MESSAGE_TYPE = 'preview-coordinate-hop';
  const POPUP_RUNTIME_MESSAGE_TYPE = 'popup-runtime-bridge';
  const PREVIEW_MESSAGE_VERSION = 1;
  const PREVIEW_POPUP_WINDOW_NAME_PREFIX = '__link_preview_popup__:';
  const POPUP_RUNTIME_ACTIONS = Object.freeze({
    BRING_TO_FRONT: 'bringToFront',
    UPDATE_URL: 'updatePopupUrl',
    FRAME_ALIVE: 'previewFrameAlive',
    REPORT_READERABILITY: 'reportReaderability',
    REQUEST_READER_MODE: 'requestReaderMode',
    READER_MODE_RESULT: 'readerModeResult'
  });

  function parsePreviewPopupBindingFromWindowName(windowName = window.name) {
    if (typeof windowName !== 'string' || !windowName.startsWith(PREVIEW_POPUP_WINDOW_NAME_PREFIX)) {
      return null;
    }
    try {
      const payload = JSON.parse(windowName.slice(PREVIEW_POPUP_WINDOW_NAME_PREFIX.length));
      if (!payload || typeof payload !== 'object') return null;
      if (typeof payload.popupId !== 'string' || typeof payload.popupSessionId !== 'string') return null;
      return {
        popupId: payload.popupId,
        popupSessionId: payload.popupSessionId
      };
    } catch (_) {
      return null;
    }
  }

  function buildPreviewPopupWindowName(popupId, popupSessionId) {
    return `${PREVIEW_POPUP_WINDOW_NAME_PREFIX}${JSON.stringify({ popupId, popupSessionId })}`;
  }

  globalThis.PreviewRuntimeContract = Object.freeze({
    PREVIEW_MESSAGE_SOURCE,
    FRAME_BRIDGE_MESSAGE_TYPE,
    POPUP_RUNTIME_MESSAGE_TYPE,
    PREVIEW_MESSAGE_VERSION,
    POPUP_RUNTIME_ACTIONS,
    parsePreviewPopupBindingFromWindowName,
    buildPreviewPopupWindowName
  });
})();
