"""Dump camera frames and find_color results as JSON test vectors.

    python3 -m okrobo.dump_vision

For each named colour, renders a frame with a matching obstacle ahead of the
robot and one with no obstacle at all, running the real reference `find_color`
on each. Used by scripts/lib/vision-parity-check.mjs to lock the Blocks/JS
vision port (apps/studio/src/lib/vision.ts) to this reference the same way
engine/tests/parity/ locks the WASM engine to okrobo/_sim.py — the same
pixels must produce the same detection in both languages, since blocks run as
JS but the Python preview must show exactly what actually happens.
"""

from __future__ import annotations

import json

from ._sim import Obstacle, World, WorldConfig
from .camera import render
from .vision import COLORS, find_color


def detection_to_dict(detection):
    if detection is None:
        return None
    return {
        "color": detection.color,
        "x": detection.x,
        "y": detection.y,
        "area": detection.area,
        "bearing": detection.bearing,
        "coverage": detection.coverage,
    }


def vector(query_color: str, obstacle_color, frame) -> dict:
    return {
        "query_color": query_color,
        "obstacle_color": obstacle_color,
        "width": frame.width,
        "height": frame.height,
        "pixels": list(frame.pixels),
        "expected": detection_to_dict(find_color(frame, query_color)),
    }


def main() -> None:
    vectors = []
    for color, rgb in COLORS.items():
        # Dead ahead: bearing 0 regardless of FOV, so this alone can't catch
        # a wrong CAMERA_FOV constant on the JS side (it did not, the first
        # time this vector set shipped, until the off-centre case below was
        # added — a planted-bug check caught the gap, not inspection).
        centered = World(WorldConfig(obstacles=[Obstacle(x=1.6, y=1.0, width=0.2, height=0.2, color=rgb)]))
        vectors.append(vector(color, color, render(centered, 64, 48)))

        # Off to one side but still inside the 60-degree FOV (atan2(-0.15,
        # 0.6) =~ -14 degrees): exercises the bearing/FOV math for real,
        # unlike the dead-ahead case above where bearing is 0 no matter what
        # CAMERA_FOV is set to.
        offset = World(WorldConfig(obstacles=[Obstacle(x=1.6, y=0.85, width=0.2, height=0.2, color=rgb)]))
        vectors.append(vector(color, color, render(offset, 64, 48)))

        vectors.append(vector(color, None, render(World(), 64, 48)))

    print(json.dumps(vectors))


if __name__ == "__main__":
    main()
