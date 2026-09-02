---
title: Drive to the wall
robot: car
pack: core
---

Your robot sits in the middle of a 2 metre arena. It has one distance sensor
pointing straight ahead, and two wheels it can drive.

Start by driving forward a little. Press Run and watch the robot move.

```okrobo-python
from okrobo import Robot

robot = Robot()
robot.forward(0.3)
print("distance to the wall:", round(robot.distance(), 2), "m")
```

The robot moved 0.3 m and the sensor now reads less than before. Distances are
always in metres, measured from the front of the robot.

Driving a fixed distance is fine until something is in the way. Instead, drive
in small steps and keep checking the sensor, so the robot stops itself.

```okrobo-python
while robot.distance() > 0.2:
    robot.forward(0.05)

print("stopped at", round(robot.distance(), 2), "m from the wall")
```

Now make it turn instead of stopping. `turn_left` takes degrees, so 90 is a
quarter turn.

```okrobo-python
while True:
    robot.forward(0.05)
    if robot.distance() < 0.2:
        robot.turn_left(90)
```

That loop never ends: the robot drives around the arena forever, turning at
every wall. Press Stop when you have seen enough.

**Try it yourself:** turn right instead of left, or turn 60 degrees and watch
the path change shape.
