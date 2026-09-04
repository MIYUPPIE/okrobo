"""Student-facing robot arm API.

    from okrobo import Arm

    arm = Arm()
    arm.move("shoulder", 80)
    print(arm.tip())

Angles are degrees at this API (radians internally). Methods block until the
motion finishes, like Robot. Joints: base (yaw), shoulder, elbow, wrist.
"""

from __future__ import annotations

import math

from ._sim import ARM_JOINT_NAMES, ArmWorld


def _joint_index(joint: int | str) -> int:
    if isinstance(joint, str):
        try:
            return ARM_JOINT_NAMES.index(joint.lower())
        except ValueError:
            raise ValueError(f"unknown joint {joint!r}; use one of {ARM_JOINT_NAMES}") from None
    if not 0 <= joint < len(ARM_JOINT_NAMES):
        raise ValueError(f"joint index out of range: {joint}")
    return joint


class Arm:
    DT = 0.01
    MAX_SECONDS = 30.0  # safety bound for a single blocking motion

    def __init__(self, world: ArmWorld | None = None) -> None:
        self.world = world or ArmWorld()

    def move(self, joint: int | str, degrees: float) -> None:
        """Move one joint to an absolute angle and wait until it arrives."""
        self.world.set_target(_joint_index(joint), math.radians(degrees))
        self._settle()

    def move_all(self, degrees: list) -> None:
        """Move every joint to absolute angles [base, shoulder, elbow, wrist]."""
        for j, value in enumerate(degrees):
            self.world.set_target(j, math.radians(value))
        self._settle()

    def angles(self) -> list:
        """Current joint angles in degrees [base, shoulder, elbow, wrist]."""
        return [math.degrees(a) for a in self.world.state().angles]

    def tip(self) -> tuple:
        """(x, y, z) of the arm's tip in meters."""
        return self.world.state().tip

    def grip(self) -> bool:
        """Grip the graspable object if the tip is within reach of it. Returns success."""
        return self.world.grip()

    def release(self) -> None:
        """Let go; the object falls under real gravity/contact once released."""
        self.world.release()

    def holding(self) -> bool:
        return self.world.state().holding

    def object_position(self) -> tuple:
        """(x, y, z) of the graspable object in meters."""
        return self.world.state().object

    def wait(self, seconds: float = 1.0) -> None:
        """Do nothing while simulation time passes."""
        steps = int(round(seconds / self.DT))
        for _ in range(steps):
            self.world.step(self.DT)

    def stop(self) -> None:
        self.world.stop()

    def _settle(self) -> None:
        for _ in range(int(self.MAX_SECONDS / self.DT)):
            if not self.world.state().moving:
                return
            self.world.step(self.DT)
