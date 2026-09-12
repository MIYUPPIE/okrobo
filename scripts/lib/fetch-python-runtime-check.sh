#!/usr/bin/env bash
# Gate test for scripts/fetch-python-runtime.sh's pure OS/arch -> release
# target mapping. Deterministic, no network: shadows `uname` to exercise
# every branch (Linux, both macOS arches, Windows via Git Bash) regardless
# of which OS this check itself runs on.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=/dev/null
source "$ROOT/scripts/fetch-python-runtime.sh"

fail=0
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: $label: expected '$expected', got '$actual'" >&2
    fail=1
  fi
}

uname() {
  case "$1" in
    -s) echo "$MOCK_UNAME_S" ;;
    -m) echo "$MOCK_UNAME_M" ;;
  esac
}

MOCK_UNAME_S=Linux MOCK_UNAME_M=x86_64
assert_eq "linux x86_64" "x86_64-unknown-linux-gnu" "$(detect_target)"

MOCK_UNAME_S=Darwin MOCK_UNAME_M=arm64
assert_eq "macos apple silicon" "aarch64-apple-darwin" "$(detect_target)"

MOCK_UNAME_S=Darwin MOCK_UNAME_M=x86_64
assert_eq "macos intel" "x86_64-apple-darwin" "$(detect_target)"

MOCK_UNAME_S=MINGW64_NT-10.0 MOCK_UNAME_M=x86_64
assert_eq "windows (git bash)" "x86_64-pc-windows-msvc" "$(detect_target)"

if MOCK_UNAME_S=Plan9 MOCK_UNAME_M=x86_64 detect_target >/dev/null 2>&1; then
  echo "FAIL: detect_target should reject an unsupported OS" >&2
  fail=1
fi

assert_eq "windows binary path" "cpython/python.exe" "$(python_bin_for x86_64-pc-windows-msvc)"
assert_eq "linux binary path" "cpython/bin/python3" "$(python_bin_for x86_64-unknown-linux-gnu)"
assert_eq "macos binary path" "cpython/bin/python3" "$(python_bin_for aarch64-apple-darwin)"

if [ "$fail" -eq 0 ]; then
  echo "fetch-python-runtime-check: all assertions passed"
else
  exit 1
fi
