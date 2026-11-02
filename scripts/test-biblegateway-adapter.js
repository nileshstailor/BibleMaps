#!/usr/bin/env node
/**
 * Smoke-test Bible Gateway site adapter + gazetteer against a real passage page.
 *
 * Usage: node scripts/test-biblegateway-adapter.js
 * Fetches Genesis 12 NIV from biblegateway.com (cached under /tmp).
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
const CACHE = "/tmp/biblemaps-bg-gen12.html";
const SAMPLE_URL =
  "https://www.biblegateway.com/passage/?search=Genesis+12&version=NIV";

async function loadHtml() {
  if (fs.existsSync(CACHE)) return fs.readFileSync(CACHE, "utf8");
  const res = await fetch(SAMPLE_URL, {
    headers: { "User-Agent": "BibleMapsTest/1.0" },
  });
  if (!res.ok) throw new Error(`${SAMPLE_URL} -> ${res.status}`);
  const html = await res.text();
  fs.writeFileSync(CACHE, html);
  return html;
}

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

function stripTags(html) {
  return String(html || "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const Sites = loadSites();
  const M = loadMatcher();
  const places = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/places.json"), "utf8")
  );
  const matchers = M.buildPlaceMatchers(places);

  const bg = Sites.resolveAdapter("www.biblegateway.com");
  const yc = Sites.resolveAdapter("www.bible.com");
  if (bg.id !== "biblegateway") throw new Error("BG host resolve failed");
  if (yc.id !== "biblecom") throw new Error("bible.com host resolve failed");

  const html = await loadHtml();

  let rootText = "";
  let label = "";
  let coords = null;

  if (JSDOM) {
    const dom = new JSDOM(html, { url: SAMPLE_URL });
    const { document } = dom.window;
    const root = bg.pickScanRoot(document);
    if (!root || !/\.std-text|std-text/.test(root.className || root.outerHTML?.slice(0, 80) || "")) {
      // classList may be TokenList
      const cls = String(root?.className || "");
      if (!cls.includes("std-text") && root?.querySelector?.(".std-text")) {
        throw new Error("pickScanRoot should prefer .std-text");
      }
      if (!cls.includes("std-text") && !root?.closest?.(".passage-text")) {
        throw new Error(`unexpected scan root: ${root?.tagName} ${cls}`);
      }
    }
    if (root.querySelector?.(".footnotes, .crossrefs")) {
      throw new Error("scan root must not include footnotes/crossrefs");
    }
    rootText = root.innerText || "";
    label = bg.readPassageLabel(document, SAMPLE_URL);
    coords = bg.readPassageCoords(document, SAMPLE_URL);
  } else {
    // Fallback without jsdom: regex extract std-text + OSIS
    const m = html.match(
      /class=['"]std-text['"][^>]*>([\s\S]*?)<div class=['"]footnotes/
    );
    if (!m) throw new Error("could not locate .std-text in page HTML");
    rootText = stripTags(m[1]);
    const osis = html.match(/data-osis="([^"]+)"/);
    const fakeDoc = {
      title: (html.match(/<title[^>]*>([^<]+)/) || [])[1] || "",
      querySelector(sel) {
        if (sel === "[data-osis]") {
          return { getAttribute: () => (osis ? osis[1] : "") };
        }
        if (sel.includes("dropdown-display-text") && sel.includes("bcv")) {
          return { textContent: "Genesis 12" };
        }
        if (sel.includes("translation")) {
          return { textContent: "NIV" };
        }
        return null;
      },
      defaultView: { location: { href: SAMPLE_URL } },
    };
    label = bg.readPassageLabel(fakeDoc, SAMPLE_URL);
    coords = bg.readPassageCoords(fakeDoc, SAMPLE_URL);
  }

  if (!coords || coords.book !== "Genesis" || coords.chapter !== 12) {
    throw new Error(`bad coords: ${JSON.stringify(coords)}`);
  }
  if (!/Genesis\s+12/i.test(label)) {
    throw new Error(`bad label: ${label}`);
  }

  const hits = M.findMatchesInText(rootText, matchers);
  const names = [...new Set(hits.map((h) => h.place?.name).filter(Boolean))];
  const required = ["Haran", "Canaan", "Egypt", "Shechem", "Bethel"];
  const missing = required.filter((n) => !names.includes(n));
  if (missing.length) {
    throw new Error(
      `missing places ${missing.join(", ")} — found: ${names.join(", ")}`
    );
  }

  // Footnote / crossref dump must not be the scan source
  if (/Footnotes|Cross references/i.test(rootText.slice(-400))) {
    throw new Error("scan text appears to include resources chrome");
  }

  console.log("OK Bible Gateway adapter");
  console.log(`  label: ${label}`);
  console.log(`  coords: ${coords.book} ${coords.chapter}`);
  console.log(`  places (${names.length}): ${names.sort().join(", ")}`);
  console.log(`  sample: ${SAMPLE_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
