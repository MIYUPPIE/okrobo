"""Computer vision for student programs.

    from okrobo import Robot
    from okrobo.vision import find_color

    robot = Robot()
    target = find_color(robot.camera(), "red")
    if target:
        print("red object at", round(target.bearing), "degrees")

Deliberately works with **no dependencies installed**: the blob finder is
plain Python, so a school with no internet still gets working vision lessons
out of the box. When the AI pack is installed, OpenCV accelerates the same
operation and must produce the same answer — a parity test enforces that, so a
lesson's expected result never depends on which packs a machine has.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path as _Path

from .camera import CAMERA_FOV, Frame

# Named colours students can ask for, as (r, g, b) references.
COLORS = {
    "red": (220, 40, 40),
    "green": (40, 200, 80),
    "blue": (60, 110, 230),
    "yellow": (230, 210, 60),
}


@dataclass
class Detection:
    """Where something coloured is in the frame."""

    color: str
    #: pixel column and row of the blob's centre
    x: float
    y: float
    #: how many pixels matched
    area: int
    #: degrees from straight ahead; negative is left, positive is right
    bearing: float
    #: fraction of the frame covered, 0..1 — a rough "how close is it"
    coverage: float


def _matches(pixel: tuple, reference: tuple, tolerance: float) -> bool:
    """Is this pixel that colour?

    Compares hue-like ratios rather than absolute values, because the camera
    darkens distant surfaces: a far-away red box is still red.
    """
    r, g, b = pixel
    total = r + g + b
    if total < 40:  # too dark to have a colour
        return False
    ref_total = sum(reference)
    for channel, ref in zip((r, g, b), reference):
        if abs(channel / total - ref / ref_total) > tolerance:
            return False
    return True


def find_color(frame: Frame, color: str, tolerance: float = 0.12) -> Detection | None:
    """Find the largest patch of a named colour, or None if it is not there."""
    if color not in COLORS:
        raise ValueError(f"unknown colour {color!r}; try one of {sorted(COLORS)}")
    reference = COLORS[color]

    total_x = 0
    total_y = 0
    count = 0
    for y in range(frame.height):
        row = y * frame.width * 3
        for x in range(frame.width):
            index = row + x * 3
            pixel = (frame.pixels[index], frame.pixels[index + 1], frame.pixels[index + 2])
            if _matches(pixel, reference, tolerance):
                total_x += x
                total_y += y
                count += 1

    if count == 0:
        return None

    centre_x = total_x / count
    fraction = 0.5 if frame.width == 1 else centre_x / (frame.width - 1)
    # Column 0 is the left edge of the field of view (see camera.render).
    bearing_radians = fraction * CAMERA_FOV - CAMERA_FOV / 2.0

    return Detection(
        color=color,
        x=centre_x,
        y=total_y / count,
        area=count,
        bearing=bearing_radians * 180.0 / 3.141592653589793,
        coverage=count / (frame.width * frame.height),
    )


def find_color_opencv(frame: Frame, color: str, tolerance: float = 0.12):
    """The same search using OpenCV, when the AI pack is installed.

    Exists so vision stays fast on large frames; a parity test asserts it
    agrees with the plain-Python version.
    """
    import numpy as np  # noqa: F401  (numpy ships with opencv)
    import cv2  # noqa: F401

    if color not in COLORS:
        raise ValueError(f"unknown colour {color!r}; try one of {sorted(COLORS)}")
    reference = COLORS[color]

    image = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(frame.height, frame.width, 3)
    values = image.astype(np.float32)
    totals = values.sum(axis=2)
    bright = totals >= 40
    safe_totals = np.where(totals == 0, 1, totals)

    ref_total = float(sum(reference))
    mask = bright
    for channel in range(3):
        ratio = values[:, :, channel] / safe_totals
        mask = mask & (np.abs(ratio - reference[channel] / ref_total) <= tolerance)

    count = int(mask.sum())
    if count == 0:
        return None

    ys, xs = np.nonzero(mask)
    centre_x = float(xs.mean())
    fraction = 0.5 if frame.width == 1 else centre_x / (frame.width - 1)
    bearing_radians = fraction * CAMERA_FOV - CAMERA_FOV / 2.0

    return Detection(
        color=color,
        x=centre_x,
        y=float(ys.mean()),
        area=count,
        bearing=bearing_radians * 180.0 / 3.141592653589793,
        coverage=count / (frame.width * frame.height),
    )


def opencv_available() -> bool:
    try:
        import cv2  # noqa: F401

        return True
    except Exception:
        return False


# --- Vision Lab: real object detection on real photos ----------------------
#
# find_color above works on the robot's own simulated camera because that
# camera has something colour detection can actually use: camera.render()
# draws flat-shaded colour bands, nothing else (see camera.py). A general
# object detector trained on real photos has nothing to recognise there --
# no COCO class ever appears in that feed. So detect_objects() below is
# deliberately NOT wired to robot.camera() at all: it works on a real photo
# instead, loaded from disk by load_image() (a bundled sample, or a
# student's own file) into the exact same Frame shape camera.render()
# produces, so the two code paths compose if a lesson wants them to, but
# neither assumes the other. See
# docs/decisions/vision-lab-object-detection.md for the full reasoning
# (including why this stayed Python-only, no Blockly/JS/C++ mirror -- it's
# a general-purpose capability, not a robot one, matching find_color_opencv's
# own precedent of a Python-only enhancement).
#
# Model: YOLOX-Nano (Megvii-BaseDetection/YOLOX, Apache-2.0), chosen over
# Ultralytics YOLO specifically because Ultralytics models are AGPL-3.0 by
# default (would force this project to open-source or buy an Enterprise
# license). See runtime/python/okrobo/models/NOTICE.md for exact
# provenance/license, and docs/decisions/vision-lab-object-detection.md for
# the full comparison. detect_objects()'s own decode (grid/stride) and NMS
# below are a Python port of YOLOX's own reference demo
# (demo/ONNXRuntime/onnx_inference.py, yolox/data/data_augment.py,
# yolox/utils/demo_utils.py) -- a modified file per the Apache License's own
# Section 4(b).

COCO_CLASSES = (
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
)

_MODEL_DIR = _Path(__file__).resolve().parent / "models"
_MODEL_PATH = _MODEL_DIR / "yolox_nano.onnx"
_SAMPLES_DIR = _Path(__file__).resolve().parent / "samples"
_INPUT_SIZE = (416, 416)  # yolox_nano's own trained input resolution


@dataclass
class ObjectDetection:
    """One detected object in a real photo (see detect_objects)."""

    #: one of COCO_CLASSES, e.g. "dog", "car", "chair"
    label: str
    #: how sure the model is, 0..1
    confidence: float
    #: bounding box, in pixels of the ORIGINAL image (not the model's own
    #: resized/padded input)
    x: float
    y: float
    width: float
    height: float


def object_detection_available() -> bool:
    """Whether detect_objects() can actually run -- onnxruntime installed
    (it's a hard dependency, see requirements.txt, but this stays defensive
    the same way opencv_available() is, in case an install is incomplete)
    and the bundled model file is present."""
    try:
        import onnxruntime  # noqa: F401
    except Exception:
        return False
    return _MODEL_PATH.exists()


def list_sample_images() -> list:
    """Bundled real photos under okrobo/samples/, for students with no
    photo of their own handy yet -- see load_image()."""
    if not _SAMPLES_DIR.is_dir():
        return []
    return sorted(p.name for p in _SAMPLES_DIR.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))


def load_image(path: str) -> Frame:
    """Reads a real photo file (a bundled sample name from
    list_sample_images(), or any path of your own -- JPEG/PNG/etc.) into the
    same Frame shape camera.render() produces, so detect_objects() (or even
    find_color) works on it exactly the same way."""
    from PIL import Image

    candidate = _SAMPLES_DIR / path
    real_path = candidate if candidate.is_file() else path
    with Image.open(real_path) as img:
        img = img.convert("RGB")
        width, height = img.size
        pixels = img.tobytes()
    return Frame(width=width, height=height, pixels=pixels)


_session = None


def _get_session():
    # Cached at module scope: each student program runs in its own fresh
    # subprocess (see worker.py), so there is no cross-student state to
    # worry about here -- only repeat calls within the SAME run, where
    # reloading a 3.5 MB ONNX graph on every detect_objects() call would be
    # wasteful.
    global _session
    if _session is None:
        if not _MODEL_PATH.exists():
            raise RuntimeError(f"object detection model missing at {_MODEL_PATH} -- reinstall should restore it")
        import onnxruntime

        _session = onnxruntime.InferenceSession(str(_MODEL_PATH), providers=["CPUExecutionProvider"])
    return _session


def _preprocess(frame: Frame):
    """Letterbox-resize into YOLOX's own fixed input size, matching
    yolox/data/data_augment.py's own preproc -- PIL's own BILINEAR resize
    stands in for cv2's INTER_LINEAR (this project has no other use for
    OpenCV), verified immaterial to the result by the feasibility spike this
    was built from (max abs output diff 9.89e-5 against the cv2 reference
    path, floating-point-noise level)."""
    import numpy as np
    from PIL import Image

    image_array = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(frame.height, frame.width, 3)
    input_h, input_w = _INPUT_SIZE
    ratio = min(input_h / frame.height, input_w / frame.width)
    resized_w, resized_h = int(frame.width * ratio), int(frame.height * ratio)

    resized = np.array(Image.fromarray(image_array).resize((resized_w, resized_h), Image.BILINEAR))
    padded = np.full((input_h, input_w, 3), 114, dtype=np.uint8)
    padded[:resized_h, :resized_w] = resized

    chw = padded.transpose(2, 0, 1).astype(np.float32)
    return chw[None, :, :, :], ratio


def _decode_grid_predictions(outputs, img_size):
    """Ported from yolox/utils/demo_utils.py's own demo_postprocess: turns
    the model's raw per-grid-cell offsets into absolute box coordinates."""
    import numpy as np

    strides = (8, 16, 32)
    grids = []
    expanded_strides = []
    hsizes = [img_size[0] // stride for stride in strides]
    wsizes = [img_size[1] // stride for stride in strides]
    for hsize, wsize, stride in zip(hsizes, wsizes, strides):
        xv, yv = np.meshgrid(np.arange(wsize), np.arange(hsize))
        grid = np.stack((xv, yv), 2).reshape(1, -1, 2)
        grids.append(grid)
        expanded_strides.append(np.full((*grid.shape[:2], 1), stride))
    grids = np.concatenate(grids, 1)
    expanded_strides = np.concatenate(expanded_strides, 1)
    outputs[..., :2] = (outputs[..., :2] + grids) * expanded_strides
    outputs[..., 2:4] = np.exp(outputs[..., 2:4]) * expanded_strides
    return outputs


def _nms(boxes, scores, nms_thr):
    """Ported from yolox/utils/demo_utils.py's own nms -- single-class
    greedy non-max suppression."""
    import numpy as np

    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        overlap = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(overlap <= nms_thr)[0] + 1]
    return keep


def _multiclass_nms(boxes, scores, nms_thr, score_thr):
    """Ported from yolox/utils/demo_utils.py's own
    multiclass_nms_class_agnostic (the reference demo's own default)."""
    import numpy as np

    cls_inds = scores.argmax(1)
    cls_scores = scores[np.arange(len(cls_inds)), cls_inds]
    valid = cls_scores > score_thr
    if not valid.any():
        return None
    keep = _nms(boxes[valid], cls_scores[valid], nms_thr)
    if not keep:
        return None
    valid_boxes, valid_scores, valid_cls_inds = boxes[valid], cls_scores[valid], cls_inds[valid]
    return np.concatenate([valid_boxes[keep], valid_scores[keep, None], valid_cls_inds[keep, None]], 1)


def detect_objects(frame: Frame, confidence: float = 0.5) -> list:
    """Finds real objects (one of COCO_CLASSES -- person, car, dog, chair,
    and 76 more) in a real photo. Deliberately NOT meaningful against
    robot.camera()'s own simulated feed -- see this module's own header
    comment above detect_objects's neighbourhood, and
    docs/decisions/vision-lab-object-detection.md.

        from okrobo.vision import detect_objects, load_image, list_sample_images

        frame = load_image(list_sample_images()[0])
        for obj in detect_objects(frame):
            print(obj.label, round(obj.confidence, 2))

    Returns the most confident detections first; empty list if nothing
    scored above `confidence` (0..1, default 0.5).
    """
    import numpy as np

    session = _get_session()
    tensor, ratio = _preprocess(frame)
    raw_output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    predictions = _decode_grid_predictions(raw_output, _INPUT_SIZE)[0]

    boxes = predictions[:, :4]
    scores = predictions[:, 4:5] * predictions[:, 5:]

    boxes_xyxy = np.ones_like(boxes)
    boxes_xyxy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2.0
    boxes_xyxy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2.0
    boxes_xyxy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2.0
    boxes_xyxy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2.0
    boxes_xyxy /= ratio

    dets = _multiclass_nms(boxes_xyxy, scores, nms_thr=0.45, score_thr=0.1)
    if dets is None:
        return []

    results = []
    for x1, y1, x2, y2, score, cls_ind in dets:
        if score < confidence:
            continue
        results.append(
            ObjectDetection(
                label=COCO_CLASSES[int(cls_ind)],
                confidence=float(score),
                x=float(x1),
                y=float(y1),
                width=float(x2 - x1),
                height=float(y2 - y1),
            )
        )
    results.sort(key=lambda d: d.confidence, reverse=True)
    return results
