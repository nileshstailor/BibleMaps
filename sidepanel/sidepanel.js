/**
 * Bible Maps side panel — Google embed + Leaflet kingdom overlays.
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
    modeModern: document.getElementById("modeModern"),
    modeThen: document.getElementById("modeThen"),
    modernPane: document.getElementById("modernPane"),
    thenPane: document.getElementById("thenPane"),
    modernEmbed: document.getElementById("modernEmbed"),
    modernMapsLink: document.getElementById("modernMapsLink"),
    modernStops: document.getElementById("modernStops"),
    thenMap: document.getElementById("thenMap"),
    thenHelp: document.getElementById("thenHelp"),
    kingdomsToggle: document.getElementById("kingdomsToggle"),
    kingdomLegend: document.getElementById("kingdomLegend"),
    atlasSelect: document.getElementById("atlasSelect"),
    atlasPlate: document.getElementById("atlasPlate"),
    atlasPlateImg: document.getElementById("atlasPlateImg"),
  };

  let current = null;
  let activeJourney = null;
  let activePlaceMarkers = [];
  let kingdomsGeoJson = null;
  let kingdomsLoadPromise = null;
  let atlasCatalog = null;
  let atlasLoadPromise = null;
  let leafletMap = null;
  let leafletMarkers = null;
  let leafletKingdoms = null;
  let leafletAtlas = null;
  let modernLeafletMap = null;

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
      travelmode: "driving",
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

  /** Embeddable Google Map (no API key). Loads as https iframe — real tiles. */
  function googleEmbedSrc(points, zoom) {
    const pts = (points || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (!pts.length) {
      return `https://maps.google.com/maps?q=31.7784,35.2296&z=8&output=embed`;
    }
    if (pts.length === 1) {
      return `https://maps.google.com/maps?q=${pts[0].lat},${pts[0].lng}&z=${
        zoom || 10
      }&output=embed`;
    }
    if (pts.length === 2) {
      return `https://maps.google.com/maps?saddr=${pts[0].lat},${pts[0].lng}&daddr=${pts[1].lat},${pts[1].lng}&output=embed`;
    }
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const clat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const clng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs)
    );
    const z = zoom || (span > 8 ? 5 : span > 3 ? 6 : span > 1 ? 8 : 9);
    // Multi-point: center the region (full route link is on Modern).
    return `https://maps.google.com/maps?q=${clat},${clng}&z=${z}&output=embed`;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setThenHelp(text, isError) {
    if (!els.thenHelp) return;
    els.thenHelp.textContent = text;
    els.thenHelp.style.color = isError ? "#a63024" : "";
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

  function loadAtlasCatalog() {
    if (atlasCatalog) return Promise.resolve(atlasCatalog);
    if (atlasLoadPromise) return atlasLoadPromise;
    atlasLoadPromise = fetch(chrome.runtime.getURL("media/historical/catalog.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`atlas catalog HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        atlasCatalog = data;
        populateAtlasSelect();
        return data;
      })
      .catch((err) => {
        console.warn("Bible Maps: atlas catalog failed", err);
        atlasLoadPromise = null;
        return null;
      });
    return atlasLoadPromise;
  }

  function populateAtlasSelect() {
    if (!els.atlasSelect || !atlasCatalog?.maps) return;
    const current = els.atlasSelect.value;
    els.atlasSelect.innerHTML = '<option value="">None (street map only)</option>';
    for (const m of atlasCatalog.maps) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.title}${m.era ? ` — ${m.era}` : ""}`;
      els.atlasSelect.appendChild(opt);
    }
    if ([...els.atlasSelect.options].some((o) => o.value === current)) {
      els.atlasSelect.value = current;
    }
  }

  function suggestAtlasId() {
    const jid = activeJourney?.id || "";
    if (jid === "paul_first") return "paul_first";
    if (jid === "paul_second") return "paul_second";
    if (jid === "paul_third") return "paul_third";
    if (jid === "paul_rome") return "paul_rome";
    // Default historical kingdom atlas for OT / general Then view
    return "divided_kingdom";
  }

  function renderPlaces(places) {
    els.placesPanel.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "actions";
    toolbar.style.marginBottom = "4px";
    const thenBtn = document.createElement("button");
    thenBtn.type = "button";
    thenBtn.className = "text-btn";
    thenBtn.textContent = "Open map";
    thenBtn.addEventListener("click", () => openPlacesThenMap(places || []));
    toolbar.appendChild(thenBtn);
    els.placesPanel.appendChild(toolbar);

    if (!places?.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        "No gazetteer places matched yet. You can still open the map for the region / kingdoms.";
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
        '<p class="empty">No journey patterns detected. Open the map from Places for Google / kingdom views.</p>';
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
            View Modern / Then map
          </button>
        </div>
      `;
      card.querySelector("button")?.addEventListener("click", () => openJourney(journey));
      els.journeysPanel.appendChild(card);
    }
  }

  function collectPoints() {
    const stops = activeJourney?.stops || [];
    if (stops.some((s) => Number.isFinite(s.lat))) return stops;
    return activePlaceMarkers || [];
  }

  function mountGoogleEmbed(container, points, zoom) {
    const src = googleEmbedSrc(points, zoom);
    container.innerHTML = `<iframe
      title="Google Map"
      src="${src}"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
      allowfullscreen
    ></iframe>`;
  }

  function destroyLeafletOn(container, mapRef) {
    if (mapRef) {
      try {
        mapRef.remove();
      } catch {
        /* ignore */
      }
    }
    if (container) {
      container._leaflet_id = null;
      container.innerHTML = "";
    }
  }

  function destroyLeaflet() {
    destroyLeafletOn(els.thenMap, leafletMap);
    leafletMap = null;
    leafletMarkers = null;
    leafletKingdoms = null;
    leafletAtlas = null;
  }

  function destroyModernLeaflet() {
    destroyLeafletOn(els.modernEmbed, modernLeafletMap);
    modernLeafletMap = null;
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

  function addNamedMarkers(map, layerGroup, points, { drawRoute }) {
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
        radius: 7,
        color: "#2c2416",
        weight: 1,
        fillColor: i === 0 ? "#4a6741" : "#a63024",
        fillOpacity: 0.95,
      }).addTo(layerGroup);
      const label = escapeHtml(p.name || "Place");
      const detail = escapeHtml(p.note || p.modernName || "");
      m.bindTooltip(label, {
        permanent: true,
        direction: "top",
        offset: [0, -8],
        className: "bm-pin-label",
        opacity: 0.96,
      });
      m.bindPopup(`<strong>${label}</strong>${detail ? `<br/>${detail}` : ""}`);
      bounds.push(L.latLng(p.lat, p.lng).toBounds(8000));
    });
    return bounds;
  }

  async function mountStreetMap(container, points, options = {}) {
    const {
      showKingdoms = false,
      drawRoute = false,
      asModern = false,
      atlasId = "",
    } = options;
    if (typeof L === "undefined") throw new Error("Leaflet failed to load");
    if (showKingdoms) await loadKingdoms();
    if (atlasId) await loadAtlasCatalog();

    if (asModern) destroyModernLeaflet();
    else destroyLeaflet();

    container.innerHTML = "";
    if (window.L?.Icon?.Default) {
      const iconBase = chrome.runtime.getURL("lib/images/");
      L.Icon.Default.mergeOptions({
        iconUrl: iconBase + "marker-icon.png",
        iconRetinaUrl: iconBase + "marker-icon-2x.png",
        shadowUrl: iconBase + "marker-shadow.png",
      });
    }

    const map = L.map(container, { zoomControl: true });
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles &copy; Esri", maxZoom: 19 }
    ).addTo(map);

    const bounds = [];
    // Atlas plates are shown as separate images (not Leaflet imageOverlay).
    // Forced lat/lng georeferencing was badly wrong for these atlas frames.

    if (showKingdoms && kingdomsGeoJson?.features) {
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
      try {
        bounds.push(kg.getBounds());
      } catch {
        /* ignore */
      }
      if (!asModern) leafletKingdoms = kg;
    }

    const markerLayer = L.layerGroup().addTo(map);
    bounds.push(...addNamedMarkers(map, markerLayer, points, { drawRoute }));

    if (bounds.length) {
      let merged = bounds[0];
      for (let i = 1; i < bounds.length; i += 1) merged = merged.extend(bounds[i]);
      map.fitBounds(merged.pad(0.08));
    } else {
      map.setView([31.7, 35.1], 8);
    }

    setTimeout(() => map.invalidateSize(), 80);
    setTimeout(() => map.invalidateSize(), 250);

    if (asModern) {
      modernLeafletMap = map;
    } else {
      leafletMap = map;
      leafletMarkers = markerLayer;
    }
    return { map };
  }

  function renderAtlasPlate(atlasId) {
    if (!els.atlasPlate || !els.atlasPlateImg) return null;
    const meta = atlasCatalog?.maps?.find((m) => m.id === atlasId) || null;
    if (!meta) {
      els.atlasPlate.hidden = true;
      els.atlasPlateImg.removeAttribute("src");
      return null;
    }
    els.atlasPlateImg.src = chrome.runtime.getURL(`media/historical/${meta.file}`);
    els.atlasPlateImg.alt = meta.title;
    els.atlasPlate.hidden = false;
    return meta;
  }

  async function renderThenMap() {
    try {
      await loadAtlasCatalog();
      const points = collectPoints();
      const drawKingdoms = Boolean(els.kingdomsToggle?.checked);
      if (els.kingdomLegend) els.kingdomLegend.hidden = !drawKingdoms;

      // Suggest a relevant atlas plate once (shown as image, not georeferenced overlay).
      if (els.atlasSelect && !els.atlasSelect.dataset.userTouched) {
        const suggested = suggestAtlasId();
        if ([...els.atlasSelect.options].some((o) => o.value === suggested)) {
          els.atlasSelect.value = suggested;
        }
      }

      const atlasId = els.atlasSelect?.value || "";
      const atlasMeta = renderAtlasPlate(atlasId);

      await mountStreetMap(els.thenMap, points, {
        showKingdoms: drawKingdoms,
        drawRoute: Boolean(activeJourney),
        atlasId: "", // never stretch atlas onto lat/lng
      });

      if (atlasMeta) {
        setThenHelp(
          `${atlasMeta.title} shown as an atlas plate above; street map below keeps accurate pins. ${atlasMeta.attribution || ""}`,
          false
        );
      } else {
        setThenHelp(
          "Street map with named pins. Pick a historical atlas plate to view period borders without distorting them onto modern coordinates.",
          false
        );
      }
    } catch (err) {
      console.error(err);
      destroyLeaflet();
      mountGoogleEmbed(els.thenMap, collectPoints(), 8);
      setThenHelp(
        `Map unavailable (${err?.message || err}). Falling back to a basic Google embed.`,
        true
      );
    }
  }

  async function renderModernEmbed(points) {
    if (!els.modernEmbed) return;
    els.modernEmbed.hidden = false;
    try {
      await mountStreetMap(els.modernEmbed, points, {
        showKingdoms: false,
        drawRoute: Boolean(activeJourney),
        asModern: true,
      });
    } catch (err) {
      console.warn(err);
      destroyModernLeaflet();
      mountGoogleEmbed(els.modernEmbed, points, 7);
    }
  }

  function openPlacesThenMap(places) {
    activeJourney = null;
    activePlaceMarkers = places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = "Map";
    els.mapSubtitle.textContent = "Pins + kingdoms on one map";
    const pts = places || [];
    if (pts.length === 1) {
      els.modernMapsLink.href = googlePlaceUrl(pts[0]);
      els.modernMapsLink.textContent = "Open in Google Maps";
    } else if (pts.length > 1) {
      els.modernMapsLink.href = googleJourneyUrl(pts);
      els.modernMapsLink.textContent = "Open places in Google Maps";
    } else {
      els.modernMapsLink.href = "https://www.google.com/maps/@31.7,35.1,8z";
      els.modernMapsLink.textContent = "Open region in Google Maps";
    }
    renderModernEmbed(pts);
    els.modernStops.innerHTML =
      "<li>Then map shows named pins and kingdom overlays together.</li>";
    setMode("then");
  }

  function openJourney(journey) {
    activeJourney = journey;
    activePlaceMarkers = current?.places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = journey.name;
    els.mapSubtitle.textContent = (journey.scriptureRefs || []).join(" · ");

    const stops = journey.stops || [];
    els.modernMapsLink.href = googleJourneyUrl(stops);
    els.modernMapsLink.textContent = "Open multi-stop route in Google Maps";
    els.modernMapsLink.dataset.polyline = googlePolylineSearchUrl(stops);

    renderModernEmbed(stops);

    els.modernStops.innerHTML = "";
    stops.forEach((stop) => {
      const li = document.createElement("li");
      li.textContent = `${stop.name}${stop.note ? ` — ${stop.note}` : ""}`;
      if (journey.hitPlaceIds?.includes(stop.placeId)) li.style.fontWeight = "600";
      li.title = stop.modernName || "";
      els.modernStops.appendChild(li);
    });

    setMode("modern");
  }

  function setMode(mode) {
    const isModern = mode === "modern";
    els.modeModern.classList.toggle("active", isModern);
    els.modeThen.classList.toggle("active", !isModern);
    els.modernPane.hidden = !isModern;
    els.thenPane.hidden = isModern;
    if (!isModern) {
      requestAnimationFrame(() => renderThenMap());
    } else {
      setTimeout(() => modernLeafletMap?.invalidateSize(), 80);
    }
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
    destroyModernLeaflet();
  });
  els.modeModern.addEventListener("click", () => setMode("modern"));
  els.modeThen.addEventListener("click", () => setMode("then"));

  els.kingdomsToggle?.addEventListener("change", () => {
    if (!els.thenPane.hidden) renderThenMap();
  });
  els.atlasSelect?.addEventListener("change", () => {
    if (els.atlasSelect) els.atlasSelect.dataset.userTouched = "1";
    if (!els.thenPane.hidden) renderThenMap();
  });

  els.modernMapsLink.addEventListener("click", (e) => {
    if (els.modernMapsLink.getAttribute("href") === "#") {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && els.modernMapsLink.dataset.polyline) {
      e.preventDefault();
      window.open(els.modernMapsLink.dataset.polyline, "_blank", "noopener");
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "BIBLE_MAPS_DETECTION_UPDATED") {
      applyPayload(message.payload);
    }
  });

  loadKingdoms();
  loadAtlasCatalog();
  refreshFromBackground();
  setTimeout(refreshFromBackground, 500);
  setTimeout(refreshFromBackground, 1500);
})();
