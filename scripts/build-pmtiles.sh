#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMTILES="${ROOT}/scripts/pmtiles"
OUT="${ROOT}/media/tiles/bible-region.pmtiles"
BUILD_URL="${PROTOMAPS_BUILD_URL:-https://build.protomaps.com/20251027.pmtiles}"
# Lean extract: Mediterranean + Near East, maxzoom 8 (~25MB)
BBOX="${PROTOMAPS_BBOX:-10,24,54,44}"
MAXZOOM="${PROTOMAPS_MAXZOOM:-8}"

if [[ ! -x "$PMTILES" ]]; then
  echo "Missing scripts/pmtiles CLI. Download from https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

"$PMTILES" extract "$BUILD_URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM" --overfetch=0
ls -lh "$OUT"
"$PMTILES" show "$OUT"
