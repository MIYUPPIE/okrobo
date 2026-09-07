#!/usr/bin/env bash
# Downloads Vision Lab's own model weight (see
# docs/decisions/vision-lab-object-detection.md) into
# runtime/python/okrobo/models/ -- gitignored, never committed (CLAUDE.md:
# no model weights in the repo), same "fetched at setup time" treatment
# runtime/python/.deps and tools/mujoco already get. Auto-run by
# scripts/test-all.sh; safe to re-run (a no-op if the file already exists
# with the right checksum).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$ROOT/runtime/python/okrobo/models"
DEST="$DEST_DIR/yolox_nano.onnx"
URL="https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx"
SHA256="c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d"

check_sum() {
  echo "$SHA256  $DEST" | sha256sum --check --status
}

mkdir -p "$DEST_DIR"

if [ -f "$DEST" ] && check_sum; then
  echo "yolox_nano.onnx already present and verified, skipping download"
  exit 0
fi

echo "fetching yolox_nano.onnx (~3.5 MB, one-time, see models/NOTICE.md)..."
curl -sL -o "$DEST" "$URL"

if ! check_sum; then
  echo "FAIL: yolox_nano.onnx sha256 mismatch after download -- got $(sha256sum "$DEST" | cut -d' ' -f1), expected $SHA256" >&2
  rm -f "$DEST"
  exit 1
fi

echo "yolox_nano.onnx downloaded and verified"
