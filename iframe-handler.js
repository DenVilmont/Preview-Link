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
  const {
    getNavigationAnchorFromEvent,
    classifyNavigationTarget
  } = globalThis.PreviewNavigation;
  const popupRuntimeBinding = parsePreviewPopupBindingFromWindowName();
  if (!popupRuntimeBinding) return;
  const READERABILITY_RECHECK_DELAY_MS = 1200;
  const MIN_READER_ARTICLE_LENGTH = 200;

  // Track extension enabled state only in actual preview iframe runtime contexts.
  let iframeEnabled = true;
  let readerModeSuggestionsEnabled = true;
  let readerabilityReadyListenerAttached = false;
  let readerabilityRecheckTimer = null;
  let lastReportedReaderable = null;

  chrome.storage.local.get({ enabled: true, readerModeSuggestions: true }, ({ enabled, readerModeSuggestions }) => {
    iframeEnabled = enabled;
    readerModeSuggestionsEnabled = readerModeSuggestions !== false;
    scheduleReaderabilityEvaluation();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      iframeEnabled = changes.enabled.newValue;
    }
    if (changes.readerModeSuggestions) {
      readerModeSuggestionsEnabled = changes.readerModeSuggestions.newValue !== false;
    }
    if (changes.enabled || changes.readerModeSuggestions) {
      if (!readerModeSuggestionsEnabled || !iframeEnabled) {
        clearReaderabilityScheduling();
        sendReaderabilityStatus(false);
        return;
      }
      scheduleReaderabilityEvaluation();
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

  function classifyPreviewNavigation(event) {
    const anchor = getNavigationAnchorFromEvent(event);
    if (!anchor) return null;
    return classifyNavigationTarget({
      anchor,
      baseUrl: window.location.href,
      currentDocumentUrl: window.location.href,
      event
    });
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
      createPopupRuntimeMessage(POPUP_RUNTIME_ACTIONS.UPDATE_URL, {
        url: window.location.href
      }),
      '*'
    );
  }

  function sendPreviewFrameAlive() {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      createPopupRuntimeMessage(POPUP_RUNTIME_ACTIONS.FRAME_ALIVE, {
        url: window.location.href
      }),
      '*'
    );
  }

  function createPopupRuntimeMessage(action, payload = {}) {
    return {
      source: PREVIEW_MESSAGE_SOURCE,
      type: POPUP_RUNTIME_MESSAGE_TYPE,
      version: PREVIEW_MESSAGE_VERSION,
      action,
      popupId: popupRuntimeBinding.popupId,
      popupSessionId: popupRuntimeBinding.popupSessionId,
      ...payload
    };
  }

  function isHtmlLikePreviewDocument() {
    const contentType = String(document.contentType || '').toLowerCase();
    if (!document.documentElement || document.documentElement.localName !== 'html' || !document.body) {
      return false;
    }
    return !contentType || contentType.includes('html') || contentType.includes('xhtml');
  }

  function clearReaderabilityScheduling() {
    if (readerabilityRecheckTimer) {
      clearTimeout(readerabilityRecheckTimer);
      readerabilityRecheckTimer = null;
    }
  }

  function canEvaluateReaderability() {
    return (
      iframeEnabled &&
      readerModeSuggestionsEnabled &&
      typeof globalThis.isProbablyReaderable === 'function' &&
      isHtmlLikePreviewDocument()
    );
  }

  function sendReaderabilityStatus(readerable) {
    if (!iframeEnabled) return;
    if (lastReportedReaderable === readerable) return;
    lastReportedReaderable = readerable;
    window.parent.postMessage(
      createPopupRuntimeMessage(POPUP_RUNTIME_ACTIONS.REPORT_READERABILITY, {
        url: window.location.href,
        readerable: !!readerable
      }),
      '*'
    );
  }

  function evaluateReaderability(options = {}) {
    const { allowRecheck = false } = options;
    if (!canEvaluateReaderability()) {
      sendReaderabilityStatus(false);
      return;
    }

    let readerable = false;
    try {
      readerable = !!globalThis.isProbablyReaderable(document);
    } catch (_) {
      readerable = false;
    }

    sendReaderabilityStatus(readerable);

    if (allowRecheck && !readerable && !readerabilityRecheckTimer) {
      readerabilityRecheckTimer = setTimeout(() => {
        readerabilityRecheckTimer = null;
        evaluateReaderability({ allowRecheck: false });
      }, READERABILITY_RECHECK_DELAY_MS);
    }
  }

  function runScheduledReaderabilityEvaluation() {
    if (!canEvaluateReaderability()) {
      sendReaderabilityStatus(false);
      return;
    }
    evaluateReaderability({ allowRecheck: true });
  }

  function scheduleReaderabilityEvaluation() {
    clearReaderabilityScheduling();
    if (!canEvaluateReaderability()) {
      sendReaderabilityStatus(false);
      return;
    }
    if (document.readyState === 'loading') {
      if (readerabilityReadyListenerAttached) return;
      readerabilityReadyListenerAttached = true;
      const onReady = () => {
        readerabilityReadyListenerAttached = false;
        runScheduledReaderabilityEvaluation();
      };
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
      window.addEventListener('load', onReady, { once: true });
      return;
    }
    runScheduledReaderabilityEvaluation();
  }

  function normalizePopupRuntimeMessage(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.source !== PREVIEW_MESSAGE_SOURCE || data.type !== POPUP_RUNTIME_MESSAGE_TYPE || data.version !== PREVIEW_MESSAGE_VERSION) {
      return null;
    }
    if (
      data.popupId !== popupRuntimeBinding.popupId ||
      data.popupSessionId !== popupRuntimeBinding.popupSessionId
    ) {
      return null;
    }
    if (data.action !== POPUP_RUNTIME_ACTIONS.REQUEST_READER_MODE || typeof data.requestId !== 'string') {
      return null;
    }
    return {
      action: data.action,
      requestId: data.requestId
    };
  }

  function createReaderModeResultPayload(requestId, success, article = null) {
    return createPopupRuntimeMessage(POPUP_RUNTIME_ACTIONS.READER_MODE_RESULT, {
      requestId,
      url: window.location.href,
      success: !!success,
      article
    });
  }

  function isMeaningfulReaderArticle(article) {
    if (!article || typeof article !== 'object') return false;
    const textContent = typeof article.textContent === 'string' ? article.textContent.trim() : '';
    const content = typeof article.content === 'string' ? article.content.trim() : '';
    return !!content && textContent.length >= MIN_READER_ARTICLE_LENGTH;
  }

  function parseReaderArticle() {
    if (
      typeof globalThis.Readability !== 'function' ||
      !isHtmlLikePreviewDocument()
    ) {
      return null;
    }
    const documentClone = document.cloneNode(true);
    const article = new globalThis.Readability(documentClone).parse();
    return isMeaningfulReaderArticle(article)
      ? {
          title: typeof article.title === 'string' ? article.title : '',
          byline: typeof article.byline === 'string' ? article.byline : '',
          dir: typeof article.dir === 'string' ? article.dir : '',
          lang: typeof article.lang === 'string' ? article.lang : '',
          content: typeof article.content === 'string' ? article.content : '',
          textContent: typeof article.textContent === 'string' ? article.textContent : '',
          length: Number.isFinite(article.length) ? article.length : 0,
          excerpt: typeof article.excerpt === 'string' ? article.excerpt : '',
          siteName: typeof article.siteName === 'string' ? article.siteName : '',
          publishedTime: typeof article.publishedTime === 'string' ? article.publishedTime : ''
        }
      : null;
  }

  function handleReaderModeRequest(message) {
    const article = (() => {
      try {
        return parseReaderArticle();
      } catch (_) {
        return null;
      }
    })();

    window.parent.postMessage(
      createReaderModeResultPayload(message.requestId, !!article, article),
      '*'
    );
  }

  // Child script liveness handshake: emit as soon as this content script runs.
  sendPreviewFrameAlive();
  sendPopupUrlUpdate();
  scheduleReaderabilityEvaluation();

  function sendPostLoadBridgeSignals() {
    sendPreviewFrameAlive();
    sendPopupUrlUpdate();
    scheduleReaderabilityEvaluation();
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
    if (!navigation) return;
    if (navigation.kind === 'hash') {
      schedulePreviewNavigationUpdateCheck();
      return;
    }
    if (navigation.kind !== 'document') return;
    if ((navigation.opensOutsideContext || navigation.isModifiedClick || navigation.isMiddleClick) && event.cancelable) {
      const initialHref = window.location.href;
      event.preventDefault();
      schedulePreviewNavigationUpdateCheck();
      queueMicrotask(() => {
        if (window.location.href !== initialHref) return;
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
    const initialHref = window.location.href;
    event.preventDefault();
    schedulePreviewNavigationUpdateCheck();
    queueMicrotask(() => {
      if (window.location.href !== initialHref) return;
      navigatePreviewInPlace(navigation.url);
    });
  }, true);

  window.addEventListener('message', (event) => {
    const message = normalizePopupRuntimeMessage(event?.data);
    if (!message) return;
    handleReaderModeRequest(message);
  });

  // Bring this popup to front when clicking inside its iframe
  document.addEventListener('pointerdown', () => {
    if (!iframeEnabled) return;
    window.parent.postMessage(
      createPopupRuntimeMessage(POPUP_RUNTIME_ACTIONS.BRING_TO_FRONT, {
        url: window.location.href
      }),
      '*'
    );
  });
})();
