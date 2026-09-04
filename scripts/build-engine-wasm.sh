#!/usr/bin/env bash
# Compile the C++ engine to WASM for the studio.
# Output: apps/studio/src/generated/okrobo_engine.js (generated, gitignored).
# It lives under src/ (not public/) because Vite's dev server refuses to serve
# files from public/ as ES modules; src/ makes it a normal module in dev,
# build, tests, and the desktop bundle alike.
# Requires the Emscripten SDK in tools/emsdk (see build.md, Phase 1) and a
# WASM build of MuJoCo (see scripts/build-mujoco-wasm.sh, run once) for the
# arm's graspable object (Arm.grip()/release(), docs/decisions/physics-engine.md).
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

MJ_BUILD="$ROOT/tools/mujoco/build-wasm"
if [ ! -f "$MJ_BUILD/lib/libmujoco.a" ]; then
  echo "MuJoCo WASM build missing; building it now (scripts/build-mujoco-wasm.sh)..." >&2
  bash "$ROOT/scripts/build-mujoco-wasm.sh"
fi

OUT_DIR="$ROOT/apps/studio/src/generated"
mkdir -p "$OUT_DIR"
# Clean up the pre-Phase-6 location so a stale copy cannot be picked up.
rm -rf "$ROOT/apps/studio/public/engine"

# -std=c++20: only physics_object.cpp needs it (MuJoCo's own implementation
# does; its public C API header does not), but em++ compiles every .cpp in
# one invocation so the flag applies repo-wide here — harmless, C++20 is a
# strict superset of the C++17 the rest of this file uses.
em++ -O2 -std=c++20 -fexceptions --no-entry \
  -I "$ROOT/engine/src" \
  -I "$ROOT/tools/mujoco/include" \
  "$ROOT/engine/src/world.cpp" \
  "$ROOT/engine/src/arm_world.cpp" \
  "$ROOT/engine/src/drone_world.cpp" \
  "$ROOT/engine/src/physics_object.cpp" \
  "$ROOT/engine/src/wasm_api.cpp" \
  -o "$OUT_DIR/okrobo_engine.js" \
  -L "$MJ_BUILD/lib" \
  -lmujoco -lccd -lqhullstatic_r -llodepng -ltinyxml2 -ltinyobjloader \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createEngineModule \
  -sSINGLE_FILE=1 \
  -sENVIRONMENT=web,node \
  -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8

echo "built $(du -h "$OUT_DIR/okrobo_engine.js" | cut -f1) -> apps/studio/src/generated/okrobo_engine.js"
