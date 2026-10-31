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
    kingdomToggleWrap: document.getElementById("kingdomToggleWrap"),
    kingdomLegend: document.getElementById("kingdomLegend"),
    basemapGoogle: document.getElementById("basemapGoogle"),
    basemapOverlay: document.getElementById("basemapOverlay"),
  };

  let current = null;
  let activeJourney = null;
  let activePlaceMarkers = [];
  let kingdomsGeoJson = null;
  let kingdomsLoadPromise = null;
  let thenBasemap = "google"; // google | overlay
  let leafletMap = null;
  let leafletMarkers = null;
  let leafletKingdoms = null;

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

  function renderPlaces(places) {
    els.placesPanel.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "actions";
    toolbar.style.marginBottom = "4px";
    const thenBtn = document.createElement("button");
    thenBtn.type = "button";
    thenBtn.className = "text-btn";
    thenBtn.textContent = "Open map + kingdoms";
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

  function destroyLeaflet() {
    if (leafletMap) {
      try {
        leafletMap.remove();
      } catch {
        /* ignore */
      }
    }
    leafletMap = null;
    leafletMarkers = null;
    leafletKingdoms = null;
    if (els.thenMap) {
      els.thenMap._leaflet_id = null;
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

  async function mountLeafletOverlay(points) {
    await loadKingdoms();
    if (typeof L === "undefined") {
      throw new Error("Leaflet failed to load");
    }

    destroyLeaflet();
    els.thenMap.innerHTML = "";

    if (window.L?.Icon?.Default) {
      const iconBase = chrome.runtime.getURL("lib/images/");
      L.Icon.Default.mergeOptions({
        iconUrl: iconBase + "marker-icon.png",
        iconRetinaUrl: iconBase + "marker-icon-2x.png",
        shadowUrl: iconBase + "marker-shadow.png",
      });
    }

    leafletMap = L.map(els.thenMap, { zoomControl: true });
    // Esri street tiles usually work from extension pages (OSM often blocks them).
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }
    ).addTo(leafletMap);

    leafletMarkers = L.layerGroup().addTo(leafletMap);
    const bounds = [];

    const drawKingdoms = Boolean(els.kingdomsToggle?.checked);
    if (els.kingdomLegend) els.kingdomLegend.hidden = !drawKingdoms;
    if (drawKingdoms && kingdomsGeoJson?.features) {
      leafletKingdoms = L.geoJSON(
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
      ).addTo(leafletMap);
      try {
        bounds.push(leafletKingdoms.getBounds());
      } catch {
        /* ignore */
      }
    }

    const pts = (points || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (pts.length > 1 && activeJourney) {
      const line = L.polyline(
        pts.map((p) => [p.lat, p.lng]),
        { color: "#a63024", weight: 3, dashArray: "7 5" }
      ).addTo(leafletMarkers);
      bounds.push(line.getBounds());
    }
    pts.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: "#2c2416",
        weight: 1,
        fillColor: i === 0 ? "#4a6741" : "#a63024",
        fillOpacity: 0.95,
      }).addTo(leafletMarkers);
      m.bindPopup(
        `<strong>${escapeHtml(p.name || "")}</strong><br/>${escapeHtml(
          p.note || p.modernName || ""
        )}`
      );
      bounds.push(L.latLng(p.lat, p.lng).toBounds(8000));
    });

    if (bounds.length) {
      let merged = bounds[0];
      for (let i = 1; i < bounds.length; i += 1) merged = merged.extend(bounds[i]);
      leafletMap.fitBounds(merged.pad(0.15));
    } else {
      leafletMap.setView([31.7, 35.1], 8);
    }

    setTimeout(() => leafletMap?.invalidateSize(), 80);
    setTimeout(() => leafletMap?.invalidateSize(), 250);
  }

  async function renderThenMap() {
    try {
      const points = collectPoints();
      const isOverlay = thenBasemap === "overlay";

      els.basemapGoogle?.classList.toggle("active", !isOverlay);
      els.basemapOverlay?.classList.toggle("active", isOverlay);
      if (els.kingdomToggleWrap) els.kingdomToggleWrap.hidden = !isOverlay;
      if (els.kingdomLegend) {
        els.kingdomLegend.hidden = !(isOverlay && els.kingdomsToggle?.checked);
      }

      if (!isOverlay) {
        destroyLeaflet();
        mountGoogleEmbed(els.thenMap, points, points.length > 3 ? 7 : 9);
        setThenHelp(
          "Embedded Google Map (no API key). Switch to Kingdoms for schematic borders on a street map.",
          false
        );
        return;
      }

      await mountLeafletOverlay(points);
      setThenHelp(
        "Esri street map with schematic kingdom outlines (teaching approximations). If tiles fail to load, use the Google basemap tab.",
        false
      );
    } catch (err) {
      console.error(err);
      // Fall back to Google embed if Leaflet/tiles fail.
      destroyLeaflet();
      mountGoogleEmbed(els.thenMap, collectPoints(), 8);
      setThenHelp(
        `Kingdom overlay unavailable (${err?.message || err}). Showing Google embed instead.`,
        true
      );
      thenBasemap = "google";
      els.basemapGoogle?.classList.add("active");
      els.basemapOverlay?.classList.remove("active");
    }
  }

  function openPlacesThenMap(places) {
    activeJourney = null;
    activePlaceMarkers = places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = "Map";
    els.mapSubtitle.textContent = "Google embed + optional kingdom overlays";
    const pts = places || [];
    if (pts[0]) {
      els.modernMapsLink.href = googlePlaceUrl(pts[0]);
      els.modernMapsLink.textContent = "Open first place in Google Maps";
    } else {
      els.modernMapsLink.href = "https://www.google.com/maps/@31.7,35.1,8z";
      els.modernMapsLink.textContent = "Open region in Google Maps";
    }
    if (els.modernEmbed) {
      els.modernEmbed.hidden = false;
      mountGoogleEmbed(els.modernEmbed, pts, 8);
    }
    els.modernStops.innerHTML =
      "<li>Use Then → Google for the embedded map, or Then → Kingdoms for borders.</li>";
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

    if (els.modernEmbed) {
      els.modernEmbed.hidden = false;
      mountGoogleEmbed(els.modernEmbed, stops, 6);
    }

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
    } else if (els.modernEmbed && !els.modernEmbed.hidden) {
      // resize noop for iframe
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
    const where = payload.url ? shortUrl(payload.url) : "current tab";
    setStatus(
      `Found ${placeCount} place${placeCount === 1 ? "" : "s"} and ${journeyCount} journey${
        journeyCount === 1 ? "" : "s"
      } on ${where}.`
    );
    activePlaceMarkers = payload.places || [];
    renderPlaces(payload.places || []);
    renderJourneys(payload.journeys || []);
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname.replace(/\/+$/, "") || u.host;
    } catch {
      return "bible.com";
    }
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
  els.modeModern.addEventListener("click", () => setMode("modern"));
  els.modeThen.addEventListener("click", () => setMode("then"));

  els.basemapGoogle?.addEventListener("click", () => {
    thenBasemap = "google";
    renderThenMap();
  });
  els.basemapOverlay?.addEventListener("click", () => {
    thenBasemap = "overlay";
    renderThenMap();
  });
  els.kingdomsToggle?.addEventListener("change", () => {
    if (thenBasemap === "overlay") renderThenMap();
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
  refreshFromBackground();
  setTimeout(refreshFromBackground, 500);
  setTimeout(refreshFromBackground, 1500);
})();
