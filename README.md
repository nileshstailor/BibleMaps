# Bible Maps

Manifest V3 Chrome extension for [bible.com](https://www.bible.com). It detects curated biblical **places** and **journeys** in the verse text, highlights them on the page, and opens a **side panel** with:

- **Places** → Offline **MapLibre** map (always visible) with period towns; per-place Google Maps links for modern streets
- **Journeys** → Same offline map (era preset + route) + optional walking directions link in Google Maps

No LLM and **no live map-tile servers**. The in-panel basemap is [MapLibre GL JS](https://maplibre.org/projects/gl-js/) reading a bundled regional [PMTiles](https://protomaps.com/) extract (OpenStreetMap / Protomaps, ODbL).

## Load unpacked

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder (contains `manifest.json`)
4. Pin **Bible Maps** if you like

No build step is required for day-to-day use. MapLibre and PMTiles are vendored under `lib/maplibre/`.

## Verify

1. Open e.g. [1 Kings 14](https://www.bible.com/bible/116/1KI.14.NLT) or [Acts 13](https://www.bible.com/bible/111/ACT.13.NIV)
2. Wait for light-green place highlights
3. Open the side panel — Places/Journeys accordion on top, offline map below; scroll the panel as one page
4. Confirm land/roads (not a solid blue box), pins, auto-framing for the chapter/journey, optional kingdom outlines when relevant
5. Expand a place row for notes / Google Maps; journeys can open walking directions

After pulling updates: **Reload** the extension on `chrome://extensions`.

## Offline tiles

- Bundled archive: `media/tiles/bible-region.pmtiles` (~25 MB, maxzoom 8, Med + Near East)
- Style: `media/tiles/style.json` (Protomaps light layers without remote fonts)
- Rebuild (optional): install the [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) CLI as `scripts/pmtiles`, then run `scripts/build-pmtiles.sh`

Attribution on the map: Protomaps + © OpenStreetMap contributors.

## Structure

```
BibleMaps/
  manifest.json
  background/service-worker.js
  content/…
  data/places.json | journeys.json | kingdoms.json | atlas-presets.json
  media/tiles/bible-region.pmtiles | style.json
  media/historical/          # optional JPG reference plates
  lib/maplibre/              # MapLibre CSP build + pmtiles.js
  sidepanel/
  scripts/build-pmtiles.sh
```

## Notes

- Matching uses the local gazetteer; no AI geocoding.
- Kingdom polygons are teaching overlays digitized from `media/historical/divided-kingdom.jpg` (Knowing the Bible / USGS topography).
- Reference atlas JPGs under `media/historical/` are optional art, not the basemap.
- Keep ODbL attribution if you redistribute the PMTiles extract.
