"""Student-facing robot API.

    from okrobo import Robot

    robot = Robot()
    robot.forward()
    if robot.distance() < 0.2:
        robot.turn_left()

Distances are meters, angles are degrees. Methods block until the movement
finishes. Today this runs on the reference model (_sim.py); Phase 3 adds a
transport so the same code drives the engine or a physical robot.
"""

from __future__ import annotations

import math

from ._sim import World


class Robot:
    SPEED = 0.2        # m/s during forward/backward
    TURN_SPEED = 0.1   # wheel speed during turns, m/s
    DT = 0.01          # simulation timestep, s

    def __init__(self, world: World | None = None) -> None:
        self.world = world or World()

    def forward(self, meters: float = 0.1) -> None:
        """Drive straight ahead. Stops early at a wall."""
        self._drive_for(self.SPEED, self.SPEED, meters / self.SPEED)

    def backward(self, meters: float = 0.1) -> None:
        """Drive straight back. Stops early at a wall."""
        self._drive_for(-self.SPEED, -self.SPEED, meters / self.SPEED)

    def turn_left(self, degrees: float = 90.0) -> None:
        """Rotate in place, counter-clockwise."""
        self._turn(math.radians(degrees))

    def turn_right(self, degrees: float = 90.0) -> None:
        """Rotate in place, clockwise."""
        self._turn(-math.radians(degrees))

    def wait(self, seconds: float = 1.0) -> None:
        """Do nothing while simulation time passes."""
        if seconds > 0:
            self._drive_for(0.0, 0.0, seconds)

    def distance(self) -> float:
        """Meters from the robot's front edge to the wall it is facing."""
        return self.world.state().distance

    def heading(self) -> float:
        """Robot heading in degrees, (-180, 180], 0 = +x, counter-clockwise."""
        return math.degrees(self.world.state().pose.theta)

    def position(self) -> tuple[float, float]:
        """(x, y) in meters."""
        pose = self.world.state().pose
        return (pose.x, pose.y)

    def stop(self) -> None:
        self.world.stop()

    def _turn(self, radians: float) -> None:
        if radians == 0.0:
            return
        omega = 2.0 * self.TURN_SPEED / self.world.config.wheel_base
        duration = abs(radians) / omega
        wheel = self.TURN_SPEED if radians > 0 else -self.TURN_SPEED
        self._drive_for(-wheel, wheel, duration)

    def _drive_for(self, left: float, right: float, duration: float) -> None:
        # Full steps plus one exact partial step, so movements land precisely.
        self.world.drive(left, right)
        full_steps = int(duration / self.DT)
        remainder = duration - full_steps * self.DT
        for _ in range(full_steps):
            self.world.step(self.DT)
            if self.world.state().collided:
                break
        else:
            if remainder > 1e-12:
                self.world.step(remainder)
        self.world.stop()
