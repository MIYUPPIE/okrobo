---
title: Pick and drop
robot: arm
pack: core
---

There is a small box sitting on the floor in front of the arm. `grip()`
picks it up if the tip is close enough to it; `holding()` tells you whether
you're still gripping; `release()` lets go — and unlike everything else in
this arm, what happens next is real physics, not a scripted animation: the
object actually falls and settles wherever gravity and the floor take it.

Reach down, grip the box, carry it to a new spot by swinging the base, then
set it down.

```okrobo-python
from okrobo import Arm

arm = Arm()

arm.move("shoulder", 50)
arm.move("elbow", -104)
arm.move("wrist", -2)

if arm.grip():
    print("picked it up")
    arm.move("base", 90)
    arm.release()
    arm.wait(1.5)
    x, y, z = arm.object_position()
    print(f"placed it at ({x:.2f}, {y:.2f}, {z:.2f})")
else:
    print("couldn't reach it")
```

**Try it yourself:** move the arm to a different spot before gripping and
see `grip()` return `False` — the tip has to actually be close to the
object, not just anywhere.
