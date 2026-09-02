"""Gate tests for the student Robot API."""

import math

from okrobo import Robot


def test_forward_moves_exact_distance():
    robot = Robot()
    robot.forward(0.1)
    x, y = robot.position()
    assert math.isclose(x, 1.1, abs_tol=1e-9)
    assert math.isclose(y, 1.0, abs_tol=1e-9)


def test_backward():
    robot = Robot()
    robot.backward(0.3)
    x, _ = robot.position()
    assert math.isclose(x, 0.7, abs_tol=1e-9)


def test_turn_left_is_exact():
    robot = Robot()
    robot.turn_left(90)
    assert math.isclose(robot.heading(), 90.0, abs_tol=1e-6)
    x, y = robot.position()
    assert math.isclose(x, 1.0, abs_tol=1e-9)
    assert math.isclose(y, 1.0, abs_tol=1e-9)


def test_turn_right_arbitrary_angle():
    robot = Robot()
    robot.turn_right(30)
    assert math.isclose(robot.heading(), -30.0, abs_tol=1e-6)


def test_distance_shrinks_when_approaching_wall():
    robot = Robot()
    before = robot.distance()
    robot.forward(0.5)
    assert robot.distance() < before
    assert math.isclose(robot.distance(), before - 0.5, abs_tol=1e-9)


def test_forward_stops_at_wall():
    robot = Robot()
    robot.forward(5.0)  # arena is only 2 m wide
    x, _ = robot.position()
    assert x <= 1.9 + 1e-9
    assert robot.distance() < 0.01


def test_lidar_fan():
    robot = Robot()
    distances = robot.lidar(rays=5, fov=180)
    assert len(distances) == 5
    # Center ray equals the plain distance sensor.
    assert math.isclose(distances[2], robot.distance(), abs_tol=1e-12)
    # At the arena center all cardinal rays hit walls 0.9 m away.
    assert math.isclose(distances[0], 0.9, abs_tol=1e-9)  # +90deg (left)
    assert math.isclose(distances[4], 0.9, abs_tol=1e-9)  # -90deg (right)
    # Diagonals are longer than cardinals from the center.
    assert distances[1] > distances[2]


def test_wait_passes_time_without_moving():
    robot = Robot()
    before = robot.world.state()
    robot.wait(0.5)
    after = robot.world.state()
    assert after.tick > before.tick
    assert math.isclose(after.pose.x, before.pose.x, abs_tol=1e-12)
    assert math.isclose(after.pose.y, before.pose.y, abs_tol=1e-12)


def test_vision_doc_snippet_pattern():
    # The wall avoider from docs/vision.md terminates and ends up turned.
    robot = Robot()
    while robot.distance() > 0.2:
        robot.forward(0.05)
    robot.turn_left()
    assert robot.distance() > 0.2
    assert math.isclose(robot.heading(), 90.0, abs_tol=1e-6)
