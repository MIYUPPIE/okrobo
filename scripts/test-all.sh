#!/usr/bin/env bash
# All gate suites, every directory. Green before starting work, green before committing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== engine (C++) =="
cmake -S "$ROOT/engine" -B "$ROOT/engine/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/engine/build" --parallel >/dev/null
ctest --test-dir "$ROOT/engine/build" --output-on-failure

echo "== runtime/python =="
if [ ! -d "$ROOT/runtime/python/.deps" ]; then
  (cd "$ROOT/runtime/python" && python3 -m pip install --quiet --target=.deps -r requirements.txt)
fi
(cd "$ROOT/runtime/python" && python3 -m pytest -q)

echo "== engine (WASM + parity vs reference model) =="
"$ROOT/scripts/build-engine-wasm.sh"
node "$ROOT/engine/tests/parity/parity.mjs"

echo "== desktop shell (rust) =="
export PATH="$HOME/.cargo/bin:$PATH"
if command -v cargo >/dev/null 2>&1; then
  (cd "$ROOT/apps/studio/src-tauri" && cargo test --quiet 2>&1 | grep -E "test result|running" | head -4)
else
  echo "FAIL: rust not installed (rustup.rs), required since Phase 4" >&2
  exit 1
fi

echo "== apps/studio (typecheck + unit tests + build) =="
cd "$ROOT/apps/studio"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run test
npm run build

echo
echo "ALL GATES GREEN"
