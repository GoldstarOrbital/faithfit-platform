#!/usr/bin/env bash
# Installs the 1024×1024 App Store icon into the asset catalog.
# Usage (from repo root or anywhere):
#   bash ios/FunctioningFaith/scripts/install-app-icon.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
B64="$SCRIPT_DIR/AppIcon.png.b64"
DEST="$ROOT/FunctioningFaith/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
if [[ ! -f "$B64" ]]; then
  echo "Missing $B64" >&2
  exit 1
fi
mkdir -p "$(dirname "$DEST")"
base64 -d < "$B64" > "$DEST"
echo "Wrote $DEST ($(wc -c < "$DEST") bytes)"
