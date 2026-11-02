# Bible Maps

Manifest V3 Chrome extension for [bible.com](https://www.bible.com) and [Bible Gateway](https://www.biblegateway.com/). It detects curated biblical **places** and **journeys** in the verse text, highlights them on the page, and opens a **side panel** with:

- **Places** → Offline **MapLibre** map (always visible) with period towns; per-place Google Maps links for modern streets
- **Journeys** → Same offline map (era preset + route) + optional walking directions link in Google Maps

No LLM. The in-panel basemap is [MapLibre GL JS](https://maplibre.org/projects/gl-js/) reading a bundled regional [PMTiles](https://protomaps.com/) extract (OpenStreetMap / Protomaps, ODbL). **When you are online**, a keyless Esri world canvas raster fills in outside that extract; offline stays fully local.

## Load unpacked

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder (contains `manifest.json`)
4. Pin **Bible Maps** if you like

No build step is required for day-to-day use. MapLibre and PMTiles are vendored under `lib/maplibre/`.

## Verify

1. Open e.g. [1 Kings 14](https://www.bible.com/bible/116/1KI.14.NLT) or [Acts 13](https://www.bible.com/bible/111/ACT.13.NIV) on bible.com
2. Wait for light-green place highlights
3. Open the side panel — Places/Journeys accordion on top, offline map below; scroll the panel as one page
4. Confirm land/roads (not a solid blue box), pins, auto-framing for the chapter/journey, optional kingdom outlines when relevant
5. Expand a place row for notes / Google Maps; journeys can open walking directions

### Bible Gateway

1. Reload the extension after updating
2. Open [Genesis 12 NIV](https://www.biblegateway.com/passage/?search=Genesis+12&version=NIV) (or [1 Kings 14 NLT](https://www.biblegateway.com/passage/?search=1+Kings+14&version=NLT))
3. Confirm place highlights in the passage body (not in footnotes / cross-references)
4. Open the side panel — same Places/Journeys + map layout as bible.com
5. Click **prev/next chapter** and confirm the panel refreshes for the new passage

After pulling updates: **Reload** the extension on `chrome://extensions`.

## Offline tiles (+ online fill)

- Bundled archive: `media/tiles/bible-region.pmtiles` (~41 MB, maxzoom 9, bbox `12,28,43.2,43` — Rome → Nineveh). Sized to load safely in the Chrome side panel (a denser ~93 MB extract OOM-crashed the panel). MapLibre overzooms past z9 for town pin focus.
- Style: `media/tiles/style.json` (Protomaps light layers without remote fonts)
- **Online fill:** if `navigator.onLine` and the view leaves the extract bbox, Esri public canvas tiles (light/dark, **no API key**) fill the gap. No remote requests when offline or fully inside the extract.
- Rebuild (optional): install the [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) CLI as `scripts/pmtiles`, then run `scripts/build-pmtiles.sh` (override with `PROTOMAPS_BBOX` / `PROTOMAPS_MAXZOOM`)

Attribution on the map: Protomaps + © OpenStreetMap (+ Esri when the online underlay is active).

## Structure

```
BibleMaps/
  manifest.json
  background/service-worker.js
  content/
    matcher.js               # shared gazetteer matching
    sites.js                 # per-site adapters (bible.com, Bible Gateway)
    content.js               # highlights + messaging
  data/places.json | journeys.json | kingdoms.json | atlas-presets.json
  media/tiles/bible-region.pmtiles | style.json
  media/historical/          # optional JPG reference plates
  lib/maplibre/              # MapLibre CSP build + pmtiles.js
  sidepanel/
  scripts/build-pmtiles.sh
```

## Notes

- Matching uses the local gazetteer; no AI geocoding.
- Site adapters (`content/sites.js`) locate verse roots and passage labels; scanning skips footnotes / cross-refs / SUP chrome on both hosts.
- Kingdom polygons are teaching overlays digitized from `media/historical/divided-kingdom.jpg` (Knowing the Bible / USGS topography).
- Reference atlas JPGs under `media/historical/` are optional art, not the basemap.
- Keep ODbL attribution if you redistribute the PMTiles extract.
