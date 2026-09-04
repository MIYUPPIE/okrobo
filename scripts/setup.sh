#!/usr/bin/env bash
# One-time setup for a fresh clone.
#
#   ./scripts/setup.sh
#
# Installs everything the gate suite needs that is too large to commit: the
# Emscripten SDK, node modules, and the repo-local Python dependencies. It is
# safe to re-run: anything already present is left alone.
#
# It never uses sudo. System packages and Rust are reported for you to install,
# because those change your machine outside this repo.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

missing_system=()
note() { printf '  %s\n' "$1"; }

echo "== checking tools =="
for tool in node npm python3 cmake g++ git; do
  if command -v "$tool" >/dev/null 2>&1; then
    note "ok      $tool"
  else
    note "MISSING $tool"
    missing_system+=("$tool")
  fi
done

export PATH="$HOME/.cargo/bin:$PATH"
if command -v cargo >/dev/null 2>&1; then
  note "ok      cargo ($(cargo --version | cut -d' ' -f2))"
else
  note "MISSING cargo — needed only for the desktop app"
fi

echo
echo "== python dependencies (runtime/python/.deps) =="
if python3 -m pip install --quiet --target=runtime/python/.deps --upgrade \
  -r runtime/python/requirements.txt; then
  note "installed from requirements.txt"
else
  note "FAILED — see the error above"
fi

echo
echo "== node modules (apps/studio) =="
if [ -d apps/studio/node_modules ]; then
  note "already present"
else
  (cd apps/studio && npm install --no-audit --no-fund >/dev/null) && note "installed" ||
    note "FAILED — run 'npm install' in apps/studio"
fi

echo
echo "== emscripten sdk (tools/emsdk) =="
if command -v emcc >/dev/null 2>&1; then
  note "emcc already on PATH"
elif [ -f tools/emsdk/emsdk_env.sh ]; then
  note "already present in tools/emsdk"
else
  note "installing (about 1 GB, a few minutes) ..."
  if git clone --depth 1 https://github.com/emscripten-core/emsdk tools/emsdk >/dev/null 2>&1 &&
    tools/emsdk/emsdk install latest >/dev/null 2>&1 &&
    tools/emsdk/emsdk activate latest >/dev/null 2>&1; then
    note "installed"
  else
    note "FAILED — install it by hand:"
    note "  git clone --depth 1 https://github.com/emscripten-core/emsdk tools/emsdk"
    note "  tools/emsdk/emsdk install latest && tools/emsdk/emsdk activate latest"
  fi
fi

echo
echo "== mujoco, native + wasm (tools/mujoco) =="
# The arm's graspable object (Arm.grip()/release()) needs a real solver on
# both the host (engine ctest, the C++-track compile-and-run gate test) and
# WASM (the studio's own engine build) sides -- see
# docs/decisions/physics-engine.md. Both are gitignored under tools/, same
# as tools/emsdk above; each script clones tools/mujoco once (~175 MB) and
# reuses it for the other.
if [ -f tools/mujoco/build-native/lib/libmujoco.so ]; then
  note "native build already present"
else
  note "building native (a minute or two)..."
  bash scripts/build-mujoco-native.sh >/dev/null 2>&1 && note "installed" ||
    note "FAILED — run ./scripts/build-mujoco-native.sh by hand to see why"
fi
if [ -f tools/mujoco/build-wasm/lib/libmujoco.a ]; then
  note "wasm build already present"
elif command -v emcc >/dev/null 2>&1 || [ -f tools/emsdk/emsdk_env.sh ]; then
  note "building wasm (a minute or two)..."
  bash scripts/build-mujoco-wasm.sh >/dev/null 2>&1 && note "installed" ||
    note "FAILED — run ./scripts/build-mujoco-wasm.sh by hand to see why"
else
  note "skipped — emscripten isn't set up yet; build-engine-wasm.sh builds this itself when needed"
fi

echo
echo "== what is left for you =="
if [ ${#missing_system[@]} -gt 0 ]; then
  note "install these first: ${missing_system[*]}"
fi
if ! command -v cargo >/dev/null 2>&1; then
  note "Rust (desktop app only, installs to your home directory, no sudo):"
  note "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  note "Desktop app system libraries (needs sudo, yours to run):"
  note "  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \\"
  note "       libayatana-appindicator3-dev librsvg2-dev build-essential"
fi
if [ ! -x apps/studio/src-tauri/runtime-dist/cpython/bin/python3 ]; then
  note "Optional, for fully offline installers: ./scripts/fetch-python-runtime.sh"
fi

echo
echo "Now run: ./scripts/test-all.sh"
