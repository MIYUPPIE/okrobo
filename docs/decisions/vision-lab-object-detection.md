# Decision: Vision Lab — real object detection on real photos

**Date:** 2026-09-07

## What this is

`okrobo.vision.detect_objects()` (Python-only, see below): finds real
objects — person, car, dog, chair, and 76 more COCO classes — in a real
photo file, using YOLOX-Nano (Apache-2.0, Megvii-BaseDetection) via
onnxruntime. A new `packs/ai/lessons/02-detect-real-objects.md` teaches it.

## Why this isn't wired to `robot.camera()`

The first framing considered was "port `find_color`'s own architecture, but
with a real detector instead of a colour matcher." That's wrong for this
codebase specifically: `runtime/python/okrobo/camera.py`'s `render()` is a
1D raycaster — for each pixel column it casts one ray, finds the nearest
obstacle, and draws a flat-shaded vertical colour band. Sky above, floor
below. That's the *entire* visual vocabulary the simulated camera can ever
produce. No shape, no texture, nothing resembling a dog, car, chair, or any
of YOLOX's 80 COCO classes ever appears in that feed. A COCO-trained
detector pointed at it would return garbage or nothing, always — not a bug
to fix, a fundamental mismatch between what the camera renders and what the
model was trained to recognise.

`find_color` works against that camera specifically *because* it's built for
exactly that imagery (flat colour bands). A general object detector needs
real photographic content, which this simulator's camera was never designed
to produce (and re-designing it to render photorealistic content, or
training a bespoke classifier on the raycaster's own narrow visual
vocabulary, are each a much larger, different, and not obviously
worthwhile undertaking — the raycaster's simplicity is a legitimate,
deliberate design choice of the original simulator, not a gap).

So `detect_objects()` is decoupled entirely: it takes a `Frame` from
anywhere — `load_image()` reads a real photo file into that exact same
shape `camera.render()` already produces, so the two compose if a lesson
ever wants them to, but neither assumes the other exists. This mirrors how
many real-world CV teaching tools separate "learn to use a vision API on
real images" from "drive a robot with it" — a legitimate, common pedagogical
split, not a workaround.

## Why Python-only — no Blockly block, no TS port, no C++ SDK mirror

Every other vision capability in this codebase (`find_color`) has three
mirrors: Python (`vision.py`), TS (`lib/vision.ts`, for Blockly-compiled JS
execution), and C++ (`engine/api/vision.hpp`, for the compiled SDK). This
one doesn't, on purpose, and it isn't a shortcut:

- **Blockly's own JS execution sandbox only exposes `robot`** — the
  generated code runs as `new AsyncFunction("robot", code)` with nothing
  else in scope (`apps/studio/src/program/execute.ts`). `detect_objects()`
  isn't a robot capability at all; there's no `robot.*` method it could
  reasonably become, and no image/file argument a Blockly block could
  supply.
- **This exact "Python-only, no block" pattern already exists**:
  `find_color_opencv` (same file) has no Blockly block either — not every
  Python capability needs one. `detect_objects()`/`load_image()` follow
  that precedent directly.
- **A real cross-runtime NN inference "parity" gate is a different kind of
  problem than this codebase's existing ones.** The feasibility spike this
  was built from proved onnxruntime-web (WASM) agrees with onnxruntime
  (Python CPU) to within `9.89e-5` max absolute difference on raw model
  output — tight enough that a real numeric parity gate would be
  achievable, if a JS mirror existed. It doesn't yet, because there's
  nowhere for it to run (see above) — this is banked for if a real reason
  to add one shows up (e.g. Build Mode's own CAD viewport, or the main
  Simulate view growing a real photographic camera), not a limitation of
  the underlying approach.
- **C++ SDK support** is the same story: `engine/api/vision.hpp` mirrors
  `find_color` because Blockly's C++ generator calls it directly
  (`cppGenerator.forBlock["okrobo_see_color"]`) — there's no equivalent
  call site for a non-robot capability, so nothing to mirror yet.

## Model choice: YOLOX-Nano over Ultralytics YOLO

Researched real current numbers (WebSearch/PyPI/GitHub directly, not
memorised) rather than assuming "YOLO means Ultralytics":

