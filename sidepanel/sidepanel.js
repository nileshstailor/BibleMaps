/**
 * Bible Maps side panel — MapLibre + offline PMTiles basemap.
 */
(() => {
  // CSP build ships with empty WORKER_URL; without this, Worker("") loads
  // sidepanel.html and throws: Unexpected token '<'
  if (typeof maplibregl !== "undefined" && typeof maplibregl.setWorkerUrl === "function") {
    maplibregl.setWorkerUrl(
      chrome.runtime.getURL("lib/maplibre/maplibre-gl-csp-worker.js")
    );
  }

  const els = {
    status: document.getElementById("status"),
    placesPanel: document.getElementById("placesPanel"),
    journeysPanel: document.getElementById("journeysPanel"),
    refreshBtn: document.getElementById("refreshBtn"),
    mapDock: document.getElementById("mapDock"),
    mapTitle: document.getElementById("mapTitle"),
    mapSubtitle: document.getElementById("mapSubtitle"),
    closeMapBtn: document.getElementById("closeMapBtn"),
    presetSelect: document.getElementById("presetSelect"),
    kingdomsToggle: document.getElementById("kingdomsToggle"),
    kingdomsToggleWrap: document.getElementById("kingdomsToggleWrap"),
    kingdomLegend: document.getElementById("kingdomLegend"),
    teachingMap: document.getElementById("teachingMap"),
    mapHelp: document.getElementById("mapHelp"),
    mapsLink: document.getElementById("mapsLink"),
    stopList: document.getElementById("stopList"),
    referencePlate: document.getElementById("referencePlate"),
    referencePlateImg: document.getElementById("referencePlateImg"),
    referencePlateNote: document.getElementById("referencePlateNote"),
  };

  let current = null;
  let activeJourney = null;
  let activePlaceMarkers = [];
  let allPlaces = null;
  let placesLoadPromise = null;
  let kingdomsGeoJson = null;
  let kingdomsLoadPromise = null;
  let presetsCatalog = null;
  let presetsLoadPromise = null;
  let maplibreMap = null;
  let markerObjs = [];
  let pmtilesReady = null;

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
    els.mapHelp.textContent = text;
    els.mapHelp.style.color = isError ? "#a63024" : "";
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

  function loadKingdoms() {
    if (kingdomsGeoJson) return Promise.resolve(kingdomsGeoJson);
    if (kingdomsLoadPromise) return kingdomsLoadPromise;
    kingdomsLoadPromise = fetch(chrome.runtime.getURL("data/kingdoms.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`kingdoms.json HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        kingdomsGeoJson = data;
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: kingdoms failed to load", err);
        kingdomsLoadPromise = null;
        return null;
      });
    return kingdomsLoadPromise;
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
        populatePresetSelect();
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: presets failed", err);
        presetsLoadPromise = null;
        return null;
      });
    return presetsLoadPromise;
  }

  function populatePresetSelect() {
    if (!els.presetSelect || !presetsCatalog?.presets) return;
    const currentVal = els.presetSelect.value;
    els.presetSelect.innerHTML = "";
    for (const m of presetsCatalog.presets) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.title}${m.era ? ` — ${m.era}` : ""}`;
      els.presetSelect.appendChild(opt);
    }
    if ([...els.presetSelect.options].some((o) => o.value === currentVal)) {
      els.presetSelect.value = currentVal;
    }
  }

  function getPreset(id) {
    return presetsCatalog?.presets?.find((p) => p.id === id) || null;
  }

  function suggestPresetId() {
    const jid = activeJourney?.id || "";
    if (jid === "paul_first") return "paul_first";
    if (jid === "paul_second") return "paul_second";
    if (jid === "paul_third") return "paul_third";
    if (jid === "paul_rome") return "paul_rome";
    if (jid === "abraham_travels") return "abraham";
    if (jid === "exodus_outline") return "exodus";
    if (jid === "jeroboam_wife_shiloh") return "divided_kingdom";
    const places = activePlaceMarkers || [];
    const gospelHits = places.filter((p) => (p.eras || []).includes("gospels")).length;
    if (gospelHits >= 2 && gospelHits >= places.length / 2) return "jesus";
    return "divided_kingdom";
  }

  function renderPlaces(places) {
    els.placesPanel.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "actions";
    toolbar.style.marginBottom = "4px";
    const mapBtn = document.createElement("button");
    mapBtn.type = "button";
    mapBtn.className = "text-btn";
    mapBtn.textContent = "Open map";
    mapBtn.addEventListener("click", () => openPlacesMap(places || []));
    toolbar.appendChild(mapBtn);
    els.placesPanel.appendChild(toolbar);

    if (!places?.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        "No gazetteer places matched yet. You can still open the regional map.";
      els.placesPanel.appendChild(empty);
      return;
    }
    for (const place of places) {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <h3>${escapeHtml(place.name)}</h3>
        <p class="meta">${escapeHtml(place.modernName || "")}</p>
        <p class="notes">${escapeHtml(place.eraNotes || "")}</p>
        <div class="actions">
          <a class="primary-btn" href="${googlePlaceUrl(place)}" target="_blank" rel="noopener">
            Open in Google Maps
          </a>
        </div>
      `;
      els.placesPanel.appendChild(card);
    }
  }

  function renderJourneys(journeys) {
    els.journeysPanel.innerHTML = "";
    if (!journeys?.length) {
      els.journeysPanel.innerHTML =
        '<p class="empty">No journey patterns detected. Open the map from Places.</p>';
      return;
    }
    for (const journey of journeys) {
      const card = document.createElement("article");
      card.className = "card";
      const refs = (journey.scriptureRefs || []).join(" · ");
      const hitLabel =
        journey.hitCount != null
          ? `<span class="badge">${journey.hitCount}/${journey.stopCount} stops mentioned</span>`
          : "";
      card.innerHTML = `
        <h3>${escapeHtml(journey.name)}${hitLabel}</h3>
        <p class="meta">${escapeHtml(refs)}</p>
        <p class="notes">${escapeHtml(journey.summary || "")}</p>
        <div class="actions">
          <button class="text-btn" type="button" data-journey-id="${escapeAttr(journey.id)}">
            Open map
          </button>
        </div>
      `;
      card.querySelector("button")?.addEventListener("click", () => openJourney(journey));
      els.journeysPanel.appendChild(card);
    }
  }

  function collectRoutePoints() {
    const stops = activeJourney?.stops || [];
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

  function destroyMap() {
    clearMarkers();
    if (maplibreMap) {
      try {
        maplibreMap.remove();
      } catch {
        /* ignore */
      }
    }
    maplibreMap = null;
    if (els.teachingMap) els.teachingMap.innerHTML = "";
  }

  async function waitForMapSize(el) {
    for (let i = 0; i < 40; i += 1) {
      if (el && el.clientWidth > 40 && el.clientHeight > 40) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return Boolean(el && el.clientWidth > 0);
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
      maplibregl.workerUrl = chrome.runtime.getURL(
        "lib/maplibre/maplibre-gl-csp-worker.js"
      );
      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);

      // Load full archive into memory so chrome-extension:// Range is not required.
      const tileUrl = chrome.runtime.getURL("media/tiles/bible-region.pmtiles");
      const ab = await fetch(tileUrl).then((r) => {
        if (!r.ok) throw new Error(`PMTiles HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      const file = new File([ab], "bible-region.pmtiles", {
        type: "application/octet-stream",
      });
      const archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
      protocol.add(archive);
      return true;
    })().catch((err) => {
      pmtilesReady = null;
      throw err;
    });
    return pmtilesReady;
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

  function routeToGeoJSON(stops) {
    const coords = (stops || [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => [s.lng, s.lat]);
    if (coords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    };
  }

  function addDomMarkers(map, points, { dim }) {
    for (const p of points || []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const el = document.createElement("div");
      el.className = dim ? "bm-marker bm-marker-dim" : "bm-marker";
      el.innerHTML = `<span class="bm-marker-dot"></span><span class="bm-marker-label">${escapeHtml(
        p.name || "Place"
      )}</span>`;
      el.title = p.modernName || p.note || p.name || "";
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      markerObjs.push(marker);
    }
  }

  async function mountTeachingMap() {
    if (typeof maplibregl === "undefined") throw new Error("MapLibre failed to load");
    if (!els.teachingMap) throw new Error("Map container missing");

    await Promise.all([loadPresets(), loadAllPlaces(), loadKingdoms(), ensurePmtiles()]);
    await waitForMapSize(els.teachingMap);

    if (els.presetSelect && !els.presetSelect.dataset.userTouched) {
      const suggested = suggestPresetId();
      if ([...els.presetSelect.options].some((o) => o.value === suggested)) {
        els.presetSelect.value = suggested;
      }
    }

    const preset = getPreset(els.presetSelect?.value) || getPreset("divided_kingdom");
    const basemapName = preset?.basemap || "levant";

    if (els.kingdomsToggleWrap) {
      const allowKingdoms = basemapName === "levant";
      els.kingdomsToggleWrap.hidden = !allowKingdoms;
      if (!allowKingdoms && els.kingdomsToggle) {
        els.kingdomsToggle.checked = false;
      } else if (
        allowKingdoms &&
        els.kingdomsToggle &&
        !els.kingdomsToggle.dataset.userTouched &&
        preset?.showKingdoms
      ) {
        els.kingdomsToggle.checked = true;
      }
    }
    const showKingdoms =
      Boolean(els.kingdomsToggle?.checked) && basemapName === "levant";
    if (els.kingdomLegend) els.kingdomLegend.hidden = !showKingdoms;

    destroyMap();
    updateReferencePlate(preset);

    const style = await fetch(chrome.runtime.getURL("media/tiles/style.json")).then(
      (r) => {
        if (!r.ok) throw new Error(`style.json HTTP ${r.status}`);
        return r.json();
      }
    );

    const map = new maplibregl.Map({
      container: els.teachingMap,
      style,
      center: [35.1, 31.7],
      zoom: 6.5,
      maxZoom: 8,
      attributionControl: true,
    });
    maplibreMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

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

    const matched = Array.isArray(activePlaceMarkers) ? activePlaceMarkers : [];
    const gazetteer = Array.isArray(allPlaces) ? allPlaces : [];
    const routePts = collectRoutePoints();
    const focusIds = new Set([
      ...routePts.map((p) => p.placeId || p.id).filter(Boolean),
      ...matched.map((p) => p.id).filter(Boolean),
    ]);

    const periodPlaces = filterPeriodPlaces(
      gazetteer,
      preset?.placeEras || ["divided"],
      [...focusIds]
    ).map((p) => ({
      ...p,
      ...(matched.find((a) => a.id === p.id) || {}),
    }));

    const highlightIds = new Set([
      ...routePts.map((p) => p.placeId || p.id).filter(Boolean),
      ...matched.map((p) => p.id).filter(Boolean),
    ]);
    const contextPts = periodPlaces.filter((p) => !highlightIds.has(p.id));
    const highlightPts = periodPlaces.filter((p) => highlightIds.has(p.id));
    for (const s of routePts) {
      if (
        !highlightPts.some(
          (h) => h.placeId === s.placeId || h.id === s.placeId || h.name === s.name
        )
      ) {
        highlightPts.push(s);
      }
    }
    const focusPts = highlightPts.length ? highlightPts : periodPlaces.slice(0, 40);

    if (showKingdoms && kingdomsGeoJson?.features) {
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
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#4a6741"],
          "line-width": 1.5,
        },
      });
    }

    map.addSource("route", {
      type: "geojson",
      data: routeToGeoJSON(routePts),
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#a63024",
        "line-width": 3,
        "line-dasharray": [2, 1.5],
      },
    });

    // Circle layers as backup; DOM markers carry readable labels.
    map.addSource("towns-dim", {
      type: "geojson",
      data: placesToGeoJSON(contextPts, { dim: true }),
    });
    map.addSource("towns-focus", {
      type: "geojson",
      data: placesToGeoJSON(focusPts, { dim: false }),
    });
    map.addLayer({
      id: "towns-dim-circle",
      type: "circle",
      source: "towns-dim",
      paint: {
        "circle-radius": 4,
        "circle-color": "#8a7a60",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#2c2416",
        "circle-opacity": 0.65,
      },
    });
    map.addLayer({
      id: "towns-focus-circle",
      type: "circle",
      source: "towns-focus",
      paint: {
        "circle-radius": 7,
        "circle-color": "#a63024",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#2c2416",
      },
    });

    addDomMarkers(map, contextPts.slice(0, 25), { dim: true });
    addDomMarkers(map, focusPts, { dim: false });

    if (preset?.bounds?.length === 2) {
      const [[south, west], [north, east]] = preset.bounds;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 28, maxZoom: 8, duration: 0 }
      );
    } else if (focusPts.length) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of focusPts) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 40, maxZoom: 8, duration: 0 });
    }

    map.resize();
    setTimeout(() => map.resize(), 80);
    setTimeout(() => map.resize(), 250);

    const townCount = contextPts.length + focusPts.length;
    setMapHelp(
      `${preset?.title || "Map"} — offline MapLibre / OSM (${townCount} period town${
        townCount === 1 ? "" : "s"
      }).`,
      false
    );
  }

  async function renderMap() {
    try {
      await mountTeachingMap();
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

  function setMapsLinkFromPoints(pts) {
    if (pts.length === 1) {
      els.mapsLink.href = googlePlaceUrl(pts[0]);
      els.mapsLink.textContent = "Open in Google Maps";
      delete els.mapsLink.dataset.polyline;
    } else if (pts.length > 1) {
      els.mapsLink.href = googleJourneyUrl(pts);
      els.mapsLink.textContent = "Open in Google Maps (walking)";
      els.mapsLink.dataset.polyline = googlePolylineSearchUrl(pts);
    } else {
      els.mapsLink.href = "https://www.google.com/maps/@31.7,35.1,8z";
      els.mapsLink.textContent = "Open region in Google Maps";
      delete els.mapsLink.dataset.polyline;
    }
  }

  function openPlacesMap(places) {
    activeJourney = null;
    activePlaceMarkers = places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = "Map";
    els.mapSubtitle.textContent = "Offline MapLibre basemap + period towns";
    setMapsLinkFromPoints(places || []);
    els.stopList.innerHTML = "";
    if (places?.length) {
      places.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = `${p.name}${p.modernName ? ` — ${p.modernName}` : ""}`;
        els.stopList.appendChild(li);
      });
    }
    if (els.presetSelect) delete els.presetSelect.dataset.userTouched;
    requestAnimationFrame(() => renderMap());
  }

  function openJourney(journey) {
    activeJourney = journey;
    activePlaceMarkers = current?.places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = journey.name;
    els.mapSubtitle.textContent = (journey.scriptureRefs || []).join(" · ");

    const stops = journey.stops || [];
    setMapsLinkFromPoints(stops);

    els.stopList.innerHTML = "";
    stops.forEach((stop) => {
      const li = document.createElement("li");
      li.textContent = `${stop.name}${stop.note ? ` — ${stop.note}` : ""}`;
      if (journey.hitPlaceIds?.includes(stop.placeId)) li.style.fontWeight = "600";
      li.title = stop.modernName || "";
      els.stopList.appendChild(li);
    });

    if (els.presetSelect) delete els.presetSelect.dataset.userTouched;
    requestAnimationFrame(() => renderMap());
  }

  function applyPayload(payload) {
    current = payload;
    if (!payload) {
      setStatus("Open a bible.com passage, then click Refresh.");
      renderPlaces([]);
      renderJourneys([]);
      return;
    }
    const placeCount = payload.places?.length || 0;
    const journeyCount = payload.journeys?.length || 0;
    setStatus(
      `Found ${placeCount} place${placeCount === 1 ? "" : "s"} and ${journeyCount} journey${
        journeyCount === 1 ? "" : "s"
      }.`
    );
    activePlaceMarkers = payload.places || [];
    renderPlaces(payload.places || []);
    renderJourneys(payload.journeys || []);
  }

  async function refreshFromBackground() {
    setStatus("Scanning…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "BIBLE_MAPS_RESCORE" }, () => {
          void chrome.runtime.lastError;
        });
      }
      const response = await chrome.runtime.sendMessage({
        type: "BIBLE_MAPS_GET_DETECTION",
        tabId: tab?.id,
      });
      if (response?.ok) applyPayload(response.payload);
      else setStatus(response?.error || "Could not read detection state.");
    } catch (err) {
      setStatus(String(err));
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
    });
  });

  els.refreshBtn.addEventListener("click", refreshFromBackground);
  els.closeMapBtn.addEventListener("click", () => {
    els.mapDock.hidden = true;
    activeJourney = null;
    destroyMap();
  });

  els.kingdomsToggle?.addEventListener("change", () => {
    if (els.kingdomsToggle) els.kingdomsToggle.dataset.userTouched = "1";
    if (!els.mapDock.hidden) renderMap();
  });
  els.presetSelect?.addEventListener("change", () => {
    if (els.presetSelect) els.presetSelect.dataset.userTouched = "1";
    if (!els.mapDock.hidden) renderMap();
  });

  els.mapsLink.addEventListener("click", (e) => {
    if (els.mapsLink.getAttribute("href") === "#") {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && els.mapsLink.dataset.polyline) {
      e.preventDefault();
      window.open(els.mapsLink.dataset.polyline, "_blank", "noopener");
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "BIBLE_MAPS_DETECTION_UPDATED") {
      applyPayload(message.payload);
    }
  });

  loadKingdoms();
  loadPresets();
  loadAllPlaces();
  refreshFromBackground();
  setTimeout(refreshFromBackground, 500);
  setTimeout(refreshFromBackground, 1500);
})();
