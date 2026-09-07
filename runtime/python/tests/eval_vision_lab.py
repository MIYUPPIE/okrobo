"""Quality eval for okrobo.vision.detect_objects() -- real-photo accuracy,
not gate-tested code logic (that's test_vision.py's own job: the decode/NMS
math, structural correctness on a synthetic image, none of which need a real
photo or network access).

Deliberately NOT named test_*.py: pytest's default collection (and
scripts/test-all.sh's own on-disk-vs-collected file-count guard) never picks
this up, so it never runs as part of the fast, free, always-green gate suite.
Model accuracy against a real photo isn't gate-test material anyway -- it
needs network access (fetches a well-known public test image at run time,
never bundled/redistributed as part of this repo -- see
docs/decisions/vision-lab-object-detection.md for why no sample photos ship
in the product itself) and is inherently a quality measurement with a pass
threshold, not a deterministic assertion. Run by hand before shipping a
vision.py change, or wire into a periodic/nightly job -- never into the
per-commit gate:

    PYTHONPATH=.deps:. python3 tests/eval_vision_lab.py
"""

from __future__ import annotations

import sys
import tempfile
import urllib.request
from pathlib import Path

# The same well-known YOLOX demo photo (dog + bicycle + car) the feasibility
# spike this feature was built from verified against by hand -- fetched at
# eval time, never committed to this repo.
TEST_IMAGE_URL = "https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/main/assets/dog.jpg"
EXPECTED_CLASSES = {"dog", "car", "bicycle"}
MIN_CONFIDENCE = 0.5
PASS_THRESHOLD = 2  # at least 2 of the 3 expected classes, each above MIN_CONFIDENCE


def main() -> int:
    from okrobo.vision import detect_objects, load_image, object_detection_available

    if not object_detection_available():
        print("FAIL: object_detection_available() is False -- onnxruntime or the model is missing")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        image_path = Path(tmp) / "eval-dog.jpg"
        print(f"fetching {TEST_IMAGE_URL} ...")
        urllib.request.urlretrieve(TEST_IMAGE_URL, image_path)

        frame = load_image(str(image_path))
        results = detect_objects(frame, confidence=MIN_CONFIDENCE)

    found = {d.label for d in results}
    print(f"detected: {[(d.label, round(d.confidence, 3)) for d in results]}")
    hits = found & EXPECTED_CLASSES
    print(f"expected classes found: {sorted(hits)} ({len(hits)}/{len(EXPECTED_CLASSES)})")

    if len(hits) < PASS_THRESHOLD:
        print(f"FAIL: found {len(hits)} of {len(EXPECTED_CLASSES)} expected classes, need >= {PASS_THRESHOLD}")
        return 1

    print(f"PASS: found {len(hits)}/{len(EXPECTED_CLASSES)} expected classes above confidence {MIN_CONFIDENCE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
