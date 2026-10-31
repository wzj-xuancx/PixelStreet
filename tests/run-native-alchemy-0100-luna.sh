#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

scenario=${1:-visitor}
case "$scenario" in
  visitor|keeper|rich|reward-cap) ;;
  *) echo "scenario must be visitor, keeper, rich or reward-cap" >&2; exit 2 ;;
esac

runner_bundle=$(pwd)/dist/native-alchemy-0100-luna.cjs
trap 'rm -f "$runner_bundle"' EXIT HUP INT TERM

./node_modules/.bin/esbuild tests/native-alchemy-0100-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile="$runner_bundle"
PIXELSTREET_ALCHEMY0100_RUNNER="$runner_bundle" ./node_modules/.bin/electron tests/native-alchemy-0100-luna-bootstrap.cjs "--scenario=$scenario"
