"""Robot camera: the reference implementation of engine/src/camera.hpp.

Kept byte-for-byte identical to the C++ renderer (a parity gate proves it), so
a lesson's expected answer is the same whether the frame came from the WASM
engine, the sidecar, or this module.

    from okrobo import Robot
    frame = Robot().camera()
    print(frame.width, frame.height, len(frame.pixels))
"""

from __future__ import annotations

import math
from dataclasses import dataclass

CAMERA_MAX_WIDTH = 160
CAMERA_MAX_HEIGHT = 120
CAMERA_FOV = 1.0471975511965976  # 60 degrees
CAMERA_FAR_PLANE = 4.0

SKY = (22, 24, 29)
FLOOR = (26, 34, 48)


@dataclass
class Frame:
    """One RGB camera frame, row-major from the top."""

    width: int
    height: int
    pixels: bytes

    def pixel(self, x: int, y: int) -> tuple:
        """(r, g, b) at column x, row y."""
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError(f"pixel out of range: ({x}, {y})")
        index = (y * self.width + x) * 3
        return tuple(self.pixels[index : index + 3])


def render(world, width: int = 64, height: int = 48) -> Frame:
    """Render a frame from the robot's point of view."""
    if width <= 0 or height <= 0:
        raise ValueError("camera size must be positive")
    if width > CAMERA_MAX_WIDTH or height > CAMERA_MAX_HEIGHT:
        raise ValueError(f"camera size max is {CAMERA_MAX_WIDTH}x{CAMERA_MAX_HEIGHT}")

    out = bytearray(width * height * 3)
    for column in range(width):
        fraction = 0.5 if width == 1 else column / (width - 1)
        offset = CAMERA_FOV / 2.0 - fraction * CAMERA_FOV
        hit = world.ray_hit(offset)

        distance = hit.distance * math.cos(offset)
        clamped = 0.05 if distance < 0.05 else distance

        band = min(height / (clamped * 2.0), height)
        top = int((height - band) / 2.0)
        bottom = int((height + band) / 2.0)

        shade = 1.0 - (clamped / CAMERA_FAR_PLANE)
        shade = min(max(shade, 0.15), 1.0)
        shaded = tuple(int(channel * shade) for channel in hit.color)

        for row in range(height):
            index = (row * width + column) * 3
            if row < top:
                color = SKY
            elif row >= bottom:
                color = FLOOR
            else:
                color = shaded
            out[index] = color[0]
            out[index + 1] = color[1]
            out[index + 2] = color[2]

    return Frame(width=width, height=height, pixels=bytes(out))
