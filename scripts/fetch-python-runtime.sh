#!/usr/bin/env bash
# Download standalone CPython (python-build-standalone) for bundling into the
# desktop app, so installed apps run students' Python with no system Python
# and no internet. One-time download; output is gitignored.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/apps/studio/src-tauri/runtime-dist"
ARCH="x86_64-unknown-linux-gnu"

# tkinter drags tcl/tk into linuxdeploy's dependency walk when bundling the
# AppImage and is useless for the sidecar; drop it and its data files.
prune() {
  local lib="$DEST/cpython/lib"
  rm -rf "$lib"/python3.*/tkinter "$lib"/python3.*/idlelib "$lib"/python3.*/turtledemo \
    "$lib"/python3.*/turtle.py "$lib"/python3.*/lib-dynload/_tkinter*.so \
    "$lib"/libtcl* "$lib"/libtk* "$lib"/tcl* "$lib"/tk* "$lib"/itcl* "$lib"/Tix* \
    "$lib"/thread* "$lib"/sqlite3* 2>/dev/null || true
  find "$DEST/cpython" -name "libtcl*" -o -name "libtk*" | xargs -r rm -f
}

if [ -x "$DEST/cpython/bin/python3" ]; then
  prune
  echo "already present: $("$DEST/cpython/bin/python3" --version)"
  exit 0
fi

echo "resolving latest python-build-standalone release ..."
API="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
# Asset URLs encode the '+' in the version as %2B.
URL=$(curl -fsSL --max-time 60 "$API" |
  grep -o "https://[^\"]*cpython-3\.12\.[0-9]*%2B[0-9]*-$ARCH-install_only_stripped\.tar\.gz" |
  head -1)
if [ -z "$URL" ]; then
  echo "error: could not find a cpython 3.12 $ARCH asset in the latest release" >&2
  exit 1
fi

echo "downloading $URL"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar "$URL" -o "$TMP/cpython.tar.gz"
mkdir -p "$DEST"
tar -xzf "$TMP/cpython.tar.gz" -C "$TMP"
rm -rf "$DEST/cpython"
mv "$TMP/python" "$DEST/cpython"
prune

echo "bundled: $("$DEST/cpython/bin/python3" --version) -> apps/studio/src-tauri/runtime-dist/cpython"
