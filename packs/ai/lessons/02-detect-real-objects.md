---
title: Detect real objects in a photo
robot: car
pack: ai
---

`find_color` is great for spotting a colour, but real computer vision can do
more: it can recognise actual things — a dog, a car, a chair, a cup — in a
real photograph. This lesson uses a real, offline object detector, no
internet required once it is installed.

This is different from the last lesson in one important way: it does **not**
use `robot.camera()`. The robot's own camera only ever draws simple flat
colour shapes, so a detector trained on real photographs has nothing to
recognise there. Instead, `detect_objects` works on a real photo file —
one you already have on your computer.

Save a photo to your computer first (any JPEG or PNG with something
recognisable in it — a pet, a car, furniture, food). Then point
`load_image` at it:

```okrobo-python
from okrobo.vision import load_image, detect_objects

frame = load_image("/path/to/your/photo.jpg")
print("loaded a photo:", frame.width, "x", frame.height, "pixels")
```

Replace `/path/to/your/photo.jpg` with your own photo's real path on your
computer.

Now find out what is in it:

```okrobo-python
results = detect_objects(frame)

for obj in results:
    print(obj.label, "-", round(obj.confidence * 100), "percent sure")
```

Each result also has a **bounding box** — where the object is in the photo,
in pixels:

```okrobo-python
for obj in results:
    print(obj.label, "at", round(obj.x), round(obj.y), "size", round(obj.width), round(obj.height))
```

The detector knows 80 kinds of everyday objects — people, animals, vehicles,
furniture, food, and more. If nothing in your photo matches one of those, or
the detector is not confident enough, `results` comes back empty. You can
loosen that with a lower confidence:

```okrobo-python
results = detect_objects(frame, confidence=0.25)
print("found", len(results), "possible object(s)")
```

**Try it yourself:** load two or three different photos and compare what
the detector finds in each. Does it ever get confused? What happens with a
photo that has several objects crowded together?
