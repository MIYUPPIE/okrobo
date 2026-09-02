"""Gate tests for the drone reference model and the student Drone API.
Mirrors engine/tests/test_drone.cpp."""

import math

import pytest

from okrobo import Drone, DroneWorld

TOL = 1e-9


def run(world: DroneWorld, seconds: float, dt: float = 0.01) -> None:
    for _ in range(round(seconds / dt)):
        world.step(dt)


def test_initial_state():
    s = DroneWorld().state()
    assert s.tick == 0
    assert not s.collided
    assert (s.pose.x, s.pose.y, s.pose.z, s.pose.theta) == (1.0, 1.0, 0.0, 0.0)


def test_vertical_drive_changes_only_altitude():
    world = DroneWorld()
    world.drive(0.0, 0.2, 0.0)
    run(world, 1.0)
    s = world.state()
    assert math.isclose(s.pose.z, 0.2, abs_tol=TOL)
    assert math.isclose(s.pose.x, 1.0, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)


def test_forward_drive_moves_along_heading():
    world = DroneWorld()
    world.drive(0.2, 0.0, 0.0)
    run(world, 1.0)
    s = world.state()
    assert math.isclose(s.pose.x, 1.2, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)


def test_yaw_rate_turns_in_place():
    world = DroneWorld()
    world.drive(0.0, 0.0, math.pi / 2)
    run(world, 1.0)
    assert math.isclose(world.state().pose.theta, math.pi / 2, abs_tol=1e-6)
    assert math.isclose(world.state().pose.x, 1.0, abs_tol=TOL)


def test_clamps_to_arena_walls_and_reports_collision():
    world = DroneWorld()
    world.drive(5.0, 0.0, 0.0)  # fast, straight into the +x wall
    run(world, 2.0)
    s = world.state()
    assert math.isclose(s.pose.x, 2.0 - 0.1, abs_tol=1e-6)  # arena_width - robot_radius
    assert s.collided


def test_clamps_altitude_floor_and_ceiling():
    world = DroneWorld()
    world.drive(0.0, -5.0, 0.0)  # descending below ground
    run(world, 1.0)
    assert math.isclose(world.state().pose.z, 0.0, abs_tol=1e-9)
    assert world.state().collided

    world.reset()
    world.drive(0.0, 5.0, 0.0)  # climbing past the ceiling
    run(world, 1.0)
    assert math.isclose(world.state().pose.z, 1.0, abs_tol=1e-6)  # default max_altitude
    assert world.state().collided


def test_stop_zeroes_all_rates():
    world = DroneWorld()
    world.drive(0.2, 0.1, 0.5)
    world.stop()
    run(world, 0.5)
    s = world.state()
    assert (s.pose.x, s.pose.y, s.pose.z, s.pose.theta) == (1.0, 1.0, 0.0, 0.0)


def test_reset_restores_start():
    world = DroneWorld()
    world.drive(0.2, 0.1, 0.3)
    run(world, 1.0)
    world.reset()
    s = world.state()
    assert (s.pose.x, s.pose.y, s.pose.z, s.pose.theta) == (1.0, 1.0, 0.0, 0.0)
    assert s.tick == 0
    assert not s.collided


def test_distance_sensor_is_wall_only():
    world = DroneWorld()
    # Facing +x from (1.0, 1.0) in a 2x2 arena: wall at x=2.0, robot_radius=0.1.
    assert math.isclose(world.ray(0.0), 0.9, abs_tol=TOL)


def test_state_message_shape():
    msg = DroneWorld().state().to_message()
    assert set(msg) == {"tick", "pose", "sensors", "collided"}
    assert set(msg["pose"]) == {"x", "y", "z", "theta"}
    assert set(msg["sensors"]) == {"distance"}


# ---- student Drone API ----


def test_drone_api_takeoff_and_altitude():
    drone = Drone()
    assert drone.altitude() == 0.0
    drone.takeoff()
    assert math.isclose(drone.altitude(), Drone.HOVER_HEIGHT, abs_tol=1e-6)


def test_drone_api_land_returns_to_ground():
    drone = Drone()
    drone.takeoff(0.5)
    drone.land()
    assert math.isclose(drone.altitude(), 0.0, abs_tol=1e-6)


def test_drone_api_forward_and_turn_blocking_and_units():
    drone = Drone()
    drone.forward(0.2)
    x, y, _ = drone.position()
    assert math.isclose(x, 1.2, abs_tol=1e-6)
    assert math.isclose(y, 1.0, abs_tol=1e-6)

    drone.turn_right(90)
    assert math.isclose(drone.heading(), -90.0, abs_tol=1e-4)


def test_drone_api_forward_stops_early_at_wall():
    drone = Drone()
    drone.forward(5.0)  # arena is 2m wide, far more than it can travel
    x, _, _ = drone.position()
    assert math.isclose(x, 2.0 - 0.1, abs_tol=1e-6)
    assert math.isclose(drone.distance(), 0.0, abs_tol=1e-6)


def test_drone_api_up_down_stop_early_at_limits():
    drone = Drone()
    drone.up(5.0)
    assert math.isclose(drone.altitude(), 1.0, abs_tol=1e-6)  # ceiling
    drone.down(5.0)
    assert math.isclose(drone.altitude(), 0.0, abs_tol=1e-6)  # ground


def test_drone_api_wait_passes_time_without_moving():
    drone = Drone()
    drone.takeoff()
    before = drone.position()
    drone.wait(0.5)
    assert drone.position() == before


@pytest.mark.parametrize("meters", [0.0, -1.0])
def test_drone_api_non_positive_up_down_are_no_ops(meters):
    drone = Drone()
    drone.up(meters)
    assert drone.altitude() == 0.0
