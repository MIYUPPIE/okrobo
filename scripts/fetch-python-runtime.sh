#!/usr/bin/env bash
# Download standalone CPython (python-build-standalone) for bundling into the
# desktop app, so installed apps run students' Python with no system Python
# and no internet. One-time download; output is gitignored.
#
# Auto-detects the host OS/arch (Linux, macOS Intel/Apple Silicon, Windows)
# so the same command works unmodified on every GitHub Actions runner in the
# desktop-build matrix (see .github/workflows/build-desktop.yml) as well as
# on a contributor's own laptop.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/apps/studio/src-tauri/runtime-dist"

# Maps this host to a python-build-standalone release target triple.
detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux) echo "x86_64-unknown-linux-gnu" ;;
    Darwin)
      case "$arch" in
        arm64) echo "aarch64-apple-darwin" ;;
        *) echo "x86_64-apple-darwin" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*) echo "x86_64-pc-windows-msvc" ;;
    *)
      echo "error: unsupported OS '$os'" >&2
      return 1
      ;;
  esac
}

# Where the interpreter ends up inside DEST/cpython once extracted -- every
# python-build-standalone archive unpacks a top-level "python/" dir, but only
# the Windows layout skips the "bin/" subdirectory (see python/python.exe vs.
# python/bin/python3 in the release assets).
python_bin_for() {
  case "$1" in
    *-pc-windows-msvc) echo "cpython/python.exe" ;;
    *) echo "cpython/bin/python3" ;;
  esac
}

# tkinter/idle/turtle are useless for the sidecar and, on Linux, drag tcl/tk
# into linuxdeploy's dependency walk when bundling the AppImage; drop them
# and their data files everywhere to keep the bundle small.
prune() {
  local target="$1"
  case "$target" in
    *-pc-windows-msvc)
      rm -rf "$DEST/cpython/Lib/tkinter" "$DEST/cpython/Lib/idlelib" \
        "$DEST/cpython/Lib/turtledemo" "$DEST/cpython/Lib/turtle.py" \
        "$DEST/cpython/DLLs/_tkinter.pyd" "$DEST/cpython/DLLs/tcl86t.dll" \
        "$DEST/cpython/DLLs/tk86t.dll" 2>/dev/null || true
      ;;
    *)
      local lib="$DEST/cpython/lib"
      rm -rf "$lib"/python3.*/tkinter "$lib"/python3.*/idlelib "$lib"/python3.*/turtledemo \
        "$lib"/python3.*/turtle.py "$lib"/python3.*/lib-dynload/_tkinter*.so \
        "$lib"/libtcl* "$lib"/libtk* "$lib"/tcl* "$lib"/tk* "$lib"/itcl* "$lib"/Tix* \
        "$lib"/thread* "$lib"/sqlite3* 2>/dev/null || true
      find "$DEST/cpython" -name "libtcl*" -o -name "libtk*" | xargs -r rm -f
      ;;
  esac
}

main() {
  local target python_bin
  target="${1:-$(detect_target)}"
  python_bin="$DEST/$(python_bin_for "$target")"

  if [ -f "$python_bin" ]; then
    prune "$target"
    echo "already present: $("$python_bin" --version)"
    return 0
  fi

  echo "resolving latest python-build-standalone release for $target ..."
  local api url
  api="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
  # Asset URLs encode the '+' in the version as %2B.
  url=$(curl -fsSL --max-time 60 "$api" |
    grep -o "https://[^\"]*cpython-3\.12\.[0-9]*%2B[0-9]*-$target-install_only_stripped\.tar\.gz" |
    head -1)
  if [ -z "$url" ]; then
    echo "error: could not find a cpython 3.12 $target asset in the latest release" >&2
    return 1
  fi

  echo "downloading $url"
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fL --progress-bar "$url" -o "$tmp/cpython.tar.gz"
  mkdir -p "$DEST"
  tar -xzf "$tmp/cpython.tar.gz" -C "$tmp"
  rm -rf "$DEST/cpython"
  mv "$tmp/python" "$DEST/cpython"
  prune "$target"

  echo "bundled: $("$python_bin" --version) -> apps/studio/src-tauri/runtime-dist/cpython ($target)"
}

# Allow `source`-ing this file (e.g. from tests) without running main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
