"""Gate tests for the camera and vision.

The important guarantee: vision gives the same answer with or without the AI
pack installed, so a lesson's expected result never depends on which packs a
machine has.
"""

import math

import pytest

from okrobo import Obstacle, Robot, World, WorldConfig
from okrobo.camera import CAMERA_FOV, render
from okrobo.vision import COLORS, Detection, find_color, find_color_opencv, opencv_available


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
