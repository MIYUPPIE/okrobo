#!/usr/bin/env bash
# Build the installable desktop app: deb + AppImage on Linux, NSIS installer
# on Windows, dmg + app on macOS (see apps/studio/src-tauri/tauri.*.conf.json
# for the per-platform bundle targets). Bundles the WASM engine, the okrobo
# Python runtime with its deps, and (after fetch-python-runtime.sh) a
# standalone CPython for offline machines. Runs unmodified on any of the
# three OSes -- this is also what .github/workflows/build-desktop.yml runs
# on each platform's own GitHub-hosted runner.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

"$ROOT/scripts/build-engine-wasm.sh"
if [ ! -d "$ROOT/runtime/python/.deps" ]; then
  (cd "$ROOT/runtime/python" && python3 -m pip install --quiet --target=.deps -r requirements.txt)
fi
"$ROOT/scripts/fix-mujoco-plugin-rpath.sh"
"$ROOT/scripts/fetch-vision-model.sh"

# Mirrors sidecar.rs's bundled_python_relpath_for() / fetch-python-runtime.sh's
# python_bin_for(): every platform but Windows nests the interpreter in bin/.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) bundled_python="$ROOT/apps/studio/src-tauri/runtime-dist/cpython/python.exe" ;;
  *) bundled_python="$ROOT/apps/studio/src-tauri/runtime-dist/cpython/bin/python3" ;;
esac
if [ ! -f "$bundled_python" ]; then
  echo "note: no bundled CPython (run scripts/fetch-python-runtime.sh for fully offline installs);"
  echo "      the packaged app will fall back to the target machine's python3/python."
fi

cd "$ROOT/apps/studio"
npx tauri build

echo
echo "artifacts:"
find src-tauri/target/release/bundle -maxdepth 2 \( -name "*.deb" -o -name "*.AppImage" -o -name "*.msi" -o -name "*.exe" -o -name "*.dmg" -o -name "*.app" \) | sed 's/^/  /'
