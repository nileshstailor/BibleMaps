/**
 * Bible Maps content script — detect places on bible.com with ZERO DOM
 * mutation of verse content (CSS Custom Highlight API only).
 * Mutating React-managed nodes caused Minified React error #418.
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
    quietUntil: 0,
    lastUrl: location.href,
    debounceTimer: null,
    observer: null,
    hits: [],
    highlightSupported: typeof CSS !== "undefined" && !!CSS.highlights,
    warnedLegacy: false,
  };

  const VERSE_SELECTORS = [
    "[data-usfm]",
    "[class*='ChapterContent_verse']",
    "[class*='ChapterContent_chapter']",
    "[class*='ChapterContent']",
    "[data-verse-id]",
    "main",
    "article",
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
    // Drop stale ranges (React may have replaced text nodes).
    const live = [];
    for (const hit of hits) {
      try {
        if (hit.range.startContainer && hit.range.startContainer.isConnected) {
          live.push(hit);
        }
      } catch {
        /* stale */
      }
    }
    STATE.hits = live;
    if (!STATE.highlightSupported) return;
    if (!live.length) {
      CSS.highlights.delete("bible-maps-places");
      CSS.highlights.delete("bible-maps-places-active");
      return;
    }
    CSS.highlights.set(
      "bible-maps-places",
      new Highlight(...live.map((h) => h.range))
    );
  }

  function clearHighlights() {
    STATE.hits = [];
    if (STATE.highlightSupported) {
      CSS.highlights.delete("bible-maps-places");
      CSS.highlights.delete("bible-maps-places-active");
    }
  }

  function showToast(message) {
    // Host toast in an isolated closed shadow root so we never alter
    // bible.com's light-DOM tree that React hydrates.
    let host = document.getElementById("bible-maps-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "bible-maps-toast-host";
      host.style.all = "initial";
      host.style.position = "fixed";
      host.style.zIndex = "2147483646";
      host.style.right = "16px";
      host.style.bottom = "16px";
      host.style.pointerEvents = "none";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML = `
        <style>
          .toast {
            max-width: min(320px, calc(100vw - 32px));
            padding: 10px 14px;
            border-radius: 8px;
            background: #2c2416;
            color: #f4e9d4;
            font: 13px/1.35 Georgia, "Times New Roman", serif;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 160ms ease, transform 160ms ease;
          }
          .toast.show { opacity: 1; transform: translateY(0); }
        </style>
        <div class="toast"></div>
      `;
      document.documentElement.appendChild(host);
      host._bmShadow = shadow;
    }
    const toast = host._bmShadow.querySelector(".toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function warnIfLegacyMarks() {
    // Do NOT unwrap marks — that mutates React's tree and triggers #418.
    // Old builds left <mark class="bible-maps-place">; user must hard-refresh.
    if (STATE.warnedLegacy) return;
    if (document.querySelector("mark.bible-maps-place")) {
      STATE.warnedLegacy = true;
      showToast("Old Bible Maps marks found — hard-refresh this tab (Cmd+Shift+R)");
      console.warn(
        "[Bible Maps] Legacy <mark.bible-maps-place> nodes are present from an older build. Hard-refresh the page; do not rely on DOM unwrap (causes React #418)."
      );
    }
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
    if (Date.now() < STATE.quietUntil) return;
    STATE.scanning = true;
    try {
      warnIfLegacyMarks();

      const root = pickScanRoot();
      const hits = window.BibleMapsMatcher.collectMatchRanges(
        root,
        STATE.matchers
      );
      applyHighlights(hits);

      const places = uniquePlacesFromHits(hits);
      const pageText = root.innerText || document.body.innerText || "";
      const journeys = window.BibleMapsMatcher.detectJourneys(
        places.map((p) => p.id),
        STATE.journeys,
        pageText
      );

      publish(places, journeys);
    } catch (err) {
      console.warn("Bible Maps scan failed", err);
    } finally {
      STATE.scanning = false;
      // Ignore our own follow-on observer noise / React paint churn.
      STATE.quietUntil = Date.now() + 400;
    }
  }

  function scheduleScan(delay = 400) {
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
          hit.range.startContainer === range.startContainer &&
          range.startOffset >= hit.range.startOffset &&
          range.startOffset <= hit.range.endOffset
        ) {
          return hit;
        }
      } catch {
        /* stale range */
      }
    }
    return null;
  }

  function onClick(event) {
    if (event.target?.closest?.("#bible-maps-toast-host")) return;
    const hit = hitFromPoint(event.clientX, event.clientY);
    if (!hit) return;

    if (STATE.highlightSupported) {
      try {
        CSS.highlights.set("bible-maps-places-active", new Highlight(hit.range));
      } catch {
        /* ignore */
      }
    }
    chrome.runtime.sendMessage(
      { type: "BIBLE_MAPS_OPEN_PANEL" },
      () => void chrome.runtime.lastError
    );
    showToast(`${hit.place?.name || "Place"} — see Bible Maps panel`);
  }

  function observeDom() {
    if (STATE.observer) STATE.observer.disconnect();
    STATE.observer = new MutationObserver((mutations) => {
      if (STATE.scanning || Date.now() < STATE.quietUntil) return;
      // Ignore toast host and pure attribute flips.
      const relevant = mutations.some((m) => {
        if (m.type === "characterData") return true;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return nodes.some((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.id === "bible-maps-toast-host") return false;
          }
          return n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE;
        });
      });
      if (relevant) scheduleScan(500);
    });
    const root = pickScanRoot();
    STATE.observer.observe(root === document.body ? document.body : root, {
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
        STATE.warnedLegacy = false;
        // Re-bind observer to new chapter root after SPA nav.
        setTimeout(() => {
          observeDom();
          scheduleScan(600);
        }, 300);
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
    setInterval(notify, 2000);
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
    observeSpaNavigation();
    // Wait until after bible.com hydration / first paint before first scan.
    const start = () => {
      observeDom();
      scheduleScan(800);
    };
    if (document.readyState === "complete") {
      setTimeout(start, 500);
    } else {
      window.addEventListener(
        "load",
        () => setTimeout(start, 500),
        { once: true }
      );
    }
  }

  // document_idle is fine; still defer past hydration.
  boot();
})();
