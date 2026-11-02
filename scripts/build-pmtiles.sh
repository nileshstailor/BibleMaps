#!/usr/bin/env bash
# Build a memory-safe biblical-corridor PMTiles archive for the side panel.
#
# Strategy (avoids BM-46 OOM from one huge uniform extract):
#   1) Wide shell z0–7 across Spain → India (overview / pan context)
#   2) High-detail z9–11 for Levant + Egypt (town-ish zoom)
#   3) Medium-detail z9–10 for Mesopotamia → Susa
# Then merge into media/tiles/bible-region.pmtiles (~60 MB).
#
# Do NOT spend high-zoom tiles on the Americas or east of India.
# Outside this corridor, online Esri fill covers gaps when online.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMTILES="${ROOT}/scripts/pmtiles"
OUT="${ROOT}/media/tiles/bible-region.pmtiles"
BUILD_URL="${PROTOMAPS_BUILD_URL:-https://build.protomaps.com/20251027.pmtiles}"
TMP="${TMPDIR:-/tmp}/biblemaps-pmtiles-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# Tip of Spain → India; Red Sea / Arabia south; Black Sea north.
SHELL_BBOX="${PROTOMAPS_SHELL_BBOX:--10,12,78,45}"
SHELL_MAXZOOM="${PROTOMAPS_SHELL_MAXZOOM:-7}"

# Levant + Egypt (incl. Thebes / Upper Egypt).
CORE_BBOX="${PROTOMAPS_CORE_BBOX:-29,24,42,36}"
CORE_MINZOOM="${PROTOMAPS_CORE_MINZOOM:-9}"
CORE_MAXZOOM="${PROTOMAPS_CORE_MAXZOOM:-11}"

# Mesopotamia → Susa / SW Persia (east of core, disjoint lon).
EAST_BBOX="${PROTOMAPS_EAST_BBOX:-42.2,27,55,38}"
EAST_MINZOOM="${PROTOMAPS_EAST_MINZOOM:-9}"
EAST_MAXZOOM="${PROTOMAPS_EAST_MAXZOOM:-10}"

if [[ ! -x "$PMTILES" ]]; then
  echo "Missing scripts/pmtiles CLI. Download from https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

echo "1/3 shell z0-${SHELL_MAXZOOM} bbox=${SHELL_BBOX}"
"$PMTILES" extract "$BUILD_URL" "$TMP/shell.pmtiles" \
  --bbox="$SHELL_BBOX" --maxzoom="$SHELL_MAXZOOM" --overfetch=0

echo "2/3 core z${CORE_MINZOOM}-${CORE_MAXZOOM} bbox=${CORE_BBOX}"
"$PMTILES" extract "$BUILD_URL" "$TMP/core.pmtiles" \
  --bbox="$CORE_BBOX" --minzoom="$CORE_MINZOOM" --maxzoom="$CORE_MAXZOOM" --overfetch=0

echo "3/3 east z${EAST_MINZOOM}-${EAST_MAXZOOM} bbox=${EAST_BBOX}"
"$PMTILES" extract "$BUILD_URL" "$TMP/east.pmtiles" \
  --bbox="$EAST_BBOX" --minzoom="$EAST_MINZOOM" --maxzoom="$EAST_MAXZOOM" --overfetch=0

echo "Merging → $OUT"
"$PMTILES" merge "$TMP/shell.pmtiles" "$TMP/core.pmtiles" "$TMP/east.pmtiles" "$OUT"
ls -lh "$OUT"
"$PMTILES" show "$OUT"
"$PMTILES" verify "$OUT"
