/**
 * Bible Maps content script — detect places on supported Bible sites with
 * ZERO DOM mutation of verse content (CSS Custom Highlight API only).
 * Site-specific scanning lives in content/sites.js adapters.
 */
(() => {
  let DATA_URLS;
  try {
    DATA_URLS = {
      places: chrome.runtime.getURL("data/places.json"),
      journeys: chrome.runtime.getURL("data/journeys.json"),
    };
  } catch (err) {
    console.warn("[Bible Maps] Extension context unavailable at boot", err);
    return;
  }

  const Sites = window.BibleMapsSites;
  if (!Sites) {
    console.error("[Bible Maps] sites.js missing — content script abort");
    return;
  }

  const SITE = Sites.resolveAdapter(location.hostname);

  const STATE = {
    places: [],
    journeys: [],
    placeById: new Map(),
    matchers: [],
    ready: false,
    scanning: false,
    dead: false,
    quietUntil: 0,
    lastUrl: location.href,
    debounceTimer: null,
    navTimer: null,
    observer: null,
    hits: [],
    highlightSupported: typeof CSS !== "undefined" && !!CSS.highlights,
    warnedLegacy: false,
    warnedDead: false,
  };

  function isContextValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function shutdown(reason) {
    if (STATE.dead) return;
    STATE.dead = true;
    STATE.ready = false;
    clearTimeout(STATE.debounceTimer);
    if (STATE.navTimer) clearInterval(STATE.navTimer);
    if (STATE.observer) {
      try {
        STATE.observer.disconnect();
      } catch {
        /* ignore */
      }
      STATE.observer = null;
    }
    clearHighlights();
    if (!STATE.warnedDead) {
      STATE.warnedDead = true;
      console.info(
        `[Bible Maps] Stopped (${reason}). Reload this tab after reloading the extension.`
      );
      try {
        showToast("Bible Maps updated — refresh this tab");
      } catch {
        /* ignore */
      }
    }
  }

  function pickScanRoot() {
    return SITE.pickScanRoot(document);
  }

  /** Stable ancestor for MutationObserver — scan roots are often replaced on nav. */
  function pickObserveRoot() {
    if (typeof SITE.pickObserveRoot === "function") {
      const el = SITE.pickObserveRoot(document);
      if (el) return el;
    }
    const scan = pickScanRoot();
    return (
      scan?.closest?.(
        ".passage-box, .passage-resources, .passage-text, #bibleTable, .bibleTable, .bible-verses, #leftbox, .resource-content, #content-container, .content-pane, main"
      ) ||
      scan ||
      document.body
    );
  }

  function readPassageCoords() {
    return SITE.readPassageCoords(document, location.href);
  }

  function readPassageLabel() {
    return SITE.readPassageLabel(document, location.href);
  }

  async function loadData() {
    if (!isContextValid()) {
      shutdown("extension context invalidated");
      return;
    }
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
      try {
        CSS.highlights.delete("bible-maps-places");
        CSS.highlights.delete("bible-maps-places-active");
      } catch {
        /* ignore */
      }
    }
  }

  function ensureUiHost() {
    let host = document.getElementById("bible-maps-toast-host");
    if (host?._bmShadow) return host;
    host = document.createElement("div");
    host.id = "bible-maps-toast-host";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .toast {
          position: fixed;
          right: 16px;
          bottom: 16px;
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
          pointer-events: none;
        }
        .toast.show { opacity: 1; transform: translateY(0); }
      </style>
      <div class="toast"></div>
    `;
    document.documentElement.appendChild(host);
    host._bmShadow = shadow;
    return host;
  }

  function showToast(message) {
    const host = ensureUiHost();
    const toast = host._bmShadow.querySelector(".toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function openPanelForHit(hit) {
    if (!hit || STATE.dead) return;
    if (!isContextValid()) {
      shutdown("extension context invalidated");
      return;
    }
    if (STATE.highlightSupported) {
      try {
        CSS.highlights.set("bible-maps-places-active", new Highlight(hit.range));
      } catch {
        /* ignore */
      }
    }
    // Fire open immediately (same gesture turn). Check lastError for failures.
    try {
      chrome.runtime.sendMessage(
        { type: "BIBLE_MAPS_OPEN_PANEL", placeId: hit.placeId },
        (response) => {
          const err = chrome.runtime.lastError?.message;
          if (err) {
            if (/context invalidated/i.test(err)) shutdown(err);
            else showToast("Could not open side panel — click the extension icon");
            return;
          }
          if (response && response.ok === false) {
            showToast("Could not open side panel — click the extension icon");
          }
        }
      );
    } catch (err) {
      shutdown(String(err?.message || err));
      return;
    }
  }

  function warnIfLegacyMarks() {
    if (STATE.warnedLegacy) return;
    if (document.querySelector("mark.bible-maps-place")) {
      STATE.warnedLegacy = true;
      showToast("Old Bible Maps marks found — hard-refresh this tab (Cmd+Shift+R)");
    }
  }

  function publish(places, journeys) {
    if (!isContextValid()) {
      shutdown("extension context invalidated");
      return;
    }
    const passage = readPassageCoords();
    const payload = {
      url: location.href,
      title: document.title,
      site: SITE.id,
      passageLabel: readPassageLabel(),
      passage: passage || null,
      places: places.map((p) => ({
        id: p.id,
        name: p.name,
        modernName: p.modernName,
        lat: p.lat,
        lng: p.lng,
        pinBlurb: p.pinBlurb || "",
        eraNotes: p.eraNotes,
        eras: p.eras || [],
        region: p.region || "",
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
              hidden: Boolean(s.hidden),
              markerOnly: Boolean(s.markerOnly),
            };
          }),
        };
      }),
    };

    try {
      chrome.runtime.sendMessage(
        { type: "BIBLE_MAPS_DETECTION", payload },
        () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "";
            if (/context invalidated|extension/i.test(msg)) {
              shutdown(msg);
            }
          }
        }
      );
    } catch (err) {
      shutdown(String(err?.message || err));
    }
  }

  function scan() {
    if (STATE.dead || !STATE.ready || STATE.scanning) return;
    if (!isContextValid()) {
      shutdown("extension context invalidated");
      return;
    }
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
        pageText,
        readPassageCoords()
      );

      publish(places, journeys);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/context invalidated/i.test(msg)) {
        shutdown(msg);
      } else {
        console.warn("Bible Maps scan failed", err);
      }
    } finally {
      STATE.scanning = false;
      STATE.quietUntil = Date.now() + 400;
    }
  }

  function scheduleScan(delay = 400) {
    if (STATE.dead) return;
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(scan, delay);
  }

  function hitFromPoint(x, y) {
    // Geometric hit-test first — more reliable with CSS Custom Highlights
    // than caretRangeFromPoint alone.
    for (const hit of STATE.hits) {
      try {
        const rects = hit.range.getClientRects();
        for (const r of rects) {
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return hit;
          }
        }
      } catch {
        /* stale range */
      }
    }

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
    if (STATE.dead) return;
    if (event.target?.closest?.("#bible-maps-toast-host")) return;
    const hit = hitFromPoint(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    openPanelForHit(hit);
  }

  function observeDom() {
    if (STATE.dead) return;
    if (STATE.observer) STATE.observer.disconnect();
    STATE.observer = new MutationObserver((mutations) => {
      if (STATE.dead || STATE.scanning || Date.now() < STATE.quietUntil) return;
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
    const root = pickObserveRoot();
    STATE.observer.observe(root === document.body ? document.body : root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function observeSpaNavigation() {
    const notify = () => {
      if (STATE.dead) return;
      if (location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        clearHighlights();
        STATE.hits = [];
        STATE.warnedLegacy = false;
        // Clear side panel immediately so the previous chapter does not linger.
        publish([], []);
        setTimeout(() => {
          if (STATE.dead) return;
          observeDom();
          scheduleScan(350);
        }, 250);
        // SPA / delayed verse HTML often arrives late — second pass.
        setTimeout(() => {
          if (STATE.dead) return;
          observeDom();
          scheduleScan(0);
        }, 1200);
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
    // Bible Gateway uses full page loads for prev/next; bible.com is SPA.
    // Polling covers both without site-specific wiring.
    STATE.navTimer = setInterval(notify, 1000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (STATE.dead || !isContextValid()) {
      shutdown("extension context invalidated");
      return false;
    }
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
      const msg = String(err?.message || err);
      if (/context invalidated/i.test(msg)) {
        shutdown(msg);
      } else {
        console.error("Bible Maps failed to load gazetteer", err);
      }
      return;
    }
    if (STATE.dead || !STATE.ready) return;

    document.addEventListener("click", onClick, true);
    observeSpaNavigation();
    const start = () => {
      if (STATE.dead) return;
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

  boot();
})();
