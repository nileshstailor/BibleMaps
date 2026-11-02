/**
 * Site adapters for verse scanning.
 * Exposes window.BibleMapsSites — pickScanRoot / pickObserveRoot / passage metadata.
 *
 * Supported: bible.com (YouVersion), Bible Gateway, Blue Letter Bible, Bible Hub,
 * Bible Study Tools. Shared gazetteer matching lives in matcher.js.
 */
(function initBibleMapsSites(global) {
  function cleanPassageText(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(
        /\s*[|·•\-–—]\s*(YouVersion|Bible\.com|Bible Gateway|Blue Letter Bible|Bible Hub|Bible Study Tools|Biblia\.com|Biblia|Faithlife|Bible).*$/i,
        ""
      )
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

  /** Blue Letter Bible path codes (/niv/gen/12/1/, /niv/1ki/18/1/). */
  const BLB_BOOKS = {
    gen: "Genesis",
    exo: "Exodus",
    exod: "Exodus",
    lev: "Leviticus",
    num: "Numbers",
    deu: "Deuteronomy",
    deut: "Deuteronomy",
    jos: "Joshua",
    josh: "Joshua",
    jdg: "Judges",
    judg: "Judges",
    rut: "Ruth",
    ruth: "Ruth",
    "1sa": "1 Samuel",
    "2sa": "2 Samuel",
    "1ki": "1 Kings",
    "2ki": "2 Kings",
    "1ch": "1 Chronicles",
    "2ch": "2 Chronicles",
    ezr: "Ezra",
    ezra: "Ezra",
    neh: "Nehemiah",
    est: "Esther",
    esth: "Esther",
    job: "Job",
    psa: "Psalms",
    ps: "Psalms",
    pro: "Proverbs",
    prov: "Proverbs",
    ecc: "Ecclesiastes",
    sng: "Song of Songs",
    sos: "Song of Songs",
    isa: "Isaiah",
    jer: "Jeremiah",
    lam: "Lamentations",
    ezk: "Ezekiel",
    eze: "Ezekiel",
    dan: "Daniel",
    hos: "Hosea",
    jol: "Joel",
    joel: "Joel",
    amo: "Amos",
    amos: "Amos",
    oba: "Obadiah",
    jon: "Jonah",
    mic: "Micah",
    nam: "Nahum",
    nah: "Nahum",
    hab: "Habakkuk",
    zep: "Zephaniah",
    hag: "Haggai",
    zec: "Zechariah",
    mal: "Malachi",
    mat: "Matthew",
    matt: "Matthew",
    mrk: "Mark",
    mark: "Mark",
    luk: "Luke",
    luke: "Luke",
    jhn: "John",
    joh: "John",
    john: "John",
    act: "Acts",
    acts: "Acts",
    rom: "Romans",
    "1co": "1 Corinthians",
    "2co": "2 Corinthians",
    gal: "Galatians",
    eph: "Ephesians",
    php: "Philippians",
    phi: "Philippians",
    col: "Colossians",
    "1th": "1 Thessalonians",
    "2th": "2 Thessalonians",
    "1ti": "1 Timothy",
    "2ti": "2 Timothy",
    tit: "Titus",
    phm: "Philemon",
    heb: "Hebrews",
    jas: "James",
    "1pe": "1 Peter",
    "2pe": "2 Peter",
    "1jn": "1 John",
    "2jn": "2 John",
    "3jn": "3 John",
    jud: "Jude",
    jude: "Jude",
    rev: "Revelation",
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

  /** Parse "Genesis 12", "1 Kings 18", "Acts 13:1-52", "Song of Songs 1". */
  function coordsFromSearchString(search) {
    const s = cleanPassageText(search).replace(/\+/g, " ");
    if (!s) return null;
    const m = s.match(
      /^((?:[123]\s+)?[A-Za-z]+(?:\s+(?:of\s+)?[A-Za-z]+)*)\s+(\d+)\b/i
    );
    if (!m) return null;
    return coordsFromBookChapter(m[1].replace(/\s+/g, " ").trim(), m[2]);
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

  function hrefOf(doc, href) {
    return href || doc.defaultView?.location?.href || "";
  }

  function pathOfHref(href) {
    const s = String(href || "");
    try {
      if (typeof URL !== "undefined") return new URL(s).pathname;
    } catch {
      /* fall through */
    }
    const m = s.match(/^https?:\/\/[^/?#]+(\/[^?#]*)/i);
    return m ? m[1] : s;
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
    pickObserveRoot(doc) {
      return (
        doc.querySelector("main") ||
        doc.querySelector("[class*='ChapterContent']") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      try {
        const path = new URL(hrefOf(doc, href)).pathname;
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
        const path = new URL(hrefOf(doc, href)).pathname;
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
     * Prefer `.std-text` when present (NIV often wraps verses there).
     * NLT/ESV omit `.std-text` — verses sit directly under `.text-html` with
     * footnotes/crossrefs as sibling sections (matcher skips those classes).
     */
    pickScanRoot(doc) {
      const std = firstMatching(doc, [
        ".passage-text .std-text",
        ".passage-content .std-text",
        ".std-text",
      ]);
      if (std) return std;

      const htmlRoot = firstMatching(doc, [
        ".passage-text .text-html",
        ".passage-content .text-html",
        ".passage-text .result-text-style-normal",
        "[class*='result-text-style']",
      ]);
      if (htmlRoot) return htmlRoot;

      const passage = firstMatching(doc, [".passage-text", ".passage-content"]);
      if (passage) return passage;

      const main = doc.querySelector("main") || doc.querySelector("#content");
      if (main && (main.innerText || "").trim().length > 40) return main;
      return doc.body;
    },
    pickObserveRoot(doc) {
      return (
        doc.querySelector(".passage-box") ||
        doc.querySelector(".passage-resources") ||
        doc.querySelector(".passage-text") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      const osisEls = doc.querySelectorAll("[data-osis]");
      for (const osisEl of osisEls) {
        const osis = osisEl.getAttribute("data-osis") || "";
        const om = osis.match(/^([0-9A-Za-z]+)\.(\d+)/);
        if (!om) continue;
        const book =
          OSIS_BOOKS[om[1]] ||
          OSIS_BOOKS[om[1].replace(/^([12])/, "$1")] ||
          null;
        const coords = coordsFromBookChapter(book, om[2]);
        if (coords) return coords;
      }

      try {
        const url = new URL(hrefOf(doc, href));
        const search =
          url.searchParams.get("search") ||
          url.searchParams.get("search_term") ||
          "";
        const coords = coordsFromSearchString(search);
        if (coords) return coords;
      } catch {
        /* ignore */
      }

      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const fromChrome = labelFromSelectors(doc, [
        ".passage-resources .bcv .dropdown-display-text",
        ".bcv .dropdown-display-text",
        ".passage-display-bcv",
        ".passage-display",
        "h1.passage-display",
        ".passage-box h1",
        ".passage-resources h1",
      ]);
      if (fromChrome) {
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
        const url = new URL(hrefOf(doc, href));
        const search = cleanPassageText(
          (url.searchParams.get("search") || "").replace(/\+/g, " ")
        );
        const version = (url.searchParams.get("version") || "").toUpperCase();
        if (search) {
          const base = search.replace(/:\d[\d\-–—,;\s]*$/i, "").trim();
          return version ? `${base} ${version}` : base;
        }
      } catch {
        /* ignore */
      }

      const title = cleanPassageText(doc.title);
      const tm = title.match(
        /^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?\s+\d+(?:\s+[A-Za-z0-9]+)?)\b/
      );
      if (tm) return tm[1];
      return title || "";
    },
  };

  const blueLetterBible = {
    id: "blueletterbible",
    label: "Blue Letter Bible",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return (
        h === "blueletterbible.org" || h.endsWith(".blueletterbible.org")
      );
    },
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        "#bibleTable",
        ".bibleTable",
        "[class*='scriptureText']",
        ".EngBibleText",
      ]);
      if (root) return root;
      return doc.body;
    },
    pickObserveRoot(doc) {
      return (
        doc.querySelector("#bibleTable") ||
        doc.querySelector(".bibleTable") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        // /niv/gen/12/1/ or /niv/1ki/18/1/
        const m = path.match(
          /\/(?:[a-z0-9]+)\/([0-9]?[a-z]+)\/(\d+)(?:\/\d+)?\/?/i
        );
        if (m) {
          const code = m[1].toLowerCase();
          const book = BLB_BOOKS[code] || BLB_BOOKS[code.replace(/^([12])/, "$1")];
          const coords = coordsFromBookChapter(book, m[2]);
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
        ".bibleTitle",
        "[class*='ChapterTitle']",
        "title",
      ]);
      if (fromChrome) return fromChrome;
      const title = cleanPassageText(doc.title);
      const tm = title.match(
        /^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?\s+\d+(?:\s*\([A-Za-z0-9]+\))?)/
      );
      if (tm) return tm[1].replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        const m = path.match(/\/([a-z0-9]+)\/([0-9]?[a-z]+)\/(\d+)/i);
        if (m) {
          const book =
            BLB_BOOKS[m[2].toLowerCase()] ||
            BLB_BOOKS[m[2].toLowerCase().replace(/^([12])/, "$1")];
          if (book) return `${book} ${m[3]} ${m[1].toUpperCase()}`;
        }
      } catch {
        /* ignore */
      }
      return title || "";
    },
  };

  const bibleHub = {
    id: "biblehub",
    label: "Bible Hub",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return h === "biblehub.com" || h.endsWith(".biblehub.com");
    },
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        ".chap",
        "#leftbox",
        "#leftmain",
        ".padleft",
      ]);
      if (root) return root;
      return doc.body;
    },
    pickObserveRoot(doc) {
      return (
        doc.querySelector("#leftbox") ||
        doc.querySelector(".chap") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        // /niv/acts/13.htm or /acts/13.htm or /1_kings/18.htm
        const m = path.match(
          /\/(?:[a-z0-9]+\/)?([a-z0-9_]+)\/(\d+)\.htm/i
        );
        if (m) {
          const raw = m[1].replace(/_/g, " ");
          const book = titleCaseBook(raw);
          const coords = coordsFromBookChapter(book, m[2]);
          if (coords) return coords;
        }
      } catch {
        /* ignore */
      }
      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const fromChrome = labelFromSelectors(doc, [
        "#topheading",
        "h1",
        ".topheading",
      ]);
      if (fromChrome) return fromChrome;
      const title = cleanPassageText(doc.title);
      const tm = title.match(
        /^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?\s+\d+(?:\s+[A-Za-z0-9]+)?)/
      );
      if (tm) return tm[1];
      return title || "";
    },
  };

  function titleCaseBook(slug) {
    const s = String(slug || "").replace(/[_-]+/g, " ").trim();
    const known = {
      genesis: "Genesis",
      exodus: "Exodus",
      leviticus: "Leviticus",
      numbers: "Numbers",
      deuteronomy: "Deuteronomy",
      joshua: "Joshua",
      judges: "Judges",
      ruth: "Ruth",
      "1 samuel": "1 Samuel",
      "2 samuel": "2 Samuel",
      "1 kings": "1 Kings",
      "2 kings": "2 Kings",
      "1 chronicles": "1 Chronicles",
      "2 chronicles": "2 Chronicles",
      ezra: "Ezra",
      nehemiah: "Nehemiah",
      esther: "Esther",
      job: "Job",
      psalms: "Psalms",
      psalm: "Psalms",
      proverbs: "Proverbs",
      ecclesiastes: "Ecclesiastes",
      "song of songs": "Song of Songs",
      "song of solomon": "Song of Songs",
      isaiah: "Isaiah",
      jeremiah: "Jeremiah",
      lamentations: "Lamentations",
      ezekiel: "Ezekiel",
      daniel: "Daniel",
      hosea: "Hosea",
      joel: "Joel",
      amos: "Amos",
      obadiah: "Obadiah",
      jonah: "Jonah",
      micah: "Micah",
      nahum: "Nahum",
      habakkuk: "Habakkuk",
      zephaniah: "Zephaniah",
      haggai: "Haggai",
      zechariah: "Zechariah",
      malachi: "Malachi",
      matthew: "Matthew",
      mark: "Mark",
      luke: "Luke",
      john: "John",
      acts: "Acts",
      romans: "Romans",
      "1 corinthians": "1 Corinthians",
      "2 corinthians": "2 Corinthians",
      galatians: "Galatians",
      ephesians: "Ephesians",
      philippians: "Philippians",
      colossians: "Colossians",
      "1 thessalonians": "1 Thessalonians",
      "2 thessalonians": "2 Thessalonians",
      "1 timothy": "1 Timothy",
      "2 timothy": "2 Timothy",
      titus: "Titus",
      philemon: "Philemon",
      hebrews: "Hebrews",
      james: "James",
      "1 peter": "1 Peter",
      "2 peter": "2 Peter",
      "1 john": "1 John",
      "2 john": "2 John",
      "3 john": "3 John",
      jude: "Jude",
      revelation: "Revelation",
    };
    const key = s.toLowerCase();
    if (known[key]) return known[key];
    return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  const bibleStudyTools = {
    id: "biblestudytools",
    label: "Bible Study Tools",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return (
        h === "biblestudytools.com" || h.endsWith(".biblestudytools.com")
      );
    },
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        ".bible-verses",
        "[class*='bible-verses']",
        ".bible-verse-row",
        "[class*='bible-text']",
      ]);
      if (root) return root;
      return doc.body;
    },
    pickObserveRoot(doc) {
      return (
        doc.querySelector(".bible-verses") ||
        doc.querySelector("[class*='bible-verses']") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        // /acts/13.html or /1-kings/18.html
        const m = path.match(/\/([a-z0-9-]+)\/(\d+)(?:-\d+)?\.html?/i);
        if (m) {
          const book = titleCaseBook(m[1].replace(/-/g, " "));
          const coords = coordsFromBookChapter(book, m[2]);
          if (coords) return coords;
        }
      } catch {
        /* ignore */
      }
      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const fromChrome = labelFromSelectors(doc, ["h1", "header h1", "main h1"]);
      if (fromChrome) return fromChrome;
      const title = cleanPassageText(doc.title);
      const tm = title.match(
        /^((?:[123]\s+)?[A-Za-z][A-Za-z\s\-]*?\s+\d+)/
      );
      if (tm) return tm[1].replace(/-/g, " ");
      return title || "";
    },
  };

  /** Faithlife Biblia URL codes (Ge12, 1Ki18, Ac13, …). */
  const BIBLIA_BOOKS = {
    Ge: "Genesis",
    Ex: "Exodus",
    Lev: "Leviticus",
    Nu: "Numbers",
    Num: "Numbers",
    Dt: "Deuteronomy",
    Deu: "Deuteronomy",
    Jos: "Joshua",
    Jdg: "Judges",
    Ru: "Ruth",
    "1Sa": "1 Samuel",
    "2Sa": "2 Samuel",
    "1Ki": "1 Kings",
    "2Ki": "2 Kings",
    "1Ch": "1 Chronicles",
    "2Ch": "2 Chronicles",
    Ezr: "Ezra",
    Ne: "Nehemiah",
    Neh: "Nehemiah",
    Es: "Esther",
    Est: "Esther",
    Job: "Job",
    Ps: "Psalms",
    Pr: "Proverbs",
    Pro: "Proverbs",
    Ec: "Ecclesiastes",
    Ecc: "Ecclesiastes",
    So: "Song of Songs",
    Sos: "Song of Songs",
    Is: "Isaiah",
    Isa: "Isaiah",
    Je: "Jeremiah",
    Jer: "Jeremiah",
    La: "Lamentations",
    Lam: "Lamentations",
    Eze: "Ezekiel",
    Ezk: "Ezekiel",
    Da: "Daniel",
    Dan: "Daniel",
    Ho: "Hosea",
    Hos: "Hosea",
    Joe: "Joel",
    Am: "Amos",
    Ob: "Obadiah",
    Jon: "Jonah",
    Mic: "Micah",
    Na: "Nahum",
    Nah: "Nahum",
    Hab: "Habakkuk",
    Zep: "Zephaniah",
    Hag: "Haggai",
    Zec: "Zechariah",
    Mal: "Malachi",
    Mt: "Matthew",
    Matt: "Matthew",
    Mk: "Mark",
    Mrk: "Mark",
    Lk: "Luke",
    Luk: "Luke",
    Jn: "John",
    Jhn: "John",
    Ac: "Acts",
    Act: "Acts",
    Ro: "Romans",
    Rom: "Romans",
    "1Co": "1 Corinthians",
    "2Co": "2 Corinthians",
    Gal: "Galatians",
    Eph: "Ephesians",
    Php: "Philippians",
    Col: "Colossians",
    "1Th": "1 Thessalonians",
    "2Th": "2 Thessalonians",
    "1Ti": "1 Timothy",
    "2Ti": "2 Timothy",
    Tit: "Titus",
    Phm: "Philemon",
    Heb: "Hebrews",
    Jas: "James",
    "1Pe": "1 Peter",
    "2Pe": "2 Peter",
    "1Jn": "1 John",
    "2Jn": "2 John",
    "3Jn": "3 John",
    Jud: "Jude",
    Re: "Revelation",
    Rev: "Revelation",
  };

  function parseBibliaArticle(doc) {
    const el =
      doc.querySelector(".content-chunk[data-article]") ||
      doc.querySelector("[data-article]");
    if (!el) return null;
    const raw = el.getAttribute("data-article") || "";
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      try {
        // Attribute may still contain HTML entities in some snapshots.
        const decoded = raw
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'");
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    }
  }

  function coordsFromBibliaRef(code) {
    const s = String(code || "").trim();
    // Ge12 / Ge12.1-20 / 1Ki18 / Genesis 12:1–20
    const compact = s.match(/^([1-3]?[A-Za-z]+?)(\d+)\b/);
    if (compact) {
      const bookCode = compact[1];
      const book =
        BIBLIA_BOOKS[bookCode] ||
        BIBLIA_BOOKS[bookCode.replace(/^([123])/, "$1")] ||
        OSIS_BOOKS[bookCode] ||
        BLB_BOOKS[bookCode.toLowerCase()];
      const coords = coordsFromBookChapter(book, compact[2]);
      if (coords) return coords;
    }
    return coordsFromSearchString(s.replace(/[–—]/g, "-").replace(/:.*$/, ""));
  }

  const biblia = {
    id: "biblia",
    label: "Biblia",
    matchesHost(hostname) {
      const h = String(hostname || "").toLowerCase();
      return h === "biblia.com" || h.endsWith(".biblia.com");
    },
    /**
     * Faithlife Biblia renders chapter HTML in `.resourcetext` inside
     * `.content-chunk`. Footnote popups use <a rel="popup" data-content=…>
     * (attribute payload — skipped in matcher).
     */
    pickScanRoot(doc) {
      const root = firstMatching(doc, [
        ".resource-content .resourcetext",
        ".content-chunk .resourcetext",
        ".resourcetext",
        ".content-chunk",
        ".scrolling-content",
        ".resource-content",
      ]);
      if (root) return root;
      return doc.body;
    },
    pickObserveRoot(doc) {
      return (
        doc.querySelector(".resource-content") ||
        doc.querySelector("#content-container") ||
        doc.querySelector("#content-pane-full") ||
        doc.querySelector(".content-pane") ||
        this.pickScanRoot(doc)
      );
    },
    readPassageCoords(doc, href) {
      const article = parseBibliaArticle(doc);
      if (article) {
        const fromRequested = coordsFromSearchString(
          String(article.requestedReference || "")
            .replace(/[–—]/g, "-")
            .replace(/:.*$/, "")
        );
        if (fromRequested) return fromRequested;
        const fromUrlRef = coordsFromBibliaRef(article.urlReference || "");
        if (fromUrlRef) return fromUrlRef;
        // articleId like BOOK.1.12 (Genesis = 1)
        const am = String(article.articleId || "").match(
          /^BOOK\.(\d+)\.(\d+)/i
        );
        if (am) {
          const book = BIBLIA_BOOK_NUM[Number(am[1])];
          const coords = coordsFromBookChapter(book, am[2]);
          if (coords) return coords;
        }
      }

      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        // /books/niv2011/Ge12 or /bible/niv2011/Ge12.1-20
        let m = path.match(
          /\/(?:books|bible)\/[^/]+\/([1-3]?[A-Za-z]+)(\d+)/i
        );
        if (m) {
          const coords = coordsFromBibliaRef(`${m[1]}${m[2]}`);
          if (coords) return coords;
        }
        // /bible/niv/Genesis/12
        m = path.match(/\/bible\/[^/]+\/([^/]+)\/(\d+)/i);
        if (m) {
          const book = titleCaseBook(decodeURIComponent(m[1]).replace(/_/g, " "));
          const coords = coordsFromBookChapter(book, m[2]);
          if (coords) return coords;
        }
      } catch {
        /* ignore */
      }

      // First verse milestone
      const refEl = doc.querySelector(
        ".resourcetext [data-reference], a[data-reference][rel='milestone']"
      );
      const ref = refEl?.getAttribute("data-reference") || "";
      const fromMilestone = coordsFromSearchString(
        ref.replace(/[–—]/g, "-").replace(/:.*$/, "")
      );
      if (fromMilestone) return fromMilestone;

      return coordsFromLabel(this.readPassageLabel(doc, href));
    },
    readPassageLabel(doc, href) {
      const article = parseBibliaArticle(doc);
      if (article?.requestedReference) {
        const base = cleanPassageText(
          String(article.requestedReference).replace(/[–—]/g, "-")
        ).replace(/:\d.*$/, "");
        const version = cleanPassageText(
          doc.querySelector(".resource-title")?.textContent || ""
        );
        // Prefer short version token from URL resource name when title is long.
        let verShort = "";
        try {
          const path = pathOfHref(hrefOf(doc, href));
          const resourceMatch = path.match(
            /\/(?:books|bible)\/([^/]+)(?:\/|$)/i
          );
          if (resourceMatch) {
            verShort = resourceMatch[1]
              .toUpperCase()
              .replace(/(\d{4})$/, "")
              .replace(/[_-]+$/g, "");
          }
        } catch {
          /* ignore */
        }
        if (verShort && verShort.length >= 2 && verShort.length < 12) {
          return `${base} ${verShort}`;
        }
        if (version && version.length < 40) return `${base} (${version})`;
        return base;
      }

      const fromChrome = labelFromSelectors(doc, [
        ".resource-title",
        "h1",
        "[class*='reference']",
      ]);
      if (fromChrome && /\d/.test(fromChrome)) return fromChrome;

      try {
        const path = new URL(hrefOf(doc, href)).pathname;
        const m = path.match(
          /\/(?:books|bible)\/([^/]+)\/([1-3]?[A-Za-z]+)(\d+)/i
        );
        if (m) {
          const coords = coordsFromBibliaRef(`${m[2]}${m[3]}`);
          if (coords) {
            return `${coords.book} ${coords.chapter} ${m[1].toUpperCase()}`;
          }
        }
      } catch {
        /* ignore */
      }

      return cleanPassageText(doc.title) || "";
    },
  };

  /** Biblia articleId BOOK.N.chapter — Protestant order. */
  const BIBLIA_BOOK_NUM = {
    1: "Genesis",
    2: "Exodus",
    3: "Leviticus",
    4: "Numbers",
    5: "Deuteronomy",
    6: "Joshua",
    7: "Judges",
    8: "Ruth",
    9: "1 Samuel",
    10: "2 Samuel",
    11: "1 Kings",
    12: "2 Kings",
    13: "1 Chronicles",
    14: "2 Chronicles",
    15: "Ezra",
    16: "Nehemiah",
    17: "Esther",
    18: "Job",
    19: "Psalms",
    20: "Proverbs",
    21: "Ecclesiastes",
    22: "Song of Songs",
    23: "Isaiah",
    24: "Jeremiah",
    25: "Lamentations",
    26: "Ezekiel",
    27: "Daniel",
    28: "Hosea",
    29: "Joel",
    30: "Amos",
    31: "Obadiah",
    32: "Jonah",
    33: "Micah",
    34: "Nahum",
    35: "Habakkuk",
    36: "Zephaniah",
    37: "Haggai",
    38: "Zechariah",
    39: "Malachi",
    40: "Matthew",
    41: "Mark",
    42: "Luke",
    43: "John",
    44: "Acts",
    45: "Romans",
    46: "1 Corinthians",
    47: "2 Corinthians",
    48: "Galatians",
    49: "Ephesians",
    50: "Philippians",
    51: "Colossians",
    52: "1 Thessalonians",
    53: "2 Thessalonians",
    54: "1 Timothy",
    55: "2 Timothy",
    56: "Titus",
    57: "Philemon",
    58: "Hebrews",
    59: "James",
    60: "1 Peter",
    61: "2 Peter",
    62: "1 John",
    63: "2 John",
    64: "3 John",
    65: "Jude",
    66: "Revelation",
  };

  const ADAPTERS = [
    bibleCom,
    bibleGateway,
    blueLetterBible,
    bibleHub,
    bibleStudyTools,
    biblia,
  ];

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
    coordsFromSearchString,
  };
})(typeof window !== "undefined" ? window : globalThis);
