#!/usr/bin/env bash
# Build MuJoCo's core simulation library for this machine (native, not WASM).
# Output: tools/mujoco/build-native/lib/libmujoco.so (+ its small static
# deps), a stable path linked by:
#   - engine/api/README.md's documented `g++ ... arm_world.cpp` one-liner
#     (Arm.grip()/release() needs PhysicsObject, which needs MuJoCo)
#   - the C++-track "compiles and runs" gate test for the Arm
#     (apps/studio/src/blocks/okroboBlocks.test.ts)
#
# engine/CMakeLists.txt's own ctest build gets MuJoCo separately, via CMake
# FetchContent (see that file) — this script exists because those two
# consumers compile with a plain `g++`/`em++` command, not through CMake, so
# they need MuJoCo built somewhere predictable ahead of time instead.
#
# tools/ is gitignored: run this once, like scripts/build-mujoco-wasm.sh's
# WASM counterpart.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUJOCO_TAG="3.9.0"
MJ="$ROOT/tools/mujoco"
BUILD="$MJ/build-native"

if [ ! -d "$MJ" ]; then
  echo "cloning MuJoCo $MUJOCO_TAG into tools/mujoco (~175 MB, one-time)..."
  git clone --depth 1 --branch "$MUJOCO_TAG" \
    https://github.com/google-deepmind/mujoco "$MJ"
fi

echo "configuring MuJoCo for this machine..."
cmake -S "$MJ" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMUJOCO_BUILD_TESTS=OFF \
  -DMUJOCO_BUILD_SIMULATE=OFF \
  -DMUJOCO_BUILD_EXAMPLES=OFF \
  -DBUILD_TESTING=OFF

echo "building MuJoCo's core library..."
cmake --build "$BUILD" --target mujoco --parallel

echo "done: $BUILD/lib/libmujoco.so"
