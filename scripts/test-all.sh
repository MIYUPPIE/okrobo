#!/usr/bin/env bash
# All gate suites, every directory. Green before starting work, green before committing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== engine (C++) =="
cmake -S "$ROOT/engine" -B "$ROOT/engine/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/engine/build" --parallel >/dev/null
ctest --test-dir "$ROOT/engine/build" --output-on-failure

echo "== runtime/python =="
(cd "$ROOT/runtime/python" && python3 -m pytest -q)

echo "== engine (WASM + parity vs reference model) =="
"$ROOT/scripts/build-engine-wasm.sh"
node "$ROOT/engine/tests/parity/parity.mjs"

echo "== apps/studio (typecheck + unit tests + build) =="
cd "$ROOT/apps/studio"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run test
npm run build

echo
echo "ALL GATES GREEN"
