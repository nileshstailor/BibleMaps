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
    // People ethnonyms / gentilics — match the place via the base toponym
    // or a "land of …" alias instead (1 Chr genealogies list these as persons).
    "arvadites",
    "pathrusim",
    "caphtorim",
    "philistines",
    "amalekites",
    "amalekite",
    "netophathites",
    "netophathite",
    "cushite",
    "cushites",
    "elamites",
    "midianites",
    "midianite",
    // Person names that are also Bethlehem/Judah aliases (1 Chr 2:19 Caleb's wife)
    "ephrath",
    "ephratah",
    "ephrathah",
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
   * Skip place hits that are kinship/genealogy formulas in ANY book/chapter
   * (Genesis lists, 1–2 Chronicles clan rolls, Matt 1, Luke 3, Ezra–Neh, Ruth 4, etc.).
   * Applies globally in findMatchesInText — not limited to one book.
   */
  function isGenealogyContext(source, start, end) {
    const before = source.slice(Math.max(0, start - 240), start);
    // Long 1 Chr name-lists need a wide after-window ("…, A, B, and C were the sons of")
    const after = source.slice(end, Math.min(source.length, end + 180));
    // Exclude and/or so list tails don't swallow the conjunction as a "name"
    const nameBit = "(?:(?![Aa]nd\\b|[Oo]r\\b)[\\w'’.\\-]+)(?:\\s*\\([^)]*\\))?";
    // commas or semicolons between names (ESV sometimes uses ;)
    const nameSep = "[,;]\\s*";
    // "A, B, and C, " / "A and " / "A, then B, " (NLT/ESV 1 Chr) — allow mid-list "and"
    const listTail = `(?:(?:then\\s+)?${nameBit}\\s*${nameSep}|and\\s+${nameBit}\\s*${nameSep})*(?:(?:then\\s+)?${nameBit}\\s+and\\s+|and\\s+|then\\s+)?`;
    const begetVerb =
      "begat|begot|begotten|fathered|mothered|bore|bare|became the father of|was the father of|became the mother of|was the mother of|became the ancestor of|was the ancestor of|was also the ancestor of|gave birth to";
    // "... son(s)/daughter(s)/children/father/... of NAME"
    if (
      /(?:\bsons?|\bdaughters?|\bchildren|\bchild|\bfathers?|\bmothers?|\bwives?|\bhusbands?|\bbrothers?|\bsisters?|\bdescendants?|\bancestors?|\bgrandsons?|\bgranddaughters?|\bclans?|\bfamilies?|\boffspring)\s+of\s+$/i.test(
        before
      )
    ) {
      return true;
    }
    // "NAME, son of ..." / "NAME (the father of ..." / "NAME the wife of ..."
    if (
      /^\s*[,()]?\s*(?:the\s+)?(?:sons?|daughters?|children|child|fathers?|mothers?|wives?|wife|husbands?|husband|brothers?|brother|sisters?|sister|descendants?|ancestors?|grandsons?|granddaughters?|clans?|families?|offspring)\s+of\b/i.test(
        after
      )
    ) {
      return true;
    }
    // "Eshtemoa the Maacathite" (gentilic epithet on a person)
    if (/^\s+the\s+[\w'’.\-]+(?:ites?|ians?|ean|ene)\b/i.test(after)) {
      return true;
    }
    // "NAME fathered/was the ancestor of/had … sons" (optional comma after NAME)
    if (
      new RegExp(
        `^\\s*,?\\s*(?:${begetVerb}|had\\s+(?:\\w+\\s+){0,3}(?:sons?|daughters?|children|twins?))\\b`,
        "i"
      ).test(after)
    ) {
      return true;
    }
    // "Mareshah his firstborn, who fathered Ziph"
    if (/^\s+his\s+firstborn\b/i.test(after)) {
      return true;
    }
    // "Maacah, Caleb's concubine, bore …" / "Tamar also bore"
    if (
      /^\s*,\s*[\w'’.\-]+(?:['’]s)?\s+(?:concubine|wife|husband|daughter-in-law|son-in-law)\b/i.test(
        after
      ) ||
      /^\s+also\s+(?:bore|bare|fathered|begat|gave birth)\b/i.test(after)
    ) {
      return true;
    }
    // "… Abdon, Zicri, … were the sons of Shashak"
    if (
      new RegExp(
        `^(?:\\s*${nameSep}\\s*${nameBit}){0,12}\\s*(?:\\s*${nameSep}\\s*and\\s+${nameBit})?\\s+were\\s+(?:the\\s+)?(?:sons?|daughters?|children|descendants?)\\s+of\\b`,
        "i"
      ).test(after)
    ) {
      return true;
    }
    // "sons from Tamar, his … daughter-in-law" / "daughter-in-law Tamar"
    if (
      /^\s*,\s*(?:his|her)\s+(?:widowed\s+)?(?:daughter-in-law|son-in-law|wife|husband|concubine)\b/i.test(
        after
      ) ||
      /\b(?:daughter-in-law|son-in-law|concubine)\s+$/i.test(before)
    ) {
      return true;
    }
    // Matt 1: "Judah the father of Perez and Zerah by Tamar"
    if (
      /\b(?:father of|mother of)\s+[\w'’.\-]+(?:\s+and\s+[\w'’.\-]+)?\s+by\s+$/i.test(
        before
      )
    ) {
      return true;
    }
    // "Nahor’s brother Haran" / "his brother Philip"
    if (/\b(?:brother|sister|son|daughter|uncle|aunt|nephew|niece)\s+$/i.test(before)) {
      return true;
    }
    // "... fathered/was the father of/gave birth to NAME"
    if (new RegExp(`\\b(?:${begetVerb})\\s+$`, "i").test(before)) {
      return true;
    }
    // "married Ephrathah" / "concubines, Maacah"
    if (/\b(?:married|marries|wed)\s+$/i.test(before)) {
      return true;
    }
    if (
      /\b(?:wife|wives|husband|husbands|concubine|concubines|daughter-in-law|son-in-law)\s*,\s*$/i.test(
        before
      )
    ) {
      return true;
    }
    // "fathered A, B, C, and D" / continuing comma/semicolon lists after a beget verb
    if (
      new RegExp(
        `\\b(?:${begetVerb}|the father of|the mother of)\\s+${nameBit}(?:\\s*${nameSep}${nameBit})*\\s*${nameSep}(?:and\\s+)?$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // "named/called his/her son NAME" / "was named NAME" / "named Helah and Naarah"
    if (
      /\b(?:named|called)\s+(?:his|her|their)\s+(?:son|daughter|child|name)\s+$/i.test(
        before
      ) ||
      /\b(?:was\s+)?named\s+$/i.test(before) ||
      new RegExp(`\\bnamed\\s+${nameBit}\\s+and\\s+$`, "i").test(before)
    ) {
      return true;
    }
    // "had a son/daughter named NAME"
    if (/\bhad\s+a\s+(?:son|daughter|child)\s+named\s+$/i.test(before)) {
      return true;
    }
    // "bore/bare him/her NAME"
    if (/\b(?:bore|bare)\s+(?:him|her|them)\s+$/i.test(before)) {
      return true;
    }
    // "NAME son/daughter of" / "NAME was the son of" (Luke 3 verse splits)
    if (
      /^\s+(?:(?:was|is|became)\s+(?:the\s+)?)?(?:sons?|daughters?|children|child|fathers?|mothers?)\s+of\b/i.test(
        after
      )
    ) {
      return true;
    }
    // "the son of Shammai was Maon" (1 Chr style)
    if (
      /(?:\bsons?|\bdaughters?|\bchildren|\bchild|\bdescendants?)\s+of\s+[\w'’.\-]+(?:\s*\([^)]*\))?\s+was\s+$/i.test(
        before
      )
    ) {
      return true;
    }
    // "Their sister was named Tamar" / "His wife’s name was Maacah" / "Tamar was their sister"
    if (
      /\b(?:sister|brother|wife|husband|mother|father|daughter|son|concubine)(?:['’]s\s+name)?\s+was\s+(?:named\s+)?$/i.test(
        before
      ) ||
      /^\s+was\s+their\s+(?:sister|brother)\b/i.test(after)
    ) {
      return true;
    }
    // "two wives, Helah and Naarah" / "wives Helah and Naarah"
    if (
      new RegExp(
        `\\b(?:wives?|husbands?|sons?|daughters?)\\s*,?\\s*${nameBit}\\s+and\\s+$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // Genealogy name-lists (NLT/ESV 1 Chronicles especially):
    // "sons/descendants of X were/included/: A, B, and C"
    // allow short words: "sons of Shemer his brother: …" / appositive before were
    if (
      new RegExp(
        `(?:\\bsons?|\\bdaughters?|\\bchildren|\\bdescendants?|\\bancestors?|\\boffspring)\\s+of\\s+${nameBit}(?:\\s+${nameBit}){0,3}(?:,[^.]{0,50})?\\s*(?:were|included|are|[:;])\\s*${listTail}$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // ESV verse break continues a sons-of list: "The sons of Zophah: A, B. C, D, and E"
    if (
      new RegExp(
        `(?:\\bsons?|\\bdaughters?|\\bchildren|\\bdescendants?)\\s+of\\s+${nameBit}(?:\\s+${nameBit}){0,3}\\s*:\\s*[^.]{0,160}\\.\\s*$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // ESV: "The sons of Ishmael, Nebaioth, and Kedar, …" / "firstborn of Ishmael, Nebaioth, and Kedar"
    if (
      new RegExp(
        `(?:\\bsons?|\\bdaughters?|\\bchildren|\\bdescendants?|\\bancestors?|\\boffspring|\\bfirstborn)\\s+of\\s+${nameBit}\\s*,\\s*${listTail}$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // "and of Timna, Amalek" (descendant named after "of PARENT,")
    if (new RegExp(`\\band\\s+of\\s+${nameBit}\\s*,\\s*$`, "i").test(before)) {
      return true;
    }
    // "his/other sons were A, B, Gedor" / "These were their descendants: A, B"
    if (
      new RegExp(
        `(?:\\b(?:his|her|their|other|these)\\s+)?(?:sons?|daughters?|children|descendants?|ancestors?|offspring)\\s*(?:were|included|are|[:;])\\s*${listTail}$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // "Japheth's / Javan's descendants were A, B, and C"
    if (
      new RegExp(
        `[\\w'’.\\-]+(?:['’]s)\\s+(?:sons?|daughters?|children|descendants?|ancestors?|offspring)\\s*(?:were|included|are|[:;])\\s*${listTail}$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // "clan leaders/chiefs of Edom" (Edom itself) and "… were Timna, … Teman"
    if (/\b(?:clan\s+)?(?:leaders?|chiefs?)\s+of\s+$/i.test(before)) {
      return true;
    }
    if (
      new RegExp(
        `\\b(?:clan\\s+)?(?:leaders?|chiefs?)\\s+of\\s+${nameBit}\\s+were\\s*:?\\s*(?:(?:leaders?|chiefs?)\\s+)?${listTail}$`,
        "i"
      ).test(before)
    ) {
      return true;
    }
    // "His firstborn son: Abdon, then Zur…" / "his firstborn son Abdon, then Zur…"
    if (
      new RegExp(
        `\\b(?:firstborn\\s+son|oldest\\s+son)\\s*:?\\s*${listTail}$`,
        "i"
      ).test(before)
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
      // Block ASCII hyphen compounds (Tubal-cain); allow unicode dashes as punctuation (Dan—).
      const re = new RegExp(
        `(?<![A-Za-z0-9'])(?<!-)(${pattern})(?![A-Za-z0-9'])(?!-[A-Za-z0-9])`,
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
   * Map a character offset in a concatenated text-node string back to a node + local offset.
   * `pos` may be an exclusive end (== total length).
   */
  function locateInSegments(segments, pos) {
    if (!segments.length) return null;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const segEnd = seg.startInFull + seg.length;
      if (pos < segEnd) {
        return { node: seg.node, offset: pos - seg.startInFull };
      }
      if (pos === segEnd) {
        // Prefer end of this node; exclusive ends often land on the boundary.
        return { node: seg.node, offset: seg.length };
      }
    }
    const last = segments[segments.length - 1];
    return { node: last.node, offset: last.length };
  }

  /**
   * Build non-mutating Range hits for CSS Custom Highlight API.
   *
   * IMPORTANT: match against the concatenated chapter text, not each text node
   * alone. bible.com splits phrases across spans ("son of " | "Judah"), and
   * per-node matching loses kinship context — which is why genealogies still
   * highlighted person/place names in the live page.
   */
  function collectMatchRanges(root, placeMatchers) {
    const hits = [];
    const textNodes = collectTextNodes(root);
    if (!textNodes.length) return hits;

    let full = "";
    const segments = [];
    for (const node of textNodes) {
      const value = node.nodeValue || "";
      segments.push({ node, startInFull: full.length, length: value.length });
      full += value;
    }

    const matches = findMatchesInText(full, placeMatchers);
    for (const match of matches) {
      const startLoc = locateInSegments(segments, match.start);
      const endLoc = locateInSegments(segments, match.end);
      if (!startLoc || !endLoc) continue;
      try {
        const range = document.createRange();
        range.setStart(startLoc.node, startLoc.offset);
        range.setEnd(endLoc.node, endLoc.offset);
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
    locateInSegments,
    isGenealogyContext,
    detectJourneys,
    normalizeQuotes,
  };
})(typeof window !== "undefined" ? window : globalThis);
