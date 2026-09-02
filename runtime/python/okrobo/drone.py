"""Student-facing drone API.

    from okrobo import Drone

    drone = Drone()
    drone.takeoff()
    drone.forward(0.3)
    drone.land()

Distances are meters, angles are degrees, same convention as Robot and Arm.
Methods block until the movement finishes. Runs on the reference model
(_sim.py) standalone; the studio drives the same calls through the real
engine or the sidecar, unchanged.
"""

from __future__ import annotations

import math

from ._sim import DroneWorld


class Drone:
    SPEED = 0.2          # m/s during forward/backward
    VERTICAL_SPEED = 0.1  # m/s during up/down/takeoff/land
    TURN_SPEED = 1.0     # rad/s during turns
    HOVER_HEIGHT = 0.4    # meters, takeoff()'s default
    DT = 0.01             # simulation timestep, s

    def __init__(self, world: DroneWorld | None = None) -> None:
        self.world = world or DroneWorld()

    def takeoff(self, height: float = HOVER_HEIGHT) -> None:
        """Rise straight up to `height` meters."""
        self.up(height - self.altitude())

    def land(self) -> None:
        """Descend straight down to the ground."""
        self.down(self.altitude())

    def forward(self, meters: float = 0.1) -> None:
        """Fly straight ahead. Stops early at a wall."""
        self._drive_for(self.SPEED, 0.0, 0.0, meters / self.SPEED)

    def backward(self, meters: float = 0.1) -> None:
        """Fly straight back. Stops early at a wall."""
        self._drive_for(-self.SPEED, 0.0, 0.0, meters / self.SPEED)

    def up(self, meters: float = 0.1) -> None:
        """Rise. Stops early at the altitude ceiling."""
        if meters <= 0:
            return
        self._drive_for(0.0, self.VERTICAL_SPEED, 0.0, meters / self.VERTICAL_SPEED)

    def down(self, meters: float = 0.1) -> None:
        """Descend. Stops early at the ground."""
        if meters <= 0:
            return
        self._drive_for(0.0, -self.VERTICAL_SPEED, 0.0, meters / self.VERTICAL_SPEED)

    def turn_left(self, degrees: float = 90.0) -> None:
        """Rotate in place, counter-clockwise."""
        self._turn(math.radians(degrees))

    def turn_right(self, degrees: float = 90.0) -> None:
        """Rotate in place, clockwise."""
        self._turn(-math.radians(degrees))

    def wait(self, seconds: float = 1.0) -> None:
        """Do nothing while simulation time passes."""
        if seconds > 0:
            self._drive_for(0.0, 0.0, 0.0, seconds)

    def altitude(self) -> float:
        """Meters above the ground."""
        return self.world.state().pose.z

    def distance(self) -> float:
        """Meters from the drone to the wall it is facing (walls only; it flies above obstacles)."""
        return self.world.state().distance

    def heading(self) -> float:
        """Drone heading in degrees, (-180, 180], 0 = +x, counter-clockwise."""
        return math.degrees(self.world.state().pose.theta)

    def position(self) -> tuple[float, float, float]:
        """(x, y, z) in meters."""
        pose = self.world.state().pose
        return (pose.x, pose.y, pose.z)

    def stop(self) -> None:
        self.world.stop()

    def _turn(self, radians: float) -> None:
        if radians == 0.0:
            return
        duration = abs(radians) / self.TURN_SPEED
        yaw_rate = self.TURN_SPEED if radians > 0 else -self.TURN_SPEED
        self._drive_for(0.0, 0.0, yaw_rate, duration)

    def _drive_for(self, forward: float, vertical: float, yaw_rate: float, duration: float) -> None:
        if duration <= 0:
            return
        # Full steps plus one exact partial step, so movements land precisely.
        self.world.drive(forward, vertical, yaw_rate)
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
