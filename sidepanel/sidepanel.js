/**
 * Bible Maps side panel — MapLibre + offline PMTiles basemap,
 * with optional online raster fill when the user is online and pans
 * outside (or past) the bundled extract.
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
    teachingMap: document.getElementById("teachingMap"),
    mapHelp: document.getElementById("mapHelp"),
    mapsLink: document.getElementById("mapsLink"),
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
  let pmtilesReady = null;
  let pmtilesProtocol = null;
  let pmtilesHeader = null;
  let mapMountGen = 0;
  let lastMapFingerprint = "";
  let lastMapPresetId = "";
  let lastPlacesFingerprint = "";
  let lastJourneysFingerprint = "";
  let openPlaceIds = new Set();
  let openJourneyIds = new Set();
  let focusedPlaceId = null;
  let styleCache = null;
  const PMTILES_KEY = "bible-region.pmtiles";
  /** Town context on click — closer than chapter overview, not street-level. */
  const PLACE_FOCUS_ZOOM = 10;
  /** Esri public canvas raster — world coverage when online; no API key. */
  const ONLINE_RASTER_SOURCE = "online-raster";
  const ONLINE_RASTER_LAYER = "online-basemap";
  const ONLINE_RASTER_ATTR =
    'Tiles © <a href="https://www.esri.com/">Esri</a> — Esri, TomTom, Garmin, FAO, NOAA, USGS';
  // Bundled PMTiles detail pockets (must stay in sync with scripts/build-pmtiles.sh).
  // Outside these, only shell z0–7 exists — overzoom looks soft for Acts 27 etc.
  const OFFLINE_DETAIL = {
    shellMaxZoom: 7,
    pockets: [
      { name: "core", west: 29, south: 24, east: 42, north: 36, maxZoom: 11 },
      { name: "east", west: 42.2, south: 27, east: 55, north: 38, maxZoom: 10 },
      // Acts 27–28 sea corridor (Malta, Crete, Cauda, Rhodes). Tight on purpose.
      // east < core.west (29) so pocket tests match the disjoint PMTiles merge.
      { name: "med", west: 14, south: 34, east: 28.82, north: 37.2, maxZoom: 10 },
    ],
  };

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

  function renderKingdomLegend() {
    if (!els.kingdomLegend) return;
    const feats = kingdomsGeoJson?.features || [];
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

  function routeOverlayPathForPreset(preset) {
    return preset?.routeOverlay || null;
  }

  function loadOverlay(relPath) {
    if (!relPath) {
      kingdomsGeoJson = null;
      kingdomsLoadedPath = null;
      renderKingdomLegend();
      return Promise.resolve(null);
    }
    if (overlayCache.has(relPath)) {
      kingdomsGeoJson = overlayCache.get(relPath);
      kingdomsLoadedPath = relPath;
      renderKingdomLegend();
      return Promise.resolve(kingdomsGeoJson);
    }
    return fetch(chrome.runtime.getURL(`data/${relPath}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${relPath} HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        overlayCache.set(relPath, data);
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
      const why = whyThisPinText(place);
      row.innerHTML = `
        <summary>
          <span class="acc-title">${escapeHtml(place.name)}</span>
          <span class="acc-aside">${escapeHtml(modern)}</span>
        </summary>
        <div class="acc-body">
          ${
            why
              ? `<p class="why-pin"><span class="why-pin-label">Why this pin</span>${escapeHtml(why)}</p>`
              : ""
          }
          <div class="actions">
            <a class="primary-btn" href="${googlePlaceUrl(place)}" target="_blank" rel="noopener">
              Open in Google Maps
            </a>
          </div>
        </div>
      `;
      row.addEventListener("toggle", () => {
        const id = row.dataset.placeId;
        if (!id) return;
        if (row.open) {
          openPlaceIds.add(id);
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
      const row = document.createElement("details");
      row.className = "acc-row";
      row.dataset.journeyId = journey.id || journey.name;
      if (openJourneyIds.has(row.dataset.journeyId)) row.open = true;
      const refs = (journey.scriptureRefs || []).join(" · ");
      const hitLabel =
        journey.hitCount != null
          ? `<span class="badge">${journey.hitCount}/${journey.stopCount}</span>`
          : "";
      row.innerHTML = `
        <summary>
          <span class="acc-title">${escapeHtml(journey.name)}${hitLabel}</span>
          <span class="acc-aside">${escapeHtml(refs)}</span>
        </summary>
        <div class="acc-body">
          ${
            journey.summary
              ? `<p class="notes">${escapeHtml(journey.summary)}</p>`
              : ""
          }
          <div class="actions">
            <button class="text-btn journey-map-btn" type="button" data-journey-id="${escapeAttr(journey.id)}">
              Show on map
            </button>
          </div>
        </div>
      `;
      row.addEventListener("toggle", () => {
        const id = row.dataset.journeyId;
        if (!id) return;
        if (row.open) openJourneyIds.add(id);
        else openJourneyIds.delete(id);
      });
      row.querySelector("button.journey-map-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        toggleJourneyOnMap(journey);
      });
      els.journeysPanel.appendChild(row);
    }
    updateJourneyMapButtons();
  }

  function updateJourneyMapButtons() {
    els.journeysPanel?.querySelectorAll("button.journey-map-btn").forEach((btn) => {
      const id = btn.getAttribute("data-journey-id");
      const shown = journeyOnMap && activeJourney?.id === id;
      btn.textContent = shown ? "Hide on map" : "Show on map";
      btn.classList.toggle("active-map", shown);
      btn.setAttribute("aria-pressed", shown ? "true" : "false");
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

  function showJourneyOnMap(journey) {
    if (!journey) return;
    activeJourney = journey;
    selectedJourneyId = journey.id || null;
    journeyOnMap = true;
    activePlaceMarkers = current?.places || [];
    els.mapTitle.textContent = journey.name;
    els.mapSubtitle.textContent = (journey.scriptureRefs || []).join(" · ");
    setJourneyMapsLink(visibleJourneyStops(journey));
    fillJourneyStopList(journey);
    updateJourneyMapButtons();
    requestAnimationFrame(() => renderMap());
  }

  function hideJourneyFromMap() {
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
    requestAnimationFrame(() => renderMap());
  }

  function toggleJourneyOnMap(journey) {
    if (!journey) return;
    if (journeyOnMap && activeJourney?.id === journey.id) {
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
    for (const f of kingdomsGeoJson.features) {
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
    const fromChapter = (current?.places || []).find((p) => p.id === placeId);
    if (fromChapter) return fromChapter;
    return (allPlaces || []).find((p) => p.id === placeId) || null;
  }

  function openPlaceAccordion(placeId, { scroll = false } = {}) {
    if (!placeId || !els.placesPanel) return null;
    openPlaceIds.add(placeId);
    const row = els.placesPanel.querySelector(
      `[data-place-id="${CSS.escape(placeId)}"]`
    );
    if (!row) return null;
    row.open = true;
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

  function easeMapToPlace(place, { animate = true } = {}) {
    if (!maplibreMap || !place) return false;
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return false;
    const camera = {
      center: [place.lng, place.lat],
      zoom: PLACE_FOCUS_ZOOM,
      duration: animate ? 750 : 0,
    };
    if (animate) maplibreMap.easeTo(camera);
    else maplibreMap.jumpTo({ center: camera.center, zoom: camera.zoom });
    return true;
  }

  async function focusPlaceFromClick(placeId) {
    if (!placeId) return;
    focusedPlaceId = placeId;
    showPlacesTab();
    await loadAllPlaces();

    let row = openPlaceAccordion(placeId, { scroll: true });
    if (!row) {
      // Places list may still be loading from detection.
      for (let i = 0; i < 8 && !row; i += 1) {
        await new Promise((r) => setTimeout(r, 150));
        row = openPlaceAccordion(placeId, { scroll: false });
      }
      if (row) openPlaceAccordion(placeId, { scroll: true });
    }

    const place = findPlaceById(placeId);
    if (!place) return;

    await renderMap();
    if (!maplibreMap) return;

    const fly = () => {
      easeMapToPlace(place, { animate: true });
      // Refresh markers so the focused pin gets the highlight class.
      const { focusPts } = chapterFocusPoints();
      clearMarkers();
      addDomMarkers(maplibreMap, focusPts, { dim: false });
      setPlacesMapsLink([place]);
      setMapHelp("", false);
    };
    if (typeof maplibreMap.isStyleLoaded === "function" && !maplibreMap.isStyleLoaded()) {
      maplibreMap.once("idle", fly);
    } else {
      requestAnimationFrame(fly);
    }
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
    return `${url}|${preset}|${jid}|${placeIds}|${routeIds}|kg:${kingdoms}|er:${eraRoute}|jm:${onMap}`;
  }

  function isOnline() {
    return typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  }

  function onlineRasterTilesUrl(theme = currentTheme()) {
    // Esri ArcGIS Online public canvas (no key). Note {z}/{y}/{x} order.
    const service =
      theme === "night"
        ? "Canvas/World_Dark_Gray_Base"
        : "Canvas/World_Light_Gray_Base";
    return `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  }

  function mapMaxZoom(header) {
    // Native tiles: shell z7 Spain→India + core z11 Levant/Egypt (+ meso z10).
    // Overzoom past native max for pin focus; online raster allows deeper zoom.
    const tileMax = Number(header?.maxZoom);
    const base = Number.isFinite(tileMax) ? tileMax : 11;
    const offlineCap = Math.min(14, Math.max(12, base + 2));
    return isOnline() ? Math.max(offlineCap, 16) : offlineCap;
  }

  function fitMaxZoom(header) {
    const tileMax = Number(header?.maxZoom);
    return Number.isFinite(tileMax) ? tileMax : 11;
  }

  function fitToChapter(map, preset, focusPts, header) {
    const maxZoom = fitMaxZoom(header);
    if (focusPts.length) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of focusPts) bounds.extend([p.lng, p.lat]);
      // Single town → zoom in close; many stops → still allow town-level.
      const oneStop = focusPts.length === 1 ? Math.min(13, maxZoom + 1) : maxZoom;
      map.fitBounds(bounds, {
        padding: focusPts.length === 1 ? 60 : 40,
        maxZoom: oneStop,
        duration: 0,
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
        { padding: 28, maxZoom: Math.min(8, maxZoom), duration: 0 }
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
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.28],
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
    if (focused && easeMapToPlace(focused, { animate: false })) {
      setPlacesMapsLink([focused]);
      setMapHelp("", false);
    } else {
      fitToChapter(map, preset, focusPts, pmtilesHeader);
      setMapHelp("", false);
    }
    map.resize();
  }

  async function waitForMapSize(el) {
    for (let i = 0; i < 40; i += 1) {
      if (el && el.clientWidth > 40 && el.clientHeight > 40) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return Boolean(el && el.clientWidth > 0);
  }

  /** In-memory PMTiles source — avoids chrome-extension:// Range and File quirks. */
  function bufferSource(key, buffer) {
    return {
      getKey() {
        return key;
      },
      async getBytes(offset, length) {
        return { data: buffer.slice(offset, offset + length) };
      },
    };
  }

  function ensurePmtiles() {
    if (pmtilesReady) return pmtilesReady;
    pmtilesReady = (async () => {
      if (typeof maplibregl === "undefined") {
        throw new Error("MapLibre failed to load");
      }
      if (typeof pmtiles === "undefined") {
        throw new Error("PMTiles library failed to load");
      }
      maplibregl.setWorkerUrl(
        chrome.runtime.getURL("lib/maplibre/maplibre-gl-csp-worker.js")
      );

      // Load full archive into memory (extension URLs often lack HTTP Range).
      // Keep ≤~70 MB: a uniform z10 of the old bbox was ~93 MB and OOM'd the panel.
      // Coverage uses a merged shell+core+east extract (see scripts/build-pmtiles.sh).
      const tileUrl = chrome.runtime.getURL(`media/tiles/${PMTILES_KEY}`);
      let ab;
      try {
        const r = await fetch(tileUrl);
        if (!r.ok) throw new Error(`PMTiles HTTP ${r.status}`);
        ab = await r.arrayBuffer();
      } catch (err) {
        const msg = err?.message || String(err);
        if (/arraybuffer|memory|allocation|oom/i.test(msg)) {
          throw new Error(
            "PMTiles archive too large for the side panel — rebuild with a smaller maxzoom"
          );
        }
        throw err;
      }
      if (!ab || ab.byteLength < 1000) {
        throw new Error("PMTiles archive missing or empty");
      }
      if (ab.byteLength > 85 * 1024 * 1024) {
        console.warn(
          "Bible Maps: PMTiles archive is",
          Math.round(ab.byteLength / 1e6),
          "MB — side panel may crash; prefer ≤80 MB"
        );
      }

      try {
        maplibregl.removeProtocol("pmtiles");
      } catch {
        /* first run */
      }
      pmtilesProtocol = new pmtiles.Protocol();
      // MapLibre 5 prefers the async tilev4 handler when present.
      const loadFn = pmtilesProtocol.tilev4 || pmtilesProtocol.tile;
      maplibregl.addProtocol("pmtiles", loadFn);

      const archive = new pmtiles.PMTiles(bufferSource(PMTILES_KEY, ab));
      pmtilesProtocol.add(archive);

      // Sanity-check: header must parse
      const header = await archive.getHeader();
      if (header.maxZoom == null) throw new Error("PMTiles header invalid");
      pmtilesHeader = header;
      return header;
    })().catch((err) => {
      pmtilesReady = null;
      pmtilesProtocol = null;
      throw err;
    });
    return pmtilesReady;
  }

  function buildOfflineStyle(baseStyle, header) {
    const style = JSON.parse(JSON.stringify(baseStyle));
    // Use explicit tile template so MapLibre does not invent a FetchSource
    // for a bare relative "bible-region.pmtiles" URL if lookup misses.
    style.sources = {
      protomaps: {
        type: "vector",
        tiles: [`pmtiles://${PMTILES_KEY}/{z}/{x}/{y}`],
        minzoom: header?.minZoom ?? 0,
        maxzoom: header?.maxZoom ?? 11,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    };

    // Online world raster under the vector extract: fills gaps when the user
    // pans outside the bundled bbox (or wants more context) while online.
    // Offline stays vector-only — no remote tile requests.
    if (isOnline()) {
      style.sources[ONLINE_RASTER_SOURCE] = {
        type: "raster",
        tiles: [onlineRasterTilesUrl()],
        tileSize: 256,
        maxzoom: 16,
        attribution: ONLINE_RASTER_ATTR,
      };
      const layers = Array.isArray(style.layers) ? style.layers : [];
      const bgIdx = layers.findIndex((l) => l.id === "background");
      const onlineLayer = {
        id: ONLINE_RASTER_LAYER,
        type: "raster",
        source: ONLINE_RASTER_SOURCE,
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1 },
      };
      if (bgIdx >= 0) layers.splice(bgIdx + 1, 0, onlineLayer);
      else layers.unshift(onlineLayer);
      style.layers = layers;
    }
    return style;
  }

  function offlineExtractBounds(header = pmtilesHeader) {
    if (!header) return null;
    const west = Number(header.minLon);
    const south = Number(header.minLat);
    const east = Number(header.maxLon);
    const north = Number(header.maxLat);
    if (![west, south, east, north].every(Number.isFinite)) return null;
    return { west, south, east, north };
  }

  function offlineDetailMaxZoomAt(lng, lat) {
    for (const p of OFFLINE_DETAIL.pockets) {
      if (
        lng >= p.west &&
        lng <= p.east &&
        lat >= p.south &&
        lat <= p.north
      ) {
        return p.maxZoom;
      }
    }
    return OFFLINE_DETAIL.shellMaxZoom;
  }

  /**
   * True when the viewport sticks out past the bundled PMTiles bbox, or when
   * the user has zoomed past native detail for this pocket (e.g. Crete/Cauda
   * before the med extract lands, or Italy past z10).
   */
  function viewNeedsOnlineFill(map, header = pmtilesHeader) {
    if (!isOnline() || !map || typeof map.getBounds !== "function") return false;
    const box = offlineExtractBounds(header);
    if (!box) return isOnline();
    const b = map.getBounds();
    const pad = 0.15; // small pad so edge pans still get fill
    if (
      b.getWest() < box.west - pad ||
      b.getEast() > box.east + pad ||
      b.getSouth() < box.south - pad ||
      b.getNorth() > box.north + pad
    ) {
      return true;
    }
    const z = map.getZoom?.() ?? 0;
    const c = map.getCenter?.();
    if (!c || !Number.isFinite(c.lng) || !Number.isFinite(c.lat)) return false;
    const native = offlineDetailMaxZoomAt(c.lng, c.lat);
    // Slight hysteresis so brief zooms don't flicker the raster underlay.
    return z > native + 0.35;
  }

  function updateOnlineRasterVisibility(map = maplibreMap) {
    if (!map?.getLayer?.(ONLINE_RASTER_LAYER)) return;
    const show = viewNeedsOnlineFill(map);
    try {
      map.setLayoutProperty(
        ONLINE_RASTER_LAYER,
        "visibility",
        show ? "visible" : "none"
      );
    } catch {
      /* ignore */
    }
  }

  function syncOnlineRasterLayer(map = maplibreMap) {
    if (!map || typeof map.getSource !== "function") return;
    const want = isOnline();
    const hasSource = Boolean(map.getSource(ONLINE_RASTER_SOURCE));
    const hasLayer = Boolean(map.getLayer?.(ONLINE_RASTER_LAYER));

    if (!want) {
      try {
        if (hasLayer) map.removeLayer(ONLINE_RASTER_LAYER);
        if (hasSource) map.removeSource(ONLINE_RASTER_SOURCE);
      } catch {
        /* ignore */
      }
      return;
    }

    const tiles = [onlineRasterTilesUrl()];
    if (!hasSource) {
      try {
        map.addSource(ONLINE_RASTER_SOURCE, {
          type: "raster",
          tiles,
          tileSize: 256,
          maxzoom: 16,
          attribution: ONLINE_RASTER_ATTR,
        });
      } catch (err) {
        console.warn("Bible Maps: could not add online raster source", err);
        return;
      }
    } else {
      // Swap light/dark tiles on theme change by recreating the source.
      try {
        if (hasLayer) map.removeLayer(ONLINE_RASTER_LAYER);
        map.removeSource(ONLINE_RASTER_SOURCE);
        map.addSource(ONLINE_RASTER_SOURCE, {
          type: "raster",
          tiles,
          tileSize: 256,
          maxzoom: 16,
          attribution: ONLINE_RASTER_ATTR,
        });
      } catch (err) {
        console.warn("Bible Maps: could not refresh online raster source", err);
        return;
      }
    }

    if (!map.getLayer?.(ONLINE_RASTER_LAYER)) {
      try {
        const beforeId = map.getLayer("earth") ? "earth" : undefined;
        map.addLayer(
          {
            id: ONLINE_RASTER_LAYER,
            type: "raster",
            source: ONLINE_RASTER_SOURCE,
            layout: { visibility: "none" },
            paint: { "raster-opacity": 1 },
          },
          beforeId
        );
      } catch (err) {
        console.warn("Bible Maps: could not add online raster layer", err);
      }
    }
    updateOnlineRasterVisibility(map);
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
      if (els.referencePlateNote) {
        els.referencePlateNote.textContent =
          "No bundled plate for this era — the interactive map above is the basemap.";
      }
      return;
    }
    els.referencePlateImg.src = chrome.runtime.getURL(`media/historical/${file}`);
    els.referencePlateImg.alt = preset.title || "Reference atlas plate";
    els.referencePlateImg.hidden = false;
    if (els.referencePlateNote) {
      els.referencePlateNote.textContent =
        "Static reference art (not georeferenced). Pins use gazetteer coordinates on the MapLibre basemap.";
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
    const [, , , header] = await Promise.all([
      loadPresets(),
      loadEraMap(),
      loadKingdoms(),
      ensurePmtiles(),
    ]);
    if (gen !== mapMountGen) return;
    await waitForMapSize(els.teachingMap);
    if (gen !== mapMountGen) return;

    const preset = resolvePreset();
    const overlayRel = overlayPathForPreset(preset);
    if (overlayRel !== kingdomsLoadedPath) {
      await loadOverlay(overlayRel);
      if (gen !== mapMountGen) return;
    }
    const routeOverlayRel = routeOverlayPathForPreset(preset);
    if (routeOverlayRel !== routeOverlayLoadedPath) {
      await loadRouteOverlay(routeOverlayRel);
      if (gen !== mapMountGen) return;
    }
    const basemapName = preset?.basemap || "levant";
    const allowKingdoms =
      Boolean(preset?.showKingdoms) &&
      basemapName === "levant" &&
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
    if (els.mapToolbar) {
      els.mapToolbar.hidden = !allowKingdoms;
    }
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
        maplibreMap.resize();
        return;
      }
      updateMapOverlays(maplibreMap, preset, showKingdoms);
      lastMapFingerprint = fp;
      return;
    }

    destroyMap();
    if (gen !== mapMountGen) return;

    if (!styleCache) {
      styleCache = await fetch(chrome.runtime.getURL("media/tiles/style.json")).then(
        (r) => {
          if (!r.ok) throw new Error(`style.json HTTP ${r.status}`);
          return r.json();
        }
      );
    }
    if (gen !== mapMountGen) return;

    const style = buildOfflineStyle(styleCache, header);
    const map = new maplibregl.Map({
      container: els.teachingMap,
      style,
      center: [35.1, 31.7],
      zoom: 6.5,
      maxZoom: mapMaxZoom(header),
      attributionControl: true,
      failIfMajorPerformanceCaveat: false,
    });
    maplibreMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
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
    syncOnlineRasterLayer(map);
    map.on("moveend", () => updateOnlineRasterVisibility(map));
    map.on("zoomend", () => updateOnlineRasterVisibility(map));
    lastMapFingerprint = fp;
    lastMapPresetId = presetId;

    map.resize();
    setTimeout(() => {
      if (maplibreMap === map) map.resize();
    }, 80);
    setTimeout(() => {
      if (maplibreMap === map) map.resize();
    }, 250);
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
  function setPlacesMapsLink(pts) {
    if (pts.length === 1) {
      els.mapsLink.href = googlePlaceUrl(pts[0]);
      els.mapsLink.textContent = "Open in Google Maps";
    } else {
      els.mapsLink.href = "https://www.google.com/maps/@31.7,35.1,8z";
      els.mapsLink.textContent = "Open region in Google Maps";
    }
    delete els.mapsLink.dataset.polyline;
  }

  /** Journey stops: walking directions (+ shift-click polyline search). */
  function setJourneyMapsLink(stops) {
    if (stops.length === 1) {
      els.mapsLink.href = googlePlaceUrl(stops[0]);
      els.mapsLink.textContent = "Open in Google Maps";
      delete els.mapsLink.dataset.polyline;
    } else if (stops.length > 1) {
      els.mapsLink.href = googleJourneyUrl(stops);
      els.mapsLink.textContent = "Open in Google Maps (walking)";
      els.mapsLink.dataset.polyline = googlePolylineSearchUrl(stops);
    } else {
      els.mapsLink.href = "https://www.google.com/maps/@31.7,35.1,8z";
      els.mapsLink.textContent = "Open region in Google Maps";
      delete els.mapsLink.dataset.polyline;
    }
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
      else focusedPlaceId = null;
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
      requestAnimationFrame(() => renderMap());
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
    syncOnlineRasterLayer(maplibreMap);
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

  window.addEventListener("online", () => syncOnlineRasterLayer(maplibreMap));
  window.addEventListener("offline", () => syncOnlineRasterLayer(maplibreMap));

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

  els.mapsLink.addEventListener("click", (e) => {
    if (els.mapsLink.getAttribute("href") === "#") {
      e.preventDefault();
      return;
    }
    // Shift-click polyline search only applies to journey walking links.
    if (e.shiftKey && els.mapsLink.dataset.polyline) {
      e.preventDefault();
      window.open(els.mapsLink.dataset.polyline, "_blank", "noopener");
    }
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
