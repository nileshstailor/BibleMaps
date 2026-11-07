#!/usr/bin/env node
/**
 * Smoke-test Faithlife Biblia (biblia.com) site adapter across chapters.
 *
 * Usage: node scripts/test-biblia-adapter.js
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
const CACHE_DIR = "/tmp/biblemaps-biblia";

const CASES = [
  {
    url: "https://biblia.com/books/niv2011/Ge12",
    book: "Genesis",
    chapter: 12,
    expectPlaces: ["Haran", "Canaan", "Egypt", "Shechem", "Bethel"],
  },
  {
    url: "https://biblia.com/books/niv2011/Ac13",
    book: "Acts",
    chapter: 13,
    expectPlaces: ["Antioch", "Cyprus"],
  },
  {
    url: "https://biblia.com/books/niv2011/Jn4",
    book: "John",
    chapter: 4,
    expectPlaces: ["Samaria", "Galilee"],
  },
  {
    url: "https://biblia.com/books/niv2011/1Ki18",
    book: "1 Kings",
    chapter: 18,
    expectPlaces: ["Mount Carmel", "Jezreel"],
  },
  {
    url: "https://biblia.com/books/niv2011/Ex14",
    book: "Exodus",
    chapter: 14,
    expectPlaces: ["Egypt"],
  },
  {
    url: "https://biblia.com/bible/niv2011/Ge12.1-20",
    book: "Genesis",
    chapter: 12,
    expectPlaces: ["Haran", "Shechem"],
    optionalFetch: true, // /bible/ may 429 from datacenter IPs
  },
];

function loadSites() {
  const sandbox = { window: {}, console, globalThis: {}, URL };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "content/sites.js"), "utf8"),
    sandbox
  );
  return sandbox.window.BibleMapsSites;
}

function loadMatcher() {
  const sandbox = { window: {}, console, globalThis: {}, URL };
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
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 1000) {
    return fs.readFileSync(cacheFile, "utf8");
  }
  // Prefer locally fetched probe files when present
  const ref = (url.match(/\/([1-3]?[A-Za-z]+\d+)/) || [])[1];
  const probe = ref && `/tmp/biblia-${ref.replace(/\..*$/, "")}.html`;
  if (probe && fs.existsSync(probe) && fs.statSync(probe).size > 1000) {
    const html = fs.readFileSync(probe, "utf8");
    fs.writeFileSync(cacheFile, html);
    return html;
  }
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
      Referer: "https://biblia.com/",
    },
  });
  if (!res.ok) {
    const err = new Error(`${url} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const html = await res.text();
  fs.writeFileSync(cacheFile, html);
  return html;
}

function stripTags(html) {
  return String(html || "")
    .replace(/\sdata-content="[^"]*"/gi, "")
    .replace(/<a\b[^>]*rel="popup"[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractResourceText(html) {
  const start = html.indexOf('class="resourcetext"');
  if (start < 0) return "";
  // Prefer end of the resource text chunk — avoid flip-side copyright chrome
  // ("non-saleable media…") which is outside .resourcetext in the live DOM.
  let end = html.indexOf('class="scroll-spacing"', start);
  if (end < 0) end = html.indexOf('class="back face"', start);
  if (end < 0) end = html.indexOf('id="lightbox-dim"', start);
  const body = html.slice(start, end > start ? end : start + 200000);
  return stripTags(body);
}

async function runCase(Sites, M, matchers, c) {
  const adapter = Sites.resolveAdapter("biblia.com");
  if (adapter.id !== "biblia") throw new Error("biblia host resolve failed");

  let html;
  try {
    html = await loadHtml(c.url);
  } catch (err) {
    if (c.optionalFetch && err.status === 429) {
      console.log(`SKIP optional ${c.url} (HTTP 429)`);
      return null;
    }
    throw err;
  }
  if (!html.includes("resourcetext") && c.optionalFetch) {
    console.log(`SKIP optional ${c.url} (no resourcetext)`);
    return null;
  }

  let rootText = "";
  let label = "";
  let coords = null;

  if (JSDOM) {
    const dom = new JSDOM(html, { url: c.url });
    const { document } = dom.window;
    const root = adapter.pickScanRoot(document);
    const cls = String(root?.className || "");
    if (!/resourcetext|content-chunk|scrolling-content|resource-content/i.test(cls)) {
      throw new Error(`unexpected scan root: ${root?.tagName} ${cls}`);
    }
    rootText = root.innerText || "";
    label = adapter.readPassageLabel(document, c.url);
    coords = adapter.readPassageCoords(document, c.url);
  } else {
    rootText = extractResourceText(html);
    const articleRaw = (html.match(/data-article="([^"]+)"/) || [])[1] || "";
    const articleJson = articleRaw
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    let article = null;
    try {
      article = JSON.parse(articleJson);
    } catch {
      /* ignore */
    }
    const fakeDoc = {
      title: (html.match(/<title[^>]*>([^<]+)/i) || [])[1] || "",
      querySelector(sel) {
        if (sel.includes("data-article") || sel.includes("content-chunk")) {
          return article
            ? { getAttribute: () => articleJson }
            : null;
        }
        if (sel.includes("resource-title")) {
          return { textContent: "New International Version (2011)" };
        }
        if (sel.includes("data-reference")) {
          return {
            getAttribute: () =>
              article?.requestedReference?.split(/[–—-]/)[0] ||
              `${c.book} ${c.chapter}:1`,
          };
        }
        return null;
      },
      defaultView: { location: { href: c.url } },
    };
    // parseBibliaArticle uses querySelector - wire both selectors
    fakeDoc.querySelector = (sel) => {
      if (sel.includes("data-article") || sel.includes("content-chunk")) {
        return article ? { getAttribute: () => articleJson } : null;
      }
      if (sel.includes("resource-title")) {
        return { textContent: "New International Version (2011)" };
      }
      if (sel.includes("data-reference")) {
        return {
          getAttribute: () =>
            (article?.requestedReference || `${c.book} ${c.chapter}:1`).split(
              /[–—]/
            )[0],
        };
      }
      return null;
    };
    label = adapter.readPassageLabel(fakeDoc, c.url);
    coords = adapter.readPassageCoords(fakeDoc, c.url);
  }

  if (!coords || coords.book !== c.book || coords.chapter !== c.chapter) {
    throw new Error(
      `${c.url}: bad coords ${JSON.stringify(coords)} want ${c.book} ${c.chapter}; label=${label}`
    );
  }
  if (!rootText || rootText.length < 80) {
    throw new Error(`${c.url}: scan text too short (${rootText.length})`);
  }

  const hits = M.findMatchesInText(rootText, matchers);
  const names = [...new Set(hits.map((h) => h.place?.name).filter(Boolean))];
  const missing = (c.expectPlaces || []).filter((n) => {
    if (names.includes(n)) return false;
    if (n === "Haran") return !names.includes("Haran") && !names.includes("Harran");
    if (n === "Antioch") return !names.some((x) => /antioch/i.test(x));
    return true;
  });
  // Haran gazetteer matches "Harran" alias to place name "Haran"
  const softMissing = missing.filter((n) => {
    if (n === "Haran") return !names.includes("Haran");
    return true;
  });
  if (softMissing.length) {
    throw new Error(
      `${c.url}: missing ${softMissing.join(", ")} — found: ${names.slice(0, 20).join(", ")}`
    );
  }

  return { url: c.url, label, coords, places: names.length, sample: names.slice(0, 8) };
}

async function main() {
  const Sites = loadSites();
  const M = loadMatcher();
  const places = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/places.json"), "utf8")
  );
  const matchers = M.buildPlaceMatchers(places);

  const results = [];
  for (const c of CASES) {
    const r = await runCase(Sites, M, matchers, c);
    if (!r) continue;
    results.push(r);
    console.log(
      `OK biblia: ${c.book} ${c.chapter} — ${r.places} places — ${r.label}`
    );
  }
  if (results.length < 4) {
    throw new Error(`too few successful Biblia cases (${results.length})`);
  }
  console.log("\nAll Biblia adapter checks passed.");
  for (const r of results) {
    console.log(`- ${r.label}: ${r.sample.join(", ")}`);
    console.log(`  ${r.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
