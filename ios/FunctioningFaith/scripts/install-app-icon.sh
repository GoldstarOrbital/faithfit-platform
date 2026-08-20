#!/usr/bin/env bash
# Generates the 1024x1024 App Store icon into the asset catalog.
# Usage: bash ios/FunctioningFaith/scripts/install-app-icon.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/generate-app-icon.py"
