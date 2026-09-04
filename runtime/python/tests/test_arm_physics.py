"""Gate tests for Arm.grip()/release(): the graspable object, real MuJoCo
contact/gravity once released, kinematic follow while held.
Mirrors engine/tests/test_arm_physics.cpp exactly, including the joint
targets (found numerically, not hand-derived -- see build.md)."""

import math

import pytest

pytest.importorskip("mujoco")

from okrobo import ArmWorld  # noqa: E402


def run(world: ArmWorld, seconds: float, dt: float = 0.01) -> None:
    for _ in range(round(seconds / dt)):
        world.step(dt)


def reach_for_object(world: ArmWorld) -> None:
    """A pose whose tip sits ~0.030 m from the object's default start
    (0.30, 0, 0.03) -- comfortably inside ARM_GRASP_TOLERANCE (0.05 m)."""
    world.set_target(1, math.radians(50.0))
    world.set_target(2, math.radians(-104.0))
    world.set_target(3, math.radians(-2.0))
    run(world, 3.0)
    assert not world.state().moving


def test_object_starts_put_and_unheld():
    s = ArmWorld().state()
    assert not s.holding
    assert math.isclose(s.object[0], 0.30, abs_tol=1e-9)
    assert math.isclose(s.object[1], 0.0, abs_tol=1e-9)
    assert math.isclose(s.object[2], 0.03, abs_tol=1e-9)


def test_grip_fails_when_the_tip_is_far_away():
    world = ArmWorld()  # default start pose: tip is ~0.376 m from the object
    assert world.grip() is False
    assert not world.state().holding


def test_grip_succeeds_within_tolerance_and_object_tracks_the_tip():
    world = ArmWorld()
    reach_for_object(world)
    assert world.grip() is True
    s = world.state()
    assert s.holding
    assert math.isclose(s.object[0], s.tip[0], abs_tol=1e-9)
    assert math.isclose(s.object[2], s.tip[2], abs_tol=1e-9)

    world.set_target(0, math.pi / 4)  # swing the base while holding
    run(world, 1.0)
    s = world.state()
    assert s.holding
    assert math.isclose(s.object[0], s.tip[0], abs_tol=1e-9)
    assert math.isclose(s.object[1], s.tip[1], abs_tol=1e-9)
    assert math.isclose(s.object[2], s.tip[2], abs_tol=1e-9)
    assert abs(s.object[1]) > 0.05  # it actually moved with the swing


def test_release_drops_the_object_and_it_settles_under_real_gravity():
    world = ArmWorld()
    reach_for_object(world)
    assert world.grip() is True
    held_z = world.state().object[2]  # ~0.060

    world.release()
    assert not world.state().holding

    run(world, 1.0)
    mid = world.state()
    run(world, 0.5)
    final = world.state()

    assert final.object[2] < held_z - 0.01  # it actually fell
    assert math.isclose(final.object[2], 0.03, abs_tol=5e-3)  # rests at the half-extent
    assert math.isclose(mid.object[2], final.object[2], abs_tol=2e-3)  # settled, not still falling
    assert math.isclose(mid.object[0], final.object[0], abs_tol=2e-3)
    assert math.isclose(mid.object[1], final.object[1], abs_tol=2e-3)
    assert math.isclose(final.object[0], 0.30, abs_tol=5e-3)  # no lateral drift
    assert math.isclose(final.object[1], 0.0, abs_tol=5e-3)


def test_release_without_holding_is_a_harmless_no_op():
    world = ArmWorld()
    world.release()
    s = world.state()
    assert not s.holding
    assert math.isclose(s.object[2], 0.03, abs_tol=1e-9)


def test_reset_returns_the_object_and_releases_the_hold():
    world = ArmWorld()
    reach_for_object(world)
    assert world.grip() is True
    world.release()
    run(world, 1.0)

    world.reset()
    s = world.state()
    assert not s.holding
    assert math.isclose(s.object[0], 0.30, abs_tol=1e-9)
    assert math.isclose(s.object[1], 0.0, abs_tol=1e-9)
    assert math.isclose(s.object[2], 0.03, abs_tol=1e-9)
    assert s.tick == 0


def test_student_arm_api_grip_release():
    from okrobo import Arm

    arm = Arm()
    assert arm.holding() is False
    arm.world.set_target(1, math.radians(50.0))
    arm.world.set_target(2, math.radians(-104.0))
    arm.world.set_target(3, math.radians(-2.0))
    arm.wait(3.0)

    assert arm.grip() is True
    assert arm.holding() is True
    x, y, z = arm.object_position()
    tx, ty, tz = arm.tip()
    assert math.isclose(x, tx, abs_tol=1e-9)
    assert math.isclose(y, ty, abs_tol=1e-9)
    assert math.isclose(z, tz, abs_tol=1e-9)

    arm.release()
    assert arm.holding() is False
    arm.wait(1.5)
    _, _, final_z = arm.object_position()
    assert math.isclose(final_z, 0.03, abs_tol=5e-3)
