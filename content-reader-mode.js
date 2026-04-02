(function(global) {
  if (global.PreviewPopupReaderMode) return;

  const {
    getNavigationAnchorFromEvent,
    resolveNavigationUrl,
    classifyNavigationTarget
  } = global.PreviewNavigation;

  function createController(options = {}) {
    const t = typeof options.t === 'function' ? options.t : () => '';
    const isReaderModeSuggestionsEnabled = typeof options.isReaderModeSuggestionsEnabled === 'function'
      ? options.isReaderModeSuggestionsEnabled
      : () => true;
    const generateRuntimeId = typeof options.generateRuntimeId === 'function'
      ? options.generateRuntimeId
      : () => `reader-${Date.now()}`;
    const loadPopupUrl = typeof options.loadPopupUrl === 'function'
      ? options.loadPopupUrl
      : () => {};
    const postPopupRuntimeMessage = typeof options.postPopupRuntimeMessage === 'function'
      ? options.postPopupRuntimeMessage
      : () => false;
    const requestReaderModeAction = options.requestReaderModeAction;
    const popupControlCloseIconMarkup = typeof options.popupControlCloseIconMarkup === 'string'
      ? options.popupControlCloseIconMarkup
      : '';
    const readerErrorTimeoutMs = Number.isFinite(options.readerErrorTimeoutMs)
      ? options.readerErrorTimeoutMs
      : 3500;

    function normalizePageContextKey(url) {
      if (typeof url !== 'string' || !url.trim()) return '';
      try {
        const parsedUrl = new URL(url, global.location?.href);
        parsedUrl.hash = '';
        return parsedUrl.href;
      } catch (_) {
        const hashIndex = url.indexOf('#');
        return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
      }
    }

    function createState() {
      return {
        pageKey: '',
        available: false,
        dismissed: false,
        failed: false,
        isOpening: false,
        parseRequestId: null,
        article: null,
        errorVisible: false
      };
    }

    function getLabels() {
      return {
        suggestionText: t('preview_readerSuggestion'),
        openReaderMode: t('preview_openReaderMode'),
        dismissSuggestion: t('preview_dismissReaderSuggestion'),
        backToLivePreview: t('preview_backToLivePreview'),
        parseFailed: t('preview_readerModeFailed')
      };
    }

    function getState(popupEntry) {
      if (!popupEntry.readerState) {
        popupEntry.readerState = createState();
      }
      return popupEntry.readerState;
    }

    function clearErrorTimer(popupEntry) {
      if (!popupEntry?.readerErrorTimer) return;
      clearTimeout(popupEntry.readerErrorTimer);
      popupEntry.readerErrorTimer = null;
    }

    function removeView(popupEntry, options = {}) {
      if (!popupEntry) return;
      const { preserveArticle = true } = options;
      if (popupEntry.readerView && popupEntry.readerView.parentNode === popupEntry.bodyContainer) {
        popupEntry.bodyContainer.removeChild(popupEntry.readerView);
      }
      popupEntry.readerView = null;
      if (popupEntry.iframe) {
        popupEntry.iframe.hidden = false;
      }
      if (!preserveArticle) {
        getState(popupEntry).article = null;
      }
    }

    function syncPageContext(popupEntry, url, options = {}) {
      if (!popupEntry) return createState();
      const { forceRefresh = false } = options;
      const readerState = getState(popupEntry);
      const nextPageKey = normalizePageContextKey(url);

      if (!readerState.pageKey && nextPageKey) {
        readerState.pageKey = nextPageKey;
      }

      const pageChanged = !!nextPageKey && readerState.pageKey !== nextPageKey;
      const shouldRefreshCurrentPage = forceRefresh && !!nextPageKey && readerState.pageKey === nextPageKey;

      if (!pageChanged && !shouldRefreshCurrentPage) {
        return readerState;
      }

      clearErrorTimer(popupEntry);
      removeView(popupEntry, { preserveArticle: false });
      readerState.available = false;
      readerState.isOpening = false;
      readerState.parseRequestId = null;
      readerState.errorVisible = false;

      if (pageChanged) {
        readerState.pageKey = nextPageKey;
        readerState.dismissed = false;
        readerState.failed = false;
      }

      updateUi(popupEntry);
      return readerState;
    }

    function shouldShowSuggestion(popupEntry) {
      if (!popupEntry || popupEntry.isClosing || popupEntry.state !== 'ready') return false;
      if (!isReaderModeSuggestionsEnabled() || !popupEntry.iframe || popupEntry.fallback || popupEntry.readerView) return false;
      const readerState = getState(popupEntry);
      return !!(
        readerState.pageKey &&
        readerState.available &&
        !readerState.dismissed &&
        !readerState.failed &&
        !readerState.errorVisible
      );
    }

    function renderCurtain(popupEntry, mode = 'hidden') {
      if (!popupEntry?.curtain) return;
      const curtain = popupEntry.curtain;
      curtain.textContent = '';
      curtain.hidden = mode === 'hidden';
      curtain.className = 'link-preview-curtain';
      if (mode === 'hidden') return;

      const labels = getLabels();
      const message = global.document.createElement('div');
      message.className = 'link-preview-curtain-message';
      curtain.appendChild(message);

      const actions = global.document.createElement('div');
      actions.className = 'link-preview-curtain-actions';
      curtain.appendChild(actions);

      if (mode === 'suggestion') {
        const readerState = getState(popupEntry);
        message.textContent = labels.suggestionText;

        const openButton = global.document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'link-preview-curtain-button link-preview-curtain-button--primary';
        openButton.textContent = labels.openReaderMode;
        openButton.setAttribute('aria-label', labels.openReaderMode);
        openButton.title = labels.openReaderMode;
        openButton.disabled = readerState.isOpening;
        openButton.addEventListener('click', () => openMode(popupEntry));
        actions.appendChild(openButton);

        const dismissButton = global.document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.className = 'link-preview-curtain-dismiss';
        dismissButton.setAttribute('aria-label', labels.dismissSuggestion);
        dismissButton.title = labels.dismissSuggestion;
        dismissButton.innerHTML = popupControlCloseIconMarkup;
        dismissButton.addEventListener('click', () => dismissSuggestion(popupEntry));
        actions.appendChild(dismissButton);
        return;
      }

      curtain.classList.add('link-preview-curtain--error');
      message.textContent = labels.parseFailed;
    }

    function updateUi(popupEntry) {
      if (!popupEntry) return;
      if (getState(popupEntry).errorVisible) {
        renderCurtain(popupEntry, 'error');
        return;
      }
      renderCurtain(popupEntry, shouldShowSuggestion(popupEntry) ? 'suggestion' : 'hidden');
    }

    function dismissSuggestion(popupEntry) {
      const readerState = getState(popupEntry);
      readerState.dismissed = true;
      updateUi(popupEntry);
    }

    function showError(popupEntry) {
      const readerState = getState(popupEntry);
      clearErrorTimer(popupEntry);
      readerState.errorVisible = true;
      updateUi(popupEntry);
      popupEntry.readerErrorTimer = setTimeout(() => {
        readerState.errorVisible = false;
        popupEntry.readerErrorTimer = null;
        updateUi(popupEntry);
      }, readerErrorTimeoutMs);
    }

    function resolveSafeUrl(url, baseUrl, allowedProtocols, options = {}) {
      const { allowHash = false } = options;
      const resolvedUrl = resolveNavigationUrl(url, baseUrl);
      if (!resolvedUrl) return '';
      if (allowHash && resolvedUrl.hash) {
        const baseReference = resolveNavigationUrl(baseUrl, baseUrl);
        if (baseReference) {
          const resolvedWithoutHash = new URL(resolvedUrl.href);
          resolvedWithoutHash.hash = '';
          const baseWithoutHash = new URL(baseReference.href);
          baseWithoutHash.hash = '';
          if (resolvedWithoutHash.href === baseWithoutHash.href) {
            return resolvedUrl.href;
          }
        }
      }
      return allowedProtocols.includes(resolvedUrl.protocol) ? resolvedUrl.href : '';
    }

    function sanitizeSrcset(srcset, baseUrl) {
      if (typeof srcset !== 'string' || !srcset.trim()) return '';
      const candidates = srcset
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .map((candidate) => {
          const parts = candidate.split(/\s+/);
          const candidateUrl = parts.shift();
          const resolvedUrl = resolveSafeUrl(candidateUrl, baseUrl, ['http:', 'https:']);
          if (!resolvedUrl) return '';
          return [resolvedUrl, ...parts].join(' ');
        })
        .filter(Boolean);
      return candidates.join(', ');
    }

    function getBaseUrl(popupEntry) {
      return popupEntry?.currentUrl || popupEntry?.requestedUrl || global.location?.href || '';
    }

    function classifyNavigation(anchor, popupEntry, event) {
      if (!anchor) return null;
      const baseUrl = getBaseUrl(popupEntry);
      return classifyNavigationTarget({
        anchor,
        baseUrl,
        currentDocumentUrl: baseUrl,
        event
      });
    }

    function navigateFromReaderLink(popupEntry, url) {
      if (!popupEntry || !url) return false;
      removeView(popupEntry, { preserveArticle: false });
      loadPopupUrl(popupEntry, typeof url === 'string' ? url : url.toString());
      return true;
    }

    function getScrollContainer(popupEntry) {
      return popupEntry?.readerView?.querySelector('.link-preview-reader-article') || null;
    }

    function findHashTarget(popupEntry, hash) {
      if (!popupEntry?.readerView) return null;
      const normalizedHash = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
      if (!normalizedHash) return getScrollContainer(popupEntry);
      let decodedHash = normalizedHash;
      try {
        decodedHash = decodeURIComponent(normalizedHash);
      } catch (_) {}

      const candidates = popupEntry.readerView.querySelectorAll('[id], [name]');
      return Array.from(candidates).find((node) => {
        const nodeId = node.getAttribute('id') || '';
        const nodeName = node.getAttribute('name') || '';
        return nodeId === normalizedHash || nodeId === decodedHash || nodeName === normalizedHash || nodeName === decodedHash;
      }) || null;
    }

    function handleHashNavigation(popupEntry, url) {
      const scrollContainer = getScrollContainer(popupEntry);
      if (!scrollContainer || !url) return false;
      const targetNode = findHashTarget(popupEntry, url.hash);
      if (targetNode && targetNode !== scrollContainer) {
        targetNode.scrollIntoView({ block: 'start', inline: 'nearest' });
        return true;
      }
      scrollContainer.scrollTop = 0;
      return true;
    }

    function handleLinkActivation(popupEntry, event) {
      if (!popupEntry?.readerView) return;
      const anchor = getNavigationAnchorFromEvent(event);
      if (!anchor || !popupEntry.readerView.contains(anchor)) return;

      const navigation = classifyNavigation(anchor, popupEntry, event);
      if (!navigation || !event.cancelable) return;
      if (navigation.kind === 'hash') {
        event.preventDefault();
        event.stopPropagation();
        handleHashNavigation(popupEntry, navigation.url);
        return;
      }
      if (navigation.kind !== 'document') return;

      event.preventDefault();
      event.stopPropagation();
      navigateFromReaderLink(popupEntry, navigation.url);
    }

    const READER_ALLOWED_TAGS = new Set([
      'a',
      'article',
      'blockquote',
      'br',
      'caption',
      'code',
      'div',
      'em',
      'figcaption',
      'figure',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'img',
      'li',
      'ol',
      'p',
      'picture',
      'pre',
      'section',
      'small',
      'source',
      'span',
      'strong',
      'sub',
      'sup',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul'
    ]);

    function sanitizeNode(node, targetDocument, baseUrl) {
      if (!node || !targetDocument) return null;
      if (node.nodeType === Node.TEXT_NODE) {
        return targetDocument.createTextNode(node.textContent || '');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const tagName = String(node.tagName || '').toLowerCase();
      if (!READER_ALLOWED_TAGS.has(tagName)) {
        const fragment = targetDocument.createDocumentFragment();
        Array.from(node.childNodes).forEach((childNode) => {
          const sanitizedChild = sanitizeNode(childNode, targetDocument, baseUrl);
          if (sanitizedChild) fragment.appendChild(sanitizedChild);
        });
        return fragment;
      }

      const safeNode = targetDocument.createElement(tagName);
      if (tagName === 'a') {
        const href = resolveSafeUrl(node.getAttribute('href'), baseUrl, ['http:', 'https:', 'mailto:', 'tel:'], { allowHash: true });
        if (href) {
          safeNode.setAttribute('href', href);
        }
        if (node.hasAttribute('download')) {
          const downloadValue = node.getAttribute('download');
          safeNode.setAttribute('download', downloadValue === null ? '' : downloadValue);
        }
      }
      if (tagName === 'img') {
        const src = resolveSafeUrl(node.getAttribute('src'), baseUrl, ['http:', 'https:']);
        if (src) {
          safeNode.setAttribute('src', src);
        }
        const srcset = sanitizeSrcset(node.getAttribute('srcset'), baseUrl);
        if (srcset) {
          safeNode.setAttribute('srcset', srcset);
        }
        const alt = node.getAttribute('alt');
        if (typeof alt === 'string') {
          safeNode.setAttribute('alt', alt);
        }
      }
      if (tagName === 'source') {
        const src = resolveSafeUrl(node.getAttribute('src'), baseUrl, ['http:', 'https:']);
        if (src) {
          safeNode.setAttribute('src', src);
        }
        const srcset = sanitizeSrcset(node.getAttribute('srcset'), baseUrl);
        if (srcset) {
          safeNode.setAttribute('srcset', srcset);
        }
        const media = node.getAttribute('media');
        if (typeof media === 'string' && media.trim()) {
          safeNode.setAttribute('media', media);
        }
        const type = node.getAttribute('type');
        if (typeof type === 'string' && type.trim()) {
          safeNode.setAttribute('type', type);
        }
      }

      Array.from(node.childNodes).forEach((childNode) => {
        const sanitizedChild = sanitizeNode(childNode, targetDocument, baseUrl);
        if (sanitizedChild) safeNode.appendChild(sanitizedChild);
      });
      return safeNode;
    }

    function buildContentFragment(article, targetDocument, baseUrl) {
      const parser = new DOMParser();
      const parsedDocument = parser.parseFromString(String(article?.content || ''), 'text/html');
      const fragment = targetDocument.createDocumentFragment();
      Array.from(parsedDocument.body.childNodes).forEach((childNode) => {
        const sanitizedChild = sanitizeNode(childNode, targetDocument, baseUrl);
        if (sanitizedChild) fragment.appendChild(sanitizedChild);
      });
      return fragment;
    }

    function buildMetaLine(article) {
      const parts = [
        typeof article?.byline === 'string' ? article.byline.trim() : '',
        typeof article?.siteName === 'string' ? article.siteName.trim() : '',
        typeof article?.publishedTime === 'string' ? article.publishedTime.trim() : ''
      ].filter(Boolean);
      return parts.join(' / ');
    }

    function isValidArticle(article) {
      if (!article || typeof article !== 'object') return false;
      if (typeof article.content !== 'string' || !article.content.trim()) return false;
      const textContent = typeof article.textContent === 'string' ? article.textContent.trim() : '';
      return textContent.length >= 200;
    }

    function enterMode(popupEntry, article) {
      if (!popupEntry?.bodyContainer || !isValidArticle(article)) return false;
      const readerState = getState(popupEntry);
      clearErrorTimer(popupEntry);
      readerState.errorVisible = false;
      readerState.article = article;
      removeView(popupEntry);

      const labels = getLabels();
      const readerView = global.document.createElement('div');
      readerView.className = 'link-preview-reader';
      readerView.addEventListener('click', (event) => handleLinkActivation(popupEntry, event));
      readerView.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        handleLinkActivation(popupEntry, event);
      });

      const toolbar = global.document.createElement('div');
      toolbar.className = 'link-preview-reader-toolbar';
      readerView.appendChild(toolbar);

      const backButton = global.document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'link-preview-curtain-button';
      backButton.textContent = labels.backToLivePreview;
      backButton.setAttribute('aria-label', labels.backToLivePreview);
      backButton.title = labels.backToLivePreview;
      backButton.addEventListener('click', () => {
        removeView(popupEntry);
        updateUi(popupEntry);
      });
      toolbar.appendChild(backButton);

      const articleNode = global.document.createElement('article');
      articleNode.className = 'link-preview-reader-article';
      if (typeof article.lang === 'string' && article.lang.trim()) {
        articleNode.lang = article.lang.trim();
      }
      if (typeof article.dir === 'string' && article.dir.trim()) {
        articleNode.dir = article.dir.trim();
      }

      if (typeof article.title === 'string' && article.title.trim()) {
        const titleNode = global.document.createElement('h1');
        titleNode.className = 'link-preview-reader-title';
        titleNode.textContent = article.title.trim();
        articleNode.appendChild(titleNode);
      }

      const metaLine = buildMetaLine(article);
      if (metaLine) {
        const metaNode = global.document.createElement('p');
        metaNode.className = 'link-preview-reader-meta';
        metaNode.textContent = metaLine;
        articleNode.appendChild(metaNode);
      }

      if (typeof article.excerpt === 'string' && article.excerpt.trim()) {
        const excerptNode = global.document.createElement('p');
        excerptNode.className = 'link-preview-reader-excerpt';
        excerptNode.textContent = article.excerpt.trim();
        articleNode.appendChild(excerptNode);
      }

      const contentNode = global.document.createElement('div');
      contentNode.className = 'link-preview-reader-content';
      contentNode.appendChild(buildContentFragment(article, global.document, getBaseUrl(popupEntry)));
      articleNode.appendChild(contentNode);
      readerView.appendChild(articleNode);

      popupEntry.readerView = readerView;
      if (popupEntry.iframe) {
        popupEntry.iframe.hidden = true;
      }
      popupEntry.bodyContainer.appendChild(readerView);
      updateUi(popupEntry);
      return true;
    }

    function openMode(popupEntry) {
      const readerState = getState(popupEntry);
      if (readerState.failed || !readerState.pageKey || (!readerState.article && !readerState.available)) return;
      if (readerState.article && enterMode(popupEntry, readerState.article)) {
        return;
      }
      if (readerState.isOpening) return;

      const requestId = generateRuntimeId('reader-request');
      readerState.isOpening = true;
      readerState.parseRequestId = requestId;
      updateUi(popupEntry);

      if (postPopupRuntimeMessage(popupEntry, requestReaderModeAction, { requestId })) {
        return;
      }

      readerState.isOpening = false;
      readerState.parseRequestId = null;
      readerState.failed = true;
      readerState.available = false;
      showError(popupEntry);
    }

    function handleReaderabilityReport(popupEntry, currentUrl, readerable) {
      if (!popupEntry) return;
      const readerState = syncPageContext(popupEntry, currentUrl);
      if (!readerState.pageKey || readerState.pageKey !== normalizePageContextKey(currentUrl)) return;
      readerState.available = !!readerable;
      if (!readerable) {
        readerState.isOpening = false;
        readerState.parseRequestId = null;
        readerState.article = null;
      }
      updateUi(popupEntry);
    }

    function handleReaderModeResult(popupEntry, message) {
      if (!popupEntry) return;
      const readerState = syncPageContext(popupEntry, message.url);
      if (readerState.parseRequestId !== message.requestId) return;
      readerState.isOpening = false;
      readerState.parseRequestId = null;

      if (
        readerState.pageKey !== normalizePageContextKey(message.url) ||
        !message.success ||
        !isValidArticle(message.article) ||
        !enterMode(popupEntry, message.article)
      ) {
        readerState.failed = true;
        readerState.available = false;
        readerState.article = null;
        removeView(popupEntry, { preserveArticle: false });
        showError(popupEntry);
        return;
      }

      readerState.failed = false;
      readerState.available = true;
    }

    return Object.freeze({
      normalizePageContextKey,
      createState,
      getState,
      clearErrorTimer,
      removeView,
      syncPageContext,
      updateUi,
      openMode,
      handleReaderabilityReport,
      handleReaderModeResult
    });
  }

  global.PreviewPopupReaderMode = Object.freeze({
    createController
  });
})(globalThis);
