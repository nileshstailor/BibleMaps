#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMTILES="${ROOT}/scripts/pmtiles"
OUT="${ROOT}/media/tiles/bible-region.pmtiles"
BUILD_URL="${PROTOMAPS_BUILD_URL:-https://build.protomaps.com/20251027.pmtiles}"
# Rome → Nineveh. maxzoom 9 keeps the in-memory archive ~40 MB so the Chrome
# side panel does not OOM (a z10 extract of this bbox was ~93 MB and crashed
# the panel with Chrome's sad-face / blank page). MapLibre overzooms for town focus.
BBOX="${PROTOMAPS_BBOX:-12,28,43.2,43}"
MAXZOOM="${PROTOMAPS_MAXZOOM:-9}"

if [[ ! -x "$PMTILES" ]]; then
  echo "Missing scripts/pmtiles CLI. Download from https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

"$PMTILES" extract "$BUILD_URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM" --overfetch=0
ls -lh "$OUT"
"$PMTILES" show "$OUT"
