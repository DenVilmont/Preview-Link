# Preview Link

Preview Link is a Chrome extension for in-context link preview.

Its core model is simple:

- the main preview surface is a live iframe inside a floating popup
- the popup stays on the current page so you can inspect links without leaving context
- reader mode is a secondary helper for article-like pages, not the main product mode

## Current feature set

- floating live preview popups on the current page
- hover-only and hover-plus-key interaction modes
- multiple open previews with configurable limits
- popup reload, close, and open-in-new-tab actions
- localized UI and settings
- options/settings page
- reader mode suggestion for article-like pages, opened explicitly by the user
- fallback handling for blocked or failed iframe previews

## Runtime model

The extension is a Manifest V3 Chrome extension with:

- a background service worker for browser-level state such as the action icon
- content scripts that own preview popup creation and runtime behavior
- a preview iframe bridge that keeps navigation and liveness updates inside the popup flow
- shared runtime/config modules for settings, i18n, sizing, theme tokens, and navigation classification

Live iframe preview remains the primary engine. Reader mode is an assistive layer rendered by the popup runtime when the user explicitly opens it.

## Repository structure

The repository currently looks like this at a useful developer level:

```text
manifest.json
background.js

content.js
content-reader-mode.js
iframe-handler.js

preview-runtime-contract.js
preview-navigation.js
preview-settings.js
preview-size-config.js
preview-theme.js
preview-i18n.js

popup.html
popup.js
options.html
options.js

vendor/
  readability/
    readability-readerable.js
    readability.js

_locales/
  en/messages.json
  es/messages.json
  ru/messages.json
  zh_CN/messages.json

icons/
  icon-off.png
  icon-on.png
```

## Important files

- `content.js`
  Main top-level page runtime. Owns popup collection, popup lifecycle, and iframe preview orchestration.

- `content-reader-mode.js`
  Reader-mode feature module used by `content.js`. Owns reader rendering, sanitization, reader link handling, and reader-specific transient state helpers.

- `iframe-handler.js`
  Runtime bridge that runs inside preview iframes. Handles preview navigation behavior, frame-alive messaging, and readerability detection/parsing requests for the current preview document.

- `preview-runtime-contract.js`
  Shared message/action contract between popup runtime and iframe runtime.

- `preview-navigation.js`
  Shared navigation classification helper used by iframe preview and reader mode.

- `preview-settings.js`
  Canonical settings model, defaults, normalization, storage read/write, and subscriptions.

- `preview-i18n.js`
  Locale loading and translation helpers for popup, options, and content runtime UI.

- `options.html` / `options.js`
  Full settings page.

- `popup.html` / `popup.js`
  Extension action popup for quick controls.

- `vendor/readability/`
  Vendored Mozilla Readability sources used for reader-mode suggestion and parsing.

## Settings currently supported

The current settings model includes:

- enabled / disabled state
- interaction mode
- hover delay
- trigger key
- popup size defaults
- maximum open previews
- theme mode
- UI language
- reader mode suggestions
- video mode

## Localization

The extension includes locale catalogs under `_locales/` and currently ships:

- English
- Spanish
- Russian
- Simplified Chinese

User-facing strings should go through the existing i18n pipeline instead of being hardcoded in runtime UI.

## Local development

### 1. Clone the repository

```bash
git clone https://github.com/DenVilmont/Preview-Link.git
cd Preview-Link
```

### 2. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the repository root

### 3. Make changes

Edit the project files locally.

If you change:

- `manifest.json`, reload the extension
- content/runtime files, reload the extension and refresh the test page
- locale files, reload the extension so catalogs are reloaded

### 4. Test the current behavior

Useful smoke checks:

- open a page with links and verify live preview popups still open
- test popup navigation and reload behavior
- open the options page and verify settings still save
- switch UI language and confirm localized strings still load
- test a readerable article page and verify reader suggestion and reader mode still work

## Packaging

Create a ZIP from the extension root so that `manifest.json` is at the archive root.

Include:

- `manifest.json`
- runtime JavaScript files
- HTML files
- `vendor/`
- `_locales/`
- `icons/`

Do not include:

- `.git/`
- `.github/`
- editor-specific folders
- previous zip/crx artifacts

## Limitations

- iframe preview is the primary engine, so some sites will block embedded preview with their own security policies
- reader mode is intentionally secondary and only appears when the current preview document looks article-like
- blocked previews fall back to a simpler external-open/copy flow rather than bypassing site restrictions
