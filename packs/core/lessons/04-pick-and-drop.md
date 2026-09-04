---
title: Pick and drop
robot: arm
pack: core
---

There is a small box sitting on the floor in front of the arm. `grip()`
picks it up if the tip is close enough; `release()` lets go.

```okrobo-python
from okrobo import Arm

arm = Arm()
arm.move("shoulder", 50)
arm.move("elbow", -104)
arm.move("wrist", -2)

if arm.grip():
    print("got it")
else:
    print("missed")
```

`holding()` tells you whether you're still gripping something. While held,
the object moves with the tip — pick it up and it comes along for the ride.

```okrobo-python
arm.move("base", 45)
print("holding:", arm.holding())
x, y, z = arm.object_position()
print("object is now at", round(x, 2), round(y, 2), round(z, 2))
```

`release()` lets go — and unlike everything else in this arm, what happens
next is real physics, not a scripted animation: the object actually falls
and settles wherever gravity and the floor take it.

```okrobo-python
arm.release()
arm.wait(1.5)
x, y, z = arm.object_position()
print("it landed at height", round(z, 2))
```

**Try it yourself:** move the arm to a different spot before gripping and
see `grip()` return `False` — the tip has to actually be close to the
object, not just anywhere.
