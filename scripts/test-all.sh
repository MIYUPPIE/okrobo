#!/usr/bin/env bash
# All gate suites, every directory. Green before starting work, green before committing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== engine (C++) =="
cmake -S "$ROOT/engine" -B "$ROOT/engine/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/engine/build" --parallel >/dev/null
ctest --test-dir "$ROOT/engine/build" --output-on-failure

echo "== firmware (C++ protocol, host build) =="
cmake -S "$ROOT/firmware" -B "$ROOT/firmware/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/firmware/build" --parallel >/dev/null
ctest --test-dir "$ROOT/firmware/build" --output-on-failure

echo "== runtime/python =="
if [ ! -d "$ROOT/runtime/python/.deps" ]; then
  (cd "$ROOT/runtime/python" && python3 -m pip install --quiet --target=.deps -r requirements.txt)
fi
# Guard against tests silently disappearing. tests/ is a package, so one
# module-level importorskip (a missing dependency) can abort collection of
# every file and the suite still "passes" with nothing run. Compare the number
# of files pytest collected against the number on disk.
(
  cd "$ROOT/runtime/python"
  on_disk=$(find tests -name 'test_*.py' | wc -l)
  # `|| true`: with pipefail, grep matching nothing (the very case this guard
  # exists to catch) would abort the subshell before the message below.
  collected=$(python3 -m pytest --collect-only -q 2>/dev/null | grep -oE '^tests/[^:]+' | sort -u | wc -l || true)
  if [ "$collected" -lt "$on_disk" ]; then
    echo "FAIL: pytest collected $collected of $on_disk test files." >&2
    echo "      A missing dependency usually causes this; check requirements.txt" >&2
    echo "      and reinstall: python3 -m pip install --target=.deps -r requirements.txt" >&2
    exit 1
  fi
  echo "collected all $on_disk test files"
  python3 -m pytest -q
)

echo "== engine (WASM + parity vs reference model) =="
"$ROOT/scripts/build-engine-wasm.sh"
node "$ROOT/engine/tests/parity/parity.mjs"

echo "== vision (Blocks/JS find_color parity vs Python reference) =="
node "$ROOT/scripts/lib/vision-parity-check.mjs"

echo "== packs (index + signing + school server) =="
node "$ROOT/scripts/build-pack-index.mjs" >/dev/null
node "$ROOT/scripts/lib/signing-check.mjs"
node "$ROOT/scripts/lib/school-server-check.mjs" 8482

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

echo "== browser: dev server loads the engine =="
"$ROOT/scripts/check-dev-server.sh"

echo "== browser: studio E2E (robot switching, running a program, camera, lessons) =="
"$ROOT/scripts/check-studio-e2e.sh"

echo
echo "ALL GATES GREEN"
