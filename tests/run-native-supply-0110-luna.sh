#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
scenario=${1:-rich}
case "$scenario" in
  smoke|smoke-keeper|fresh|rich) ;;
  *) echo "scenario must be smoke, smoke-keeper, fresh or rich" >&2; exit 2 ;;
esac
runner_bundle=$(pwd)/dist/native-supply-0110-luna.cjs
trap 'rm -f "$runner_bundle"' EXIT HUP INT TERM
./node_modules/.bin/esbuild tests/native-supply-0110-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile="$runner_bundle"
./node_modules/.bin/electron tests/native-supply-0110-luna-bootstrap.cjs "--scenario=$scenario"
