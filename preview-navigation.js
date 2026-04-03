(function(global) {
  if (global.PreviewNavigation) return;

  const DOCUMENT_PROTOCOLS = Object.freeze(['http:', 'https:']);

  function getAnchorCandidateFromNode(node) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.matches === 'function' && node.matches('a[href]')) {
      return node;
    }
    if (typeof node.closest === 'function') {
      return node.closest('a[href]');
    }
    return null;
  }

  function getNavigationAnchorFromComposedPath(event) {
    if (!event || typeof event.composedPath !== 'function') return null;
    const composedPath = event.composedPath();
    if (!Array.isArray(composedPath)) return null;
    for (const pathNode of composedPath) {
      const anchor = getAnchorCandidateFromNode(pathNode);
      if (anchor) return anchor;
    }
    return null;
  }

  function getNavigationAnchorFromEvent(event) {
    const composedPathAnchor = getNavigationAnchorFromComposedPath(event);
    if (composedPathAnchor) return composedPathAnchor;
    return getAnchorCandidateFromNode(event?.target || null);
  }

  function normalizeNavigationTarget(anchor) {
    const rawTarget = typeof anchor?.getAttribute === 'function' ? anchor.getAttribute('target') : '';
    return (rawTarget || '').trim().toLowerCase();
  }

  function resolveNavigationUrl(rawUrl, baseUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
    try {
      return new URL(rawUrl, baseUrl || global.location?.href || undefined);
    } catch (_) {
      return null;
    }
  }

  function stripHash(url) {
    if (!url) return '';
    const copy = new URL(url.href);
    copy.hash = '';
    return copy.href;
  }

  function isHashOnlyNavigation(url, referenceUrl) {
    if (!url || !referenceUrl || !url.hash) return false;
    return stripHash(url) === stripHash(referenceUrl);
  }

  function classifyNavigationTarget(options = {}) {
    const {
      anchor = null,
      href = null,
      baseUrl = null,
      currentDocumentUrl = baseUrl,
      event = null
    } = options;

    const rawHref = typeof href === 'string'
      ? href
      : (typeof anchor?.getAttribute === 'function' ? anchor.getAttribute('href') : '') || anchor?.href || '';
    if (!rawHref) return null;

    if (anchor?.hasAttribute?.('download')) {
      return { anchor, rawHref, url: null, kind: 'special', reason: 'download' };
    }

    const resolvedUrl = resolveNavigationUrl(rawHref, baseUrl);
    if (!resolvedUrl) {
      return { anchor, rawHref, url: null, kind: 'special', reason: 'invalid-url' };
    }

    const protocol = String(resolvedUrl.protocol || '').toLowerCase();
    if (protocol === 'javascript:') {
      return { anchor, rawHref, url: resolvedUrl, kind: 'special', reason: 'javascript' };
    }

    const referenceUrl = resolveNavigationUrl(currentDocumentUrl || baseUrl || rawHref, baseUrl || currentDocumentUrl || undefined);
    if (DOCUMENT_PROTOCOLS.includes(protocol) && isHashOnlyNavigation(resolvedUrl, referenceUrl)) {
      return {
        anchor,
        rawHref,
        url: resolvedUrl,
        kind: 'hash',
        reason: 'hash-only',
        target: normalizeNavigationTarget(anchor),
        isModifiedClick: !!(event && (event.metaKey || event.ctrlKey || event.shiftKey)),
        isMiddleClick: !!(event && event.type === 'auxclick' && event.button === 1),
        opensOutsideContext: !!(normalizeNavigationTarget(anchor) && normalizeNavigationTarget(anchor) !== '_self')
      };
    }

    if (!DOCUMENT_PROTOCOLS.includes(protocol)) {
      return { anchor, rawHref, url: resolvedUrl, kind: 'special', reason: 'unsupported-protocol' };
    }

    return {
      anchor,
      rawHref,
      url: resolvedUrl,
      kind: 'document',
      target: normalizeNavigationTarget(anchor),
      isModifiedClick: !!(event && (event.metaKey || event.ctrlKey || event.shiftKey)),
      isMiddleClick: !!(event && event.type === 'auxclick' && event.button === 1),
      opensOutsideContext: !!(normalizeNavigationTarget(anchor) && normalizeNavigationTarget(anchor) !== '_self')
    };
  }

  global.PreviewNavigation = Object.freeze({
    DOCUMENT_PROTOCOLS,
    getNavigationAnchorFromEvent,
    normalizeNavigationTarget,
    resolveNavigationUrl,
    classifyNavigationTarget
  });
})(globalThis);
