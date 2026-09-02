"""Computer vision for student programs.

    from okrobo import Robot
    from okrobo.vision import find_color

    robot = Robot()
    target = find_color(robot.camera(), "red")
    if target:
        print("red object at", round(target.bearing), "degrees")

Deliberately works with **no dependencies installed**: the blob finder is
plain Python, so a school with no internet still gets working vision lessons
out of the box. When the AI pack is installed, OpenCV accelerates the same
operation and must produce the same answer — a parity test enforces that, so a
lesson's expected result never depends on which packs a machine has.
"""

from __future__ import annotations

from dataclasses import dataclass

from .camera import CAMERA_FOV, Frame

# Named colours students can ask for, as (r, g, b) references.
COLORS = {
    "red": (220, 40, 40),
    "green": (40, 200, 80),
    "blue": (60, 110, 230),
    "yellow": (230, 210, 60),
}


@dataclass
class Detection:
    """Where something coloured is in the frame."""

    color: str
    #: pixel column and row of the blob's centre
    x: float
    y: float
    #: how many pixels matched
    area: int
    #: degrees from straight ahead; negative is left, positive is right
    bearing: float
    #: fraction of the frame covered, 0..1 — a rough "how close is it"
    coverage: float


def _matches(pixel: tuple, reference: tuple, tolerance: float) -> bool:
    """Is this pixel that colour?

    Compares hue-like ratios rather than absolute values, because the camera
    darkens distant surfaces: a far-away red box is still red.
    """
    r, g, b = pixel
    total = r + g + b
    if total < 40:  # too dark to have a colour
        return False
    ref_total = sum(reference)
    for channel, ref in zip((r, g, b), reference):
        if abs(channel / total - ref / ref_total) > tolerance:
            return False
    return True


def find_color(frame: Frame, color: str, tolerance: float = 0.12) -> Detection | None:
    """Find the largest patch of a named colour, or None if it is not there."""
    if color not in COLORS:
        raise ValueError(f"unknown colour {color!r}; try one of {sorted(COLORS)}")
    reference = COLORS[color]

    total_x = 0
    total_y = 0
    count = 0
    for y in range(frame.height):
        row = y * frame.width * 3
        for x in range(frame.width):
            index = row + x * 3
            pixel = (frame.pixels[index], frame.pixels[index + 1], frame.pixels[index + 2])
            if _matches(pixel, reference, tolerance):
                total_x += x
                total_y += y
                count += 1

    if count == 0:
        return None

    centre_x = total_x / count
    fraction = 0.5 if frame.width == 1 else centre_x / (frame.width - 1)
    # Column 0 is the left edge of the field of view (see camera.render).
    bearing_radians = fraction * CAMERA_FOV - CAMERA_FOV / 2.0

    return Detection(
        color=color,
        x=centre_x,
        y=total_y / count,
        area=count,
        bearing=bearing_radians * 180.0 / 3.141592653589793,
        coverage=count / (frame.width * frame.height),
    )


def find_color_opencv(frame: Frame, color: str, tolerance: float = 0.12):
    """The same search using OpenCV, when the AI pack is installed.

    Exists so vision stays fast on large frames; a parity test asserts it
    agrees with the plain-Python version.
    """
    import numpy as np  # noqa: F401  (numpy ships with opencv)
    import cv2  # noqa: F401

    if color not in COLORS:
        raise ValueError(f"unknown colour {color!r}; try one of {sorted(COLORS)}")
    reference = COLORS[color]

    image = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(frame.height, frame.width, 3)
    values = image.astype(np.float32)
    totals = values.sum(axis=2)
    bright = totals >= 40
    safe_totals = np.where(totals == 0, 1, totals)

    ref_total = float(sum(reference))
    mask = bright
    for channel in range(3):
        ratio = values[:, :, channel] / safe_totals
        mask = mask & (np.abs(ratio - reference[channel] / ref_total) <= tolerance)

    count = int(mask.sum())
    if count == 0:
        return None

    ys, xs = np.nonzero(mask)
    centre_x = float(xs.mean())
    fraction = 0.5 if frame.width == 1 else centre_x / (frame.width - 1)
    bearing_radians = fraction * CAMERA_FOV - CAMERA_FOV / 2.0

    return Detection(
        color=color,
        x=centre_x,
        y=float(ys.mean()),
        area=count,
        bearing=bearing_radians * 180.0 / 3.141592653589793,
        coverage=count / (frame.width * frame.height),
    )


def opencv_available() -> bool:
    try:
        import cv2  # noqa: F401

        return True
    except Exception:
        return False
