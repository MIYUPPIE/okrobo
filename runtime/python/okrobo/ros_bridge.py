"""ROS 2 bridge: put an OKROBO robot on the ROS graph.

    python3 -m okrobo.ros_bridge                 # simulator
    python3 -m okrobo.ros_bridge --port /dev/ttyUSB0   # a real robot

Publishes `/okrobo/odom` (nav_msgs/Odometry) and `/okrobo/scan`
(sensor_msgs/LaserScan), and subscribes to `/okrobo/cmd_vel`
(geometry_msgs/Twist), so a student who has outgrown the studio can drive the
same robot from `ros2 topic pub`, rviz, or their own node.

ROS 2 is an optional pack: this module imports rclpy lazily and the rest of
OKROBO never depends on it, keeping the offline promise intact on machines
that have never heard of ROS.
"""

from __future__ import annotations

import argparse
import math

TOPIC_ODOM = "/okrobo/odom"
TOPIC_SCAN = "/okrobo/scan"
TOPIC_CMD_VEL = "/okrobo/cmd_vel"

SCAN_RAYS = 9
SCAN_FOV = math.pi  # 180 degrees, matching Robot.lidar defaults
DEFAULT_RATE_HZ = 20.0


def ros_available() -> bool:
    """True when a ROS 2 distribution with rclpy is importable."""
    try:
        import rclpy  # noqa: F401

        return True
    except Exception:
        return False


def twist_to_wheels(linear: float, angular: float, wheel_base: float) -> tuple:
    """Convert a Twist into differential-drive wheel speeds (m/s).

    Pure arithmetic and the inverse of the engine's unicycle model, so it is
    tested without ROS installed.
    """
    half = angular * wheel_base / 2.0
    return (linear - half, linear + half)


def quaternion_from_yaw(theta: float) -> tuple:
    """(x, y, z, w) for a rotation about z, which is all a ground robot needs."""
    return (0.0, 0.0, math.sin(theta / 2.0), math.cos(theta / 2.0))


class OkroboNode:
    """Bridges an OKROBO world onto ROS 2 topics.

    Takes any object with the simulated World's interface, so the same node
    serves the simulator or a physical robot over serial.
    """

    def __init__(self, world, wheel_base: float = 0.12, rate_hz: float = DEFAULT_RATE_HZ):
        import rclpy
        from geometry_msgs.msg import Twist
        from nav_msgs.msg import Odometry
        from rclpy.node import Node
        from sensor_msgs.msg import LaserScan

        self._rclpy = rclpy
        self._Odometry = Odometry
        self._LaserScan = LaserScan
        self.world = world
        self.wheel_base = wheel_base
        self.dt = 1.0 / rate_hz

        self.node = Node("okrobo")
        self.odom_publisher = self.node.create_publisher(Odometry, TOPIC_ODOM, 10)
        self.scan_publisher = self.node.create_publisher(LaserScan, TOPIC_SCAN, 10)
        self.node.create_subscription(Twist, TOPIC_CMD_VEL, self._on_cmd_vel, 10)
        self.timer = self.node.create_timer(self.dt, self.tick)

    def _on_cmd_vel(self, message) -> None:
        left, right = twist_to_wheels(
            float(message.linear.x), float(message.angular.z), self.wheel_base
        )
        self.world.drive(left, right)

    def odometry_message(self):
        state = self.world.state()
        message = self._Odometry()
        message.header.stamp = self.node.get_clock().now().to_msg()
        message.header.frame_id = "odom"
        message.child_frame_id = "base_link"
        message.pose.pose.position.x = float(state.pose.x)
        message.pose.pose.position.y = float(state.pose.y)
        x, y, z, w = quaternion_from_yaw(float(state.pose.theta))
        message.pose.pose.orientation.x = x
        message.pose.pose.orientation.y = y
        message.pose.pose.orientation.z = z
        message.pose.pose.orientation.w = w
        return message

    def scan_message(self):
        message = self._LaserScan()
        message.header.stamp = self.node.get_clock().now().to_msg()
        message.header.frame_id = "base_link"
        message.angle_min = -SCAN_FOV / 2.0
        message.angle_max = SCAN_FOV / 2.0
        message.angle_increment = SCAN_FOV / (SCAN_RAYS - 1)
        message.range_min = 0.0
        message.range_max = 4.0
        # ROS scans run counter-clockwise from angle_min (right to left).
        message.ranges = [
            float(self.world.ray(message.angle_min + i * message.angle_increment))
            for i in range(SCAN_RAYS)
        ]
        return message

    def tick(self) -> None:
        self.world.step(self.dt)
        self.odom_publisher.publish(self.odometry_message())
        self.scan_publisher.publish(self.scan_message())

    def destroy(self) -> None:
        self.node.destroy_node()


def main() -> None:
    parser = argparse.ArgumentParser(description="OKROBO ROS 2 bridge")
    parser.add_argument("--port", help="serial port of a physical robot; omit for the simulator")
    parser.add_argument("--world", help="world JSON file for the simulator")
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE_HZ)
    args = parser.parse_args()

    if not ros_available():
        raise SystemExit(
            "ROS 2 not found. Install the ROS 2 pack, or source your distribution "
            "(for example: source /opt/ros/jazzy/setup.bash)"
        )

    import rclpy

    if args.port:
        from .serial_link import SerialRobot

        world = SerialRobot(args.port)
        wheel_base = 0.12
    else:
        import json

        from ._sim import World, WorldConfig

        config = WorldConfig()
        if args.world:
            with open(args.world) as f:
                config = WorldConfig.from_dict(json.load(f))
        world = World(config)
        wheel_base = config.wheel_base

    rclpy.init()
    bridge = OkroboNode(world, wheel_base=wheel_base, rate_hz=args.rate)
    print(f"okrobo ROS 2 bridge: publishing {TOPIC_ODOM} and {TOPIC_SCAN}", flush=True)
    print(f"  drive it with: ros2 topic pub {TOPIC_CMD_VEL} geometry_msgs/msg/Twist ...", flush=True)
    try:
        rclpy.spin(bridge.node)
    except KeyboardInterrupt:
        pass
    finally:
        bridge.destroy()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
