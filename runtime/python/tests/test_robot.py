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


def test_vision_doc_snippet_pattern():
    # The wall avoider from docs/vision.md terminates and ends up turned.
    robot = Robot()
    while robot.distance() > 0.2:
        robot.forward(0.05)
    robot.turn_left()
    assert robot.distance() > 0.2
    assert math.isclose(robot.heading(), 90.0, abs_tol=1e-6)
