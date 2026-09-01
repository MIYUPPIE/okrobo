"""Wall-avoider demo on the reference model.

    python3 -m okrobo.demo
"""

from __future__ import annotations

from .robot import Robot


def main() -> None:
    robot = Robot()
    print("OKROBO demo: drive to each wall, turn left. Arena 2x2 m.")
    for leg in range(1, 5):
        while robot.distance() > 0.2:
            robot.forward(0.05)
        x, y = robot.position()
        print(
            f"leg {leg}: wall at distance {robot.distance():.2f} m, "
            f"pose ({x:.2f}, {y:.2f}) heading {robot.heading():.0f} deg -> turn left"
        )
        robot.turn_left(90)
    x, y = robot.position()
    print(f"done: back near start at ({x:.2f}, {y:.2f}), heading {robot.heading():.0f} deg")


if __name__ == "__main__":
    main()
