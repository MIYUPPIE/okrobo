#!/usr/bin/env bash
# Build MuJoCo's core simulation library for WASM (single-threaded, no
# GUI/examples/Python bindings). Output: static libs under
# tools/mujoco/build-wasm/lib, which scripts/build-engine-wasm.sh links
# against for Arm.grip()/release() (docs/decisions/physics-engine.md).
#
# tools/ is gitignored, so this is a local build step, same as tools/emsdk
# itself: run it once, or whenever bumping the pinned MuJoCo version below.
# Needs network at configure time (CMake FetchContent pulls MuJoCo's own
# small dependencies: ccd, qhull, tinyxml2, tinyobjloader, lodepng, miniz).
#
# Recipe verified in a standalone feasibility spike before this script
# existed (see build.md): MuJoCo 3.9.0 has first-class upstream Emscripten
# support (a wasm/ dir, if(EMSCRIPTEN) branches throughout its CMakeLists.txt)
# and needed zero source patches. mj_step/mj_forward run single-threaded with
# no pthreads (d->threadpool stays null for a basic model), so no
# SharedArrayBuffer / COOP-COEP headers are needed anywhere in this project.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUJOCO_TAG="3.9.0"
MJ="$ROOT/tools/mujoco"
BUILD="$MJ/build-wasm"

if ! command -v em++ >/dev/null 2>&1; then
  if [ -f "$ROOT/tools/emsdk/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "$ROOT/tools/emsdk/emsdk_env.sh" >/dev/null 2>&1
  else
    echo "error: em++ not found and tools/emsdk missing." >&2
    echo "  git clone --depth 1 https://github.com/emscripten-core/emsdk tools/emsdk" >&2
    echo "  tools/emsdk/emsdk install latest && tools/emsdk/emsdk activate latest" >&2
    exit 1
  fi
fi

if [ ! -d "$MJ" ]; then
  echo "cloning MuJoCo $MUJOCO_TAG into tools/mujoco (~175 MB, one-time)..."
  git clone --depth 1 --branch "$MUJOCO_TAG" \
    https://github.com/google-deepmind/mujoco "$MJ"
fi

echo "configuring MuJoCo for WASM..."
emcmake cmake -S "$MJ" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMUJOCO_WASM_THREADS=OFF \
  -DMUJOCO_BUILD_TESTS_WASM=OFF \
  -DMUJOCO_BUILD_STUDIO=OFF \
  -DMUJOCO_USE_FILAMENT=OFF \
  -DBUILD_TESTING=OFF

echo "building MuJoCo's core library (not the wasm/ embind bindings, which okrobo doesn't use)..."
cmake --build "$BUILD" --target mujoco --parallel

echo "done: $BUILD/lib/libmujoco.a (+ ccd, qhullstatic_r, lodepng, tinyxml2, tinyobjloader)"
