"""Gate tests for the camera and vision.

The important guarantee: vision gives the same answer with or without the AI
pack installed, so a lesson's expected result never depends on which packs a
machine has.
"""

import math

import numpy as np
import pytest
from PIL import Image

from okrobo import Obstacle, Robot, World, WorldConfig
from okrobo.camera import CAMERA_FOV, render
from okrobo.vision import (
    COCO_CLASSES,
    COLORS,
    Detection,
    detect_objects,
    find_color,
    find_color_opencv,
    list_sample_images,
    load_image,
    object_detection_available,
    opencv_available,
)
from okrobo.vision import _decode_grid_predictions, _multiclass_nms, _nms


def world_with_box(x=1.6, y=1.0, color=(220, 40, 40)) -> World:
    config = WorldConfig(
        obstacles=[Obstacle(x=x, y=y, width=0.2, height=0.2, color=color)]
    )
    return World(config)


def test_camera_frame_shape():
    frame = render(World(), 32, 24)
    assert frame.width == 32
    assert frame.height == 24
    assert len(frame.pixels) == 32 * 24 * 3
    assert frame.pixel(0, 0) == (22, 24, 29)  # sky
    assert frame.pixel(0, 23) == (26, 34, 48)  # floor


def test_camera_rejects_bad_sizes():
    with pytest.raises(ValueError):
        render(World(), 0, 10)
    with pytest.raises(ValueError):
        render(World(), 10, 1000)


def test_camera_sees_a_red_box_ahead():
    frame = render(world_with_box(), 64, 48)
    r, g, b = frame.pixel(32, 24)
    assert r > g * 2 and r > b * 2


def test_obstacle_shortens_the_distance_sensor():
    assert math.isclose(World().state().distance, 0.9, abs_tol=1e-9)
    # Box near face at x=1.5, robot at x=1.0 with radius 0.1.
    assert math.isclose(world_with_box().state().distance, 0.4, abs_tol=1e-9)


def test_find_color_locates_the_box():
    detection = find_color(render(world_with_box(), 64, 48), "red")
    assert detection is not None
    assert detection.color == "red"
    assert detection.area > 50
    # Dead ahead: bearing near zero.
    assert abs(detection.bearing) < 3


def test_find_color_reports_left_and_right():
    # A box offset to the robot's left (+y) should read as a negative bearing.
    left = find_color(render(world_with_box(x=1.45, y=1.25), 64, 48), "red")
    right = find_color(render(world_with_box(x=1.45, y=0.75), 64, 48), "red")
    assert left is not None and right is not None
    assert left.bearing < -5
    assert right.bearing > 5


def test_find_color_returns_none_when_absent():
    assert find_color(render(World(), 32, 24), "red") is None
    # A green box is not a red one.
    green = render(world_with_box(color=(40, 200, 80)), 32, 24)
    assert find_color(green, "red") is None
    assert find_color(green, "green") is not None


def test_find_color_rejects_unknown_names():
    with pytest.raises(ValueError, match="unknown colour"):
        find_color(render(World(), 8, 8), "purple")


def test_closer_boxes_cover_more_of_the_frame():
    near = find_color(render(world_with_box(x=1.4), 64, 48), "red")
    far = find_color(render(world_with_box(x=1.9), 64, 48), "red")
    assert near is not None and far is not None
    assert near.coverage > far.coverage


@pytest.mark.skipif(not opencv_available(), reason="opencv not installed (AI pack)")
def test_opencv_agrees_with_the_dependency_free_finder():
    """Vision must not change its answer because a pack is installed."""
    for color_name, rgb in COLORS.items():
        frame = render(world_with_box(color=rgb), 64, 48)
        plain = find_color(frame, color_name)
        accelerated = find_color_opencv(frame, color_name)
        assert (plain is None) == (accelerated is None), color_name
        if plain is None:
            continue
        assert isinstance(accelerated, Detection)
        assert accelerated.area == plain.area, color_name
        assert math.isclose(accelerated.x, plain.x, abs_tol=1e-6), color_name
        assert math.isclose(accelerated.bearing, plain.bearing, abs_tol=1e-6), color_name


def test_robot_camera_helper():
    robot = Robot(world=world_with_box())
    frame = robot.camera(32, 24)
    assert frame.width == 32
    assert find_color(frame, "red") is not None


def test_bearing_matches_the_camera_field_of_view():
    # A detection at the extreme left column maps to half the field of view.
    frame = render(world_with_box(), 64, 48)
    detection = find_color(frame, "red")
    assert detection is not None
    limit = math.degrees(CAMERA_FOV / 2)
    assert -limit <= detection.bearing <= limit


# ---- Vision Lab: real object detection (see vision.py's own header on why
# this is deliberately decoupled from robot.camera()) --------------------- #


def test_object_detection_available_reports_true_when_installed():
    # onnxruntime + the bundled model are a hard dependency (requirements.txt),
    # not an optional pack like OpenCV -- this should always be true in a
    # correctly-installed environment (mirrors opencv_available()'s own
    # defensive shape without being conditionally skippable the same way).
    assert object_detection_available() is True


def test_list_sample_images_reports_bundled_jpg_and_png_files(tmp_path, monkeypatch):
    import okrobo.vision as vision_module

    monkeypatch.setattr(vision_module, "_SAMPLES_DIR", tmp_path)
    (tmp_path / "b.png").write_bytes(b"")
    (tmp_path / "a.jpg").write_bytes(b"")
    (tmp_path / "notes.txt").write_bytes(b"")

    assert list_sample_images() == ["a.jpg", "b.png"]


