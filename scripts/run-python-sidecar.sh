#!/usr/bin/env bash
# Start the OKROBO Python sidecar (contracts/robot-remote/v0).
# The studio connects to it automatically; students' Python then drives the sim.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT/runtime/python"
if [ ! -d .deps ]; then
  echo "installing python dependencies into runtime/python/.deps ..."
  python3 -m pip install --quiet --target=.deps -r requirements.txt
fi
exec python3 -m okrobo.sidecar "$@"
