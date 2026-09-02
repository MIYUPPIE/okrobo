#!/usr/bin/env bash
# Build the installable desktop app (deb + AppImage).
# Bundles the WASM engine, the okrobo Python runtime with its deps, and
# (after fetch-python-runtime.sh) a standalone CPython for offline machines.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

"$ROOT/scripts/build-engine-wasm.sh"
if [ ! -d "$ROOT/runtime/python/.deps" ]; then
  (cd "$ROOT/runtime/python" && python3 -m pip install --quiet --target=.deps -r requirements.txt)
fi
if [ ! -x "$ROOT/apps/studio/src-tauri/runtime-dist/cpython/bin/python3" ]; then
  echo "note: no bundled CPython (run scripts/fetch-python-runtime.sh for fully offline installs);"
  echo "      the packaged app will fall back to the target machine's python3."
fi

cd "$ROOT/apps/studio"
npx tauri build

echo
echo "artifacts:"
find src-tauri/target/release/bundle -maxdepth 2 -name "*.deb" -o -maxdepth 2 -name "*.AppImage" | sed 's/^/  /'
