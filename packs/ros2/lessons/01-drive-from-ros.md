---
title: Drive the robot from ROS 2
robot: car
pack: ros2
---

ROS 2 is what most real robots run. This pack puts your OKROBO robot on the
ROS graph, so the tools professional roboticists use work on it too.

Start the bridge in a terminal, with your ROS 2 distribution sourced:

```okrobo-python
print("run this in a terminal, not in the studio:")
print("  source /opt/ros/jazzy/setup.bash")
print("  python3 -m okrobo.ros_bridge")
```

The bridge publishes two topics and listens on a third:

- `/okrobo/odom` — where the robot thinks it is
- `/okrobo/scan` — nine distance readings, like a small laser scanner
- `/okrobo/cmd_vel` — how you tell it to move

In another terminal, watch the robot's position change:

```okrobo-python
print("  ros2 topic echo /okrobo/odom")
```

Then drive it. `linear.x` is speed forwards in metres per second, and
`angular.z` is turning speed in radians per second:

```okrobo-python
print("  ros2 topic pub /okrobo/cmd_vel geometry_msgs/msg/Twist \\")
print("    '{linear: {x: 0.2}, angular: {z: 0.0}}'")
```

The robot drives forward, exactly as it would from `robot.forward()`. The
difference is that anything speaking ROS 2 can now drive it: your own node,
a joystick package, or a navigation stack.

The scan works the same way as `robot.lidar()`, so what you learned in the
studio transfers directly:

```okrobo-python
print("  ros2 topic echo /okrobo/scan")
```

**Try it yourself:** write a small ROS 2 node that subscribes to
`/okrobo/scan` and publishes to `/okrobo/cmd_vel` to stop before a wall. It is
the same wall-avoider you built in lesson one, written the way a professional
robot would run it.
