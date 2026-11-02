# Chrome Web Store — reviewer test instructions (Bible Maps 1.0.0)

## Install

1. Load the uploaded package (or Load unpacked from the ZIP contents).
2. Pin **Bible Maps**.
3. Grant site access if Chrome prompts when opening a Bible site.

## Happy path (bible.com)

1. Open https://www.bible.com/bible/111/ACT.13.NIV  
2. Within a few seconds, place names (e.g. Antioch, Cyprus, Perga) should show light-green highlights.  
3. Click the extension icon → open the **side panel**.  
4. Confirm **Places** list is populated and the offline map shows land (not a solid empty/blue frame) with pins.  
5. Switch to **Journeys** if a journey is detected; map should frame the route.

## Second site (Bible Gateway)

1. Open https://www.biblegateway.com/passage/?search=Genesis+12&version=NIV  
2. Confirm highlights in the passage body (not only in footnotes).  
3. Side panel should list places such as Haran/Harran, Canaan, Egypt, Shechem, Bethel.

## Optional third site (Biblia)

1. Open https://biblia.com/books/niv2011/Ge12  
2. Confirm highlights appear in the chapter text after the reader content loads.  
3. Side panel updates with the same style of places list + map.

## Notes for reviewers

- Matching is offline gazetteer-based (no LLM).  
- First side-panel open loads a bundled ~60 MB PMTiles archive into memory; allow a moment on slower machines.  
- Online Esri tiles appear only when online and panning outside the biblical-corridor extract.  
- Supported hosts are listed in `manifest.json` `content_scripts.matches` / `host_permissions`.
