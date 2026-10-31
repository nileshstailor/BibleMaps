/**
 * Bible Maps content script — detect places on bible.com without mutating
 * React's DOM (CSS Custom Highlight API). Avoids React error #418.
 */
(() => {
  const DATA_URLS = {
    places: chrome.runtime.getURL("data/places.json"),
    journeys: chrome.runtime.getURL("data/journeys.json"),
  };

  const STATE = {
    places: [],
    journeys: [],
    placeById: new Map(),
    matchers: [],
    ready: false,
    scanning: false,
    lastUrl: location.href,
    debounceTimer: null,
    observer: null,
    hits: [], // { range, placeId, place }
    highlightSupported: typeof CSS !== "undefined" && !!CSS.highlights,
  };

  const VERSE_SELECTORS = [
    "[data-usfm]",
    "[class*='ChapterContent_verse']",
    "[class*='ChapterContent_chapter']",
    "[class*='verse']",
    "p.verse",
    ".verse",
    "span.verse",
    "[data-verse-id]",
    "main",
    "article",
    "#react-app-Bible",
    "#__next",
  ];

  function pickScanRoot() {
    for (const sel of VERSE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && (el.innerText || "").trim().length > 40) return el;
    }
    return document.body;
  }

  async function loadData() {
    const [places, journeys] = await Promise.all([
      fetch(DATA_URLS.places).then((r) => r.json()),
      fetch(DATA_URLS.journeys).then((r) => r.json()),
    ]);
    STATE.places = places;
    STATE.journeys = journeys;
    STATE.placeById = new Map(places.map((p) => [p.id, p]));
    STATE.matchers = window.BibleMapsMatcher.buildPlaceMatchers(places);
    STATE.ready = true;
  }

  function uniquePlacesFromHits(hits) {
    const seen = new Set();
    const list = [];
    for (const hit of hits) {
      if (!hit.placeId || seen.has(hit.placeId)) continue;
      seen.add(hit.placeId);
      const place = STATE.placeById.get(hit.placeId);
      if (place) list.push(place);
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  function applyHighlights(hits) {
    STATE.hits = hits;
    if (!STATE.highlightSupported) return;

    const highlight = new Highlight(...hits.map((h) => h.range));
    CSS.highlights.set("bible-maps-places", highlight);
    CSS.highlights.delete("bible-maps-places-active");
  }

  function clearHighlights() {
    STATE.hits = [];
    if (STATE.highlightSupported) {
      CSS.highlights.delete("bible-maps-places");
      CSS.highlights.delete("bible-maps-places-active");
    }
  }

  function showToast(message) {
    let toast = document.querySelector(".bible-maps-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "bible-maps-toast";
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("bible-maps-toast-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.remove("bible-maps-toast-visible");
    }, 2200);
  }

  function publish(places, journeys) {
    const payload = {
      url: location.href,
      title: document.title,
      places: places.map((p) => ({
        id: p.id,
        name: p.name,
        modernName: p.modernName,
        lat: p.lat,
        lng: p.lng,
        eraNotes: p.eraNotes,
        aliases: p.aliases || [],
      })),
      journeys: journeys.map((j) => {
        const full = STATE.journeys.find((x) => x.id === j.id);
        return {
          ...j,
          stops: (full?.stops || []).map((s) => {
            const place = STATE.placeById.get(s.placeId);
            return {
              placeId: s.placeId,
              note: s.note || "",
              name: place?.name || s.placeId,
              lat: place?.lat,
              lng: place?.lng,
              modernName: place?.modernName || "",
            };
          }),
        };
      }),
    };

    chrome.runtime.sendMessage(
      { type: "BIBLE_MAPS_DETECTION", payload },
      () => void chrome.runtime.lastError
    );
  }

  function scan() {
    if (!STATE.ready || STATE.scanning) return;
    STATE.scanning = true;
    try {
      const root = pickScanRoot();
      const matcher = window.BibleMapsMatcher;

      // Cleanup marks from older builds once; do not re-wrap (breaks React).
      matcher.clearLegacyMarks(document);

      const hits = matcher.collectMatchRanges(root, STATE.matchers);
      applyHighlights(hits);

      const places = uniquePlacesFromHits(hits);
      const pageText = root.innerText || document.body.innerText || "";
      const journeys = matcher.detectJourneys(
        places.map((p) => p.id),
        STATE.journeys,
        pageText
      );

      publish(places, journeys);

      if (!STATE.highlightSupported && places.length) {
        showToast("Places found (highlight API unavailable — see side panel)");
      }
    } catch (err) {
      console.warn("Bible Maps scan failed", err);
    } finally {
      STATE.scanning = false;
    }
  }

  function scheduleScan(delay = 220) {
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(scan, delay);
  }

  function hitFromPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos?.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) return null;

    for (const hit of STATE.hits) {
      try {
        if (
          hit.range.isPointInRange(range.startContainer, range.startOffset) ||
          (range.startContainer.nodeType === Node.TEXT_NODE &&
            hit.range.intersectsNode(range.startContainer) &&
            range.startOffset >= hit.range.startOffset &&
            range.startOffset <= hit.range.endOffset)
        ) {
          return hit;
        }
      } catch {
        /* ranges can go stale after React re-render */
      }
    }

    // Fallback: compare text node + offset containment
    for (const hit of STATE.hits) {
      try {
        if (
          hit.range.startContainer === range.startContainer &&
          range.startOffset >= hit.range.startOffset &&
          range.startOffset <= hit.range.endOffset
        ) {
          return hit;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function onClick(event) {
    const hit = hitFromPoint(event.clientX, event.clientY);
    if (!hit) return;

    if (STATE.highlightSupported) {
      CSS.highlights.set("bible-maps-places-active", new Highlight(hit.range));
    }
    chrome.runtime.sendMessage(
      { type: "BIBLE_MAPS_OPEN_PANEL" },
      () => void chrome.runtime.lastError
    );
    showToast(`${hit.place?.name || "Place"} — see Bible Maps panel`);
  }

  function observeDom() {
    if (STATE.observer) STATE.observer.disconnect();
    STATE.observer = new MutationObserver(() => {
      if (STATE.scanning) return;
      scheduleScan(350);
    });
    STATE.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function observeSpaNavigation() {
    const notify = () => {
      if (location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        clearHighlights();
        scheduleScan(450);
      }
    };
    const wrap = (type) => {
      const original = history[type];
      history[type] = function patched(...args) {
        const ret = original.apply(this, args);
        notify();
        return ret;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", notify);
    setInterval(notify, 1500);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BIBLE_MAPS_RESCORE") {
      scheduleScan(0);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  async function boot() {
    try {
      await loadData();
    } catch (err) {
      console.error("Bible Maps failed to load gazetteer", err);
      return;
    }
    document.addEventListener("click", onClick, true);
    observeDom();
    observeSpaNavigation();
    scheduleScan(400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
