#!/usr/bin/env bash
# Acceptance check for the DEV server (npm run dev), not just the built app.
# Boots Vite headlessly and asserts the studio really loads the WASM engine
# and renders the 3D viewport, with no Vite error overlay.
#
# This exists because a bug shipped that only affected dev: the engine lived
# in public/ and Vite refuses to serve public files as ES modules, so
# `npm run dev` and `tauri dev` were broken while the built app worked.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5199}"
CDP_PORT="${CDP_PORT:-9231}"
TMP="$(mktemp -d)"
# `npm run dev` runs predev then dev as separate child processes; killing
# just the top-level npm PID can leave the actual vite process (its
# grandchild) orphaned and still holding the port. Kill the whole tree.
kill_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null
}
cleanup() {
  [ -n "${DEV_PID:-}" ] && kill_tree "$DEV_PID"
  [ -n "${CHROME_PID:-}" ] && kill "$CHROME_PID" 2>/dev/null
  sleep 1  # let the browser finish writing its profile before removing it
  rm -rf "$TMP" 2>/dev/null
  return 0
}
trap cleanup EXIT

BROWSER=""
for candidate in google-chrome chromium chromium-browser; do
  command -v "$candidate" >/dev/null && BROWSER="$candidate" && break
done
if [ -z "$BROWSER" ]; then
  echo "skip: no chrome/chromium found for the dev-server check"
  exit 0
fi

cd "$ROOT/apps/studio"
npm run dev -- --port "$PORT" --strictPort >"$TMP/dev.log" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/" >/dev/null 2>&1 && break
  sleep 0.5
done

"$BROWSER" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port="$CDP_PORT" --user-data-dir="$TMP/chrome" \
  about:blank >"$TMP/chrome.log" 2>&1 &
CHROME_PID=$!
sleep 3

CDP_PORT="$CDP_PORT" URL="http://localhost:$PORT/" node "$ROOT/scripts/lib/dev-server-check.mjs"
