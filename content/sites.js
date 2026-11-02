/**
 * Site adapters for verse scanning (bible.com, Bible Gateway, …).
 * Exposes window.BibleMapsSites — pickScanRoot / passage metadata / host match.
 */
(function initBibleMapsSites(global) {
  function cleanPassageText(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(/\s*[|·•\-–—]\s*(YouVersion|Bible\.com|Bible Gateway|Bible).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** USFM-ish codes used by bible.com URLs (1KI, GEN, …). */
  const USFM_BOOKS = {
    GEN: "Genesis",
    EXO: "Exodus",
    LEV: "Leviticus",
    NUM: "Numbers",
    DEU: "Deuteronomy",
    JOS: "Joshua",
    JDG: "Judges",
    RUT: "Ruth",
    "1SA": "1 Samuel",
    "2SA": "2 Samuel",
    "1KI": "1 Kings",
    "2KI": "2 Kings",
    "1CH": "1 Chronicles",
    "2CH": "2 Chronicles",
    EZR: "Ezra",
    NEH: "Nehemiah",
    EST: "Esther",
    JOB: "Job",
    PSA: "Psalms",
    PRO: "Proverbs",
    ECC: "Ecclesiastes",
    SNG: "Song of Songs",
    ISA: "Isaiah",
    JER: "Jeremiah",
    LAM: "Lamentations",
    EZK: "Ezekiel",
    DAN: "Daniel",
    HOS: "Hosea",
    JOL: "Joel",
    AMO: "Amos",
    OBA: "Obadiah",
    JON: "Jonah",
    MIC: "Micah",
    NAM: "Nahum",
    HAB: "Habakkuk",
    ZEP: "Zephaniah",
    HAG: "Haggai",
    ZEC: "Zechariah",
    MAL: "Malachi",
    MAT: "Matthew",
    MRK: "Mark",
    LUK: "Luke",
    JHN: "John",
    ACT: "Acts",
    ROM: "Romans",
    "1CO": "1 Corinthians",
    "2CO": "2 Corinthians",
    GAL: "Galatians",
    EPH: "Ephesians",
    PHP: "Philippians",
    COL: "Colossians",
    "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians",
    "1TI": "1 Timothy",
    "2TI": "2 Timothy",
    TIT: "Titus",
    PHM: "Philemon",
    HEB: "Hebrews",
    JAS: "James",
    "1PE": "1 Peter",
    "2PE": "2 Peter",
    "1JN": "1 John",
    "2JN": "2 John",
    "3JN": "3 John",
    JUD: "Jude",
    REV: "Revelation",
  };

  /** OSIS / Bible Gateway codes (Gen, 1Kgs, Exod, …). */
  const OSIS_BOOKS = {
    Gen: "Genesis",
    Exod: "Exodus",
    Lev: "Leviticus",
    Num: "Numbers",
    Deut: "Deuteronomy",
    Josh: "Joshua",
    Judg: "Judges",
    Ruth: "Ruth",
    "1Sam": "1 Samuel",
    "2Sam": "2 Samuel",
    "1Kgs": "1 Kings",
    "2Kgs": "2 Kings",
    "1Chr": "1 Chronicles",
    "2Chr": "2 Chronicles",
    Ezra: "Ezra",
    Neh: "Nehemiah",
    Esth: "Esther",
    Job: "Job",
    Ps: "Psalms",
    Prov: "Proverbs",
    Eccl: "Ecclesiastes",
    Song: "Song of Songs",
    Isa: "Isaiah",
    Jer: "Jeremiah",
    Lam: "Lamentations",
    Ezek: "Ezekiel",
    Dan: "Daniel",
    Hos: "Hosea",
    Joel: "Joel",
    Amos: "Amos",
    Obad: "Obadiah",
    Jonah: "Jonah",
    Mic: "Micah",
    Nah: "Nahum",
    Hab: "Habakkuk",
    Zeph: "Zephaniah",
    Hag: "Haggai",
    Zech: "Zechariah",
    Mal: "Malachi",
    Matt: "Matthew",
    Mark: "Mark",
    Luke: "Luke",
    John: "John",
    Acts: "Acts",
    Rom: "Romans",
    "1Cor": "1 Corinthians",
    "2Cor": "2 Corinthians",
    Gal: "Galatians",
    Eph: "Ephesians",
    Phil: "Philippians",
    Col: "Colossians",
    "1Thess": "1 Thessalonians",
    "2Thess": "2 Thessalonians",
    "1Tim": "1 Timothy",
    "2Tim": "2 Timothy",
    Titus: "Titus",
    Phlm: "Philemon",
    Heb: "Hebrews",
    Jas: "James",
    "1Pet": "1 Peter",
    "2Pet": "2 Peter",
    "1John": "1 John",
    "2John": "2 John",
    "3John": "3 John",
    Jude: "Jude",
    Rev: "Revelation",
  };

  function expandUsfmPassage(raw) {
    const s = cleanPassageText(raw).replace(/\./g, " ");
    const m = s.match(/^([0-9A-Za-z]+)\s+(\d+)\s*([A-Za-z0-9]+)?/);
    if (!m) return "";
    const code = m[1].toUpperCase();
    const book =
      USFM_BOOKS[code] || USFM_BOOKS[code.replace(/^([12])/, "$1")] || null;
    if (!book) return "";
    const chapter = m[2];
    const version = (m[3] || "").toUpperCase();
    return version ? `${book} ${chapter} ${version}` : `${book} ${chapter}`;
  }

  function coordsFromBookChapter(book, chapter) {
    const b = String(book || "").trim();
    const ch = Number(chapter);
    if (!b || !Number.isFinite(ch) || ch < 1) return null;
    return { book: b, chapter: ch };
  }

  function coordsFromLabel(label) {
    const hm = String(label || "").match(
      /^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?)\s+(\d+)\b/
    );
    if (!hm) return null;
    return coordsFromBookChapter(hm[1], hm[2]);
  }

  function firstMatching(doc, selectors, minLen = 40) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && (el.innerText || "").trim().length > minLen) return el;
    }
    return null;
  }

  function labelFromSelectors(doc, selectors) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      const text = cleanPassageText(el?.textContent || "");
      if (
        text &&
        text.length < 80 &&
        /\d/.test(text) &&
        /[A-Za-z]{2,}/.test(text) &&
        !/^menu$/i.test(text)
      ) {
        return text;
      }
    }
    return "";
  }

  const bibleCom = {
    id: "biblecom",
    label: "bible.com",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return h === "bible.com" || h.endsWith(".bible.com");
    },
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        "[class*='ChapterContent_chapter']",
        "[class*='ChapterContent']",
        "[data-usfm]",
        "[class*='ChapterContent_verse']",
        "[data-verse-id]",
      ]);
      if (root) return root;
      const main = doc.querySelector("main");
      if (main && (main.innerText || "").trim().length > 40) return main;
      return doc.body;
    },
    readPassageCoords(doc, href) {
      try {
        const path = new URL(href || doc.defaultView?.location?.href || "").pathname;
        const m = path.match(/\/(?:bible\/\d+\/)?([0-9]?[A-Za-z]{2,3})\.(\d+)/i);
        if (m) {
          const label = expandUsfmPassage(`${m[1]} ${m[2]}`);
          const coords = coordsFromLabel(label);
          if (coords) return coords;
        }
      } catch {
        /* ignore */
      }
      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const fromChrome = labelFromSelectors(doc, [
        "h1",
        "[class*='ChapterTitle']",
        "[class*='chapter-title']",
        "[class*='ReaderHeader'] h1",
        "[class*='ReaderHeader'] h2",
        "[data-testid*='chapter']",
        "header h1",
        "main h1",
      ]);
      if (fromChrome) return fromChrome;

      const title = cleanPassageText(doc.title);
      if (title && !/^[0-9A-Z]{2,4}\s+\d+/i.test(title)) return title;
      if (title) {
        const expanded = expandUsfmPassage(title);
        if (expanded) return expanded;
      }

      try {
        const path = new URL(href || "").pathname;
        const m = path.match(/\/bible\/\d+\/([^/.]+)\.(\d+)\.([^/]+)/i);
        if (m) {
          const expanded = expandUsfmPassage(`${m[1]} ${m[2]} ${m[3]}`);
          if (expanded) return expanded;
        }
      } catch {
        /* ignore */
      }
      return title || "";
    },
  };

  const bibleGateway = {
    id: "biblegateway",
    label: "Bible Gateway",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return h === "biblegateway.com" || h.endsWith(".biblegateway.com");
    },
    /**
     * Prefer `.std-text` (verse body only). Footnotes / crossrefs live as
     * siblings under `.passage-text` and must not be scanned.
     */
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        ".passage-text .std-text",
        ".passage-content .std-text",
        ".passage-text .text-html",
        ".passage-content",
        ".passage-text",
        ".passage-box",
      ]);
      if (root) return root;
      const main = doc.querySelector("main") || doc.querySelector("#content");
      if (main && (main.innerText || "").trim().length > 40) return main;
      return doc.body;
    },
    readPassageCoords(doc, href) {
      // data-osis="Gen.12.1-Gen.12.20"
      const osisEl = doc.querySelector("[data-osis]");
      const osis = osisEl?.getAttribute("data-osis") || "";
      const om = osis.match(/^([0-9A-Za-z]+)\.(\d+)/);
      if (om) {
        const book = OSIS_BOOKS[om[1]] || OSIS_BOOKS[om[1].replace(/^([12])/, "$1")];
        const coords = coordsFromBookChapter(book, om[2]);
        if (coords) return coords;
      }

      try {
        const url = new URL(href || doc.defaultView?.location?.href || "");
        const search = url.searchParams.get("search") || "";
        // "Genesis 12" / "Genesis 12:1-20" / "1 Kings 14"
        const sm = search.match(
          /^((?:[123]\s+)?[A-Za-z][A-Za-z]*(?:\s+[A-Za-z]+)?)\s+(\d+)/
        );
        if (sm) {
          const coords = coordsFromBookChapter(sm[1], sm[2]);
          if (coords) return coords;
        }
      } catch {
        /* ignore */
      }

      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const fromChrome = labelFromSelectors(doc, [
        ".passage-resources .bcv .dropdown-display-text",
        ".bcv .dropdown-display-text",
        ".passage-display",
        "h1.passage-display",
        ".passage-box h1",
      ]);
      if (fromChrome) {
        // Append translation when nearby (e.g. "Genesis 12" + "NIV")
        const version = cleanPassageText(
          doc.querySelector(
            ".passage-resources .translation .dropdown-display-text, .translation .dropdown-display-text"
          )?.textContent || ""
        );
        if (version && version.length < 12 && !fromChrome.includes(version)) {
          return `${fromChrome} ${version}`;
        }
        return fromChrome;
      }

      try {
        const url = new URL(href || "");
        const search = cleanPassageText(url.searchParams.get("search") || "");
        const version = (url.searchParams.get("version") || "").toUpperCase();
        if (search) {
          const base = search.replace(/:\d.*$/, "").trim();
          return version ? `${base} ${version}` : base;
        }
      } catch {
        /* ignore */
      }

      const title = cleanPassageText(doc.title);
      // "Genesis 12 NIV - The Call of Abram - … - Bible Gateway"
      const tm = title.match(
        /^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?\s+\d+\s+[A-Za-z0-9]+)\b/
      );
      if (tm) return tm[1];
      return title || "";
    },
  };

  const ADAPTERS = [bibleCom, bibleGateway];

  function resolveAdapter(hostname) {
    const host = String(
      hostname ||
        (typeof location !== "undefined" ? location.hostname : "") ||
        ""
    );
    for (const adapter of ADAPTERS) {
      if (adapter.matchesHost(host)) return adapter;
    }
    return bibleCom;
  }

  global.BibleMapsSites = {
    adapters: ADAPTERS,
    resolveAdapter,
    cleanPassageText,
    expandUsfmPassage,
  };
})(typeof window !== "undefined" ? window : globalThis);
