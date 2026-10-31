#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# Root must explicitly declare the product integration frozen before this
# script even bundles the dedicated hidden-native harness.
if [ "${PIXELSTREET_INNER_0110_CAMP_LUNA_FROZEN:-}" != "1" ]; then
  echo "Refusing to run: root must freeze the integrated 0.11.0 candidate and set PIXELSTREET_INNER_0110_CAMP_LUNA_FROZEN=1." >&2
  exit 2
fi

scenario=${1:-inner}
case "$scenario" in
  inner|fresh|rich|claim-only|claim-full) ;;
  *) echo "scenario must be inner, fresh, rich, claim-only or claim-full" >&2; exit 2 ;;
esac

./node_modules/.bin/esbuild tests/native-camp-inner-0110-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile=dist/native-camp-inner-0110-luna.cjs
./node_modules/.bin/electron tests/native-camp-inner-0110-luna-bootstrap.cjs "--scenario=$scenario"
