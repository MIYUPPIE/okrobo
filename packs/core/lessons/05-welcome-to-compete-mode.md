---
title: Welcome to Compete mode
robot: car
pack: core
---

Everything so far has been about learning the robot's own API one piece at a
time. Compete mode is different: it's a challenge someone else designed --
an arena, a goal, and a scoreboard -- and you bring the program.

Click **Compete** in the top bar. A picker opens with every competition
available. Pick **Sprint to the Zone** first: an open arena with nothing in
the way, just a zone to reach before time runs out.

Your program doesn't change at all. It's still the same `robot.forward()` /
`robot.turn_left()` / `robot.distance()` you already know -- Compete mode
only swaps in a different arena underneath, and a live scoreboard watches
your robot's position from outside your program.

```okrobo-python
from okrobo import Robot

robot = Robot()
while True:
    robot.forward(0.05)
```

Press Run. Watch the scoreboard in the corner of the viewport: it shows your
score, the time remaining, and whether you've reached the zone yet. Press
Stop (or wait for the clock to run out) and a report appears with the full
breakdown.

Once Sprint to the Zone feels easy, choose a different competition from the
sidebar without leaving Compete mode. **Obstacle Slalom** puts three posts
across the direct path -- driving straight will clip one of them. Use the
distance sensor to steer around each post instead of relying on a straight
line:

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

That's a rough dodge, not a polished one -- tune the angles and distances
until you can get all the way to the zone without a single hit.

**Try it yourself:** once you've beaten Obstacle Slalom, try **Precision
Docking**. Its zone is much smaller and tucked behind a narrow gate, so
reaching it cleanly takes real control, not just forward motion.
