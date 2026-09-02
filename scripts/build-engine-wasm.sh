#!/usr/bin/env bash
# Compile the C++ engine to WASM for the studio.
# Output: apps/studio/public/engine/okrobo_engine.js (generated, gitignored).
# Requires the Emscripten SDK in tools/emsdk (see build.md, Phase 1).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "$ROOT/tools/emsdk/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "$ROOT/tools/emsdk/emsdk_env.sh" >/dev/null 2>&1
  else
    echo "error: emcc not found and tools/emsdk missing." >&2
    echo "  git clone --depth 1 https://github.com/emscripten-core/emsdk tools/emsdk" >&2
    echo "  tools/emsdk/emsdk install latest && tools/emsdk/emsdk activate latest" >&2
    exit 1
  fi
fi

OUT_DIR="$ROOT/apps/studio/public/engine"
mkdir -p "$OUT_DIR"

em++ -O2 -std=c++17 --no-entry \
  -I "$ROOT/engine/src" \
  "$ROOT/engine/src/world.cpp" \
  "$ROOT/engine/src/arm.cpp" \
  "$ROOT/engine/src/wasm_api.cpp" \
  -o "$OUT_DIR/okrobo_engine.js" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createEngineModule \
  -sSINGLE_FILE=1 \
  -sENVIRONMENT=web,node \
  -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=0

echo "built $(du -h "$OUT_DIR/okrobo_engine.js" | cut -f1) -> apps/studio/public/engine/okrobo_engine.js"
