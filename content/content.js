/**
 * Bible Maps content script — detect & highlight places on bible.com,
 * observe SPA navigation, report results to the background/side panel.
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
    applying: false,
    lastUrl: location.href,
    debounceTimer: null,
    observer: null,
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

  function uniquePlacesFromMarks(marks) {
    const seen = new Set();
    const list = [];
    for (const mark of marks) {
      const id = mark.dataset.placeId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const place = STATE.placeById.get(id);
      if (place) list.push(place);
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
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
    STATE.applying = true;
    try {
      const root = pickScanRoot();
      const matcher = window.BibleMapsMatcher;

      // Avoid fighting React by clearing only our marks, then re-wrapping.
      matcher.clearHighlights(document);

      const textNodes = matcher.collectTextNodes(root);
      const createdMarks = [];
      for (const node of textNodes) {
        const matches = matcher.findMatchesInText(
          node.nodeValue || "",
          STATE.matchers
        );
        if (matches.length) {
          createdMarks.push(...matcher.wrapMatchesInTextNode(node, matches));
        }
      }

      const places = uniquePlacesFromMarks(createdMarks);
      const pageText = root.innerText || document.body.innerText || "";
      const journeys = matcher.detectJourneys(
        places.map((p) => p.id),
        STATE.journeys,
        pageText
      );

      publish(places, journeys);
    } catch (err) {
      console.warn("Bible Maps scan failed", err);
    } finally {
      // Let the current mutation batch settle before accepting new ones.
      setTimeout(() => {
        STATE.applying = false;
        STATE.scanning = false;
      }, 0);
    }
  }

  function scheduleScan(delay = 180) {
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(scan, delay);
  }

  function onClick(event) {
    const mark = event.target?.closest?.("mark.bible-maps-place");
    if (!mark) return;
    event.preventDefault();
    event.stopPropagation();
    document
      .querySelectorAll('mark.bible-maps-place[data-bm-active="true"]')
      .forEach((el) => el.removeAttribute("data-bm-active"));
    mark.dataset.bmActive = "true";
    chrome.runtime.sendMessage(
      { type: "BIBLE_MAPS_OPEN_PANEL" },
      () => void chrome.runtime.lastError
    );
    showToast(`${mark.dataset.placeName || "Place"} — see Bible Maps panel`);
    scheduleScan(50);
  }

  function observeDom() {
    if (STATE.observer) STATE.observer.disconnect();
    STATE.observer = new MutationObserver((mutations) => {
      if (STATE.applying || STATE.scanning) return;
      // Ignore mutations that are only our own marks being added/removed.
      const relevant = mutations.some((m) => {
        const nodes = [...m.addedNodes, ...m.removedNodes];
        if (!nodes.length && m.type === "characterData") return true;
        return nodes.some((n) => {
          if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE) {
            return false;
          }
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.classList?.contains("bible-maps-place")) return false;
            if (n.classList?.contains("bible-maps-toast")) return false;
          }
          return true;
        });
      });
      if (relevant) scheduleScan(250);
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
        scheduleScan(400);
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
    // bible.com also updates content without always changing history immediately
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
    scheduleScan(300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
