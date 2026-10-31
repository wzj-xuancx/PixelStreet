#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild tests/native-camp-090-luna.ts --bundle --platform=node --target=node22 --format=cjs --external:electron --outfile=dist/native-camp-090-luna.cjs
scenario=${1:-smoke}
case "$scenario" in
  smoke|fresh|rich|import|import-busy) ;;
  *) echo "scenario must be smoke, fresh, rich, import or import-busy" >&2; exit 2 ;;
esac
./node_modules/.bin/electron tests/native-camp-090-luna-bootstrap.cjs "--scenario=$scenario"
