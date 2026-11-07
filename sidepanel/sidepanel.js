/**
 * Bible Maps side panel — MapLibre + streamed Esri basemap (Canvas / Imagery)
 * with reference label tiles when online.
 */
(() => {
  // CSP build ships with empty WORKER_URL; without this, Worker("") loads
  // sidepanel.html and throws: Unexpected token '<'
  if (typeof maplibregl !== "undefined" && typeof maplibregl.setWorkerUrl === "function") {
    maplibregl.setWorkerUrl(
      chrome.runtime.getURL("lib/maplibre/maplibre-gl-csp-worker.js")
    );
  }

  const THEME_KEY = "bibleMapsTheme";
  const MAP_TYPE_KEY = "bibleMapsMapType";
  const LABELS_KEY = "bibleMapsBasemapLabels";
  const DOCK_HEIGHT_KEY = "bibleMapsDockHeight";
  const DOCK_HINT_DISMISSED_KEY = "bibleMapsDockHintDismissed";
  const DOCK_UI_VERSION_KEY = "bibleMapsDockUiVersion";
  const DOCK_UI_VERSION = 3;
  const els = {
    status: document.getElementById("status"),
    placesPanel: document.getElementById("placesPanel"),
    journeysPanel: document.getElementById("journeysPanel"),
    themeBtn: document.getElementById("themeBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    mapDock: document.getElementById("mapDock"),
    mapTitle: document.getElementById("mapTitle"),
    mapSubtitle: document.getElementById("mapSubtitle"),
    mapToolbar: document.getElementById("mapToolbar"),
    kingdomsToggle: document.getElementById("kingdomsToggle"),
    kingdomsToggleWrap: document.getElementById("kingdomsToggleWrap"),
    kingdomLegend: document.getElementById("kingdomLegend"),
    labelsToggle: document.getElementById("labelsToggle"),
    mapTypeButtons: () =>
      Array.from(document.querySelectorAll(".map-type-toggle .seg-btn")),
    dockGrabber: document.getElementById("dockGrabber"),
    mapZoomIn: document.getElementById("mapZoomIn"),
    mapZoomOut: document.getElementById("mapZoomOut"),
    mapRecenter: document.getElementById("mapRecenter"),
    teachingMap: document.getElementById("teachingMap"),
    mapHelp: document.getElementById("mapHelp"),
    dockGrabberHint: document.getElementById("dockGrabberHint"),
    showPlacesBtn: document.getElementById("showPlacesBtn"),
    stopListWrap: document.getElementById("stopListWrap"),
    stopList: document.getElementById("stopList"),
    referencePlate: document.getElementById("referencePlate"),
    referencePlateImg: document.getElementById("referencePlateImg"),
    referencePlateNote: document.getElementById("referencePlateNote"),
  };

  let current = null;
  let activeJourney = null;
  let selectedJourneyId = null;
  let journeyOnMap = false;
  let activeTab = "places";
  let activePlaceMarkers = [];
  let allPlaces = null;
  let placesLoadPromise = null;
  let kingdomsGeoJson = null;
  let kingdomsLoadPromise = null;
  let kingdomsLoadedPath = null;
  let routeOverlayGeoJson = null;
  let routeOverlayLoadedPath = null;
  let overlayCache = new Map();
  let presetsCatalog = null;
  let presetsLoadPromise = null;
  let eraMap = null;
  let eraMapLoadPromise = null;
  let maplibreMap = null;
  let markerObjs = [];
  let kingdomLabelMarkers = [];
  let mapMountGen = 0;
  let basemapType = "map";
  let basemapLabels = false;
  let dockHeightPx = 228;
  let dockDragStart = null;
  let dockDragging = false;
  let mapResizeRaf = 0;
  let pendingOverviewAnimate = false;
  let placeFocusGen = 0;
  let placeCameraBusy = false;
  let suppressPlaceToggleDive = false;
  let lastFocusedLngLat = null;
  let lastMapFingerprint = "";
  let lastMapPresetId = "";
  let lastPlacesFingerprint = "";
  let lastJourneysFingerprint = "";
  let openPlaceIds = new Set();
  let openJourneyIds = new Set();
  let focusedPlaceId = null;
  /** Town context on click — closer than chapter overview, not street-level. */
  const PLACE_FOCUS_ZOOM = 10;
  const JOURNEY_FIT_ANIM_MS = 750;
  /** When chapter pins span farther than this (degrees), frame the densest cluster. */
  const EMPIRE_CLUSTER_MAX_SPAN_DEG = 12;
  const ESRI_BASEMAP_SOURCE = "esri-basemap";
  const ESRI_LABELS_SOURCE = "esri-labels";
  const ESRI_BASEMAP_LAYER = "esri-basemap";
  const ESRI_LABELS_LAYER = "esri-labels";
  const ESRI_ATTR =
    'Tiles © <a href="https://www.esri.com/">Esri</a> — Esri, TomTom, Garmin, FAO, NOAA, USGS';

  function biblicalTrainingPlaceUrl(place) {
    try {
      if (window.BiblicalTrainingLinks?.placeURL) {
        return window.BiblicalTrainingLinks.placeURL(place);
      }
    } catch {
      /* ignore */
    }
    const slug = String(place?.name || "bible")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `https://www.biblicaltraining.org/library/${encodeURIComponent(slug || "bible")}`;
  }

  function googlePlaceUrl(place) {
    if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${place.lat},${place.lng}`
      )}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      place.modernName || place.name || ""
    )}`;
  }

  function googleJourneyUrl(stops) {
    const coords = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => `${s.lat},${s.lng}`);
    if (!coords.length) return "https://www.google.com/maps";
    if (coords.length === 1) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords[0])}`;
    }
    const origin = coords[0];
    const destination = coords[coords.length - 1];
    const waypoints = coords.slice(1, -1);
    const limited =
      waypoints.length > 8
        ? waypoints.filter((_, i) => i % Math.ceil(waypoints.length / 8) === 0).slice(0, 8)
        : waypoints;
    const params = new URLSearchParams({
      api: "1",
      travelmode: "walking",
      origin,
      destination,
    });
    if (limited.length) params.set("waypoints", limited.join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  function googlePolylineSearchUrl(stops) {
    const path = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => `${s.lat},${s.lng}`)
      .join("/");
    if (!path) return "https://www.google.com/maps";
    return `https://www.google.com/maps/dir/${path}`;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setMapHelp(text, isError) {
    if (!els.mapHelp) return;
    // Only surface errors in the UI — skip MapLibre/OSM status chrome.
    if (!isError) {
      els.mapHelp.hidden = true;
      els.mapHelp.textContent = "";
      els.mapHelp.style.color = "";
      return;
    }
    els.mapHelp.hidden = false;
    els.mapHelp.textContent = text || "";
    els.mapHelp.style.color = "#a63024";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function shortKingdomName(props) {
    const raw = props?.name || props?.id || "Kingdom";
    return String(raw)
      .replace(/^Kingdom of\s+/i, "")
      .trim();
  }

  function provinceOverlayFeatures(feats) {
    return (feats || []).filter((f) => {
      const id = String(f?.properties?.id || "");
      return id && !id.startsWith("roman_empire");
    });
  }

  function renderKingdomLegend() {
    if (!els.kingdomLegend) return;
    const all = kingdomsGeoJson?.features || [];
    const feats =
      provinceOverlayFeatures(all).length > 0 ? provinceOverlayFeatures(all) : all;
    if (!feats.length) {
      els.kingdomLegend.innerHTML = "";
      return;
    }
    els.kingdomLegend.innerHTML = feats
      .map((f) => {
        const p = f.properties || {};
        const color = p.color || "#888888";
        const opacity = Number.isFinite(p.fillOpacity) ? p.fillOpacity : 0.3;
        const bg = color.length === 7 ? `${color}${Math.round(opacity * 255)
          .toString(16)
          .padStart(2, "0")}` : color;
        return `<span><i class="swatch" style="background:${bg}"></i> ${escapeHtml(
          shortKingdomName(p)
        )}</span>`;
      })
      .join("");
  }

  function overlayPathForPreset(preset) {
    const rel = preset?.overlay || (preset?.showKingdoms ? "kingdoms.json" : null);
    return rel || null;
  }

  /** Base (e.g. Roman Empire) then local kingdom overlay paths. */
  function overlayPathsForPreset(preset) {
    const paths = [];
    if (preset?.baseOverlay) paths.push(preset.baseOverlay);
    const rel = overlayPathForPreset(preset);
    if (rel) paths.push(rel);
    return paths;
  }

  function routeOverlayPathForPreset(preset) {
    return preset?.routeOverlay || null;
  }

  function fetchOverlayJson(relPath) {
    if (overlayCache.has(relPath)) {
      return Promise.resolve(overlayCache.get(relPath));
    }
    return fetch(chrome.runtime.getURL(`data/${relPath}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${relPath} HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        overlayCache.set(relPath, data);
        return data;
      });
  }

  function loadOverlay(relPath) {
    if (!relPath) {
      kingdomsGeoJson = null;
      kingdomsLoadedPath = null;
      renderKingdomLegend();
      return Promise.resolve(null);
    }
    return fetchOverlayJson(relPath)
      .then((data) => {
        kingdomsGeoJson = data;
        kingdomsLoadedPath = relPath;
        renderKingdomLegend();
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: overlay failed to load", relPath, err);
        return null;
      });
  }

  /** Load + merge baseOverlay + overlay for the active era preset. */
  function loadOverlaysForPreset(preset) {
    const paths = overlayPathsForPreset(preset);
    if (!paths.length) {
      kingdomsGeoJson = null;
      kingdomsLoadedPath = null;
      renderKingdomLegend();
      return Promise.resolve(null);
    }
    const key = paths.join("|");
    if (overlayCache.has(key)) {
      kingdomsGeoJson = overlayCache.get(key);
      kingdomsLoadedPath = key;
      renderKingdomLegend();
      return Promise.resolve(kingdomsGeoJson);
    }
    return Promise.all(paths.map((p) => fetchOverlayJson(p)))
      .then((parts) => {
        const merged = {
          type: "FeatureCollection",
          features: parts.flatMap((p) => (p && p.features) || []),
        };
        overlayCache.set(key, merged);
        kingdomsGeoJson = merged;
        kingdomsLoadedPath = key;
        renderKingdomLegend();
        return merged;
      })
      .catch((err) => {
        console.warn("Bible Maps: overlays failed to load", paths, err);
        return null;
      });
  }

  function loadRouteOverlay(relPath) {
    if (!relPath) {
      routeOverlayGeoJson = null;
      routeOverlayLoadedPath = null;
      return Promise.resolve(null);
    }
    if (overlayCache.has(relPath)) {
      routeOverlayGeoJson = overlayCache.get(relPath);
      routeOverlayLoadedPath = relPath;
      return Promise.resolve(routeOverlayGeoJson);
    }
    return fetch(chrome.runtime.getURL(`data/${relPath}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${relPath} HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        overlayCache.set(relPath, data);
        routeOverlayGeoJson = data;
        routeOverlayLoadedPath = relPath;
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: route overlay failed to load", relPath, err);
        routeOverlayGeoJson = null;
        routeOverlayLoadedPath = null;
        return null;
      });
  }

  function loadKingdoms() {
    // Default divided-kingdom overlay; mountTeachingMap swaps per preset.
    return loadOverlay("kingdoms.json");
  }

  function loadEraMap() {
    if (eraMap) return Promise.resolve(eraMap);
    if (eraMapLoadPromise) return eraMapLoadPromise;
    eraMapLoadPromise = fetch(chrome.runtime.getURL("data/era-map.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`era-map.json HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        eraMap = data;
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: era-map failed", err);
        eraMapLoadPromise = null;
        return null;
      });
    return eraMapLoadPromise;
  }

  function presetFromPassage(passage) {
    if (!eraMap?.rules || !passage?.book) return null;
    const book = String(passage.book).trim();
    const chapter = Number(passage.chapter);
    for (const rule of eraMap.rules) {
      if (!(rule.books || []).includes(book)) continue;
      if (Array.isArray(rule.chapters) && rule.chapters.length) {
        if (!Number.isFinite(chapter) || !rule.chapters.includes(chapter)) continue;
      }
      return rule.preset;
    }
    return eraMap.defaultPreset || null;
  }

  function loadAllPlaces() {
    if (allPlaces) return Promise.resolve(allPlaces);
    if (placesLoadPromise) return placesLoadPromise;
    placesLoadPromise = fetch(chrome.runtime.getURL("data/places.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`places.json HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        allPlaces = data;
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: places failed to load", err);
        placesLoadPromise = null;
        return [];
      });
    return placesLoadPromise;
  }

  function loadPresets() {
    if (presetsCatalog) return Promise.resolve(presetsCatalog);
    if (presetsLoadPromise) return presetsLoadPromise;
    presetsLoadPromise = fetch(chrome.runtime.getURL("data/atlas-presets.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`atlas-presets.json HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        presetsCatalog = data;
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: presets failed", err);
        presetsLoadPromise = null;
        return null;
      });
    return presetsLoadPromise;
  }

  function getPreset(id) {
    return presetsCatalog?.presets?.find((p) => p.id === id) || null;
  }

  /** Silent era framing: active journey → book/chapter era-map → place eras → default. */
  function suggestPresetId() {
    const jid = activeJourney?.id || "";
    if (jid === "paul_first") return "paul_first";
    if (jid === "paul_second") return "paul_second";
    if (jid === "paul_third") return "paul_third";
    if (jid === "paul_rome") return "paul_rome";
    if (jid === "abraham_travels") return "abraham";
    if (jid === "exodus_outline") return "exodus";
    if (
      jid === "jeroboam_wife_shiloh" ||
      jid === "shishak_jerusalem" ||
      jid === "jeroboam_return_egypt" ||
      jid === "rehoboam_shechem" ||
      jid === "man_of_god_bethel" ||
      jid === "elijah_to_zarephath" ||
      jid === "elijah_carmel_jezreel" ||
      jid === "elijah_flight_horeb" ||
      jid === "ahab_aphek"
    ) {
      return "divided_kingdom";
    }
    if (jid === "solomon_ophir_fleet" || jid === "queen_of_sheba") {
      return "kingdom_david";
    }

    const fromPassage = presetFromPassage(current?.passage);
    if (fromPassage) return fromPassage;

    const places = activePlaceMarkers || [];
    const gospelHits = places.filter((p) => (p.eras || []).includes("gospels")).length;
    if (places.length && gospelHits >= 2 && gospelHits >= places.length / 2) return "jesus";
    const unitedHits = places.filter((p) => (p.eras || []).includes("united")).length;
    if (places.length && unitedHits >= 2 && unitedHits >= places.length / 2) return "kingdom_david";
    return eraMap?.defaultPreset || "levant_general";
  }

  function resolvePreset() {
    return getPreset(suggestPresetId()) || getPreset("levant_general") || getPreset("divided_kingdom");
  }

  function placesFingerprint(places) {
    return (places || [])
      .map(
        (p) =>
          `${p.id}:${p.name}:${p.modernName || ""}:${p.pinBlurb || ""}:${p.eraNotes || ""}`
      )
      .join("|");
  }

  /** Prefer journey stop note, then curated pinBlurb, then eraNotes. */
  function whyThisPinText(place) {
    if (!place) return "";
    const id = place.id || place.placeId;
    if (id) {
      for (const j of current?.journeys || []) {
        const stop = (j.stops || []).find(
          (s) => s.placeId === id && s.note && !s.hidden
        );
        if (stop?.note) return formatWhyThisPin(stop.note);
      }
    }
    return formatWhyThisPin(place.pinBlurb || place.eraNotes || place.note || "");
  }

  /** Turn "Acts 27:8 — Harbor…" into "Harbor… (Acts 27:8)." Cap length. */
  function formatWhyThisPin(raw) {
    let s = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return "";
    const citeFirst = s.match(
      /^((?:[123]\s+)?[A-Za-z][A-Za-z0-9 .]*?\s+\d+(?::\d+(?:[–\-]\d+)?)?(?:\s*[–\-]\s*\d+(?::\d+)?)?)\s*[—–\-]\s*(.+)$/
    );
    if (citeFirst) {
      const cite = citeFirst[1].trim();
      let body = citeFirst[2].trim().replace(/[.\s]+$/, "");
      if (!/\([A-Za-z].*\d+.*\)$/.test(body)) body = `${body} (${cite})`;
      s = body;
    }
    if (!/[.!?]$/.test(s)) s += ".";
    if (s.length > 180) s = `${s.slice(0, 177).replace(/\s+\S*$/, "")}…`;
    return s;
  }

  function journeysFingerprint(journeys) {
    return (journeys || [])
      .map(
        (j) =>
          `${j.id}:${j.hitCount ?? ""}:${j.stopCount ?? ""}:${(j.scriptureRefs || []).join(",")}`
      )
      .join("|");
  }

  function renderPlaces(places, { force = false } = {}) {
    const fp = placesFingerprint(places);
    if (!force && fp === lastPlacesFingerprint) return;
    lastPlacesFingerprint = fp;

    els.placesPanel.innerHTML = "";
    if (!places?.length) {
      openPlaceIds.clear();
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No gazetteer places matched in this chapter yet.";
      els.placesPanel.appendChild(empty);
      return;
    }
    for (const place of places) {
      const row = document.createElement("details");
      row.className = "acc-row";
      row.dataset.placeId = place.id || place.name;
      if (openPlaceIds.has(row.dataset.placeId)) row.open = true;
      const modern = place.modernName ? ` · ${place.modernName}` : "";
      row.innerHTML = `
        <summary>
          <span class="acc-title">${escapeHtml(place.name)}</span>
          <span class="acc-aside">${escapeHtml(modern)}</span>
        </summary>
        <div class="acc-body">
          <div class="actions">
            <a class="primary-btn" href="${escapeAttr(googlePlaceUrl(place))}" target="_blank" rel="noopener">
              Open in Google Maps
            </a>
            <a class="ghost-btn wiki-link" href="${escapeAttr(biblicalTrainingPlaceUrl(place))}" target="_blank" rel="noopener">
              Wiki
            </a>
          </div>
        </div>
      `;
      row.addEventListener("toggle", () => {
        const id = row.dataset.placeId;
        if (!id) return;
        if (suppressPlaceToggleDive) return;
        if (row.open) {
          closeOtherPlaceAccordions(id);
          diveToPlaceFromList(id);
        } else {
          openPlaceIds.delete(id);
          // User closed it — don't let focus/poll force it back open.
          if (focusedPlaceId === id) {
            focusedPlaceId = null;
            row.classList.remove("is-focused");
          }
        }
      });
      els.placesPanel.appendChild(row);
    }
  }

  function renderJourneys(journeys, { force = false } = {}) {
    const fp = journeysFingerprint(journeys);
    if (!force && fp === lastJourneysFingerprint) return;
    lastJourneysFingerprint = fp;

    els.journeysPanel.innerHTML = "";
    if (!journeys?.length) {
      openJourneyIds.clear();
      els.journeysPanel.innerHTML =
        '<p class="empty">No journey patterns detected in this chapter.</p>';
      return;
    }
    for (const journey of journeys) {
      const id = journey.id || journey.name;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "journey-row";
      row.dataset.journeyId = id;
      const refs = (journey.scriptureRefs || []).join(", ");
      const hitLabel =
        journey.hitCount != null
          ? `${journey.hitCount}/${journey.stopCount} stops`
          : "";
      const selected = journeyOnMap && activeJourney?.id === journey.id;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-pressed", selected ? "true" : "false");
      row.innerHTML = `
        <span class="journey-row-main">
          <span class="journey-row-title">${escapeHtml(journey.name)}</span>
          <span class="journey-row-meta">${escapeHtml(hitLabel)}${hitLabel && refs ? " · " : ""}${escapeHtml(refs)}</span>
          ${
            journey.summary
              ? `<span class="journey-row-summary">${escapeHtml(journey.summary)}</span>`
              : ""
          }
        </span>
        <span class="journey-row-check" aria-hidden="true">${selected ? "✓" : "○"}</span>
      `;
      row.addEventListener("click", () => toggleJourneyOnMap(journey));
      els.journeysPanel.appendChild(row);
    }
  }

  function updateJourneyMapButtons() {
    els.journeysPanel?.querySelectorAll("button.journey-row").forEach((row) => {
      const id = row.dataset.journeyId;
      const selected = journeyOnMap && activeJourney?.id === id;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-pressed", selected ? "true" : "false");
      const check = row.querySelector(".journey-row-check");
      if (check) check.textContent = selected ? "✓" : "○";
    });
  }

  function hideStopList() {
    if (els.stopListWrap) els.stopListWrap.hidden = true;
    if (els.stopList) els.stopList.innerHTML = "";
  }

  function visibleJourneyStops(journey) {
    return (journey?.stops || []).filter((s) => !s?.hidden);
  }

  /** Stops that shape the sailing line (exclude landmark-only pass-bys). */
  function routeGeometryStops(stops) {
    return (stops || []).filter((s) => !s?.markerOnly);
  }

  function fillJourneyStopList(journey) {
    if (!els.stopList || !els.stopListWrap) return;
    els.stopList.innerHTML = "";
    const stops = visibleJourneyStops(journey);
    if (!stops.length) {
      els.stopListWrap.hidden = true;
      return;
    }
    stops.forEach((stop) => {
      const li = document.createElement("li");
      li.textContent = `${stop.name}${stop.note ? ` — ${stop.note}` : ""}`;
      if (journey.hitPlaceIds?.includes(stop.placeId)) {
        li.classList.add("stop-hit");
      }
      li.title = stop.modernName || "";
      els.stopList.appendChild(li);
    });
    els.stopListWrap.hidden = false;
  }

  /** Keep the always-visible map chrome in sync with chapter places. */
  function syncPlacesMapChrome(places) {
    activeJourney = null;
    // Do not clear journeyOnMap — Hide on map owns that; tab switches can restore.
    activePlaceMarkers = places || [];
    const chap = chapterLabel(current);
    els.mapTitle.textContent = "Map";
    els.mapSubtitle.textContent = chap ? `Places in ${chap}` : "Places in this chapter";
    // Places: region / single-pin link only — no walking directions.
    setPlacesMapsLink(places || []);
    // Place names live in the accordion above the map — don't duplicate under it.
    hideStopList();
    updateJourneyMapButtons();
  }

  function requestOverviewFit(animate = true) {
    pendingOverviewAnimate = Boolean(animate);
  }

  function showJourneyOnMap(journey) {
    if (!journey) return;
    cancelPlaceCameraFlight();
    clearPlaceFocusUi();
    requestOverviewFit(true);
    activeJourney = journey;
    selectedJourneyId = journey.id || null;
    journeyOnMap = true;
    activePlaceMarkers = current?.places || [];
    els.mapTitle.textContent = journey.name;
    els.mapSubtitle.textContent = (journey.scriptureRefs || []).join(" · ");
    setJourneyMapsLink(visibleJourneyStops(journey));
    fillJourneyStopList(journey);
    updateJourneyMapButtons();
    refreshJourneyMapView();
  }

  function hideJourneyFromMap() {
    requestOverviewFit(true);
    lastFocusedLngLat = null;
    journeyOnMap = false;
    activeJourney = null;
    // Keep chapter places on the map; clear the journey route/chrome.
    const places = current?.places || [];
    activePlaceMarkers = places;
    const chap = chapterLabel(current);
    els.mapTitle.textContent = "Map";
    els.mapSubtitle.textContent = chap ? `Places in ${chap}` : "Places in this chapter";
    setPlacesMapsLink(places);
    hideStopList();
    updateJourneyMapButtons();
    refreshJourneyMapView();
  }

  function cancelPlaceCameraFlight() {
    placeFocusGen += 1;
    placeCameraBusy = false;
  }

  function clearPlaceFocusUi() {
    focusedPlaceId = null;
    lastFocusedLngLat = null;
    openPlaceIds.clear();
    if (els.placesPanel) {
      for (const row of els.placesPanel.querySelectorAll(".acc-row[data-place-id]")) {
        row.open = false;
        row.classList.remove("is-focused");
      }
    }
  }

  function fitStoryOnMap() {
    if (!maplibreMap) return;
    cancelPlaceCameraFlight();
    clearPlaceFocusUi();
    requestOverviewFit(true);
    const preset = resolvePreset();
    const showKingdoms =
      Boolean(preset?.showKingdoms) &&
      Boolean(kingdomsGeoJson?.features?.length) &&
      Boolean(els.kingdomsToggle?.checked);
    applyMapViewportNow();
    updateMapOverlays(maplibreMap, preset, showKingdoms);
    lastMapFingerprint = mapFingerprint();
    lastMapPresetId = preset?.id || "";
  }

  function refreshJourneyMapView() {
    const apply = () => {
      if (!maplibreMap) {
        requestAnimationFrame(() => renderMap());
        return;
      }
      fitStoryOnMap();
    };
    requestAnimationFrame(apply);
  }

  function toggleJourneyOnMap(journey) {
    if (!journey) return;
    const same = journeyOnMap && activeJourney?.id === journey.id;
    if (same) {
      hideJourneyFromMap();
      return;
    }
    showJourneyOnMap(journey);
  }

  function pickJourneyForTab() {
    if (!journeyOnMap) return null;
    const journeys = current?.journeys || [];
    if (!journeys.length) return null;
    if (selectedJourneyId) {
      const preferred = journeys.find((j) => j.id === selectedJourneyId);
      if (preferred) return preferred;
    }
    if (activeJourney) {
      const still = journeys.find((j) => j.id === activeJourney.id);
      if (still) return still;
    }
    return null;
  }

  /** Keep the always-visible map aligned with Places vs Journeys tab. */
  function syncMapForActiveTab() {
    if (activeTab === "journeys") {
      if (journeyOnMap) {
        const journey = pickJourneyForTab();
        if (journey) {
          showJourneyOnMap(journey);
          return;
        }
      }
      // Journeys tab with nothing shown — chapter places until user hits Show on map.
      hideJourneyFromMap();
      return;
    }
    syncPlacesMapChrome(current?.places || []);
    requestAnimationFrame(() => renderMap());
  }

  function collectRoutePoints() {
    // Include hidden routing vias; exclude markerOnly landmarks from the line.
    const stops = routeGeometryStops(activeJourney?.stops || []);
    if (stops.some((s) => Number.isFinite(s.lat))) return stops;
    return [];
  }

  function clearMarkers() {
    for (const m of markerObjs) {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    }
    markerObjs = [];
  }

  function clearKingdomLabels() {
    for (const m of kingdomLabelMarkers) {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    }
    kingdomLabelMarkers = [];
  }

  function addKingdomLabels(map) {
    clearKingdomLabels();
    if (!map || !kingdomsGeoJson?.features?.length) return;
    const all = kingdomsGeoJson.features;
    const feats =
      provinceOverlayFeatures(all).length > 0 ? provinceOverlayFeatures(all) : all;
    for (const f of feats) {
      const p = f.properties || {};
      const lng = Number(p.labelLng);
      const lat = Number(p.labelLat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const el = document.createElement("div");
      el.className = "bm-kingdom-label";
      el.textContent = String(p.shortName || shortKingdomName(p)).toUpperCase();
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
        pitchAlignment: "viewport",
        rotationAlignment: "viewport",
      })
        .setLngLat([lng, lat])
        .addTo(map);
      kingdomLabelMarkers.push(marker);
    }
  }

  function showPlacesTab() {
    const tab = document.querySelector('.tab[data-tab="places"]');
    if (!tab) return;
    if (activeTab === "places" && !els.placesPanel.hidden) return;
    tab.click();
  }

  function findPlaceById(placeId) {
    if (!placeId) return null;
    const match = (p) => p.id === placeId || p.name === placeId;
    const fromChapter = (current?.places || []).find(match);
    if (fromChapter) return fromChapter;
    return (allPlaces || []).find(match) || null;
  }

  function closeOtherPlaceAccordions(keepPlaceId) {
    if (!els.placesPanel) return;
    for (const row of els.placesPanel.querySelectorAll(
      ".acc-row[data-place-id]"
    )) {
      const id = row.dataset.placeId;
      if (!id || id === keepPlaceId) continue;
      if (row.open) row.open = false;
      openPlaceIds.delete(id);
      row.classList.remove("is-focused");
    }
    if (keepPlaceId) {
      openPlaceIds.clear();
      openPlaceIds.add(keepPlaceId);
    }
  }

  function openPlaceAccordion(placeId, { scroll = false } = {}) {
    if (!placeId || !els.placesPanel) return null;
    closeOtherPlaceAccordions(placeId);
    const row = els.placesPanel.querySelector(
      `[data-place-id="${CSS.escape(placeId)}"]`
    );
    if (!row) return null;
    openPlaceIds.add(placeId);
    suppressPlaceToggleDive = true;
    row.open = true;
    suppressPlaceToggleDive = false;
    els.placesPanel
      .querySelectorAll(".acc-row.is-focused")
      .forEach((el) => el.classList.remove("is-focused"));
    row.classList.add("is-focused");
    // Only scroll on the original bible-click focus — polling must not yank the panel back up.
    if (scroll) {
      try {
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch {
        /* ignore */
      }
    }
    return row;
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }

  function approxDistanceKm(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRad(b.lng - a.lng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return (6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  }

  function waitMapMoveEnd(map, gen) {
    return new Promise((resolve) => {
      if (gen !== placeFocusGen) {
        resolve(false);
        return;
      }
      const done = () => {
        map.off("moveend", done);
        resolve(gen === placeFocusGen);
      };
      map.once("moveend", done);
    });
  }

  async function easeMapStep(map, { center, zoom, duration }, gen) {
    if (gen !== placeFocusGen) return false;
    map.easeTo({
      center,
      zoom,
      duration,
      easing: easeInOutQuad,
      essential: true,
    });
    return waitMapMoveEnd(map, gen);
  }

  /** iOS-style place dive: pull out, then ease into town-scale (multi-leg when hopping). */
  async function cinematicFocusPlace(place) {
    if (!maplibreMap || !place) return false;
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return false;
    const gen = ++placeFocusGen;
    const map = maplibreMap;
    const to = [place.lng, place.lat];
    const prior = lastFocusedLngLat;

    if (!prior) {
      const c = map.getCenter();
      const currentZoom = map.getZoom();
      const pullZoom = Math.max(5.2, Math.min(currentZoom - 2, 7.5));
      const ok1 = await easeMapStep(
        map,
        { center: [c.lng, c.lat], zoom: pullZoom, duration: 2000 },
        gen
      );
      if (!ok1) return false;
      const ok2 = await easeMapStep(
        map,
        { center: to, zoom: PLACE_FOCUS_ZOOM, duration: 2450 },
        gen
      );
      if (!ok2) return false;
    } else {
      const km = approxDistanceKm(
        { lat: prior[1], lng: prior[0] },
        { lat: place.lat, lng: place.lng }
      );
      if (km < 120) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend(prior);
        bounds.extend(to);
        if (gen !== placeFocusGen) return false;
        map.fitBounds(bounds, {
          padding: 72,
          maxZoom: 9,
          duration: 2000,
          easing: easeInOutQuad,
          essential: true,
        });
        const ok1 = await waitMapMoveEnd(map, gen);
        if (!ok1) return false;
        const ok2 = await easeMapStep(
          map,
          { center: to, zoom: PLACE_FOCUS_ZOOM, duration: 2400 },
          gen
        );
        if (!ok2) return false;
      } else {
        const farZoom = 6.2;
        const ok1 = await easeMapStep(
          map,
          { center: prior, zoom: farZoom, duration: 2200 },
          gen
        );
        if (!ok1) return false;
        const ok2 = await easeMapStep(
          map,
          { center: to, zoom: farZoom, duration: 2200 },
          gen
        );
        if (!ok2) return false;
        const ok3 = await easeMapStep(
          map,
          { center: to, zoom: PLACE_FOCUS_ZOOM, duration: 2600 },
          gen
        );
        if (!ok3) return false;
      }
    }
    if (gen === placeFocusGen) lastFocusedLngLat = to;
    return true;
  }

  async function flyToPlaceOnMap(place, { ensureMap = false } = {}) {
    if (!place) return;
    if (ensureMap && !maplibreMap) {
      await renderMap();
    }
    if (!maplibreMap) return;

    const run = async () => {
      const { focusPts } = chapterFocusPoints();
      clearMarkers();
      addDomMarkers(maplibreMap, focusPts, { dim: false });
      setPlacesMapsLink([place]);
      setMapHelp("", false);
      await cinematicFocusPlace(place);
    };

    if (
      typeof maplibreMap.isStyleLoaded === "function" &&
      !maplibreMap.isStyleLoaded()
    ) {
      await new Promise((resolve) => {
        maplibreMap.once("idle", () => {
          run().finally(resolve);
        });
      });
    } else {
      await run();
    }
  }

  async function diveToPlaceFromList(placeId, { scrollAccordion = false } = {}) {
    if (!placeId) return;
    focusedPlaceId = placeId;
    placeFocusGen += 1;
    placeCameraBusy = true;
    try {
      showPlacesTab();
      await loadAllPlaces();
      openPlaceAccordion(placeId, { scroll: scrollAccordion });
      const place = findPlaceById(placeId);
      if (!place) return;
      await flyToPlaceOnMap(place, { ensureMap: true });
    } finally {
      placeCameraBusy = false;
    }
  }

  async function focusPlaceFromClick(placeId) {
    if (!placeId) return;
    showPlacesTab();
    await loadAllPlaces();

    let row = openPlaceAccordion(placeId, { scroll: true });
    if (!row) {
      for (let i = 0; i < 8 && !row; i += 1) {
        await new Promise((r) => setTimeout(r, 150));
        row = openPlaceAccordion(placeId, { scroll: false });
      }
      if (row) openPlaceAccordion(placeId, { scroll: true });
    }

    await diveToPlaceFromList(placeId, { scrollAccordion: false });
  }

  async function consumePendingFocus() {
    try {
      if (!chrome.storage?.session?.get) return;
      const stored = await chrome.storage.session.get("pendingFocusPlace");
      const pending = stored?.pendingFocusPlace;
      if (!pending?.placeId) return;
      await chrome.storage.session.remove("pendingFocusPlace");
      if (Date.now() - (pending.at || 0) > 30000) return;
      await focusPlaceFromClick(pending.placeId);
    } catch {
      /* ignore */
    }
  }

  function destroyMap() {
    clearMarkers();
    clearKingdomLabels();
    if (maplibreMap) {
      try {
        maplibreMap.remove();
      } catch {
        /* ignore */
      }
    }
    maplibreMap = null;
    lastMapFingerprint = "";
    lastMapPresetId = "";
    if (els.teachingMap) els.teachingMap.innerHTML = "";
  }

  function eraRouteIsActive(preset = resolvePreset()) {
    if (journeyOnMap) return false;
    const jid = preset?.journeyId || routeOverlayGeoJson?.meta?.journeyId;
    if (!jid || !routeOverlayGeoJson?.features?.length) return false;
    // Only paint the Paul Mediterranean trace when that journey is actually
    // detected in the chapter — avoids Acts 22–26 (paul_rome basemap) showing
    // a lonely Rome-voyage dashed line with no relevant pins.
    return (current?.journeys || []).some((j) => j.id === jid);
  }

  function eraRouteStopPoints() {
    if (!eraRouteIsActive()) return [];
    const out = [];
    const seen = new Set();
    for (const f of routeOverlayGeoJson?.features || []) {
      if (f?.geometry?.type !== "Point") continue;
      if (f.properties?.hidden) continue;
      const [lng, lat] = f.geometry.coordinates || [];
      const id = f.properties?.id;
      if (!id || seen.has(id)) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      seen.add(id);
      out.push({
        id,
        placeId: id,
        name: f.properties?.name || id,
        lat,
        lng,
        note: f.properties?.note || "",
      });
    }
    return out;
  }

  function chapterFocusPoints() {
    const matched = Array.isArray(activePlaceMarkers) ? activePlaceMarkers : [];
    const routePts = collectRoutePoints();
    const focusPts = [];
    const seen = new Set();
    for (const p of matched) {
      if (!p?.id || seen.has(p.id)) continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      seen.add(p.id);
      focusPts.push(p);
    }
    for (const s of routePts) {
      if (s?.hidden) continue; // routing vias shape the line only
      const id = s.placeId || s.id || s.name;
      if (!id || seen.has(id)) continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      seen.add(id);
      focusPts.push(s);
    }
    // Landmark pass-bys (e.g. Cnidus, Salmone): show pins, not line vertices.
    for (const s of activeJourney?.stops || []) {
      if (!s?.markerOnly || s?.hidden) continue;
      const id = s.placeId || s.id || s.name;
      if (!id || seen.has(id)) continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      seen.add(id);
      focusPts.push(s);
    }
    for (const s of eraRouteStopPoints()) {
      const id = s.placeId || s.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      focusPts.push(s);
    }
    return { focusPts, routePts };
  }

  function mapFingerprint() {
    const { focusPts, routePts } = chapterFocusPoints();
    const placeIds = focusPts.map((p) => p.id || p.placeId || p.name).join(",");
    const routeIds = routePts.map((p) => p.placeId || p.name).join(">");
    const jid = activeJourney?.id || "";
    const url = current?.url || "";
    const kingdoms = Boolean(els.kingdomsToggle?.checked);
    const preset = suggestPresetId();
    const eraRoute = routeOverlayLoadedPath || "";
    const onMap = journeyOnMap ? "1" : "0";
    const focus = focusedPlaceId || "";
    return `${url}|${preset}|${jid}|${placeIds}|${routeIds}|kg:${kingdoms}|er:${eraRoute}|jm:${onMap}|bm:${basemapType}|lb:${basemapLabels ? 1 : 0}|fc:${focus}`;
  }

  function isOnline() {
    return typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  }

  function esriBasemapTilesUrl(mapType = basemapType) {
    if (mapType === "satellite") {
      return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    }
    // Land-forward palette (greens/tans) — closer to Bing road maps than pale topo/gray canvas.
    return "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}";
  }

  function esriLabelsTilesUrl(mapType = basemapType) {
    return "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
  }

  function buildStreamingStyle({
    mapType = basemapType,
    theme = currentTheme(),
    labels = basemapLabels,
  } = {}) {
    const bg = theme === "night" ? "#2a261f" : "#e2dfda";
    const style = {
      version: 8,
      name: "Bible Maps Esri",
      sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": bg } }],
    };
    if (!isOnline()) return style;
    style.sources[ESRI_BASEMAP_SOURCE] = {
      type: "raster",
      tiles: [esriBasemapTilesUrl(mapType)],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTR,
    };
    style.layers.push({
      id: ESRI_BASEMAP_LAYER,
      type: "raster",
      source: ESRI_BASEMAP_SOURCE,
    });
    if (labels) {
      style.sources[ESRI_LABELS_SOURCE] = {
        type: "raster",
        tiles: [esriLabelsTilesUrl(mapType)],
        tileSize: 256,
        maxzoom: 19,
      };
      style.layers.push({
        id: ESRI_LABELS_LAYER,
        type: "raster",
        source: ESRI_LABELS_SOURCE,
      });
    }
    return style;
  }

  function mapMaxZoom() {
    return isOnline() ? 18 : 8;
  }

  function fitMaxZoom() {
    return isOnline() ? 14 : 8;
  }

  function clusterSpanDeg(pts) {
    if (!pts.length) return 0;
    let minLat = pts[0].lat;
    let maxLat = pts[0].lat;
    let minLng = pts[0].lng;
    let maxLng = pts[0].lng;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    return Math.max(maxLat - minLat, maxLng - minLng);
  }

  /** Empire-scale chapters: frame the densest neighborhood (iOS primaryCluster). */
  function primaryClusterForCamera(pts, maxSpan = EMPIRE_CLUSTER_MAX_SPAN_DEG) {
    if (pts.length < 2) return pts;
    if (clusterSpanDeg(pts) <= maxSpan) return pts;
    const radius = maxSpan / 2;
    let best = [pts[0]];
    for (const seed of pts) {
      const members = pts.filter(
        (p) =>
          Math.abs(p.lat - seed.lat) <= radius && Math.abs(p.lng - seed.lng) <= radius
      );
      if (members.length > best.length) {
        best = members;
      } else if (members.length === best.length && members.length > 1) {
        if (clusterSpanDeg(members) < clusterSpanDeg(best)) best = members;
      }
    }
    return best;
  }

  /** Camera bbox points — journey routes only when a journey is on the map. */
  function cameraFitPoints() {
    const { focusPts, routePts } = chapterFocusPoints();
    if (journeyOnMap) {
      const pts = routePts.filter(
        (s) => !s?.hidden && Number.isFinite(s.lat) && Number.isFinite(s.lng)
      );
      if (pts.length) return pts;
    }
    const matched = Array.isArray(activePlaceMarkers) ? activePlaceMarkers : [];
    let fromChapter = matched.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (!fromChapter.length) {
      fromChapter = focusPts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
    return primaryClusterForCamera(fromChapter);
  }

  function fitToChapter(map, preset, pts, { animate = false } = {}) {
    const maxZoom = fitMaxZoom();
    if (pts.length) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pts) bounds.extend([p.lng, p.lat]);
      const oneStop = pts.length === 1 ? Math.max(PLACE_FOCUS_ZOOM, 12) : maxZoom;
      map.fitBounds(bounds, {
        padding: pts.length === 1 ? 60 : 48,
        maxZoom: oneStop,
        duration: animate ? JOURNEY_FIT_ANIM_MS : 0,
        essential: true,
      });
      return;
    }
    if (preset?.bounds?.length === 2) {
      const [[south, west], [north, east]] = preset.bounds;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: 28,
          maxZoom: Math.min(8, maxZoom),
          duration: animate ? JOURNEY_FIT_ANIM_MS : 0,
        }
      );
    }
  }

  function ensureOverlayLayers(map, showKingdoms) {
    if (showKingdoms && kingdomsGeoJson?.features) {
      if (!map.getSource("kingdoms")) {
        map.addSource("kingdoms", { type: "geojson", data: kingdomsGeoJson });
        map.addLayer({
          id: "kingdoms-fill",
          type: "fill",
          source: "kingdoms",
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#4a6741"],
            "fill-opacity": [
              "max",
              0.24,
              ["coalesce", ["get", "fillOpacity"], 0.28],
            ],
          },
        });
        map.addLayer({
          id: "kingdoms-line",
          type: "line",
          source: "kingdoms",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#4a6741"],
            "line-width": 1.25,
            "line-opacity": 0.85,
          },
        });
      } else {
        map.getSource("kingdoms").setData(kingdomsGeoJson);
        if (map.getLayoutProperty("kingdoms-fill", "visibility") === "none") {
          map.setLayoutProperty("kingdoms-fill", "visibility", "visible");
          map.setLayoutProperty("kingdoms-line", "visibility", "visible");
        }
      }
      addKingdomLabels(map);
    } else {
      clearKingdomLabels();
      if (map.getLayer("kingdoms-fill")) {
        map.setLayoutProperty("kingdoms-fill", "visibility", "none");
        map.setLayoutProperty("kingdoms-line", "visibility", "none");
      }
    }

    if (!map.getSource("era-route")) {
      map.addSource("era-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "era-route-line",
        type: "line",
        source: "era-route",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#a63024",
          "line-width": 2.5,
          "line-opacity": 0.7,
          "line-dasharray": [1.2, 1.4],
        },
      });
      map.addLayer({
        id: "era-route-stops",
        type: "circle",
        source: "era-route",
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["!=", ["get", "hidden"], true],
        ],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#a63024",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff8ef",
        },
      });
      map.addLayer({
        id: "era-route-labels",
        type: "symbol",
        source: "era-route",
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["!=", ["get", "hidden"], true],
        ],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#2c2416",
          "text-halo-color": "#fff8ef",
          "text-halo-width": 1.4,
        },
      });
    }

    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: routeToGeoJSON([]) });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#a63024",
          "line-width": 3,
          "line-dasharray": [2, 1.5],
        },
      });
      ensureRouteArrowImage(map);
      map.addLayer(routeArrowLayerSpec());
    } else if (!map.getLayer("route-arrows")) {
      ensureRouteArrowImage(map);
      map.addLayer(routeArrowLayerSpec());
    } else {
      ensureRouteArrowImage(map);
      try {
        map.setLayoutProperty("route-arrows", "symbol-placement", "line-center");
        map.setLayoutProperty("route-arrows", "icon-size", 0.7);
      } catch {
        /* ignore */
      }
    }
    // Place pins are DOM markers only (dot + label) — no second circle layer.
  }

  function routeArrowLayerSpec() {
    return {
      id: "route-arrows",
      type: "symbol",
      source: "route",
      layout: {
        // One tip per arc segment — line spacing skipped short hops entirely.
        "symbol-placement": "line-center",
        "icon-image": "route-arrow",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
      },
    };
  }

  function ensureRouteArrowImage(map) {
    if (!map) return;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    // Soft halo so the tip stays readable on dark basemap tiles.
    ctx.fillStyle = "rgba(255, 248, 239, 0.92)";
    ctx.beginPath();
    ctx.moveTo(size * 0.16, size * 0.28);
    ctx.lineTo(size * 0.9, size * 0.5);
    ctx.lineTo(size * 0.16, size * 0.72);
    ctx.lineTo(size * 0.28, size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#a63024";
    ctx.beginPath();
    // Sleek but readable chevron along +x (MapLibre rotates to line bearing).
    ctx.moveTo(size * 0.2, size * 0.32);
    ctx.lineTo(size * 0.86, size * 0.5);
    ctx.lineTo(size * 0.2, size * 0.68);
    ctx.lineTo(size * 0.3, size * 0.5);
    ctx.closePath();
    ctx.fill();
    const imageData = ctx.getImageData(0, 0, size, size);
    const opts = { pixelRatio: 2 };
    try {
      if (map.hasImage("route-arrow") && typeof map.updateImage === "function") {
        map.updateImage("route-arrow", imageData);
      } else if (!map.hasImage("route-arrow")) {
        map.addImage("route-arrow", imageData, opts);
      } else {
        map.removeImage("route-arrow");
        map.addImage("route-arrow", imageData, opts);
      }
    } catch {
      try {
        if (map.hasImage("route-arrow")) map.removeImage("route-arrow");
        map.addImage("route-arrow", imageData, opts);
      } catch {
        /* ignore */
      }
    }
  }

  function updateMapOverlays(map, preset, showKingdoms) {
    const { focusPts, routePts } = chapterFocusPoints();
    ensureOverlayLayers(map, showKingdoms);
    // Era route overlay (Paul Mediterranean traces): only when that journey is
    // detected in-chapter, and not while a user journey is shown on the map.
    const eraRoute = eraRouteIsActive(preset)
      ? routeOverlayGeoJson
      : { type: "FeatureCollection", features: [] };
    map.getSource("era-route")?.setData(eraRoute);
    // Prefer traced overlay geometry for the active journey when it matches
    // (keeps Acts 27 north-of-Cyprus / south-Crete teaching track accurate).
    const overlayJourneyId = routeOverlayGeoJson?.meta?.journeyId;
    if (
      journeyOnMap &&
      activeJourney?.id &&
      overlayJourneyId &&
      activeJourney.id === overlayJourneyId &&
      routeOverlayGeoJson?.features?.length
    ) {
      map.getSource("route")?.setData({
        type: "FeatureCollection",
        features: routeOverlayGeoJson.features.filter(
          (f) => f?.geometry?.type === "LineString"
        ),
      });
    } else {
      map.getSource("route")?.setData(routeToGeoJSON(routePts));
    }
    // Drop legacy circle layer if an older panel session still has it.
    if (map.getLayer("towns-focus-circle")) {
      try {
        map.removeLayer("towns-focus-circle");
      } catch {
        /* ignore */
      }
    }
    if (map.getSource("towns-focus")) {
      try {
        map.removeSource("towns-focus");
      } catch {
        /* ignore */
      }
    }
    clearMarkers();
    addDomMarkers(map, focusPts, { dim: false });
    const focused =
      focusedPlaceId && findPlaceById(focusedPlaceId);
    const keepCamera = Boolean(placeCameraBusy || focused);
    if (!placeCameraBusy && !dockDragging) {
      applyMapViewportNow();
    }
    if (keepCamera) {
      if (focused) setPlacesMapsLink([focused]);
      setMapHelp("", false);
    } else {
      const fitPts = cameraFitPoints();
      const animate =
        pendingOverviewAnimate ||
        Boolean(journeyOnMap && fitPts.length && !focusedPlaceId);
      pendingOverviewAnimate = false;
      fitToChapter(map, preset, fitPts, { animate });
      setMapHelp("", false);
    }
  }

  async function waitForMapSize(el) {
    for (let i = 0; i < 40; i += 1) {
      if (el && el.clientWidth > 40 && el.clientHeight > 40) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return Boolean(el && el.clientWidth > 0);
  }

  function clampDockHeight(px) {
    const min = dockPeekHeight();
    const max = Math.max(min, window.innerHeight * 0.78);
    return Math.min(max, Math.max(min, px));
  }

  /** Resting height: grabber + tabs + a peek at the first place/journey row. */
  function dockPeekHeight() {
    const h = window.innerHeight;
    return Math.round(Math.min(Math.max(h * 0.28, 184), 268));
  }

  function dockExpandedHeight() {
    const h = window.innerHeight;
    return Math.round(Math.min(Math.max(h * 0.52, 260), 520));
  }

  function applyMapViewportNow() {
    if (!maplibreMap || dockDragging) return;
    try {
      const bottom = Math.round(dockHeightPx);
      maplibreMap.setPadding({ top: 0, bottom, left: 0, right: 0 });
      maplibreMap.resize();
    } catch {
      /* ignore */
    }
  }

  function scheduleMapResize() {
    if (!maplibreMap || dockDragging) return;
    if (mapResizeRaf) return;
    mapResizeRaf = requestAnimationFrame(() => {
      mapResizeRaf = 0;
      applyMapViewportNow();
    });
  }

  function syncDockMapViewport() {
    if (mapResizeRaf) {
      cancelAnimationFrame(mapResizeRaf);
      mapResizeRaf = 0;
    }
    applyMapViewportNow();
  }

  function applyDockHeight(px, { persist = true, syncMap = true } = {}) {
    dockHeightPx = clampDockHeight(px);
    document.documentElement.style.setProperty("--dock-height", `${dockHeightPx}px`);
    if (persist) {
      try {
        localStorage.setItem(DOCK_HEIGHT_KEY, String(Math.round(dockHeightPx)));
      } catch {
        /* ignore */
      }
    }
    if (syncMap && !dockDragging) syncDockMapViewport();
    const peek = dockPeekHeight();
    els.mapDock?.classList.toggle("is-dock-peek", dockHeightPx <= peek + 10);
    if (!dockDragging) syncDockGrabberHint();
  }

  function expandDockPanel() {
    applyDockHeight(dockExpandedHeight());
    syncDockGrabberHint();
  }

  function loadDockHeight() {
    try {
      const peek = dockPeekHeight();
      const uiVer = Number(localStorage.getItem(DOCK_UI_VERSION_KEY));
      const stored = Number(localStorage.getItem(DOCK_HEIGHT_KEY));
      if (!Number.isFinite(uiVer) || uiVer < DOCK_UI_VERSION) {
        if (Number.isFinite(stored) && stored >= peek) {
          dockHeightPx = stored;
        } else {
          dockHeightPx = peek;
        }
        localStorage.setItem(DOCK_UI_VERSION_KEY, String(DOCK_UI_VERSION));
        localStorage.removeItem(DOCK_HINT_DISMISSED_KEY);
      } else if (Number.isFinite(stored) && stored >= peek) {
        dockHeightPx = stored;
      } else {
        dockHeightPx = peek;
      }
    } catch {
      /* ignore */
    }
    applyDockHeight(dockHeightPx, { persist: false });
    syncDockGrabberHint();
  }

  function dismissDockGrabberHint() {
    try {
      localStorage.setItem(DOCK_HINT_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    syncDockGrabberHint();
  }

  function syncDockGrabberHint() {
    if (!els.dockGrabberHint) return;
    const peek = dockPeekHeight();
    const cramped = dockHeightPx <= peek + 6;
    if (cramped) {
      els.dockGrabberHint.hidden = false;
      els.dockGrabberHint.textContent = "Pull up · or Places ↑ on map";
    } else {
      els.dockGrabberHint.hidden = true;
      els.dockGrabberHint.textContent = "";
    }
    if (els.showPlacesBtn) {
      els.showPlacesBtn.hidden = !cramped;
    }
  }

  function initMapNavControls() {
    const zoomStep = () => ({ duration: 220 });
    els.mapZoomIn?.addEventListener("click", () => {
      cancelPlaceCameraFlight();
      maplibreMap?.zoomIn(zoomStep());
    });
    els.mapZoomOut?.addEventListener("click", () => {
      cancelPlaceCameraFlight();
      maplibreMap?.zoomOut(zoomStep());
    });
    els.mapRecenter?.addEventListener("click", () => {
      if (!maplibreMap) return;
      fitStoryOnMap();
    });
  }

  function initDockGrabber() {
    els.showPlacesBtn?.addEventListener("click", () => {
      expandDockPanel();
      showPlacesTab();
      dismissDockGrabberHint();
    });
    const grab = els.dockGrabber;
    if (!grab) return;
    grab.addEventListener("pointerdown", (e) => {
      grab.setPointerCapture(e.pointerId);
      dockDragging = true;
      document.body.classList.add("is-dock-dragging");
      dockDragStart = { y: e.clientY, h: dockHeightPx };
      dismissDockGrabberHint();
    });
    grab.addEventListener("dblclick", () => {
      applyDockHeight(dockExpandedHeight());
      syncDockGrabberHint();
    });
    grab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        applyDockHeight(dockHeightPx + 28);
        dismissDockGrabberHint();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        applyDockHeight(dockHeightPx - 28);
      }
    });
    const endDockDrag = () => {
      if (!dockDragStart) return;
      dockDragStart = null;
      dockDragging = false;
      document.body.classList.remove("is-dock-dragging");
      applyDockHeight(dockHeightPx, { persist: true, syncMap: true });
      syncDockGrabberHint();
    };
    grab.addEventListener("pointermove", (e) => {
      if (!dockDragStart) return;
      const delta = dockDragStart.y - e.clientY;
      applyDockHeight(dockDragStart.h + delta, { persist: false, syncMap: false });
    });
    grab.addEventListener("pointerup", endDockDrag);
    grab.addEventListener("pointercancel", endDockDrag);
    window.addEventListener("resize", () => {
      applyDockHeight(dockHeightPx, { persist: false });
      syncDockGrabberHint();
    });
  }

  function syncBasemapPreferencesUi() {
    for (const btn of els.mapTypeButtons()) {
      const active = btn.dataset.mapType === basemapType;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (els.labelsToggle) els.labelsToggle.checked = basemapLabels;
  }

  function persistBasemapPrefs() {
    try {
      localStorage.setItem(MAP_TYPE_KEY, basemapType);
      localStorage.setItem(LABELS_KEY, basemapLabels ? "1" : "0");
    } catch {
      /* ignore */
    }
    try {
      chrome.storage?.local?.set?.({
        [MAP_TYPE_KEY]: basemapType,
        [LABELS_KEY]: basemapLabels,
      });
    } catch {
      /* ignore */
    }
  }

  async function loadBasemapPrefs() {
    let mapType = "map";
    let labels = false;
    try {
      const stored = await chrome.storage?.local?.get?.([MAP_TYPE_KEY, LABELS_KEY]);
      if (stored?.[MAP_TYPE_KEY] === "satellite" || stored?.[MAP_TYPE_KEY] === "map") {
        mapType = stored[MAP_TYPE_KEY];
      }
      if (stored?.[LABELS_KEY] === false || stored?.[LABELS_KEY] === "0") labels = false;
    } catch {
      /* ignore */
    }
    try {
      const lsType = localStorage.getItem(MAP_TYPE_KEY);
      if (lsType === "satellite" || lsType === "map") mapType = lsType;
      if (localStorage.getItem(LABELS_KEY) === "0") labels = false;
    } catch {
      /* ignore */
    }
    basemapType = mapType;
    basemapLabels = labels;
    syncBasemapPreferencesUi();
  }

  function filterPeriodPlaces(places, placeEras, focusIds) {
    const eraSet = new Set(placeEras || []);
    const focus = new Set(focusIds || []);
    return (places || []).filter((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      if (focus.has(p.id)) return true;
      const eras = p.eras || [];
      return eras.some((e) => eraSet.has(e));
    });
  }

  function updateReferencePlate(preset) {
    const file = preset?.referencePlate;
    if (!file || !els.referencePlateImg) {
      if (els.referencePlateImg) {
        els.referencePlateImg.hidden = true;
        els.referencePlateImg.removeAttribute("src");
      }
      if (els.referencePlate) els.referencePlate.open = false;
      if (els.referencePlateNote) {
        els.referencePlateNote.textContent =
          "No bundled plate for this era — the interactive map above is the basemap.";
      }
      return;
    }
    els.referencePlateImg.src = chrome.runtime.getURL(`media/historical/${file}`);
    els.referencePlateImg.alt = preset.title || "Reference atlas plate";
    els.referencePlateImg.hidden = false;
    if (els.referencePlate) els.referencePlate.open = true;
    if (els.referencePlateNote) {
      els.referencePlateNote.textContent =
        "Region names (Macedonia, Cappadocia, Asia, etc.) are on this plate. The live map uses pins + the Era outline for empire borders.";
    }
  }

  function placesToGeoJSON(points, { dim }) {
    return {
      type: "FeatureCollection",
      features: (points || [])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p, i) => ({
          type: "Feature",
          properties: {
            name: p.name || "Place",
            detail: p.note || p.modernName || "",
            dim: Boolean(dim),
            focus: !dim,
            order: i,
          },
          geometry: {
            type: "Point",
            coordinates: [p.lng, p.lat],
          },
        })),
    };
  }

  /**
   * Quadratic arc from a→b. Positive bulge bends left of travel direction so
   * A→B and B→A naturally take opposite sides and no longer stack.
   */
  function curvedRouteSegment(a, b, bulge, steps = 28) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [a.slice(), b.slice()];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Left-hand normal relative to travel a→b.
    const px = -dy / len;
    const py = dx / len;
    // Keep a minimum geographic bend so short hops still read as arcs.
    const offset = Math.max(Math.abs(bulge) * len, 0.08) * Math.sign(bulge || 1);
    const ctrl = [mid[0] + px * offset, mid[1] + py * offset];
    const coords = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      coords.push([
        u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
      ]);
    }
    return coords;
  }

  function routeToGeoJSON(stops) {
    const coords = (stops || [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => [s.lng, s.lat]);
    if (coords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }

    const directedUses = new Map();
    const features = [];
    for (let i = 0; i < coords.length - 1; i += 1) {
      const a = coords[i];
      const b = coords[i + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const dKey = `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;
      const use = directedUses.get(dKey) || 0;
      directedUses.set(dKey, use + 1);
      // Always bend left of travel; reverse legs land on the other side.
      // Repeated same-direction hops fan farther out.
      const bulge = 0.22 + use * 0.14;
      features.push({
        type: "Feature",
        properties: { segment: i, bulge },
        geometry: {
          type: "LineString",
          coordinates: curvedRouteSegment(a, b, bulge),
        },
      });
    }

    return { type: "FeatureCollection", features };
  }

  function addDomMarkers(map, points, { dim }) {
    const matchedIds = new Set(
      (activePlaceMarkers || []).map((p) => p.id).filter(Boolean)
    );
    for (const p of points || []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const el = document.createElement("div");
      const id = p.id || p.placeId;
      const focused = Boolean(focusedPlaceId && id === focusedPlaceId);
      const fromPassage = Boolean(id && matchedIds.has(id));
      el.className = [
        dim ? "bm-marker bm-marker-dim" : "bm-marker",
        fromPassage ? "bm-marker-place" : "bm-marker-journey",
        focused ? "bm-marker-focus" : "",
      ]
        .filter(Boolean)
        .join(" ");
      el.innerHTML = `<span class="bm-marker-dot"></span><span class="bm-marker-label">${escapeHtml(
        p.name || "Place"
      )}</span>`;
      const why = whyThisPinText(p);
      el.title = why || p.modernName || p.note || p.name || "";
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      markerObjs.push(marker);
    }
  }

  async function mountTeachingMap({ forceRemount = false } = {}) {
    if (typeof maplibregl === "undefined") throw new Error("MapLibre failed to load");
    if (!els.teachingMap) throw new Error("Map container missing");

    const gen = ++mapMountGen;
    await Promise.all([loadPresets(), loadEraMap(), loadKingdoms()]);
    if (gen !== mapMountGen) return;
    await waitForMapSize(els.teachingMap);
    if (gen !== mapMountGen) return;

    const preset = resolvePreset();
    const overlayKey = overlayPathsForPreset(preset).join("|") || null;
    if (overlayKey !== kingdomsLoadedPath) {
      await loadOverlaysForPreset(preset);
      if (gen !== mapMountGen) return;
    }
    const routeOverlayRel = routeOverlayPathForPreset(preset);
    if (routeOverlayRel !== routeOverlayLoadedPath) {
      await loadRouteOverlay(routeOverlayRel);
      if (gen !== mapMountGen) return;
    }
    const allowKingdoms =
      Boolean(preset?.showKingdoms) &&
      Boolean(kingdomsGeoJson?.features?.length);

    if (els.kingdomsToggleWrap) {
      els.kingdomsToggleWrap.hidden = !allowKingdoms;
      if (!allowKingdoms && els.kingdomsToggle) {
        els.kingdomsToggle.checked = false;
        delete els.kingdomsToggle.dataset.userTouched;
      } else if (
        allowKingdoms &&
        els.kingdomsToggle &&
        !els.kingdomsToggle.dataset.userTouched
      ) {
        els.kingdomsToggle.checked = true;
      }
    }
    if (els.mapToolbar) els.mapToolbar.hidden = false;
    const showKingdoms = allowKingdoms && Boolean(els.kingdomsToggle?.checked);
    if (els.kingdomLegend) els.kingdomLegend.hidden = !showKingdoms;

    updateReferencePlate(preset);

    const fp = mapFingerprint();
    const presetId = preset?.id || "";
    const canReuse =
      !forceRemount &&
      maplibreMap &&
      lastMapPresetId === presetId &&
      typeof maplibreMap.isStyleLoaded === "function" &&
      maplibreMap.isStyleLoaded();

    if (canReuse) {
      if (fp === lastMapFingerprint) {
        syncDockMapViewport();
        return;
      }
      updateMapOverlays(maplibreMap, preset, showKingdoms);
      lastMapFingerprint = fp;
      return;
    }

    destroyMap();
    if (gen !== mapMountGen) return;

    if (!isOnline()) {
      setMapHelp("Connect to the internet to load Esri map tiles.", true);
      if (els.teachingMap) {
        els.teachingMap.innerHTML =
          '<p class="muted" style="padding:12px">Map tiles need a network connection.</p>';
      }
      return;
    }
    setMapHelp("", false);
    if (els.teachingMap) els.teachingMap.innerHTML = "";

    const style = buildStreamingStyle();
    const map = new maplibregl.Map({
      container: els.teachingMap,
      style,
      center: [35.1, 31.7],
      zoom: 6.5,
      maxZoom: mapMaxZoom(),
      attributionControl: true,
      failIfMajorPerformanceCaveat: false,
    });
    maplibreMap = map;
    map.on("error", (e) => {
      const msg = e?.error?.message || e?.message || String(e?.error || e || "");
      if (msg) {
        console.warn("Bible Maps map error", e);
        setMapHelp(`Map tile error: ${msg}`, true);
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (e) => {
        map.off("load", onLoad);
        reject(e?.error || e || new Error("MapLibre load failed"));
      };
      const onLoad = () => {
        map.off("error", onError);
        resolve();
      };
      map.once("load", onLoad);
      map.once("error", onError);
    });
    if (gen !== mapMountGen || maplibreMap !== map) {
      try {
        map.remove();
      } catch {
        /* ignore */
      }
      return;
    }

    updateMapOverlays(map, preset, showKingdoms);
    lastMapFingerprint = fp;
    lastMapPresetId = presetId;
  }

  async function renderMap(opts = {}) {
    try {
      await mountTeachingMap(opts);
    } catch (err) {
      console.error(err);
      setMapHelp(`Map unavailable (${err?.message || err}). Reload the extension.`, true);
      if (els.teachingMap && !maplibreMap) {
        els.teachingMap.innerHTML = `<p class="muted" style="padding:12px">Could not draw map: ${escapeHtml(
          String(err?.message || err)
        )}</p>`;
      }
    }
  }

  /** Chapter places: pin or region view — never a multi-stop walking route. */
  function setPlacesMapsLink() {
    /* Per-place Google Maps links live in each place row. */
  }

  function setJourneyMapsLink() {
    /* Journey map links omitted — use place rows or host site. */
  }

  function chapterLabel(payload) {
    if (payload?.passageLabel) return payload.passageLabel;
    const title = String(payload?.title || "")
      .replace(/\s*[|·•\-–—]\s*(YouVersion|Bible\.com|Bible).*$/i, "")
      .trim();
    if (title && !/^[0-9]?[A-Z]{2,3}\s+\d+/i.test(title)) return title;
    // Last resort: expand USFM from the URL (1KI.14.NLT → 1 Kings 14 NLT)
    const url = payload?.url || "";
    try {
      const path = new URL(url).pathname;
      const m = path.match(/\/bible\/\d+\/([^/.]+)\.(\d+)\.([^/]+)/i);
      if (m) {
        const BOOKS = {
          GEN: "Genesis",
          EXO: "Exodus",
          LEV: "Leviticus",
          NUM: "Numbers",
          DEU: "Deuteronomy",
          JOS: "Joshua",
          JDG: "Judges",
          RUT: "Ruth",
          "1SA": "1 Samuel",
          "2SA": "2 Samuel",
          "1KI": "1 Kings",
          "2KI": "2 Kings",
          "1CH": "1 Chronicles",
          "2CH": "2 Chronicles",
          EZR: "Ezra",
          NEH: "Nehemiah",
          EST: "Esther",
          JOB: "Job",
          PSA: "Psalms",
          PRO: "Proverbs",
          ECC: "Ecclesiastes",
          SNG: "Song of Songs",
          ISA: "Isaiah",
          JER: "Jeremiah",
          LAM: "Lamentations",
          EZK: "Ezekiel",
          DAN: "Daniel",
          HOS: "Hosea",
          JOL: "Joel",
          AMO: "Amos",
          OBA: "Obadiah",
          JON: "Jonah",
          MIC: "Micah",
          NAM: "Nahum",
          HAB: "Habakkuk",
          ZEP: "Zephaniah",
          HAG: "Haggai",
          ZEC: "Zechariah",
          MAL: "Malachi",
          MAT: "Matthew",
          MRK: "Mark",
          LUK: "Luke",
          JHN: "John",
          ACT: "Acts",
          ROM: "Romans",
          "1CO": "1 Corinthians",
          "2CO": "2 Corinthians",
          GAL: "Galatians",
          EPH: "Ephesians",
          PHP: "Philippians",
          COL: "Colossians",
          "1TH": "1 Thessalonians",
          "2TH": "2 Thessalonians",
          "1TI": "1 Timothy",
          "2TI": "2 Timothy",
          TIT: "Titus",
          PHM: "Philemon",
          HEB: "Hebrews",
          JAS: "James",
          "1PE": "1 Peter",
          "2PE": "2 Peter",
          "1JN": "1 John",
          "2JN": "2 John",
          "3JN": "3 John",
          JUD: "Jude",
          REV: "Revelation",
        };
        const book = BOOKS[m[1].toUpperCase()] || m[1];
        return `${book} ${m[2]} ${m[3].toUpperCase()}`;
      }
    } catch {
      /* ignore */
    }
    return title;
  }

  function applyPayload(payload) {
    const prevUrl = current?.url;
    current = payload;
    if (!payload) {
      setStatus("Open a supported Bible passage, then click Refresh.");
      lastPlacesFingerprint = "";
      lastJourneysFingerprint = "";
      openPlaceIds.clear();
      openJourneyIds.clear();
      focusedPlaceId = null;
      renderPlaces([], { force: true });
      renderJourneys([], { force: true });
      syncPlacesMapChrome([]);
      requestAnimationFrame(() => renderMap());
      return;
    }

    if (payload.url && payload.url !== prevUrl) {
      focusedPlaceId = null;
      lastFocusedLngLat = null;
      placeFocusGen += 1;
    }

    activePlaceMarkers = payload.places || [];
    // Skip DOM rebuild when poll returns the same lists — rebuilding closes accordions.
    renderPlaces(payload.places || []);
    renderJourneys(payload.journeys || []);
    // Restore focus styling only if the user still has that row open.
    // Do not force-open — that fought manual collapse on every poll.
    if (focusedPlaceId) {
      const row = els.placesPanel?.querySelector(
        `[data-place-id="${CSS.escape(focusedPlaceId)}"]`
      );
      if (row?.open) row.classList.add("is-focused");
    }

    const placeCount = payload.places?.length || 0;
    const journeyCount = payload.journeys?.length || 0;
    const chap = chapterLabel(payload);
    const chapBit = chap ? `${chap} · ` : "";

    if (payload.clearing) {
      setStatus(`${chapBit}Loading chapter…`);
      // Don't tear down the basemap while the next chapter loads — only pins update later.
      return;
    }

    setStatus(
      `${chapBit}Found ${placeCount} place${placeCount === 1 ? "" : "s"} and ${journeyCount} journey${
        journeyCount === 1 ? "" : "s"
      }.`
    );

    // Always-visible map: keep chrome + overlays in sync with the active tab.
    if (activeTab === "journeys") {
      const journey = pickJourneyForTab();
      if (journey && journeyOnMap) {
        const same =
          activeJourney?.id === journey.id &&
          mapFingerprint() === lastMapFingerprint &&
          maplibreMap;
        if (!same) showJourneyOnMap(journey);
        else {
          activeJourney = journey;
          selectedJourneyId = journey.id || selectedJourneyId;
          fillJourneyStopList(journey);
          updateJourneyMapButtons();
        }
      } else {
        // Nothing shown on map (or journey no longer in chapter) — chapter places only.
        if (journeyOnMap) hideJourneyFromMap();
        else {
          activePlaceMarkers = payload.places || [];
          const label = chap ? `Places in ${chap}` : "Places in this chapter";
          if (els.mapSubtitle.textContent !== label) els.mapSubtitle.textContent = label;
          updateJourneyMapButtons();
          const fp = mapFingerprint();
          if (fp !== lastMapFingerprint || !maplibreMap) {
            requestAnimationFrame(() => renderMap());
          }
        }
      }
      return;
    }

    // Places tab — only refresh chrome when map content changes.
    const fp = mapFingerprint();
    if (fp !== lastMapFingerprint || !maplibreMap) {
      syncPlacesMapChrome(payload.places || []);
      if (placeCameraBusy) {
        lastMapFingerprint = fp;
      } else if (focusedPlaceId) {
        if (maplibreMap) {
          const preset = resolvePreset();
          const showKingdoms =
            Boolean(preset?.showKingdoms) &&
            Boolean(kingdomsGeoJson?.features?.length) &&
            Boolean(els.kingdomsToggle?.checked);
          updateMapOverlays(maplibreMap, preset, showKingdoms);
          lastMapFingerprint = fp;
        }
      } else {
        requestAnimationFrame(() => renderMap());
      }
    } else {
      activePlaceMarkers = payload.places || [];
      const label = chap ? `Places in ${chap}` : "Places in this chapter";
      if (els.mapSubtitle.textContent !== label) els.mapSubtitle.textContent = label;
      updateJourneyMapButtons();
    }
  }

  let lastPolledUrl = "";

  async function refreshFromBackground({ forceRescan = false } = {}) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url || "";
      const urlChanged = tabUrl && tabUrl !== lastPolledUrl;
      if (urlChanged) lastPolledUrl = tabUrl;

      if (tab?.id && (forceRescan || urlChanged)) {
        setStatus("Scanning…");
        chrome.tabs.sendMessage(tab.id, { type: "BIBLE_MAPS_RESCORE" }, () => {
          void chrome.runtime.lastError;
        });
      }

      const response = await chrome.runtime.sendMessage({
        type: "BIBLE_MAPS_GET_DETECTION",
        tabId: tab?.id,
      });
      if (response?.ok) applyPayload(response.payload);
      else if (forceRescan) setStatus(response?.error || "Could not read detection state.");
    } catch (err) {
      if (forceRescan) setStatus(String(err));
    }
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      const which = tab.dataset.tab;
      els.placesPanel.classList.toggle("active", which === "places");
      els.journeysPanel.classList.toggle("active", which === "journeys");
      els.placesPanel.hidden = which !== "places";
      els.journeysPanel.hidden = which !== "journeys";
      if (which && which !== activeTab) {
        activeTab = which;
        syncMapForActiveTab();
      }
    });
  });

  function currentTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "night" ? "night" : "day";
  }

  function applyTheme(theme, { persist = true } = {}) {
    const next = theme === "night" ? "night" : "day";
    document.documentElement.setAttribute("data-theme", next);
    const isNight = next === "night";
    if (els.themeBtn) {
      els.themeBtn.setAttribute("aria-pressed", isNight ? "true" : "false");
      els.themeBtn.title = isNight ? "Switch to day mode" : "Switch to night mode";
      els.themeBtn.setAttribute(
        "aria-label",
        isNight ? "Switch to day mode" : "Switch to night mode"
      );
      const icon = els.themeBtn.querySelector(".icon-btn-glyph");
      if (icon) icon.textContent = isNight ? "☀" : "☾";
    }
    if (!persist) return;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    try {
      chrome.storage?.local?.set?.({ [THEME_KEY]: next });
    } catch {
      /* ignore */
    }
  }

  window.addEventListener("online", () => renderMap({ forceRemount: true }));
  window.addEventListener("offline", () => renderMap({ forceRemount: true }));

  async function initTheme() {
    applyTheme(currentTheme(), { persist: false });
    try {
      const stored = await chrome.storage?.local?.get?.(THEME_KEY);
      const fromStore = stored?.[THEME_KEY];
      if (fromStore === "night" || fromStore === "day") {
        applyTheme(fromStore, { persist: false });
        try {
          localStorage.setItem(THEME_KEY, fromStore);
        } catch {
          /* ignore */
        }
        return;
      }
    } catch {
      /* ignore */
    }
    applyTheme(currentTheme(), { persist: true });
  }

  els.themeBtn?.addEventListener("click", () => {
    applyTheme(currentTheme() === "night" ? "day" : "night");
  });

  els.refreshBtn.addEventListener("click", () =>
    refreshFromBackground({ forceRescan: true })
  );

  els.kingdomsToggle?.addEventListener("change", () => {
    if (els.kingdomsToggle) els.kingdomsToggle.dataset.userTouched = "1";
    renderMap();
  });

  for (const btn of els.mapTypeButtons()) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.mapType;
      if (!next || next === basemapType) return;
      basemapType = next;
      syncBasemapPreferencesUi();
      persistBasemapPrefs();
      renderMap({ forceRemount: true });
    });
  }

  els.labelsToggle?.addEventListener("change", () => {
    basemapLabels = Boolean(els.labelsToggle?.checked);
    persistBasemapPrefs();
    renderMap({ forceRemount: true });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "BIBLE_MAPS_DETECTION_UPDATED") {
      applyPayload(message.payload);
    }
    if (message?.type === "BIBLE_MAPS_FOCUS_PLACE" && message.placeId) {
      focusPlaceFromClick(message.placeId);
    }
  });

  initTheme();
  loadBasemapPrefs();
  loadDockHeight();
  initDockGrabber();
  initMapNavControls();
  window.BiblicalTrainingLinks?.ensureSlugs?.();
  loadKingdoms();
  loadPresets();
  loadEraMap();
  loadAllPlaces();
  // Mount the always-visible map immediately (pins update when detection arrives).
  syncPlacesMapChrome([]);
  requestAnimationFrame(() => renderMap());
  refreshFromBackground({ forceRescan: true }).then(() => consumePendingFocus());
  setTimeout(() => refreshFromBackground({ forceRescan: true }), 500);
  setTimeout(() => refreshFromBackground({ forceRescan: true }), 1500);
  // Keep panel aligned if the tab SPA-navigates while the panel is open.
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    refreshFromBackground();
  }, 1500);
})();
