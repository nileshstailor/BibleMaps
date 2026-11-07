#!/usr/bin/env bash
# Build a clean Chrome Web Store ZIP of the extension root (no .git / store / tests / CLI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c "import json; print(json.load(open('$ROOT/manifest.json'))['version'])")"
OUT_DIR="$ROOT/store/dist"
STAGE="$OUT_DIR/stage-bible-maps"
ZIP="$OUT_DIR/bible-maps-${VERSION}.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT_DIR"

# Copy runtime extension files only
rsync -a \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  --exclude '.cursor/' \
  --exclude 'store/' \
  --exclude 'scripts/' \
  --exclude 'node_modules/' \
  --exclude '*.log' \
  --exclude '.idea/' \
  --exclude '.vscode/' \
  --exclude 'CHANGELOG.md' \
  --exclude '*.mov' \
  --exclude '*.mp4' \
  --exclude 'ScreenRecording_*' \
  --exclude 'media/tiles/' \
  "$ROOT/" "$STAGE/"

# Drop oversized native CLI if present under scripts was already excluded;
# also strip any accidental pmtiles binary copies
find "$STAGE" -name 'pmtiles' -type f -delete 2>/dev/null || true

rm -f "$ZIP"
(
  cd "$STAGE"
  zip -qr "$ZIP" . \
    -x '*.DS_Store' \
    -x '**/.DS_Store'
)

rm -rf "$STAGE"
echo "Wrote $ZIP"
ls -lh "$ZIP"
# Quick inventory
unzip -l "$ZIP" | head -40
echo "…"
unzip -l "$ZIP" | tail -5
