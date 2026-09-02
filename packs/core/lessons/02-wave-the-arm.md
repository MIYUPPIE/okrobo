---
title: Wave the arm
robot: arm
pack: core
---

Switch to the Arm in the robot list. This arm has four joints: **base** turns
it left and right, and **shoulder**, **elbow** and **wrist** bend it up and
down.

Move one joint at a time. Angles are in degrees, and each move waits until the
joint arrives.

```okrobo-python
from okrobo import Arm

arm = Arm()
arm.move("shoulder", 85)
arm.move("shoulder", 35)
```

The arm nodded. Every joint has limits, so asking for an impossible angle just
stops at the limit instead of breaking anything.

```okrobo-python
arm.move("shoulder", 500)
print("shoulder stopped at", round(arm.angles()[1]), "degrees")
```

`tip()` tells you where the end of the arm is in space: x and y across the
floor, z upwards.

```okrobo-python
arm.move_all([0, 90, 0, 0])
x, y, z = arm.tip()
print("tip is", round(z, 2), "m above the ground")
```

Straight up, the tip is as high as the arm can reach: the base height plus all
three link lengths.

**Try it yourself:** write a loop that waves three times, then turns the base
45 degrees between waves.
