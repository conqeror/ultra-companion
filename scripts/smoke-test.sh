#!/bin/bash
# Comprehensive UI smoke test: navigate all screens, take screenshots
# Usage: ./scripts/smoke-test.sh [UDID]
#   UDID defaults to the first booted simulator
#
# Requires: axe (brew install cameroncooke/axe/axe)
# Screenshots saved to .axe-screenshots/
# Step files in axe-steps/

set -euo pipefail

UDID="${1:-$(xcrun simctl list devices booted -j | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(u['udid'] for dl in d['devices'].values() for u in dl if u['state']=='Booted'))")}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTDIR="$DIR/.axe-screenshots"
STEPS="$DIR/axe-steps"
BUNDLE_ID="com.ultra.companion"
N=1

mkdir -p "$OUTDIR"

echo "Using simulator: $UDID"

snap() {
  local file
  file=$(printf "%s/%02d-%s.png" "$OUTDIR" "$N" "$1")
  axe screenshot --udid "$UDID" --output "$file" 2>&1 | head -1
  N=$((N + 1))
}

run() {
  axe batch --udid "$UDID" --file "$STEPS/$1" ${2:+$2} 2>&1 | tail -1
}

# Launch app if not running
xcrun simctl launch "$UDID" "$BUNDLE_ID" 2>/dev/null || true
sleep 3

echo ""
echo "=== MAP TAB ==="
axe tap --label 'Map, tab, 1 of 3' --udid "$UDID" --post-delay 1 2>&1 | head -1
snap "map"

echo "--- Weather ---"
run 01-open-weather.steps
snap "map-weather"

echo "--- POI list ---"
run 02-close-weather-open-poi.steps "--ax-cache perStep"
snap "poi-list"

run 03-scroll-poi-list.steps
snap "poi-list-scrolled"

echo "--- Elevation panel ---"
run 04-close-poi-cycle-elevation.steps "--ax-cache perStep"
snap "elevation-panel"

run 05-cycle-elevation-and-close.steps
snap "elevation-panel-2"

echo ""
echo "=== ROUTES TAB ==="
run 06-close-elevation-go-routes.steps "--ax-cache perStep"
snap "routes"

echo "--- Collection detail ---"
run 07-open-collection.steps
snap "collection-top"

run 08-scroll-collection.steps
snap "collection-segments"

run 08-scroll-collection.steps
snap "collection-elevation"

run 08-scroll-collection.steps
snap "collection-offline"

echo ""
echo "=== SETTINGS TAB ==="
run 09-back-to-routes-go-settings.steps "--ax-cache perStep"
snap "settings-top"

run 10-scroll-settings.steps
snap "settings-scrolled"

echo ""
echo "Done. $((N - 1)) screenshots in $OUTDIR/"
ls -1 "$OUTDIR/"
