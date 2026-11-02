#!/usr/bin/env node
/**
 * Smoke-test site adapters against real passage HTML for multiple chapters/hosts.
 *
 * Usage: node scripts/test-multisite-adapters.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = (() => {
  try {
    return require("jsdom");
  } catch {
    return { JSDOM: null };
  }
})();

const ROOT = path.join(__dirname, "..");
const CACHE_DIR = "/tmp/biblemaps-multisite";

const CASES = [
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=Genesis+12&version=NIV",
    book: "Genesis",
    chapter: 12,
    expectPlaces: ["Haran", "Canaan", "Egypt", "Shechem"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=Acts+13&version=NIV",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch", "Cyprus"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=John+4&version=NIV",
    book: "John",
    chapter: 4,
    expectPlaces: ["Samaria", "Galilee"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=1+Kings+18&version=NIV",
    book: "1 Kings",
    chapter: 18,
    expectPlaces: ["Mount Carmel", "Jezreel"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=Exodus+14&version=NIV",
    book: "Exodus",
    chapter: 14,
    expectPlaces: ["Egypt"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=1%20Kings%2014&version=NLT",
    book: "1 Kings",
    chapter: 14,
    expectPlaces: ["Jerusalem"],
  },
  {
    host: "www.biblegateway.com",
    id: "biblegateway",
    url: "https://www.biblegateway.com/passage/?search=Acts+13:1-52&version=ESV",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch"],
  },
  {
    host: "www.blueletterbible.org",
    id: "blueletterbible",
    url: "https://www.blueletterbible.org/niv/act/13/1/",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch"],
  },
  {
    host: "biblehub.com",
    id: "biblehub",
    url: "https://biblehub.com/niv/acts/13.htm",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch"],
  },
  {
    host: "www.biblestudytools.com",
    id: "biblestudytools",
    url: "https://www.biblestudytools.com/acts/13.html",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch"],
  },
];

function loadSites() {
  const sandbox = { window: {}, console, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "content/sites.js"), "utf8"),
    sandbox
  );
  return sandbox.window.BibleMapsSites;
}

function loadMatcher() {
  const sandbox = { window: {}, console, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "content/matcher.js"), "utf8"),
    sandbox
  );
  return sandbox.window.BibleMapsMatcher;
}

async function loadHtml(url) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const key = url.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 120);
  const cacheFile = path.join(CACHE_DIR, `${key}.html`);
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, "utf8");
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BibleMapsTest/1.0; +https://github.com/nileshstailor/BibleMaps)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const html = await res.text();
  fs.writeFileSync(cacheFile, html);
  return html;
}

function stripTags(html) {
  return String(html || "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFallbackText(html, id) {
  if (id === "biblegateway") {
    const std = html.match(
      /class=['"]std-text['"][^>]*>([\s\S]*?)(?:<div class=['"]footnotes|<div class=['"]crossrefs|<div class=['"]publisher)/i
    );
    if (std) return stripTags(std[1]);
    const htmlRoot = html.match(
      /class="[^"]*text-html[^"]*"[^>]*>([\s\S]*?)(?:<div class=['"]footnotes|<div class=['"]crossrefs|<div class=['"]publisher)/i
    );
    if (htmlRoot) return stripTags(htmlRoot[1]);
  }
  if (id === "blueletterbible") {
    const parts = [
      ...html.matchAll(
        /class="[^"]*scriptureText[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
      ),
    ];
    if (parts.length) return stripTags(parts.map((p) => p[1]).join(" "));
  }
  if (id === "biblehub") {
    const chap = html.match(/class="chap"[^>]*>([\s\S]*?)(?:<div id="footnotes"|<div class="bot"|<\/td>)/i);
    if (chap) return stripTags(chap[1]);
  }
  if (id === "biblestudytools") {
    const verses = html.match(
      /class="bible-verses[^"]*"[^>]*>([\s\S]*?)(?:<\/div>\s*<div[^>]*class="[^"]*(?:related|footer)|$)/i
    );
    if (verses) return stripTags(verses[1]);
    const rows = [...html.matchAll(/class="bible-text"[^>]*>([\s\S]*?)<\/span>/gi)];
    if (rows.length) return stripTags(rows.map((r) => r[1]).join(" "));
  }
  return stripTags(html).slice(0, 20000);
}

async function runCase(Sites, M, matchers, c) {
  const adapter = Sites.resolveAdapter(c.host);
  if (adapter.id !== c.id) {
    throw new Error(`${c.url}: expected adapter ${c.id}, got ${adapter.id}`);
  }
  const html = await loadHtml(c.url);
  let rootText = "";
  let label = "";
  let coords = null;
  let rootCls = "";

  if (JSDOM) {
    const dom = new JSDOM(html, { url: c.url });
    const { document } = dom.window;
    const root = adapter.pickScanRoot(document);
    rootCls = String(root?.className || root?.id || root?.tagName || "");
    rootText = root?.innerText || "";
    label = adapter.readPassageLabel(document, c.url);
    coords = adapter.readPassageCoords(document, c.url);
    if (c.id === "biblegateway" && root?.querySelector) {
      // Prefer not to use a root that is ONLY footnotes, but text-html may contain them.
      const onlyFn =
        root.matches?.(".footnotes, .crossrefs") ||
        /^(footnotes|crossrefs)/i.test(rootCls);
      if (onlyFn) throw new Error("scan root is footnotes-only");
    }
  } else {
    rootText = extractFallbackText(html, c.id);
    // Minimal fake document for coords/label
    const osis = (html.match(/data-osis="([^"]+)"/) || [])[1] || "";
    const title = (html.match(/<title[^>]*>([^<]+)/i) || [])[1] || "";
    const fakeDoc = {
      title,
      querySelector(sel) {
        if (sel === "[data-osis]" || sel.includes("data-osis")) {
          return osis ? { getAttribute: () => osis } : null;
        }
        if (sel.includes("dropdown-display-text") && sel.includes("bcv")) {
          const m = title.match(/^((?:[123]\s+)?[A-Za-z][A-Za-z\s]*?\s+\d+)/);
          return m ? { textContent: m[1] } : null;
        }
        if (sel.includes("translation")) {
          const vm = c.url.match(/version=([A-Za-z0-9]+)/i);
          return vm ? { textContent: vm[1] } : null;
        }
        if (sel === "h1" || sel === "#topheading") {
          const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          return h ? { textContent: stripTags(h[1]) } : null;
        }
        return null;
      },
      querySelectorAll(sel) {
        if (sel === "[data-osis]") {
          return osis
            ? [{ getAttribute: () => osis }]
            : [];
        }
        return [];
      },
      defaultView: { location: { href: c.url } },
    };
    label = adapter.readPassageLabel(fakeDoc, c.url);
    coords = adapter.readPassageCoords(fakeDoc, c.url);
  }

  if (!coords || coords.book !== c.book || coords.chapter !== c.chapter) {
    throw new Error(
      `${c.url}: bad coords ${JSON.stringify(coords)} (want ${c.book} ${c.chapter}); label=${label}`
    );
  }
  if (!rootText || rootText.trim().length < 80) {
    throw new Error(`${c.url}: scan text too short (${rootText.length}) root=${rootCls}`);
  }

  const hits = M.findMatchesInText(rootText, matchers);
  const names = [...new Set(hits.map((h) => h.place?.name).filter(Boolean))];
  const missing = (c.expectPlaces || []).filter((n) => !names.includes(n));
  // Allow alias spelling variants for a couple of soft checks
  const softMissing = missing.filter((n) => {
    if (n === "Red Sea") return !names.some((x) => /red sea/i.test(x));
    if (n === "Antioch") return !names.some((x) => /antioch/i.test(x));
    return true;
  });
  if (softMissing.length) {
    throw new Error(
      `${c.url}: missing ${softMissing.join(", ")} — found: ${names.slice(0, 20).join(", ")}`
    );
  }

  return { url: c.url, id: c.id, label, coords, places: names.length, sample: names.slice(0, 8) };
}

async function main() {
  // Unit: search string parser
  const Sites = loadSites();
  const samples = [
    ["Genesis 12", "Genesis", 12],
    ["1 Kings 18", "1 Kings", 18],
    ["Acts 13:1-52", "Acts", 13],
    ["Song of Songs 1", "Song of Songs", 1],
  ];
  for (const [s, book, ch] of samples) {
    const c = Sites.coordsFromSearchString(s);
    if (!c || c.book !== book || c.chapter !== ch) {
      throw new Error(`coordsFromSearchString(${s}) -> ${JSON.stringify(c)}`);
    }
  }

  const M = loadMatcher();
  const places = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/places.json"), "utf8")
  );
  const matchers = M.buildPlaceMatchers(places);

  const results = [];
  for (const c of CASES) {
    results.push(await runCase(Sites, M, matchers, c));
    console.log(
      `OK ${c.id}: ${c.book} ${c.chapter} — ${results[results.length - 1].places} places`
    );
  }

  console.log("\nAll multi-site adapter checks passed.");
  for (const r of results) {
    console.log(`- ${r.id}: ${r.label} | ${r.sample.join(", ")}`);
    console.log(`  ${r.url}`);
  }
  if (!JSDOM) {
    console.log("(jsdom not installed — used HTML fallback extractors)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
