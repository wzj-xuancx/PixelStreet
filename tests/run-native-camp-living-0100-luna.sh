#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# Root must explicitly declare the product integration frozen before this
# script even bundles the dedicated hidden-native harness.
if [ "${PIXELSTREET_CAMP_LUNA_FROZEN:-}" != "1" ]; then
  echo "Refusing to run: root must freeze the integrated camp candidate and set PIXELSTREET_CAMP_LUNA_FROZEN=1." >&2
  exit 2
fi

scenario=${1:-rich}
case "$scenario" in
  fresh|rich|claim-only|claim-full) ;;
  *) echo "scenario must be fresh, rich, claim-only or claim-full" >&2; exit 2 ;;
esac

./node_modules/.bin/esbuild tests/native-camp-living-0100-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile=dist/native-camp-living-0100-luna.cjs
./node_modules/.bin/electron tests/native-camp-living-0100-luna-bootstrap.cjs "--scenario=$scenario"
