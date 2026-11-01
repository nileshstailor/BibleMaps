#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMTILES="${ROOT}/scripts/pmtiles"
OUT="${ROOT}/media/tiles/bible-region.pmtiles"
BUILD_URL="${PROTOMAPS_BUILD_URL:-https://build.protomaps.com/20251027.pmtiles}"
# Biblical Mediterranean + Levant + W. Mesopotamia (Rome → Nineveh).
# maxzoom 10 keeps the archive under GitHub's 100MB limit while covering
# Paul/Greece/Italy towns added in the gazetteer expansion. Overzoom in
# MapLibre still allows town focus past z10.
BBOX="${PROTOMAPS_BBOX:-12,28,43.2,43}"
MAXZOOM="${PROTOMAPS_MAXZOOM:-10}"

if [[ ! -x "$PMTILES" ]]; then
  echo "Missing scripts/pmtiles CLI. Download from https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

"$PMTILES" extract "$BUILD_URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM" --overfetch=0
ls -lh "$OUT"
"$PMTILES" show "$OUT"
