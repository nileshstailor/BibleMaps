/**
 * Bible Maps content script — detect places on bible.com with ZERO DOM
 * mutation of verse content (CSS Custom Highlight API only).
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

  const VERSE_SELECTORS = [
    "[data-usfm]",
    "[class*='ChapterContent_verse']",
    "[class*='ChapterContent_chapter']",
    "[class*='ChapterContent']",
    "[data-verse-id]",
    "main",
    "article",
  ];

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
    for (const sel of VERSE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && (el.innerText || "").trim().length > 40) return el;
    }
    return document.body;
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
        .hover-chip {
          position: fixed;
          display: none;
          z-index: 2147483647;
          pointer-events: auto;
          transform: translate(-50%, -120%);
          padding: 6px 10px;
          border: none;
          border-radius: 8px;
          background: #2f5d3a;
          color: #f3fff5;
          font: 12px/1.3 Georgia, "Times New Roman", serif;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
          cursor: pointer;
          white-space: nowrap;
        }
        .hover-chip:hover { filter: brightness(1.08); }
        .hover-chip.show { display: inline-flex; align-items: center; gap: 6px; }
        .hover-chip small { opacity: 0.85; font-size: 10px; }
      </style>
      <div class="toast"></div>
      <button type="button" class="hover-chip" aria-label="Open Bible Maps side panel"></button>
    `;
    document.documentElement.appendChild(host);
    host._bmShadow = shadow;
    const chip = shadow.querySelector(".hover-chip");
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanelForHit(chip._bmHit);
    });
    chip.addEventListener("mouseenter", () => {
      clearTimeout(hideHoverChip._t);
    });
    chip.addEventListener("mouseleave", () => hideHoverChip(180));
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

  function showHoverChip(hit, clientX, clientY) {
    const host = ensureUiHost();
    const chip = host._bmShadow.querySelector(".hover-chip");
    chip._bmHit = hit;
    const name = hit.place?.name || "Place";
    chip.innerHTML = `<span>${name}</span><small>Open side panel</small>`;
    chip.style.left = `${Math.min(window.innerWidth - 20, Math.max(20, clientX))}px`;
    chip.style.top = `${Math.max(28, clientY)}px`;
    chip.classList.add("show");
    clearTimeout(hideHoverChip._t);
  }

  function hideHoverChip(delay = 0) {
    clearTimeout(hideHoverChip._t);
    hideHoverChip._t = setTimeout(() => {
      const host = document.getElementById("bible-maps-toast-host");
      host?._bmShadow?.querySelector(".hover-chip")?.classList.remove("show");
    }, delay);
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
    try {
      chrome.runtime.sendMessage(
        { type: "BIBLE_MAPS_OPEN_PANEL" },
        () => void chrome.runtime.lastError
      );
    } catch (err) {
      shutdown(String(err?.message || err));
      return;
    }
    showToast(`${hit.place?.name || "Place"} — Bible Maps panel`);
    hideHoverChip(0);
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
        pageText
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

  function onMouseMove(event) {
    if (STATE.dead || !STATE.hits.length) {
      hideHoverChip(0);
      return;
    }
    // Ignore when over our own chip host (chip handles its own leave).
    if (event.target?.id === "bible-maps-toast-host") return;
    const hit = hitFromPoint(event.clientX, event.clientY);
    if (hit) showHoverChip(hit, event.clientX, event.clientY);
    else hideHoverChip(120);
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
    const root = pickScanRoot();
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
        STATE.warnedLegacy = false;
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
    STATE.navTimer = setInterval(notify, 2000);
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
    document.addEventListener("mousemove", onMouseMove, { passive: true });
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
