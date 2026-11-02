# Bible Maps

**Version 1.0.1** (Chrome Web Store). Earlier engineering builds used a **1.4.x** manifest line — treat those as pre-1.0 / 0.x-era development, not a separate major product. See `CHANGELOG.md`. Store packaging lives under [`store/`](store/PUBLISH_CHECKLIST.md).

Manifest V3 Chrome extension for [bible.com](https://www.bible.com) (YouVersion), [Bible Gateway](https://www.biblegateway.com/), [Biblia](https://biblia.com/) (Faithlife), [Blue Letter Bible](https://www.blueletterbible.org/), [Bible Hub](https://biblehub.com/), and [Bible Study Tools](https://www.biblestudytools.com/). It detects curated biblical **places** and **journeys** in the verse text, highlights them on the page, and opens a **side panel** with:

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

### Bible Gateway (multi-chapter)

1. Reload the extension after updating
2. Try several chapters/versions, not only Genesis 12:
   - [Genesis 12 NIV](https://www.biblegateway.com/passage/?search=Genesis+12&version=NIV)
   - [Acts 13 NIV](https://www.biblegateway.com/passage/?search=Acts+13&version=NIV)
   - [John 4 NIV](https://www.biblegateway.com/passage/?search=John+4&version=NIV)
   - [1 Kings 18 NIV](https://www.biblegateway.com/passage/?search=1+Kings+18&version=NIV)
   - [Exodus 14 NIV](https://www.biblegateway.com/passage/?search=Exodus+14&version=NIV)
   - [1 Kings 14 NLT](https://www.biblegateway.com/passage/?search=1+Kings+14&version=NLT) (no `.std-text` wrapper)
3. Confirm highlights in the passage body (not footnotes / cross-references)
4. Prev/next chapter and version changes should refresh the side panel

### Biblia (Faithlife)

1. Open e.g. [Genesis 12 NIV2011](https://biblia.com/books/niv2011/Ge12) or [Acts 13](https://biblia.com/books/niv2011/Ac13)
2. Confirm highlights in `.resourcetext` (not footnote popup chrome)
3. Chapter changes via Biblia’s reader should refresh the side panel (observer on `.resource-content`)

Also works with `/bible/{resource}/{ref}` URLs (e.g. `Ge12.1-20`) when the chapter HTML is present.

### Other readers

| Site | Why included | Sample URL |
|------|----------------|------------|
| **Biblia** | Faithlife reader; `.resourcetext` + `data-article` coords | [Genesis 12](https://biblia.com/books/niv2011/Ge12) |
| **Blue Letter Bible** | Stable `#bibleTable` / `.scriptureText` verse rows; high traffic | [Acts 13 NIV](https://www.blueletterbible.org/niv/act/13/1/) |
| **Bible Hub** | Simple `.chap` / `.reg` chapter HTML; version + interlinear URLs | [Acts 13 NIV](https://biblehub.com/niv/acts/13.htm) |
| **Bible Study Tools** | Clear `.bible-verses` / `.bible-text` rows | [Acts 13](https://www.biblestudytools.com/acts/13.html) |

YouVersion web is already covered via **bible.com**. Site adapters live in `content/sites.js`.

After pulling updates: **Reload** the extension on `chrome://extensions`. Smoke: `node scripts/test-multisite-adapters.js`.

## Offline tiles (+ online fill)

- Bundled archive: `media/tiles/bible-region.pmtiles` (~62 MB, maxzoom 11). Merged **biblical corridor** extract (not world coverage):
  - **Shell** z0–7, bbox `-10,12,78,45` — tip of Spain → India (overview / pan)
  - **Core** z9–11, bbox `29,24,42,36` — Levant + Egypt town detail (incl. Thebes)
  - **East** z9–10, bbox `42.2,27,55,38` — Mesopotamia → Susa
- Sized for in-memory load in the Chrome side panel (extension URLs lack reliable Range). A uniform z10 of the old Rome→Nineveh bbox was ~93 MB and OOM-crashed the panel; this merge stays ~62 MB by putting high zoom only where biblical narrative is dense. No high-detail tiles for the Americas or east of India.
- Style: `media/tiles/style.json` (Protomaps light layers without remote fonts)
- **Online fill:** if `navigator.onLine` and the view leaves the extract bbox, Esri public canvas tiles (light/dark, **no API key**) fill the gap. Inside the shell but past core/east maxzoom, MapLibre overzooms coarser tiles; zoomed-in quality is best in Levant/Egypt.
- Rebuild: `scripts/pmtiles` CLI + `scripts/build-pmtiles.sh` (override `PROTOMAPS_SHELL_BBOX`, `PROTOMAPS_CORE_BBOX`, `PROTOMAPS_EAST_BBOX`, zoom caps)

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
- Site adapters (`content/sites.js`) locate verse roots and passage labels; scanning skips footnotes / cross-refs / SUP chrome per host. MutationObserver watches a stable ancestor so chapter swaps that replace the verse root still rescan.
- Kingdom polygons are teaching overlays digitized from `media/historical/divided-kingdom.jpg` (Knowing the Bible / USGS topography).
- Reference atlas JPGs under `media/historical/` are optional art, not the basemap.
- Keep ODbL attribution if you redistribute the PMTiles extract.