| | Ultralytics YOLO (v5n .. YOLO26) | YOLOX-Nano (Megvii) |
|---|---|---|
| License | **AGPL-3.0** by default — must open-source the entire project or buy an Enterprise license | **Apache-2.0** |
| Redistributing weights | Same AGPL obligation applies to the trained weights, not just the code | No copyleft; attribution only |
| Params / size | 6.3 MB (YOLOv8n) | ~0.9M params, 3.5 MB (`yolox_nano.onnx`) |
| COCO-80 pretrained ONNX | Requires export | Direct download from an official release |

OKROBO has no LICENSE file today (private/commercial posture) — bundling an
AGPL-3.0 model would have forced a real legal decision neither asked for nor
wanted. This alone ruled out every Ultralytics YOLO variant, independent of
the size question. YOLOX-Nano (Apache-2.0, Megvii-BaseDetection, actively
maintained) sidesteps it entirely, at a comparable or smaller size and
comparable accuracy for this use case. NanoDet-Plus (also Apache-2.0, even
smaller at <2 MB) was the runner-up — not chosen because its repo has had no
commits since August 2024 (still fine to *use*, since only its pretrained
weights and export format matter, not ongoing development, but YOLOX's own
active maintenance and more mainstream tooling made it the safer default).

`runtime/python/okrobo/models/yolox_nano.onnx` is the official pretrained
release asset, downloaded unmodified (sha256 verified against the spike's
own record). `models/LICENSE` and `models/NOTICE.md` carry the exact
provenance and the Apache License's own Section 4(b) attribution for the
ported decode/NMS code (`detect_objects()`'s own grid-decode and NMS helpers
are a direct Python port of YOLOX's reference demo — `demo/ONNXRuntime/
onnx_inference.py`, `data_augment.py`, `demo_utils.py` — adapted to this
project's own style; PIL's own BILINEAR resize stands in for the reference's
cv2 INTER_LINEAR, verified immaterial to the result).

## Real cost: ~70 MB, not the originally-assumed 500 MB

The original "YOLO/torch" framing (`build.md`'s own Phase-8-era "Not done"
note) bundled a full PyTorch/Ultralytics *training* framework. This project
only ever needs *inference* on a pretrained model — a fundamentally
different, much smaller dependency:

- `onnxruntime` (MIT, Microsoft): **66 MB** unpacked in `.deps` (the ~23 MB
  figure quoted during research was the compressed PyPI wheel download size,
  not the unpacked install).
- `Pillow` (decodes real JPEG/PNG photos into the same raw-RGB `Frame` shape
  `camera.render()` already produces): **7.0 MB**.
- `yolox_nano.onnx`: 3.5 MB.

Total ~76 MB added to `runtime/python/.deps` — smaller than the MuJoCo
integration's own ~135 MB pull, and both are already accepted costs in this
project (see `runtime/python/requirements.txt`'s own precedent). No pack
gate needed: like `find_color`, this is a hard dependency
(`requirements.txt`), not something a school has to separately install —
Blockly blocks in this codebase are never pack-gated anyway (only lesson
*content* is), so gating the underlying capability behind an install step
while leaving no way to hide the (nonexistent) block would have been
inconsistent.

## No bundled sample photos

The original framing ("students run detection on real bundled sample
photos, or upload their own") assumed a small set of shipped example
images. That was dropped: most "obvious" test photos passed around ML demo
repos (including YOLOX's own `assets/dog.jpg`, used only for this feature's
own manual verification and the eval script below, never shipped) have
genuinely unclear underlying copyright — a decade-old stock photo with no
clear original license grant, just conventionally reused. Rather than spend
real effort sourcing and verifying properly-licensed (CC0/public-domain)
sample imagery under time pressure, `load_image()` accepts any real file
path a student already has — "upload your own" *is* the whole feature, with
no bundled-content licensing question at all. `list_sample_images()` /
`_SAMPLES_DIR` stay in the code as a clean extension point if properly
licensed samples get added later.

## Testing: gate tests vs. eval, deliberately different lanes

Real-photo detection accuracy is a *model quality* question, not
deterministic code logic — CLAUDE.md's own two-lane framework (gate tests:
deterministic/free/fast; evals: quality-measuring, allowed to be
non-deterministic, pass-threshold-based) maps onto this directly:

- **Gate tests** (`runtime/python/tests/test_vision.py`, always run, no
  network): the decode/NMS math (`_decode_grid_predictions`, `_nms`,
  `_multiclass_nms`) against hand-built numpy arrays with known-correct
  answers — proves the *port* is correct, independent of any photo. Plus a
  structural/robustness check (`detect_objects` runs end-to-end on a
  synthetic flat-colour image without crashing, returns well-shaped
  results) and `load_image`/`list_sample_images` unit tests. A sidecar
  smoke test (`test_worker.py`) proves it works through the real
  worker/RPC boundary a lesson actually runs in.
- **Eval** (`runtime/python/tests/eval_vision_lab.py`, NOT `test_*.py` —
  pytest's default collection, and `scripts/test-all.sh`'s own
  on-disk-vs-collected file-count guard, both skip it by name): fetches the
  same well-known real photo the feasibility spike verified against (at run
  time, never committed to this repo), runs `detect_objects`, and asserts a
  pass threshold (>=2 of 3 expected classes above 0.5 confidence). Run by
  hand before shipping a `vision.py` change, or wired into a periodic job —
  never the per-commit gate. Verified passing: found all 3/3 expected
  classes (dog 0.833, car 0.817, bicycle 0.779).

## A real, previously-latent production bug this surfaced

`okrobo/sidecar.py`'s own `start_program()` spawns the worker subprocess via
`asyncio.create_subprocess_exec(...)` with no `env=` at all -- it silently
inherited whatever `PYTHONPATH` the sidecar process itself happened to be
launched with. The sidecar sees `.deps` (mujoco, and now onnxruntime) via
`from . import _deps` at import time, which patches `sys.path` -- a
**process-local** change a subprocess never inherits; only real environment
variables do. Every worker-executed capability before `detect_objects()`
needed nothing from `.deps` at all (`find_color`/`Frame` are dependency-free
pure Python -- that's the whole point of `find_color`'s own design), so this
was completely latent until now: a real student "Run" of a Vision Lab
lesson would have failed with `ModuleNotFoundError: No module named
'onnxruntime'` inside the worker subprocess, even though the sidecar
process itself imports onnxruntime just fine. Caught by `test_worker.py`'s
own `run_worker` harness failing under `scripts/test-all.sh`'s bare
`python3 -m pytest` invocation (no `PYTHONPATH` pre-set in that shell) even
though the same test passed when run manually with `PYTHONPATH=.deps:.`
already set -- the discrepancy is the tell.

Fixed at the actual production call site (`sidecar.py`'s own
`start_program`), not just in the test harness that happened to catch it:
both now build an explicit `env` dict with `.deps` prepended onto
`PYTHONPATH`, mirroring `_deps.py`'s own exact path computation. Verified
with `env -u PYTHONPATH python3 -m pytest tests/test_sidecar.py
tests/test_worker.py` (both harnesses, deliberately with no `PYTHONPATH`
already set in the invoking shell, exactly reproducing how
`scripts/test-all.sh` runs) -- all pass, including a new full-stack
regression test (`test_sidecar.py`'s own
`test_program_can_import_a_deps_only_package_through_the_real_worker_subprocess`,
which runs the real `serve()`/`start_program` path end to end, not a lower-
level harness).

## Non-goals

- **No live use in `robot.camera()`'s own pipeline.** See above — the
  simulated camera has nothing for a COCO detector to recognise.
- **No Blockly block, TS port, or C++ SDK mirror this phase.** See above —
  no sandbox reachability for the first, no call site for the second.
- **No bundled sample photos.** See above.
- **No training/fine-tuning.** Pretrained COCO-80 weights only.

## Verification

Feasibility spike (background agent, confined to gitignored
`tools/yolox-spike/`, matching the MuJoCo integration's own pre-work
discipline): real download, real onnxruntime inference against a real
photo (dog/car/bicycle, all detected correctly), real onnxruntime-web WASM
cross-check (9.89e-5 max diff), real license text, real installed sizes —
full pass on all 6 points before any application code was written.

Real implementation: `runtime/python/tests/test_vision.py` (13 new tests,
all passing), `runtime/python/tests/test_worker.py` (+1, real
worker-subprocess smoke test), `runtime/python/tests/eval_vision_lab.py`
(new eval, passing 3/3), `apps/studio/src/packs/corePack.test.ts` (allowlist
extended for the new lesson's own API calls, 6/6 passing). Manually
verified end to end against the real bundled model + real onnxruntime
install in this actual repo location (not just the spike's own isolated
copy): dog 0.8330, car 0.8173, bicycle 0.7786 — matching the spike's own
findings closely.
