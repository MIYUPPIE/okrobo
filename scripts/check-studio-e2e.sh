#!/usr/bin/env bash
# Permanent browser regression test: boots the dev server headlessly and
# walks the core student journeys (robot switching, running a block program,
# the camera, the Python mirror, the lesson player). See
# scripts/lib/studio-e2e-check.mjs for what it checks and why it exists.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5198}"
CDP_PORT="${CDP_PORT:-9230}"
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
  sleep 1
  rm -rf "$TMP" 2>/dev/null
  return 0
}
trap cleanup EXIT

BROWSER=""
for candidate in google-chrome chromium chromium-browser; do
  command -v "$candidate" >/dev/null && BROWSER="$candidate" && break
done
if [ -z "$BROWSER" ]; then
  echo "skip: no chrome/chromium found for the studio E2E check"
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

CDP_PORT="$CDP_PORT" URL="http://localhost:$PORT/" node "$ROOT/scripts/lib/studio-e2e-check.mjs"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "--- dev server log (tail) ---"
  tail -30 "$TMP/dev.log"
fi
exit "$STATUS"
