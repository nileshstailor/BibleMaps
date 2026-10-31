/**
 * Bible Maps side panel — offline teaching map (no live tiles).
 */
(() => {
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
  const basemapCache = {};
  let leafletMap = null;

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

  function loadBasemap(name) {
    const key = name || "levant";
    if (basemapCache[key]) return Promise.resolve(basemapCache[key]);
    const file =
      key === "mediterranean"
        ? "coast-mediterranean.geojson"
        : key === "near-east"
          ? "coast-near-east.geojson"
          : "coast-levant.geojson";
    return fetch(chrome.runtime.getURL(`data/${file}`))
      .then((r) => {
        if (!r.ok) throw new Error(`${file} HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data?.features?.length) throw new Error(`${file} empty`);
        basemapCache[key] = data;
        return data;
      });
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
    // Gospel-heavy page?
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
        "No gazetteer places matched yet. You can still open the regional teaching map.";
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

  function destroyLeaflet() {
    if (leafletMap) {
      try {
        leafletMap.remove();
      } catch {
        /* ignore */
      }
    }
    leafletMap = null;
    if (els.teachingMap) {
      els.teachingMap._leaflet_id = null;
      els.teachingMap.innerHTML = "";
    }
  }

  function kingdomStyle(feature) {
    const p = feature.properties || {};
    return {
      color: p.color || "#4a6741",
      weight: 1.5,
      opacity: 0.95,
      fillColor: p.color || "#4a6741",
      fillOpacity: p.fillOpacity != null ? p.fillOpacity : 0.28,
    };
  }

  function basemapStyle(feature) {
    const kind = feature.properties?.kind;
    if (kind === "water") {
      return {
        color: "#5f7f92",
        weight: 1,
        fillColor: "#8eacc0",
        fillOpacity: 0.95,
      };
    }
    return {
      color: "#6e5a38",
      weight: 1.25,
      fillColor: "#dfc892",
      fillOpacity: 1,
    };
  }

  function addNamedMarkers(layerGroup, points, { drawRoute, dim }) {
    const bounds = [];
    const pts = (points || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (drawRoute && pts.length > 1) {
      const line = L.polyline(
        pts.map((p) => [p.lat, p.lng]),
        { color: "#a63024", weight: 3, dashArray: "7 5" }
      ).addTo(layerGroup);
      bounds.push(line.getBounds());
    }
    pts.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: dim ? 4 : 7,
        color: "#2c2416",
        weight: 1,
        fillColor: dim ? "#8a7a60" : i === 0 && drawRoute ? "#4a6741" : "#a63024",
        fillOpacity: dim ? 0.55 : 0.95,
      }).addTo(layerGroup);
      const label = escapeHtml(p.name || "Place");
      const detail = escapeHtml(p.note || p.modernName || "");
      if (!dim) {
        m.bindTooltip(label, {
          permanent: true,
          direction: "top",
          offset: [0, -8],
          className: "bm-pin-label",
          opacity: 0.96,
        });
      } else {
        m.bindTooltip(label, { direction: "top", opacity: 0.9 });
      }
      m.bindPopup(`<strong>${label}</strong>${detail ? `<br/>${detail}` : ""}`);
      bounds.push(L.latLngBounds([p.lat - 0.12, p.lng - 0.12], [p.lat + 0.12, p.lng + 0.12]));
    });
    return bounds;
  }

  async function waitForMapSize(el) {
    for (let i = 0; i < 40; i += 1) {
      if (el && el.clientWidth > 40 && el.clientHeight > 40) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return Boolean(el && el.clientWidth > 0);
  }

  /** Tiny inline fallback if GeoJSON fetch fails. */
  function fallbackBasemap(name) {
    if (name === "mediterranean" || name === "near-east") {
      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "land", name: "Land" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [10, 30],
                  [42, 30],
                  [42, 45],
                  [10, 45],
                  [10, 30],
                ],
              ],
            },
          },
        ],
      };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "land", name: "Canaan" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [34.2, 29.6],
                [35.9, 29.6],
                [36.1, 33.5],
                [34.3, 33.5],
                [34.2, 29.6],
              ],
            ],
          },
        },
      ],
    };
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
          "No bundled plate for this era — the interactive map above is the teaching layer.";
      }
      return;
    }
    els.referencePlateImg.src = chrome.runtime.getURL(`media/historical/${file}`);
    els.referencePlateImg.alt = preset.title || "Reference atlas plate";
    els.referencePlateImg.hidden = false;
    if (els.referencePlateNote) {
      els.referencePlateNote.textContent =
        "Static reference art (not georeferenced). Pins on the map above use gazetteer coordinates.";
    }
  }

  async function mountTeachingMap() {
    if (typeof L === "undefined") throw new Error("Leaflet failed to load");
    if (!els.teachingMap) throw new Error("Map container missing");

    await Promise.all([loadPresets(), loadAllPlaces(), loadKingdoms()]);
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
    if (els.kingdomLegend) {
      els.kingdomLegend.hidden = !showKingdoms;
    }

    destroyLeaflet();
    updateReferencePlate(preset);

    const map = L.map(els.teachingMap, {
      zoomControl: true,
      attributionControl: false,
    });
    leafletMap = map;
    // Set a view immediately so SVG paths project before async work finishes.
    map.setView([31.7, 35.1], 8);

    let basemap;
    try {
      basemap = await loadBasemap(basemapName);
    } catch (err) {
      console.warn("Bible Maps: basemap fetch failed, using fallback", err);
      basemap = fallbackBasemap(basemapName);
    }
    if (!basemap?.features?.length) basemap = fallbackBasemap(basemapName);

    const basemapLayer = L.geoJSON(basemap, {
      style: basemapStyle,
      interactive: false,
    }).addTo(map);

    const bounds = [];
    try {
      bounds.push(basemapLayer.getBounds());
    } catch {
      /* ignore */
    }

    if (showKingdoms && kingdomsGeoJson?.features) {
      try {
        const kg = L.geoJSON(
          { type: "FeatureCollection", features: kingdomsGeoJson.features },
          {
            style: kingdomStyle,
            onEachFeature(feature, layer) {
              const p = feature.properties || {};
              layer.bindPopup(
                `<strong>${escapeHtml(p.name || "")}</strong><br/>${escapeHtml(
                  p.eraLabel || ""
                )}`
              );
            },
          }
        ).addTo(map);
        bounds.push(kg.getBounds());
      } catch (err) {
        console.warn("Bible Maps: kingdoms overlay failed", err);
      }
    }

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
      if (!highlightPts.some((h) => h.placeId === s.placeId || h.id === s.placeId || h.name === s.name)) {
        highlightPts.push(s);
      }
    }
    // If nothing matched yet, still show period towns so the map isn't empty.
    const focusPts = highlightPts.length
      ? highlightPts
      : periodPlaces.slice(0, 40);

    const markerLayer = L.layerGroup().addTo(map);
    bounds.push(...addNamedMarkers(markerLayer, contextPts, { drawRoute: false, dim: true }));
    bounds.push(
      ...addNamedMarkers(markerLayer, focusPts, {
        drawRoute: Boolean(activeJourney) && routePts.length > 1,
        dim: false,
      })
    );

    if (preset?.bounds?.length === 2) {
      const [[south, west], [north, east]] = preset.bounds;
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [16, 16], maxZoom: 10 }
      );
    } else if (bounds.length) {
      let merged = bounds[0];
      for (let i = 1; i < bounds.length; i += 1) {
        try {
          merged = merged.extend(bounds[i]);
        } catch {
          /* ignore */
        }
      }
      map.fitBounds(merged.pad(0.08), { maxZoom: 10 });
    }

    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 50);
    setTimeout(() => map.invalidateSize(), 200);

    const townCount = contextPts.length + focusPts.length;
    setMapHelp(
      `${preset?.title || "Teaching map"} — ${townCount} period town${
        townCount === 1 ? "" : "s"
      } on offline vector map.`,
      false
    );
  }

  async function renderMap() {
    try {
      await mountTeachingMap();
    } catch (err) {
      console.error(err);
      setMapHelp(`Map unavailable (${err?.message || err}). Reload the extension.`, true);
      if (els.teachingMap && !leafletMap) {
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
    els.mapSubtitle.textContent = "Period towns on an offline teaching map";
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
    destroyLeaflet();
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
