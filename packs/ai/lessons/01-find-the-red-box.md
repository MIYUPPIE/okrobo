---
title: Find the red box
robot: car
pack: ai
---

Your robot has a camera. It sees a small picture of whatever is in front of
it, and your program can look at that picture and decide what to do.

Start by taking one picture and checking its size.

```okrobo-python
from okrobo import Robot

robot = Robot()
frame = robot.camera()
print("the camera sees", frame.width, "x", frame.height, "pixels")
print("the middle pixel is", frame.pixel(32, 24))
```

That middle pixel is mostly red, because there is a red box straight ahead.
Every pixel is three numbers: how much red, green and blue it has, from 0 to
255.

Searching pixel by pixel is slow to write, so `find_color` does it for you. It
returns where the colour is, or nothing at all if it cannot see it.

```okrobo-python
from okrobo.vision import find_color

target = find_color(robot.camera(), "red")
if target:
    print("red found, bearing", round(target.bearing), "degrees")
    print("it fills", round(target.coverage * 100), "percent of the picture")
else:
    print("no red in sight")
```

**Bearing** is the important number: negative means the object is to your
left, positive means to your right, and near zero means straight ahead. That
is enough to steer.

```okrobo-python
target = find_color(robot.camera(), "red")

if target is None:
    robot.turn_left(20)
elif target.bearing < -5:
    robot.turn_left(5)
elif target.bearing > 5:
    robot.turn_right(5)
else:
    robot.forward(0.05)
```

Run that a few times and the robot lines itself up with the box. Now put it in
a loop so it keeps going until it arrives.

```okrobo-python
while robot.distance() > 0.15:
    target = find_color(robot.camera(), "red")
    if target is None:
        robot.turn_left(20)
    elif target.bearing < -5:
        robot.turn_left(5)
    elif target.bearing > 5:
        robot.turn_right(5)
    else:
        robot.forward(0.05)

print("arrived at the red box")
```

That is real computer vision: look, decide, move, repeat.

**Try it yourself:** there is a blue box in the arena too. Change the colour
you search for and watch the robot go somewhere else entirely.
