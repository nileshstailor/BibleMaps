/**
 * Bible Maps side panel — places/journeys + offline SVG Then map.
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
    thenHelp: document.getElementById("thenHelp"),
    kingdomsToggle: document.getElementById("kingdomsToggle"),
    kingdomLegend: document.getElementById("kingdomLegend"),
  };

  let current = null;
  let activeJourney = null;
  let activePlaceMarkers = [];
  let kingdomsGeoJson = null;
  let kingdomsLoadPromise = null;

  function googlePlaceUrl(place) {
    if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
      const ll = `${place.lat},${place.lng}`;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`;
    }
    const q = encodeURIComponent(place.modernName || place.name || "");
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
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
        console.warn("Bible Maps: kingdoms overlay failed to load", err);
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
    thenBtn.textContent = "Open Then map + kingdoms";
    thenBtn.addEventListener("click", () => openPlacesThenMap(places || []));
    toolbar.appendChild(thenBtn);
    els.placesPanel.appendChild(toolbar);

    if (!places?.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        "No gazetteer places matched in this passage yet. You can still open the Then map for kingdom overlays.";
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
        '<p class="empty">No journey patterns detected. Try Acts travel chapters or Exodus/Abraham narratives — or open Then map from Places for kingdom overlays.</p>';
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

  function openPlacesThenMap(places) {
    activeJourney = null;
    activePlaceMarkers = places || [];
    els.mapDock.hidden = false;
    els.mapTitle.textContent = "Then map";
    els.mapSubtitle.textContent = "Schematic kingdoms (offline)";
    els.modernMapsLink.href = "#";
    els.modernStops.innerHTML =
      "<li>Switch to Then for kingdom overlays. Modern Google Maps links are on each place card.</li>";
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

    els.modernStops.innerHTML = "";
    stops.forEach((stop) => {
      const li = document.createElement("li");
      li.textContent = `${stop.name}${stop.note ? ` — ${stop.note}` : ""}`;
      if (journey.hitPlaceIds?.includes(stop.placeId)) {
        li.style.fontWeight = "600";
      }
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
      renderThenMap();
    }
  }

  async function renderThenMap() {
    try {
      await loadKingdoms();
      const show = Boolean(els.kingdomsToggle?.checked);
      if (els.kingdomLegend) els.kingdomLegend.hidden = !show;

      if (!window.BibleMapsSvgMap) {
        throw new Error("SVG map module failed to load");
      }

      window.BibleMapsSvgMap.render({
        container: els.thenMap,
        kingdoms: kingdomsGeoJson,
        showKingdoms: show,
        stops: activeJourney?.stops || [],
        places: activePlaceMarkers,
      });

      const meta = kingdomsGeoJson?.meta;
      setThenHelp(
        meta?.disclaimer ||
          "Offline schematic Then map — no Leaflet/OSM tile network required.",
        false
      );
      if (!activeJourney && meta?.title) {
        els.mapSubtitle.textContent = meta.title;
      }
    } catch (err) {
      console.error(err);
      setThenHelp(`Map error: ${err?.message || err}`, true);
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
  });
  els.modeModern.addEventListener("click", () => setMode("modern"));
  els.modeThen.addEventListener("click", () => setMode("then"));
  els.kingdomsToggle?.addEventListener("change", () => {
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
  refreshFromBackground();
  setTimeout(refreshFromBackground, 500);
  setTimeout(refreshFromBackground, 1500);
})();
