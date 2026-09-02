"""Gate tests for the arm reference model and the student Arm API.
Mirrors engine/tests/test_arm.cpp."""

import math

import pytest

from okrobo import Arm, ArmWorld

TOL = 1e-9


def run(world: ArmWorld, seconds: float, dt: float = 0.01) -> None:
    for _ in range(round(seconds / dt)):
        world.step(dt)


def test_initial_state_and_fk():
    s = ArmWorld().state()
    assert s.tick == 0
    assert not s.moving
    r = 0.22 * math.cos(math.pi / 3) + 0.18 * math.cos(math.pi / 6) + 0.10
    z = 0.12 + 0.22 * math.sin(math.pi / 3) + 0.18 * math.sin(math.pi / 6)
    assert math.isclose(s.tip[0], r, abs_tol=TOL)
    assert math.isclose(s.tip[1], 0.0, abs_tol=TOL)
    assert math.isclose(s.tip[2], z, abs_tol=TOL)


def test_moves_to_target_exactly():
    world = ArmWorld()
    world.set_target(0, math.pi / 2)
    run(world, 0.5)
    assert world.state().moving
    assert math.isclose(world.state().angles[0], math.pi / 4, abs_tol=TOL)
    run(world, 0.6)
    s = world.state()
    assert not s.moving
    assert math.isclose(s.angles[0], math.pi / 2, abs_tol=TOL)


def test_targets_clamped_to_limits():
    world = ArmWorld()
    world.set_target(1, 10.0)
    run(world, 5.0)
    s = world.state()
    assert math.isclose(s.angles[1], 1.7453292519943295, abs_tol=TOL)
    assert not s.moving


def test_stop_freezes_motion():
    world = ArmWorld()
    world.set_target(2, 1.5)
    run(world, 0.2)
    world.stop()
    held = world.state().angles[2]
    run(world, 1.0)
    assert math.isclose(world.state().angles[2], held, abs_tol=TOL)


def test_state_message_shape():
    msg = ArmWorld().state().to_message()
    assert set(msg) == {"tick", "joints", "moving", "tip"}
    assert len(msg["joints"]["angles"]) == 4
    assert set(msg["tip"]) == {"x", "y", "z"}


def test_arm_api_move_blocking_and_degrees():
    arm = Arm()
    arm.move("base", 90)
    assert math.isclose(arm.angles()[0], 90.0, abs_tol=1e-6)
    x, y, _ = arm.tip()
    assert math.isclose(x, 0.0, abs_tol=1e-6)
    assert y > 0.3


def test_arm_api_move_all_and_names():
    arm = Arm()
    arm.move_all([0, 90, 0, 0])  # arm straight up
    _, _, z = arm.tip()
    assert math.isclose(z, 0.12 + 0.22 + 0.18 + 0.10, abs_tol=1e-6)
    with pytest.raises(ValueError):
        arm.move("knee", 10)


def test_arm_stop_interrupts():
    arm = Arm()
    arm.world.set_target(0, math.pi)
    run(arm.world, 0.3)
    arm.stop()
    held = arm.angles()[0]
    arm.wait(1.0)
    assert math.isclose(arm.angles()[0], held, abs_tol=1e-9)
