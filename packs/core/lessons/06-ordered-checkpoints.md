---
title: Ordered checkpoints
robot: car
pack: core
---

Every competition so far had one zone to reach. **Object Delivery Race**
has two -- a pickup zone, then a delivery zone -- and the delivery zone is
*locked* until you've reached the pickup zone first. Driving straight
through it early does nothing; the scoreboard shows a 🔒 next to it until
its own prerequisite is done.

Click **Compete**, choose **Object Delivery Race**. The scoreboard lists
both zones -- notice the delivery zone starts locked. There's also a crate
sitting on the direct path between them, so a straight line won't clear it
either:

```okrobo-python
from okrobo import Robot

robot = Robot()
while robot.distance() > 0.3:
    robot.forward(0.05)
robot.turn_left(30)
while True:
    robot.forward(0.05)
    if robot.distance() < 0.3:
        robot.turn_right(60)
```

Watch the 🔒 disappear the moment you reach the pickup zone -- that's your
signal the delivery zone is now reachable. Your program doesn't need to
know or care about the order; it's the exact same `robot.forward()` loop
either way. The scoreboard (and the ground marker under your robot's own
camera, if you look down at the arena) handles the sequencing for you.

**Try it yourself:** once Object Delivery Race feels natural, choose
**Maze Challenge**. It's the same idea stretched further -- a wall blocks
the direct route entirely, so you'll need to turn twice, not just dodge
once, to reach Checkpoint 1 and then the exit zone in order.
