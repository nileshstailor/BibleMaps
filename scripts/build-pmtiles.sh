#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMTILES="${ROOT}/scripts/pmtiles"
OUT="${ROOT}/media/tiles/bible-region.pmtiles"
BUILD_URL="${PROTOMAPS_BUILD_URL:-https://build.protomaps.com/20251027.pmtiles}"
# Town-level extract: Levant + Cyprus + S. Anatolia, maxzoom 11 (~80MB)
# Covers OT/Gospel teaching maps and early Pauline Asia Minor; under GitHub 100MB limit.
BBOX="${PROTOMAPS_BBOX:-28,29,40,42}"
MAXZOOM="${PROTOMAPS_MAXZOOM:-11}"

if [[ ! -x "$PMTILES" ]]; then
  echo "Missing scripts/pmtiles CLI. Download from https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

"$PMTILES" extract "$BUILD_URL" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM" --overfetch=0
ls -lh "$OUT"
"$PMTILES" show "$OUT"
