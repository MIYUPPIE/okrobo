"""Gate tests for the reference model. Mirrors engine/tests/test_world.cpp."""

import math

from okrobo import Obstacle, Pose, World, WorldConfig

TOL = 1e-9


def run(world: World, seconds: float, dt: float = 0.01) -> None:
    for _ in range(round(seconds / dt)):
        world.step(dt)


def test_initial_state():
    s = World().state()
    assert s.tick == 0
    assert math.isclose(s.pose.x, 1.0, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)
    assert math.isclose(s.pose.theta, 0.0, abs_tol=TOL)
    assert math.isclose(s.distance, 0.9, abs_tol=TOL)
    assert not s.collided


def test_straight_drive():
    world = World()
    world.drive(0.2, 0.2)
    run(world, 1.0)
    s = world.state()
    assert s.tick == 100
    assert math.isclose(s.pose.x, 1.2, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)
    assert math.isclose(s.distance, 0.7, abs_tol=TOL)


def test_turn_in_place():
    world = World()
    world.drive(-0.06, 0.06)  # w = 1 rad/s
    run(world, math.pi / 2, dt=math.pi / 200)
    s = world.state()
    assert math.isclose(s.pose.x, 1.0, abs_tol=1e-6)
    assert math.isclose(s.pose.y, 1.0, abs_tol=1e-6)
    assert math.isclose(s.pose.theta, math.pi / 2, abs_tol=1e-6)
    assert math.isclose(s.distance, 0.9, abs_tol=1e-6)


def test_wall_stop():
    world = World()
    world.drive(0.5, 0.5)
    run(world, 10.0)
    s = world.state()
    assert math.isclose(s.pose.x, 1.9, abs_tol=TOL)
    assert s.collided
    assert math.isclose(s.distance, 0.0, abs_tol=TOL)


def test_reset():
    world = World()
    world.drive(0.5, 0.5)
    run(world, 10.0)
    world.reset()
    s = world.state()
    assert s.tick == 0
    assert math.isclose(s.pose.x, 1.0, abs_tol=TOL)
    assert not s.collided


def test_obstacle_stop():
    config = WorldConfig(start=Pose(1.0, 1.0, 0.0))
    world = World(config)
    # Box centred at (1.6, 1.0), half-width 0.1 -> near edge at x=1.5.
    world.config.obstacles.append(Obstacle(x=1.6, y=1.0, width=0.2, height=0.2))
    world.drive(0.5, 0.5)
    run(world, 10.0)
    s = world.state()
    # Pushed out to exactly robot_radius (0.1) from the box's nearest edge.
    assert math.isclose(s.pose.x, 1.4, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)
    assert s.collided


def test_obstacle_missed_when_driving_past():
    config = WorldConfig(start=Pose(1.0, 1.0, 0.0))
    world = World(config)
    # Box well clear of a straight drive along y=1.0.
    world.config.obstacles.append(Obstacle(x=1.6, y=1.6, width=0.2, height=0.2))
    world.drive(0.2, 0.2)
    run(world, 1.0)
    s = world.state()
    assert math.isclose(s.pose.x, 1.2, abs_tol=TOL)
    assert math.isclose(s.pose.y, 1.0, abs_tol=TOL)
    assert not s.collided


def test_obstacle_corner_approach():
    # Approaching a box diagonally must resolve toward the nearest CORNER (a
    # true circle-vs-AABB push-out), not toward whichever edge a naive
    # axis-independent clamp would pick.
    config = WorldConfig(arena_width=4.0, arena_height=4.0, start=Pose(1.0, 1.0, math.pi / 4.0))
    world = World(config)
    world.config.obstacles.append(Obstacle(x=2.0, y=2.0, width=0.4, height=0.4))  # corner at (1.8, 1.8)
    world.drive(0.5, 0.5)
    run(world, 10.0)
    s = world.state()
    assert s.collided
    dx = s.pose.x - 1.8
    dy = s.pose.y - 1.8
    # Exactly robot_radius (0.1) from the corner, along the diagonal.
    assert math.isclose(math.hypot(dx, dy), 0.1, abs_tol=1e-6)
    assert math.isclose(dx, dy, abs_tol=1e-6)  # symmetric approach -> symmetric push-out


def test_world_config_from_dict():
    import json
    from pathlib import Path

    from okrobo import WorldConfig

    arena_path = Path(__file__).resolve().parents[3] / "packs" / "core" / "worlds" / "arena.json"
    config = WorldConfig.from_dict(json.loads(arena_path.read_text()))
    assert config.arena_width == 2.0
    assert config.wheel_base == 0.12
    assert config.start.x == 1.0

    # The shipped arena carries coloured boxes for the camera lessons.
    assert len(config.obstacles) == 2
    red = config.obstacles[0]
    assert red.color == (220, 40, 40)

    # The red box sits at x = 1.7, so its near face is 0.6 m from the robot
    # centre and 0.5 m from its front edge — nearer than the 0.9 m wall.
    state = World(config).state()
    assert math.isclose(state.distance, 0.5, abs_tol=1e-9)


def test_empty_world_still_sees_the_wall():
    # Without obstacles the sensor reaches the arena wall, as in v0.
    assert math.isclose(World().state().distance, 0.9, abs_tol=TOL)


def test_arc_returns_to_start():
    world = World()
    world.drive(0.05, 0.15)  # v = 0.1, w = 0.1/0.12
    w = 0.1 / 0.12
    period = 2 * math.pi / w
    run(world, period, dt=period / 1000)
    s = world.state()
    assert math.isclose(s.pose.x, 1.0, abs_tol=1e-6)
    assert math.isclose(s.pose.y, 1.0, abs_tol=1e-6)
    assert math.isclose(s.pose.theta, 0.0, abs_tol=1e-6)
