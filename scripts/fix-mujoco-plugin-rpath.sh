#!/usr/bin/env bash
# mujoco's Linux wheel ships its optional plugin .so files (plugin/*.so --
# actuator/elasticity/sdf/sensor extensions, dlopen'd by libmujoco itself,
# not linked directly by any Python extension module) with a RUNPATH baked
# in from mujoco's own build machine:
#   /tmpfs/src/git/mujoco_internal/build/lib
# That path never exists here. Python's dynamic loader never notices, because
# by the time a plugin dlopens libmujoco.so.3.9.0 the main mujoco extension
# has already loaded it by soname -- but linuxdeploy's static dependency walk
# (used when bundling the desktop app's AppImage) does notice, can't resolve
# it, and aborts the whole bundle with "Could not find dependency".
#
# Fix: repoint each plugin's RUNPATH at its real sibling directory
# ($ORIGIN/.., i.e. mujoco/, one level up from mujoco/plugin/) so both
# linuxdeploy's static walk and a plain manual `python -c "import mujoco"`
# resolve the same way. Idempotent; a no-op if .deps/mujoco isn't installed
# (nothing to fix) or already patched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT/runtime/python/.deps/mujoco/plugin"

# RUNPATH/patchelf is an ELF (Linux) concept. macOS's mujoco wheel has the
# same kind of build-machine-absolute path baked into its dylibs via
# @rpath/install_name, but macOS's app/dmg bundler (unlike linuxdeploy for
# the AppImage) doesn't do a strict static dependency walk that trips over
# it, so there's nothing to patch there. Windows's plugin DLLs resolve via
# the process's DLL search path, not an embedded rpath, so same story.
if [ "$(uname -s)" != "Linux" ]; then
  echo "not Linux -- mujoco plugin rpath patch doesn't apply here, skipping"
  exit 0
fi

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "no runtime/python/.deps/mujoco/plugin -- nothing to patch"
  exit 0
fi

if ! command -v patchelf >/dev/null 2>&1; then
  echo "error: patchelf not found on PATH (apt: patchelf, or 'pip install --target=<dir> patchelf')" >&2
  exit 1
fi

for so in "$PLUGIN_DIR"/*.so; do
  [ -e "$so" ] || continue
  patchelf --set-rpath '$ORIGIN/..' "$so"
  echo "patched: $so"
done
