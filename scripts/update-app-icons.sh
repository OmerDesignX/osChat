#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="${1:-$ROOT/assets/logo/oschat-icon-source.png}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This icon generator uses macOS AppKit. On Windows, run scripts/round-icon.ps1." >&2
  exit 1
fi

if [[ ! -f "$SOURCE" ]]; then
  echo "Icon source is missing: $SOURCE" >&2
  exit 1
fi

CORNER_RATIO="0.2185"
xcrun swift "$SCRIPT_DIR/render-rounded-icon.swift" \
  "$SOURCE" "$ROOT/assets/logo/oschat-icon.png" 1254 "$CORNER_RATIO"
xcrun swift "$SCRIPT_DIR/render-rounded-icon.swift" \
  "$SOURCE" "$ROOT/src/assets/oschat-icon.png" 512 "$CORNER_RATIO"
xcrun swift "$SCRIPT_DIR/render-rounded-icon.swift" \
  "$SOURCE" "$ROOT/build/icon.png" 1024 "$CORNER_RATIO"

bash "$ROOT/releaseScripts/macos/prepare-icon.sh"
echo "Updated osChat icons for the UI, README, macOS, Windows, and Linux."
