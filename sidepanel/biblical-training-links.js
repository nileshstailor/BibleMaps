/**
 * BiblicalTraining.org library links — mirrors iOS BiblicalTrainingLinks.swift.
 */
(() => {
  const SLUG_OVERRIDES = {
    "antioch of pisidia": "antioch-of-pisidia",
    "caesarea maritima": "caesarea",
    "plains of moab": "moab",
    "plain of dura": "dura",
    "hill country of ephraim": "ephraim",
    "forest of ephraim": "ephraim",
    "wilderness of judea": "judea",
    "wilderness of judah": "judah",
    "akeldama (field of blood)": "akeldama",
    "migdal eder (tower of edar)": "migdal-eder",
    "brook of egypt": "brook-of-egypt",
    "sea of adria": "adria",
    "abana river": "abana",
    "pharpar river": "pharpar",
    "aenon near salim": "aenon",
    "forum of appius": "forum-of-appius",
    "valley of craftsmen": "valley-of-craftsmen",
    "mount hermon": "hermon",
    "mount carmel": "carmel",
    "mount zemaraim": "zemaraim",
    "kidron valley": "kidron",
    "brook besor": "besor",
    "brook zered": "zered",
    "brook kanah": "kanah",
    tishbe: "thisbe",
    parthia: "parthians",
  };

  const OF_PREFIXES = [
    "plains of ",
    "plain of ",
    "valley of ",
    "valleys of ",
    "wilderness of ",
    "desert of ",
    "land of ",
    "territory of ",
    "region of ",
    "mountains of ",
    "hills of ",
    "hill of ",
    "hill country of ",
    "forest of ",
    "waters of ",
    "water of ",
    "pool of ",
    "cave of ",
    "well of ",
    "spring of ",
    "brook of ",
    "river of ",
    "rock of ",
    "stone of ",
    "ascent of ",
    "gate of ",
    "tower of ",
    "field of ",
    "house of ",
  ];

  let verifiedSlugs = null;
  let slugsPromise = null;

  function slugify(name) {
    const folded = String(name)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    let out = "";
    let pendingHyphen = false;
    for (const ch of folded) {
      if (/[a-z0-9]/.test(ch)) {
        if (pendingHyphen && out) out += "-";
        pendingHyphen = false;
        out += ch;
      } else if (ch === "'" || ch === "\u2019") {
        /* skip */
      } else {
        pendingHyphen = true;
      }
    }
    while (out.includes("--")) out = out.replace("--", "-");
    return out.replace(/^-+|-+$/g, "");
  }

  function candidateSlugs(place) {
    const ordered = [];
    const add = (slug) => {
      if (!slug || ordered.includes(slug)) return;
      ordered.push(slug);
    };

    const labels = [place?.name, ...(place?.aliases || [])]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    for (const raw of labels) {
      const key = raw.toLowerCase();
      if (SLUG_OVERRIDES[key]) add(SLUG_OVERRIDES[key]);

      for (const prefix of OF_PREFIXES) {
        if (key.startsWith(prefix)) {
          add(slugify(raw.slice(prefix.length)));
        }
      }

      if (key.startsWith("mount ")) {
        add(slugify(raw.slice(6)));
        add(slugify(raw));
      } else if (key.startsWith("sea of ")) {
        add(slugify(raw));
        add(slugify(raw.slice(7)));
      } else if (key.endsWith(" river")) {
        add(slugify(key.slice(0, -6)));
        add(slugify(raw));
      } else if (key.startsWith("brook ")) {
        add(slugify(raw.slice(6)));
        add(slugify(raw));
      } else if (key.endsWith(" sea") && !key.startsWith("sea ")) {
        add(slugify(raw));
        add(slugify(key.slice(0, -4)));
      }

      const paren = raw.indexOf("(");
      if (paren > 0) add(slugify(raw.slice(0, paren)));

      add(slugify(raw));
    }
    return ordered;
  }

  function encyclopediaSlug(place) {
    const verified = verifiedSlugs?.[place?.id];
    if (verified) return verified;
    const candidates = candidateSlugs(place);
    return candidates[0] || "bible";
  }

  function placeURL(place) {
    const slug = encyclopediaSlug(place);
    return `https://www.biblicaltraining.org/library/${encodeURIComponent(slug)}`;
  }

  async function ensureSlugs() {
    if (verifiedSlugs) return verifiedSlugs;
    if (!slugsPromise) {
      slugsPromise = fetch(
        chrome.runtime.getURL("data/biblical-training-slugs.json")
      )
        .then((r) => {
          if (!r.ok) throw new Error(`slugs HTTP ${r.status}`);
          return r.json();
        })
        .then((map) => {
          verifiedSlugs = map && typeof map === "object" ? map : {};
          return verifiedSlugs;
        })
        .catch(() => {
          verifiedSlugs = {};
          return verifiedSlugs;
        });
    }
    return slugsPromise;
  }

  window.BiblicalTrainingLinks = { placeURL, ensureSlugs, encyclopediaSlug };
})();
