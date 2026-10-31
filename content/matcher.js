/**
 * Curated gazetteer matching for biblical place and journey names.
 * Exposes window.BibleMapsMatcher (no bundler).
 * Does NOT mutate page DOM — returns Ranges for CSS Highlight API.
 */
(function initBibleMapsMatcher(global) {
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "CODE",
    "PRE",
    "SVG",
    "MATH",
  ]);

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeQuotes(s) {
    return String(s || "")
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .replace(/\u00A0/g, " ");
  }

  // Standalone English words / too-ambiguous toponyms (e.g. Thebes alias "No").
  const BLOCKED_ALIASES = new Set([
    "no",
    "on",
    "or",
    "so",
    "an",
    "as",
    "at",
    "be",
    "by",
    "do",
    "go",
    "he",
    "if",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "to",
    "up",
    "us",
    "we",
    "am",
  ]);

  function buildPlaceMatchers(places) {
    const entries = [];
    for (const place of places) {
      const aliases = Array.from(
        new Set([place.name, ...(place.aliases || [])].filter(Boolean))
      );
      for (const alias of aliases) {
        if (BLOCKED_ALIASES.has(alias.toLowerCase())) continue;
        entries.push({
          alias,
          placeId: place.id,
          place,
          length: alias.length,
        });
      }
    }
    entries.sort((a, b) => b.length - a.length || a.alias.localeCompare(b.alias));

    return entries.map((entry) => {
      const pattern = escapeRegExp(entry.alias).replace(/\\ /g, "[\\s\\u00A0]+");
      const re = new RegExp(`(?<![A-Za-z0-9])(${pattern})(?![A-Za-z0-9])`, "giu");
      return { ...entry, re };
    });
  }

  function findMatchesInText(text, placeMatchers) {
    const source = normalizeQuotes(text);
    const occupied = new Array(source.length).fill(false);
    const matches = [];

    for (const matcher of placeMatchers) {
      matcher.re.lastIndex = 0;
      let m;
      while ((m = matcher.re.exec(source)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        let overlaps = false;
        for (let i = start; i < end; i += 1) {
          if (occupied[i]) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        for (let i = start; i < end; i += 1) occupied[i] = true;
        matches.push({
          start,
          end,
          text: m[0],
          placeId: matcher.placeId,
          place: matcher.place,
        });
      }
    }

    matches.sort((a, b) => a.start - b.start);
    return matches;
  }

  function shouldSkipNode(node) {
    if (!node) return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (SKIP_TAGS.has(node.tagName)) return true;
      if (node.isContentEditable) return true;
    }
    return false;
  }

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || shouldSkipNode(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  /**
   * Build non-mutating Range hits for CSS Custom Highlight API.
   */
  function collectMatchRanges(root, placeMatchers) {
    const hits = [];
    const textNodes = collectTextNodes(root);
    for (const node of textNodes) {
      const matches = findMatchesInText(node.nodeValue || "", placeMatchers);
      for (const match of matches) {
        try {
          const range = document.createRange();
          range.setStart(node, match.start);
          range.setEnd(node, match.end);
          hits.push({
            range,
            placeId: match.placeId,
            place: match.place,
            text: match.text,
          });
        } catch {
          /* node may have changed mid-scan */
        }
      }
    }
    return hits;
  }

  function detectJourneys(foundPlaceIds, journeys, pageText) {
    const text = normalizeQuotes(pageText).toLowerCase();
    const found = new Set(foundPlaceIds);
    const results = [];

    for (const journey of journeys) {
      const stopIds = journey.stops.map((s) => s.placeId);
      const uniqueStops = [...new Set(stopIds)];
      const hitStops = uniqueStops.filter((id) => found.has(id));
      const aliasHit = (journey.aliases || [])
        .concat([journey.name])
        .some((alias) => {
          const a = normalizeQuotes(alias).toLowerCase();
          return a && text.includes(a.toLowerCase());
        });

      const stopRatio = uniqueStops.length
        ? hitStops.length / uniqueStops.length
        : 0;
      // Chapter-scoped: require multiple stop hits, or one stop + explicit journey alias.
      // Avoid single-place false positives (e.g. "Jerusalem" alone ≠ Paul's Rome journey).
      const relevant =
        hitStops.length >= 2 || (aliasHit && hitStops.length >= 1);

      if (!relevant) continue;

      results.push({
        id: journey.id,
        name: journey.name,
        scriptureRefs: journey.scriptureRefs || [],
        summary: journey.summary || "",
        pathHints: journey.pathHints || "",
        hitPlaceIds: hitStops,
        hitCount: hitStops.length,
        stopCount: uniqueStops.length,
        aliasHit,
        score: hitStops.length * 2 + (aliasHit ? 3 : 0) + stopRatio,
      });
    }

    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return results;
  }

  global.BibleMapsMatcher = {
    buildPlaceMatchers,
    findMatchesInText,
    collectTextNodes,
    collectMatchRanges,
    detectJourneys,
    normalizeQuotes,
  };
})(typeof window !== "undefined" ? window : globalThis);
