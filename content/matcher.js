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
  // Also block bare person/tribe/people names that collide with places — match via
  // multi-word aliases on the place instead (e.g. "land of Uz", "queen of Sheba").
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
    "kue",
    "lud",
    "magog",
    "meshech",
    "naphtali",
    "sheba",
    "tob",
    "tubal",
    "uz",
    "zebulun",
  ]);

  // Bare person/place collisions that are OK only in town-list geography
  // (e.g. 1 Kgs 15:20 "Ijon, Dan, Abel-beth-maacah").
  const CONTEXT_REQUIRED_ALIASES = new Set(["dan"]);

  // Multi-word aliases that are also ordinary English (ESV Gen 1:21 "great sea creatures").
  const BLOCKED_FOLLOW_WORDS = new Map([
    [
      "great sea",
      new Set(["creature", "creatures", "monster", "monsters", "animal", "animals"]),
    ],
    [
      "the great sea",
      new Set(["creature", "creatures", "monster", "monsters", "animal", "animals"]),
    ],
  ]);

  function followingWord(source, end) {
    const m = /^[\s\u00A0]+([A-Za-z]+)/.exec(source.slice(end));
    return m ? m[1].toLowerCase() : "";
  }

  /** True for ", Dan," / ", Dan and" / "and Dan," town-list patterns. */
  function isPlaceListContext(source, start, end) {
    const before = source.slice(Math.max(0, start - 24), start);
    const after = source.slice(end, Math.min(source.length, end + 24));
    if (/,\s*$/.test(before) && (/^\s*,/.test(after) || /^\s+and\s+/i.test(after))) {
      return true;
    }
    if (/\band\s+$/i.test(before) && /^\s*,/.test(after)) {
      return true;
    }
    return false;
  }

  /**
   * Skip place hits that are clearly kinship/genealogy formulas
   * ("son of Judah", "Jeshua the son of", "Abraham begat Isaac"), not locations.
   */
  function isGenealogyContext(source, start, end) {
    const before = source.slice(Math.max(0, start - 48), start);
    const after = source.slice(end, Math.min(source.length, end + 48));
    if (
      /(?:\bsons?|\bdaughters?|\bfathers?|\bmothers?|\bwives?|\bhusbands?|\bdescendants?|\bbegetters?)\s+of\s+$/i.test(
        before
      )
    ) {
      return true;
    }
    if (
      /^\s*,?\s*(?:the\s+)?(?:sons?|daughters?|fathers?|mothers?|descendants?)\s+of\b/i.test(
        after
      )
    ) {
      return true;
    }
    if (
      /^\s*(?:begat|begot|begotten|fathered|became the father of|was the father of)\b/i.test(
        after
      )
    ) {
      return true;
    }
    if (
      /\b(?:begat|begot|fathered|became the father of|was the father of)\s+$/i.test(
        before
      )
    ) {
      return true;
    }
    return false;
  }

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
      // Treat hyphen/apostrophe as word chars so "Tubal" does not hit inside "Tubal-cain".
      const re = new RegExp(
        `(?<![A-Za-z0-9'\\-\\u2010-\\u2014])(${pattern})(?![A-Za-z0-9'\\-\\u2010-\\u2014])`,
        "giu"
      );
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
        const blockedFollow = BLOCKED_FOLLOW_WORDS.get(matcher.alias.toLowerCase());
        if (blockedFollow && blockedFollow.has(followingWord(source, end))) {
          continue;
        }
        if (isGenealogyContext(source, start, end)) {
          continue;
        }
        if (
          CONTEXT_REQUIRED_ALIASES.has(matcher.alias.toLowerCase()) &&
          !isPlaceListContext(source, start, end)
        ) {
          continue;
        }
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

  /** Normalize book titles for scriptureRefs matching ("1 Kings", "1KI", "I Kings"). */
  function normalizeBookKey(raw) {
    let s = normalizeQuotes(raw)
      .toLowerCase()
      .replace(/\./g, " ")
      .replace(/\s+/g, " ")
      .trim();
    s = s
      .replace(/^i\s+/, "1 ")
      .replace(/^ii\s+/, "2 ")
      .replace(/^iii\s+/, "3 ");
    const usfm = {
      gen: "genesis",
      exo: "exodus",
      "1ki": "1 kings",
      "2ki": "2 kings",
      "1sa": "1 samuel",
      "2sa": "2 samuel",
      "1ch": "1 chronicles",
      "2ch": "2 chronicles",
      mat: "matthew",
      mrk: "mark",
      luk: "luke",
      jhn: "john",
      act: "acts",
      rom: "romans",
      rev: "revelation",
    };
    if (usfm[s]) return usfm[s];
    // "1kings" → "1 kings"
    s = s.replace(/^([123])([a-z])/, "$1 $2");
    return s;
  }

  /**
   * Parse refs like "1 Kings 14:1–18", "Acts 13–14", "Acts 15:36–18:22".
   * Returns list of { book, chapters: number[] }.
   */
  function parseScriptureRefs(refs) {
    const out = [];
    for (const ref of refs || []) {
      const r = normalizeQuotes(ref).replace(/[–—]/g, "-");
      const bookRe = "((?:[123]\\s+)?[A-Za-z]+)";
      // Cross-chapter with verses: "Acts 15:36-18:22" or "Genesis 11:31-12:9"
      const cross = r.match(
        new RegExp(`^${bookRe}\\s+(\\d+):(\\d+)\\s*-\\s*(\\d+):(\\d+)`)
      );
      if (cross) {
        const start = Number(cross[2]);
        const end = Number(cross[4]);
        const chapters = [];
        for (let c = start; c <= end; c++) chapters.push(c);
        out.push({ book: normalizeBookKey(cross[1]), chapters });
        continue;
      }
      // Chapter range without verses: "Acts 13-14"
      const chRange = r.match(
        new RegExp(`^${bookRe}\\s+(\\d+)\\s*-\\s*(\\d+)(?!\\s*:)`)
      );
      if (chRange) {
        const start = Number(chRange[2]);
        const end = Number(chRange[3]);
        const chapters = [];
        for (let c = start; c <= end; c++) chapters.push(c);
        out.push({ book: normalizeBookKey(chRange[1]), chapters });
        continue;
      }
      // Single chapter (optional verse range): "1 Kings 14:1-18", "Genesis 13"
      const single = r.match(new RegExp(`^${bookRe}\\s+(\\d+)`));
      if (!single) continue;
      out.push({
        book: normalizeBookKey(single[1]),
        chapters: [Number(single[2])],
      });
    }
    return out;
  }

  function journeyMatchesPassage(journey, passage) {
    if (!passage?.book || !passage?.chapter) return true; // no context → keep old behavior
    const parsed = parseScriptureRefs(journey.scriptureRefs || []);
    if (!parsed.length) return true;
    const book = normalizeBookKey(passage.book);
    const chapter = Number(passage.chapter);
    return parsed.some(
      (p) => p.book === book && p.chapters.includes(chapter)
    );
  }

  function detectJourneys(foundPlaceIds, journeys, pageText, passage) {
    const text = normalizeQuotes(pageText).toLowerCase();
    const found = new Set(foundPlaceIds);
    const results = [];

    for (const journey of journeys) {
      if (!journeyMatchesPassage(journey, passage)) continue;

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