def test_list_sample_images_empty_when_no_samples_bundled(tmp_path, monkeypatch):
    import okrobo.vision as vision_module

    monkeypatch.setattr(vision_module, "_SAMPLES_DIR", tmp_path / "does-not-exist")
    assert list_sample_images() == []


def test_load_image_reads_a_real_file_into_the_same_frame_shape_camera_render_uses(tmp_path):
    path = tmp_path / "solid.png"
    Image.new("RGB", (40, 30), color=(200, 50, 25)).save(path)

    frame = load_image(str(path))

    assert frame.width == 40
    assert frame.height == 30
    assert len(frame.pixels) == 40 * 30 * 3
    assert frame.pixel(0, 0) == (200, 50, 25)


def test_load_image_resolves_a_bundled_sample_by_bare_name(tmp_path, monkeypatch):
    import okrobo.vision as vision_module

    monkeypatch.setattr(vision_module, "_SAMPLES_DIR", tmp_path)
    # PNG (lossless), not JPEG: JPEG's own quantization can shift a tiny
    # solid-colour test image by a unit or two, which would make this test
    # about resolving a bare sample name flaky about something else entirely.
    Image.new("RGB", (10, 10), color=(1, 2, 3)).save(tmp_path / "sample.png")

    frame = load_image("sample.png")
    assert frame.width == 10
    assert frame.pixel(0, 0) == (1, 2, 3)


def test_load_image_still_accepts_a_full_path_when_the_name_is_not_a_sample(tmp_path):
    path = tmp_path / "my-photo.jpg"
    Image.new("RGB", (5, 5), color=(9, 9, 9)).save(path)
    assert load_image(str(path)).width == 5


def test_decode_grid_predictions_transforms_the_first_cell_by_its_own_stride():
    # The FIRST entry of the concatenated grid list is always stride 8's own
    # (x=0, y=0) cell (np.meshgrid + reshape ordering) -- a raw (0.5, 0.5)
    # offset with a raw (0, 0) size (exp(0) == 1) should decode to
    # (0.5*8, 0.5*8, 1*8, 1*8), independent of every other cell's own value.
    total_cells = (416 // 8) ** 2 + (416 // 16) ** 2 + (416 // 32) ** 2
    outputs = np.zeros((1, total_cells, 85), dtype=np.float32)
    outputs[0, 0, 0:4] = [0.5, 0.5, 0.0, 0.0]

    decoded = _decode_grid_predictions(outputs, (416, 416))

    assert decoded[0, 0, 0] == pytest.approx(4.0)
    assert decoded[0, 0, 1] == pytest.approx(4.0)
    assert decoded[0, 0, 2] == pytest.approx(8.0)
    assert decoded[0, 0, 3] == pytest.approx(8.0)


def test_nms_keeps_the_highest_scoring_of_two_overlapping_boxes():
    boxes = np.array(
        [
            [0, 0, 10, 10],
            [1, 1, 11, 11],  # heavily overlaps the first
            [100, 100, 110, 110],  # unrelated, no overlap
        ],
        dtype=np.float32,
    )
    scores = np.array([0.9, 0.5, 0.8], dtype=np.float32)

    keep = _nms(boxes, scores, nms_thr=0.5)

    assert 0 in keep
    assert 1 not in keep
    assert 2 in keep


def test_multiclass_nms_drops_low_confidence_and_keeps_the_rest():
    boxes = np.array([[0, 0, 10, 10], [50, 50, 60, 60]], dtype=np.float32)
    scores = np.zeros((2, 3), dtype=np.float32)
    scores[0, 1] = 0.9  # class 1, well above score_thr
    scores[1, 2] = 0.05  # class 2, below score_thr

    dets = _multiclass_nms(boxes, scores, nms_thr=0.45, score_thr=0.1)

    assert dets is not None
    assert dets.shape[0] == 1
    assert dets[0, 4] == pytest.approx(0.9)
    assert dets[0, 5] == 1


def test_multiclass_nms_returns_none_when_nothing_scores_high_enough():
    boxes = np.array([[0, 0, 10, 10]], dtype=np.float32)
    scores = np.array([[0.01, 0.02]], dtype=np.float32)
    assert _multiclass_nms(boxes, scores, nms_thr=0.45, score_thr=0.1) is None


@pytest.mark.skipif(not object_detection_available(), reason="onnxruntime/model not installed")
def test_detect_objects_runs_end_to_end_without_crashing(tmp_path):
    """A flat-colour synthetic photo has nothing a COCO-trained model would
    recognise -- same reason detect_objects() isn't wired to robot.camera()
    at all (see vision.py's own header). This only proves the real
    onnxruntime session loads and runs end to end and returns well-shaped
    results, not that it detects anything real; semantic correctness against
    a real photo is eval_vision_lab.py's own job (not a gate test -- needs
    network access, and model accuracy on real-world input isn't
    deterministic gate-test material, see CLAUDE.md's own two test lanes)."""
    path = tmp_path / "flat.png"
    Image.new("RGB", (200, 150), color=(120, 120, 120)).save(path)
    frame = load_image(str(path))

    results = detect_objects(frame)

    assert isinstance(results, list)
    for obj in results:
        assert obj.label in COCO_CLASSES
        assert 0.0 <= obj.confidence <= 1.0
        assert 0 <= obj.x <= frame.width
        assert 0 <= obj.y <= frame.height
        assert obj.width > 0 and obj.height > 0
