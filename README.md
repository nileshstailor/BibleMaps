# Bible Maps

Manifest V3 Chrome extension for [bible.com](https://www.bible.com). It detects curated biblical **places** and **journeys** in the verse text, highlights them on the page, and opens a **side panel** with:

- **Places** → Open in Google Maps, plus in-panel **Google embed** / kingdom overlay map
- **Journeys** → **Modern** embedded Google Map + multi-stop link; **Then** → Google embed or **Kingdoms** (Esri street tiles + schematic borders)

No LLM, no required remote API key for v1. Matching uses a local gazetteer (`data/places.json`) and journey catalog (`data/journeys.json`).

## Load unpacked

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `BibleMaps` (the directory that contains `manifest.json`)
5. Pin **Bible Maps** from the extensions menu if you like

No build step is required. Leaflet is vendored under `lib/`.

## Verify on a sample passage

1. Open a passage rich in place names, for example:
   - [Acts 13 (NIV) — Paul’s first journey geography](https://www.bible.com/bible/111/ACT.13.NIV)
   - [John 6 — Capernaum / Sea of Galilee](https://www.bible.com/bible/111/JHN.6.NIV)
   - [Genesis 12 — Abraham / Canaan / Egypt](https://www.bible.com/bible/111/GEN.12.NIV)
2. Wait a moment for highlights (amber underlines on place names).
3. Click the **Bible Maps** toolbar icon to open the side panel (or click a highlighted place).
4. Confirm:
   - **Places** lists matches with working **Open in Google Maps** links
   - **Journeys** may list Paul’s / Abraham / Exodus outlines when enough stops or journey cues appear
   - Open a journey → **Modern** (Google Maps) and **Then** (Leaflet muted overlay)

Tip: use **Refresh** in the side panel after bible.com finishes its SPA navigation.

## Extension structure

```
BibleMaps/
  manifest.json
  README.md
  background/service-worker.js   # message routing + side panel open
  content/content.js             # SPA-aware scan + highlight
  content/content.css
  content/matcher.js             # gazetteer / journey matching
  data/places.json               # ~95 biblical places
  data/journeys.json             # Abraham, Exodus, Paul’s journeys
  data/kingdoms.json             # schematic Israel / Judah / Philistia polygons
  sidepanel/sidepanel.html|css|js|svg-map.js
  icons/icon16.png|icon48.png|icon128.png
```

## Architecture notes

- **Content script** runs on `*.bible.com` and matches gazetteer aliases with the **CSS Custom Highlight API** (no DOM wrapping — avoids React hydration errors on bible.com).
- **Background service worker** only routes detection payloads and opens `chrome.sidePanel`.
- **Side panel** embeds Google Maps via iframe (no API key) and can draw kingdom polygons on Esri tiles via Leaflet when OSM tiles are blocked from the extension origin.

## Gaps / later

- Place coverage is high-frequency, not exhaustive; some Exodus stops are geographically debated.
- Journey detection is heuristic (alias cues + co-occurring stops), not full narrative NLP.
- Google Maps waypoint limits may thin very long itineraries.
- True 3D terrain / Cesium-style flythrough is explicitly out of v1.
- Kingdom polygons are schematic teaching overlays, not a scholarly boundary dataset.
- In-panel maps use Esri street tiles (OSM often blocks `chrome-extension://`). Yahoo Maps is discontinued; Bing/Azure Maps needs an API key. Carto and Esri are the usual free-ish tile options that work from extensions.
- `media/historical/` holds compressed atlas overlays sourced from your local `Downloads/Bible Maps` set (Knowing the Bible / USGS topography). These are **image overlays**, not slippy offline tiles or vector borders. Keep licensing in mind if you redistribute the extension.
- bible.com class names change often; selectors are defensive but may need updates.
- bible.com `401 /authenticate` and some React hydration messages can be site-side; after upgrading from older Bible Maps builds, **hard-refresh** the tab once so leftover `<mark>` nodes are gone (we no longer unwrap them, because that triggered React #418).
