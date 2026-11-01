#!/usr/bin/env node
/**
 * Regression: run the place matcher against real 1 Chronicles 1–9 text (NLT + ESV).
 * Fetches from bolls.life (public API) — same chapters users hit on bible.com.
 *
 * Usage: node scripts/test-genealogy-1chr.js
 * Exit 1 if kinship/person false-positives remain above threshold.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join("/tmp", "biblemaps-1chr");

async function fetchChapter(trans, chapter) {
  const cacheFile = path.join(CACHE, `${trans}-1chr-${chapter}.txt`);
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, "utf8");
  const url = `https://bolls.life/get-text/${trans}/13/${chapter}/`;
  const res = await fetch(url, { headers: { "User-Agent": "BibleMapsTest/1.0" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const verses = await res.json();
  const text = verses.map((v) => String(v.text || "").replace(/<[^>]+>/g, "")).join(" ");
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return text;
}

function loadMatcher() {
  const sandbox = { window: {}, console, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "content/matcher.js"), "utf8"), sandbox);
  return sandbox.window.BibleMapsMatcher;
}

function isLikelyGeo(window) {
  return /\b(land of|lived in|lived at|settled in|towns? of|and its towns|territory|pasturelands|city of|inhabitants of|exiled|reigned|built|captured|border|region of|born (?:in|to him in)|founder of|people of|king of|country of|entrance of|settlements|possessions|villages|to the (?:east|west|south|north)|near |from |into exile|opposite their kinsmen in)\b/i.test(
    window
  );
}

function isLikelyPerson(window) {
  return /\b(sons? of|daughters? of|father of|mother of|wife of|bore |fathered|begat|firstborn|concubine|daughter-in-law|were the sons|his brother|named his|clan leaders? of|chiefs? of)\b/i.test(
    window
  );
}

async function main() {
  const M = loadMatcher();
  const places = JSON.parse(fs.readFileSync(path.join(ROOT, "data/places.json"), "utf8"));
  const matchers = M.buildPlaceMatchers(places);

  const mustSkip = [
    "The descendants of Japheth were Gomer, Magog, Madai, Javan, Tubal, Meshech, and Tiras.",
    "Joktan was the ancestor of Almodad, Sheleph, Hazarmaveth, Jerah, Hadoram, Uzal, Diklah, Obal, Abimael, Sheba, Ophir, Havilah, and Jobab.",
    "Ishpan, Eber, Eliel, Abdon, Zicri, Hanan, Hananiah, Elam, Anthothijah, Iphdeiah, and Penuel were the sons of Shashak.",
    "His firstborn son: Abdon, then Zur, Kish, Baal, Nadab, Gedor, Ahio, Zecher, and Mikloth",
    "the firstborn of Ishmael, Nebaioth, and Kedar, Adbeel, Mibsam, Mishma, Dumah, Massa, Hadad, Tema, Jetur, Naphish, and Kedemah.",
    "Caleb married Ephrathah, and they had a son named Hur.",
    "Later Judah had twin sons from Tamar, his widowed daughter-in-law.",
    // bible.com splits "son of" / name across spans — concat must still skip
    "Simeon was the son of Judah.Judah was the son of Joseph.Joseph was the son of Jonam.",
    "Judah the father of Perez and Zerah by Tamar, and Perez the father of Hezron",
    "daughters of Nahor’s brother Haran.",
  ];

  // Per-node matching (old bug) vs concatenated chapter text (fixed collectMatchRanges)
  {
    const parts = [
      "Simeon was the son of ",
      "Judah",
      ".",
      "Judah",
      " was the son of Joseph.",
    ];
    const perNode = parts.flatMap((p) =>
      M.findMatchesInText(p, matchers).map((h) => h.place?.name)
    );
    const concat = M.findMatchesInText(parts.join(""), matchers);
    if (!perNode.includes("Judah")) {
      console.error("FAIL expected per-node Judah leak to demonstrate the bug");
      failures += 1;
    } else {
      console.log("OK demonstrated per-node Judah leak:", perNode);
    }
    if (concat.length) {
      console.error("FAIL concat still hits", concat.map((h) => h.place?.name));
      failures += 1;
    } else {
      console.log("OK concat skips split-node genealogy names");
    }
  }
  const mustKeep = [
    ["They lived in Beersheba, Moladah, Hazar-shual", ["Beersheba", "Moladah"]],
    ["born in Hebron", ["Hebron"]],
    ["land of Edom", ["Edom"]],
    ["founder of Bethlehem", ["Bethlehem"]],
  ];

  let failures = 0;
  for (const t of mustSkip) {
    const hits = M.findMatchesInText(t, matchers);
    if (hits.length) {
      failures += 1;
      console.error("FAIL skip", hits.map((h) => h.place?.name), t.slice(0, 70));
    }
  }
  for (const [t, expect] of mustKeep) {
    const names = M.findMatchesInText(t, matchers).map((h) => h.place?.name);
    if (!expect.every((e) => names.includes(e))) {
      failures += 1;
      console.error("FAIL keep", names, "want", expect, t);
    }
  }

  console.log("\n1 Chronicles 1–9 (real chapter text):");
  for (const trans of ["NLT", "ESV"]) {
    let total = 0;
    const personish = [];
    for (let ch = 1; ch <= 9; ch += 1) {
      const text = await fetchChapter(trans, ch);
      const matches = M.findMatchesInText(text, matchers);
      total += matches.length;
      for (const m of matches) {
        const window = text.slice(Math.max(0, m.start - 70), Math.min(text.length, m.end + 70));
        if (!isLikelyGeo(window) && isLikelyPerson(window)) {
          personish.push({
            ch,
            name: m.place?.name,
            ctx: window.replace(/\s+/g, " ").slice(0, 140),
          });
        }
      }
    }
    console.log(`${trans}: ${total} place hits, ${personish.length} person-ish false positives`);
    for (const p of personish) {
      console.error(`  ??? ${trans} ${p.ch} ${p.name}: ${p.ctx}`);
    }
    // Allow zero; any remaining kinship false positive fails the run.
    if (personish.length > 0) failures += personish.length;
  }

  if (failures) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll genealogy regression checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
