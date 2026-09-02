---
title: Fly a square
robot: drone
pack: core
---

Switch to the Drone in the robot list. It shares the same arena as the car,
but it can also go up: `takeoff()` rises to a hover height, `land()` comes
back down.

```okrobo-python
from okrobo import Drone

drone = Drone()
drone.takeoff()
print("altitude:", round(drone.altitude(), 2), "m")
```

The drone rose to 0.4 m and stayed there. `altitude()` always reads meters
above the ground.

Once it is airborne, `forward()` and `turn_left()`/`turn_right()` work just
like the car's — the drone just also has height. It has a distance sensor
too, but it only sees the walls: it flies above the boxes on the ground.

```okrobo-python
drone.forward(0.3)
drone.turn_right(90)
print("distance to the wall:", round(drone.distance(), 2), "m")
```

Four forward-and-turn legs like that trace out a square, back to where it
started.

```okrobo-python
for _ in range(4):
    drone.forward(0.3)
    drone.turn_right(90)

drone.land()
print("landed at altitude", round(drone.altitude(), 2))
```

**Try it yourself:** change the square's side length, or add `drone.up(0.2)`
partway through to climb during the flight instead of holding one height.
