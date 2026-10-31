/**
 * Bible Maps side panel — lists detected places/journeys and map actions.
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
    modernMapsLink: document.getElementById("modernMapsLink"),
    modernStops: document.getElementById("modernStops"),
    thenMap: document.getElementById("thenMap"),
  };

  let current = null;
  let activeJourney = null;
  let thenMap = null;
  let thenLayerGroup = null;

  function googlePlaceUrl(place) {
    const q = encodeURIComponent(
      `${place.lat},${place.lng} (${place.modernName || place.name})`
    );
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  /**
   * Multi-stop Google Maps directions URL.
   * Uses the first stop as origin, last as destination, middles as waypoints.
   */
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
    // Google caps waypoints; keep a reasonable subset for long itineraries.
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

  /**
   * Polyline overview URL (also useful when directions mode is awkward for ancient routes).
   */
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

  function renderPlaces(places) {
    els.placesPanel.innerHTML = "";
    if (!places?.length) {
      els.placesPanel.innerHTML =
        '<p class="empty">No gazetteer places matched in this passage yet.</p>';
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
        '<p class="empty">No journey patterns detected. Try Acts travel chapters or Exodus/Abraham narratives.</p>';
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

  function openJourney(journey) {
    activeJourney = journey;
    els.mapDock.hidden = false;
    els.mapTitle.textContent = journey.name;
    els.mapSubtitle.textContent = (journey.scriptureRefs || []).join(" · ");

    const stops = journey.stops || [];
    els.modernMapsLink.href = googleJourneyUrl(stops);
    els.modernMapsLink.textContent = "Open multi-stop route in Google Maps";
    // Secondary polyline-style URL via path segments
    els.modernMapsLink.dataset.polyline = googlePolylineSearchUrl(stops);

    els.modernStops.innerHTML = "";
    stops.forEach((stop, i) => {
      const li = document.createElement("li");
      li.textContent = `${stop.name}${stop.note ? ` — ${stop.note}` : ""}`;
      if (journey.hitPlaceIds?.includes(stop.placeId)) {
        li.style.fontWeight = "600";
      }
      // Deduplicate visual list noise for return legs: still show all ordered stops
      li.title = stop.modernName || "";
      els.modernStops.appendChild(li);
      void i;
    });

    setMode("modern");
    // Prefetch then-map so switching is snappy
    requestAnimationFrame(() => ensureThenMap(stops));
  }

  function setMode(mode) {
    const isModern = mode === "modern";
    els.modeModern.classList.toggle("active", isModern);
    els.modeThen.classList.toggle("active", !isModern);
    els.modernPane.hidden = !isModern;
    els.thenPane.hidden = isModern;
    if (!isModern && activeJourney) {
      ensureThenMap(activeJourney.stops || []);
      setTimeout(() => thenMap?.invalidateSize(), 60);
    }
  }

  function ensureThenMap(stops) {
    const pts = stops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => [s.lat, s.lng]);

    if (!thenMap) {
      // Fix default icon paths for extension pages
      if (window.L?.Icon?.Default) {
        const iconBase = chrome.runtime.getURL("lib/images/");
        L.Icon.Default.mergeOptions({
          iconUrl: iconBase + "marker-icon.png",
          iconRetinaUrl: iconBase + "marker-icon-2x.png",
          shadowUrl: iconBase + "marker-shadow.png",
        });
      }
      thenMap = L.map(els.thenMap, {
        zoomControl: true,
        attributionControl: true,
      });
      // Muted / aged-looking basemap (CartoDB Positron / Voyager variants)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 18,
      }).addTo(thenMap);
      thenLayerGroup = L.layerGroup().addTo(thenMap);
    }

    thenLayerGroup.clearLayers();
    if (!pts.length) {
      thenMap.setView([31.5, 35.0], 6);
      return;
    }

    const latLngs = pts.map(([lat, lng]) => L.latLng(lat, lng));
    const line = L.polyline(latLngs, {
      color: "#a63024",
      weight: 3.5,
      opacity: 0.9,
      dashArray: "8 6",
    }).addTo(thenLayerGroup);

    stops.forEach((stop, index) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 6,
        color: "#2c2416",
        weight: 1,
        fillColor: index === 0 ? "#4a6741" : index === stops.length - 1 ? "#a63024" : "#c9a227",
        fillOpacity: 0.95,
      }).addTo(thenLayerGroup);
      marker.bindPopup(
        `<strong>${escapeHtml(stop.name)}</strong><br/>${escapeHtml(stop.note || stop.modernName || "")}`
      );
    });

    thenMap.fitBounds(line.getBounds().pad(0.18));
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

  // Tabs
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
  });
  els.modeModern.addEventListener("click", () => setMode("modern"));
  els.modeThen.addEventListener("click", () => setMode("then"));

  // Allow shift-click on Modern link to use path-style URL
  els.modernMapsLink.addEventListener("click", (e) => {
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

  refreshFromBackground();
  // Re-fetch shortly after open in case content script publishes late
  setTimeout(refreshFromBackground, 500);
  setTimeout(refreshFromBackground, 1500);
})();
