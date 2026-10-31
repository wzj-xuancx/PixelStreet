#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild tests/native-living-0100-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile=dist/native-living-0100-luna.cjs
scenario=${1:-smoke}
case "$scenario" in
  smoke|smoke-keeper|fresh|rich) ;;
  *) echo "scenario must be smoke, smoke-keeper, fresh or rich" >&2; exit 2 ;;
esac
./node_modules/.bin/electron tests/native-living-0100-luna-bootstrap.cjs "--scenario=$scenario"
