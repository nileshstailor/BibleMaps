/**
 * Offline SVG Then-map (no Leaflet / no tile network).
 * Equirectangular projection over the southern Levant.
 */
(function initBibleMapsSvgMap(global) {
  const VIEW = {
    // padding around Israel/Judah teaching region
    minLng: 34.2,
    maxLng: 36.0,
    minLat: 30.9,
    maxLat: 33.5,
    width: 360,
    height: 420,
  };

  function project(lng, lat) {
    const x =
      ((lng - VIEW.minLng) / (VIEW.maxLng - VIEW.minLng)) * VIEW.width;
    const y =
      ((VIEW.maxLat - lat) / (VIEW.maxLat - VIEW.minLat)) * VIEW.height;
    return [x, y];
  }

  function ringToPath(ring) {
    return ring
      .map((coord, i) => {
        const [lng, lat] = coord;
        const [x, y] = project(lng, lat);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z";
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render({
    container,
    kingdoms,
    showKingdoms,
    stops,
    places,
  }) {
    const w = VIEW.width;
    const h = VIEW.height;

    const kingdomPaths = [];
    if (showKingdoms && kingdoms?.features) {
      for (const feature of kingdoms.features) {
        const p = feature.properties || {};
        const rings = feature.geometry?.coordinates || [];
        // Polygon: coordinates[0] is outer ring
        const outer = rings[0];
        if (!outer) continue;
        kingdomPaths.push({
          d: ringToPath(outer),
          color: p.color || "#4a6741",
          fillOpacity: p.fillOpacity != null ? p.fillOpacity : 0.3,
          name: p.name || "",
          eraLabel: p.eraLabel || "",
        });
      }
    }

    const route = (stops || []).filter(
      (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
    );
    const markers = route.length
      ? route
      : (places || []).filter(
          (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
        );

    let lineD = "";
    if (route.length > 1) {
      lineD = route
        .map((s, i) => {
          const [x, y] = project(s.lng, s.lat);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    }

    const svg = `
<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" role="img" aria-label="Schematic Then map">
  <defs>
    <pattern id="bmGrid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(44,36,22,0.08)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="#e6d5b0"/>
  <rect width="${w}" height="${h}" fill="url(#bmGrid)"/>
  <text x="12" y="22" fill="#6d5f4a" font-size="11" font-family="Georgia, serif">Offline schematic map · no tile server</text>
  ${kingdomPaths
    .map(
      (k) =>
        `<path d="${k.d}" fill="${k.color}" fill-opacity="${k.fillOpacity}" stroke="${k.color}" stroke-width="1.5">
          <title>${escapeXml(k.name)} — ${escapeXml(k.eraLabel)}</title>
        </path>`
    )
    .join("\n")}
  ${
    lineD
      ? `<path d="${lineD}" fill="none" stroke="#a63024" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round"/>`
      : ""
  }
  ${markers
    .map((m, i) => {
      const [x, y] = project(m.lng, m.lat);
      const fill =
        route.length && i === 0
          ? "#4a6741"
          : route.length && i === route.length - 1
            ? "#a63024"
            : "#a63024";
      return `<g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${fill}" stroke="#2c2416" stroke-width="1"/>
        <title>${escapeXml(m.name || "")}${m.note ? " — " + escapeXml(m.note) : ""}</title>
        <text x="${(x + 7).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#2c2416" font-family="Georgia, serif">${escapeXml(
          (m.name || "").slice(0, 14)
        )}</text>
      </g>`;
    })
    .join("\n")}
</svg>`;

    container.innerHTML = svg;
  }

  global.BibleMapsSvgMap = { render, project, VIEW };
})(typeof window !== "undefined" ? window : globalThis);
