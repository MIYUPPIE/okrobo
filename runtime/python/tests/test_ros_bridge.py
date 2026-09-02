"""Gate tests for the ROS 2 bridge.

The pure conversions run everywhere. The node tests need rclpy and are skipped
on machines without ROS 2 — which is the point: ROS is an optional pack and
nothing else in OKROBO may depend on it.
"""

import math

import pytest

from okrobo import World
from okrobo.ros_bridge import (
    SCAN_RAYS,
    TOPIC_CMD_VEL,
    TOPIC_ODOM,
    TOPIC_SCAN,
    quaternion_from_yaw,
    ros_available,
    twist_to_wheels,
)


def test_twist_to_wheels_straight_line():
    left, right = twist_to_wheels(0.2, 0.0, 0.12)
    assert math.isclose(left, 0.2)
    assert math.isclose(right, 0.2)


def test_twist_to_wheels_spin_in_place():
    # Pure rotation: wheels equal and opposite.
    left, right = twist_to_wheels(0.0, 1.0, 0.12)
    assert math.isclose(left, -0.06)
    assert math.isclose(right, 0.06)


def test_twist_to_wheels_inverts_the_engine_model():
    """Feeding the wheels back through the engine must reproduce the Twist."""
    linear, angular, wheel_base = 0.15, 0.8, 0.12
    left, right = twist_to_wheels(linear, angular, wheel_base)
    # The engine's forward model (see engine/src/world.cpp).
    assert math.isclose((left + right) / 2.0, linear, abs_tol=1e-12)
    assert math.isclose((right - left) / wheel_base, angular, abs_tol=1e-12)


def test_quaternion_from_yaw():
    x, y, z, w = quaternion_from_yaw(0.0)
    assert (x, y, z) == (0.0, 0.0, 0.0) and math.isclose(w, 1.0)
    _, _, z, w = quaternion_from_yaw(math.pi / 2)
    assert math.isclose(z, math.sin(math.pi / 4))
    assert math.isclose(w, math.cos(math.pi / 4))


def test_topic_names_are_namespaced():
    # Everything under /okrobo so the bridge never collides with a student's
    # own nodes or another robot on the same network.
    for topic in (TOPIC_ODOM, TOPIC_SCAN, TOPIC_CMD_VEL):
        assert topic.startswith("/okrobo/")


rclpy_missing = not ros_available()

# LaserScan.ranges and the angle fields are float32 in ROS, so values that are
# exact doubles inside the engine arrive here rounded (0.4 -> 0.40000000596).
FLOAT32_TOL = 1e-6


@pytest.mark.skipif(rclpy_missing, reason="ROS 2 not installed (optional pack)")
def test_node_publishes_odometry_and_scan():
    import rclpy

    from okrobo.ros_bridge import OkroboNode

    rclpy.init()
    try:
        bridge = OkroboNode(World())

        odom = bridge.odometry_message()
        assert odom.header.frame_id == "odom"
        assert math.isclose(odom.pose.pose.position.x, 1.0)
        assert math.isclose(odom.pose.pose.orientation.w, 1.0)

        scan = bridge.scan_message()
        assert len(scan.ranges) == SCAN_RAYS
        assert math.isclose(scan.angle_min, -math.pi / 2, abs_tol=FLOAT32_TOL)
        # From the arena centre every ray hits a wall within the arena.
        assert all(0.0 < r < 4.0 for r in scan.ranges)
        # The centre ray is the plain distance sensor.
        assert math.isclose(scan.ranges[SCAN_RAYS // 2], 0.9, abs_tol=FLOAT32_TOL)

        bridge.destroy()
    finally:
        rclpy.shutdown()


@pytest.mark.skipif(rclpy_missing, reason="ROS 2 not installed (optional pack)")
def test_cmd_vel_drives_the_robot():
    import rclpy
    from geometry_msgs.msg import Twist

    from okrobo.ros_bridge import OkroboNode

    rclpy.init()
    try:
        world = World()
        bridge = OkroboNode(world)

        message = Twist()
        message.linear.x = 0.2
        bridge._on_cmd_vel(message)
        for _ in range(20):
            bridge.tick()

        # One second of driving at 0.2 m/s from x = 1.0.
        assert world.state().pose.x > 1.15
        assert math.isclose(world.state().pose.y, 1.0, abs_tol=1e-9)

        bridge.destroy()
    finally:
        rclpy.shutdown()


@pytest.mark.skipif(rclpy_missing, reason="ROS 2 not installed (optional pack)")
def test_obstacles_appear_in_the_scan():
    import rclpy

    from okrobo import Obstacle, WorldConfig
    from okrobo.ros_bridge import OkroboNode

    rclpy.init()
    try:
        config = WorldConfig(obstacles=[Obstacle(x=1.6, y=1.0, width=0.2, height=0.2)])
        bridge = OkroboNode(World(config))
        ranges = bridge.scan_message().ranges
        # The box ahead is nearer than the wall it hides.
        assert math.isclose(ranges[SCAN_RAYS // 2], 0.4, abs_tol=FLOAT32_TOL)
        bridge.destroy()
    finally:
        rclpy.shutdown()
