(function(global) {
  const POPUP_MIN_WIDTH = 256;
  const POPUP_MIN_HEIGHT = 128;
  const POPUP_PERCENT_MIN = 10;
  const POPUP_PERCENT_MAX = 90;
  const DEFAULT_POPUP_SIZE_UNIT = 'percent';
  const PREVIEW_SIZE_UNIT_DEFAULTS = {
    percent: { width: 33, height: 33 },
    px: { width: 640, height: 360 }
  };

  function isValidPopupSizeUnit(value) {
    return value === 'percent' || value === 'px';
  }

  function getDefaultPreviewSizeForUnit(unit) {
    const normalizedUnit = isValidPopupSizeUnit(unit) ? unit : DEFAULT_POPUP_SIZE_UNIT;
    return PREVIEW_SIZE_UNIT_DEFAULTS[normalizedUnit];
  }

  function isValidPopupSizeValue(unit, dimension, value) {
    if (!Number.isInteger(value)) return false;
    if (unit === 'percent') {
      return value >= POPUP_PERCENT_MIN && value <= POPUP_PERCENT_MAX;
    }
    if (unit !== 'px') return false;
    return dimension === 'width' ? value >= POPUP_MIN_WIDTH : value >= POPUP_MIN_HEIGHT;
  }

  function normalizePreviewSizeSettings(settings) {
    const popupSizeUnit = isValidPopupSizeUnit(settings.popupSizeUnit) ? settings.popupSizeUnit : DEFAULT_POPUP_SIZE_UNIT;
    const defaults = getDefaultPreviewSizeForUnit(popupSizeUnit);
    const popupWidth = isValidPopupSizeValue(popupSizeUnit, 'width', settings.popupWidth)
      ? settings.popupWidth
      : defaults.width;
    const popupHeight = isValidPopupSizeValue(popupSizeUnit, 'height', settings.popupHeight)
      ? settings.popupHeight
      : defaults.height;

    return {
      popupSizeUnit,
      popupWidth,
      popupHeight
    };
  }

  global.PreviewSizeConfig = {
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_PERCENT_MIN,
    POPUP_PERCENT_MAX,
    DEFAULT_POPUP_SIZE_UNIT,
    PREVIEW_SIZE_UNIT_DEFAULTS,
    isValidPopupSizeUnit,
    getDefaultPreviewSizeForUnit,
    isValidPopupSizeValue,
    normalizePreviewSizeSettings
  };
})(globalThis);
