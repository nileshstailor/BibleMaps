# Bible Maps

Manifest V3 Chrome extension for [bible.com](https://www.bible.com). It detects curated biblical **places** and **journeys** in the verse text, highlights them on the page, and opens a **side panel** with:

- **Places** → Open in Google Maps (modern streets) + offline **teaching map** with period towns
- **Journeys** → Same teaching map (era preset + route) + walking directions link in Google Maps

No LLM, no map-tile network for the in-panel map. Matching uses a local gazetteer (`data/places.json`) and journey catalog (`data/journeys.json`). The side panel basemap is recreated vector GeoJSON (coast / land / kingdoms), not live Esri or Google tiles.

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
   - [1 Kings 14 — Tirzah / Shiloh](https://www.bible.com/bible/116/1KI.14.NLT)
   - [John 6 — Capernaum / Sea of Galilee](https://www.bible.com/bible/111/JHN.6.NIV)
2. Wait a moment for highlights (light green on place names).
3. Click the **Bible Maps** toolbar icon to open the side panel (or click a highlighted place / hover chip).
4. Confirm:
   - **Places** lists matches with working **Open in Google Maps** links
   - **Open map** shows one offline teaching map (era preset selector; optional kingdom outlines on Levant maps)
   - **Journeys** open the matching era map with a route line
   - Optional **Reference atlas plate** shows bundled JPG art (not georeferenced)

Tip: use **Refresh** in the side panel after bible.com finishes its SPA navigation. Reload the extension after pulling this version.

## Extension structure

```
BibleMaps/
  manifest.json
  README.md
  background/service-worker.js
  content/content.js|css + matcher.js
  data/places.json              # gazetteer + era/region tags
  data/journeys.json
  data/kingdoms.json
  data/atlas-presets.json       # era teaching-map recipes
  data/coast-*.geojson          # offline vector basemaps
  media/historical/             # optional reference JPG plates
  sidepanel/sidepanel.html|css|js
  lib/leaflet.*                 # vendored Leaflet
  icons/
```

## Architecture notes

- **Content script** matches gazetteer aliases with the **CSS Custom Highlight API** (no DOM wrapping — avoids React hydration errors on bible.com).
- **Background service worker** routes detection payloads and opens `chrome.sidePanel` synchronously on gesture.
- **Side panel** draws an offline Leaflet teaching map (vector coast + period towns + optional kingdoms). Google Maps is an external link for modern streets/walking only — not an in-panel tile layer.
- Bundled atlas JPGs are **reference art** only; pins use gazetteer lat/lng on the recreated vector map.

## Gaps / later

- Place coverage is high-frequency, not exhaustive; some Exodus stops are geographically debated.
- Coast polygons are schematic teaching outlines, not cartographic surveys.
- Journey detection is heuristic (alias cues + co-occurring stops), not full narrative NLP.
- Kingdom polygons are schematic teaching overlays, not a scholarly boundary dataset.
- Keep licensing in mind if you redistribute the Knowing the Bible reference plates under `media/historical/`.
- bible.com class names change often; selectors are defensive but may need updates.
