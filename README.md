# Preview Link

Preview Link is a Chrome extension for live in-context link preview.

It helps you inspect links without opening unnecessary tabs and without losing the current page context.

## What it does

Preview Link lets you open links inside floating preview popups directly on the current page.

This is useful when you want to:

* inspect a link before fully opening it
* reduce tab clutter
* compare multiple links more easily
* keep your original page visible while exploring related content

## Main idea

Instead of choosing between:

* opening a link in the same tab and losing context
* opening many links in new tabs and creating clutter

Preview Link gives you a lighter workflow:

* stay on the current page
* preview the target page in context
* decide later whether it deserves full navigation

## Current interaction modes

The extension supports:

* hover preview
* hover + trigger key preview

## Current project status

This repository contains the source code of the Chrome extension.

The application is currently built as:

* Manifest V3 extension
* background service worker
* content scripts
* DOM-rendered floating preview popups
* iframe-based live preview

## Project structure

```text
manifest.json
background.js
content.js
iframe-handler.js
popup.html
popup.js
styles/
  popup.css
icons/
  icon-off.png
  icon-on.png
```

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
4. Select the project folder

### 3. Make changes

Edit the source files locally.

### 4. Reload the extension

After changes:

* go to `chrome://extensions`
* click **Reload** on the extension card
* refresh the page where you are testing

## Packaging for Chrome Web Store

Create a ZIP package from the extension root so that `manifest.json` is in the root of the archive.

The package should include runtime files such as:

* `manifest.json`
* JavaScript files
* `popup.html`
* `styles/`
* `icons/`

The package should not include:

* `.git/`
* `.github/`
* `_metadata/`
* editor folders
* previous zip/crx artifacts

## Settings

The extension currently supports user-configurable settings such as:

* enabled / disabled state
* preview interaction mode
* hover delay
* trigger key
* max open previews

## Product philosophy

Preview Link is meant to be:

* lightweight
* practical
* fast
* predictable
* useful in real link-heavy workflows

It is not meant to become:

* a full browser inside the page
* a tab manager
* a heavy browsing dashboard
* a complex rule engine

## Current limitations

The extension uses iframe as the primary preview engine.

Because of that, some websites may block embedded preview through their own security policies. This is a platform limitation of the web, not always a bug in the extension.

## Development direction

The main development priorities are:

* runtime stability
* clear popup lifecycle
* predictable interaction behavior
* better fallback handling for blocked previews
* low-friction settings and UX
* minimal unnecessary complexity

