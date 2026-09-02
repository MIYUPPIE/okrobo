"""Render camera frames from the reference model and print them as hex.

    python3 -m okrobo.dump_camera --world arena.json --width 64 --height 48

One line per frame: `<x> <y> <theta> <hex pixels>`, for a fixed sweep of robot
poses. The engine parity gate renders the same poses through the WASM camera
and compares byte for byte, so the two implementations cannot drift.
"""

from __future__ import annotations

import argparse
import json
import math

from ._sim import World, WorldConfig
from .camera import render

# Poses chosen to look at obstacles, along walls, and into corners.
POSES = [
    (1.0, 1.0, 0.0),
    (1.0, 1.0, math.pi / 4),
    (1.0, 1.0, -math.pi / 4),
    (1.0, 1.0, math.pi / 2),
    (0.5, 0.5, 0.0),
    (1.5, 1.5, math.pi),
    (0.3, 1.0, -math.pi / 3),
    (1.7, 0.4, 2.4),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", required=True)
    parser.add_argument("--width", type=int, default=64)
    parser.add_argument("--height", type=int, default=48)
    args = parser.parse_args()

    with open(args.world) as f:
        config = WorldConfig.from_dict(json.load(f))

    for x, y, theta in POSES:
        config.start.x, config.start.y, config.start.theta = x, y, theta
        world = World(config)
        frame = render(world, args.width, args.height)
        print(f"{x} {y} {theta} {frame.pixels.hex()}")


if __name__ == "__main__":
    main()
