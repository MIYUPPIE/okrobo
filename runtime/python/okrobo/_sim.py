"""Reference model for the OKROBO robot API v0.

This is the executable spec for contracts/robot-api/v0. The production
implementation is the C++ engine (engine/src/world.cpp); a parity test locks
the two together (Phase 1). Change this file only together with the engine
and the contract.

Units: meters, radians, seconds. theta=0 faces +x, CCW positive,
normalized to (-pi, pi].
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

_OMEGA_EPSILON = 1e-9


@dataclass
class Pose:
    x: float = 0.0
    y: float = 0.0
    theta: float = 0.0


@dataclass
class Obstacle:
    """A coloured box the robot can see. Colour is what makes vision lessons
    possible: the camera renders it and student code looks for it."""

    x: float = 0.0
    y: float = 0.0
    width: float = 0.2
    height: float = 0.2
    color: tuple = (200, 60, 60)

    @classmethod
    def from_dict(cls, data: dict) -> "Obstacle":
        color = data.get("color", [200, 60, 60])
        return cls(
            x=float(data["x"]),
            y=float(data["y"]),
            width=float(data.get("width", 0.2)),
            height=float(data.get("height", 0.2)),
            color=(int(color[0]), int(color[1]), int(color[2])),
        )


@dataclass
class RayHit:
    distance: float
    color: tuple


@dataclass
class WorldConfig:
    arena_width: float = 2.0
    arena_height: float = 2.0
    robot_radius: float = 0.1
    wheel_base: float = 0.12
    start: Pose = field(default_factory=lambda: Pose(1.0, 1.0, 0.0))
    obstacles: list = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "WorldConfig":
        """Build from a contracts/world document (extra keys ignored)."""
        start = data["start"]
        return cls(
            arena_width=float(data["arena_width"]),
            arena_height=float(data["arena_height"]),
            robot_radius=float(data["robot_radius"]),
            wheel_base=float(data["wheel_base"]),
            start=Pose(float(start["x"]), float(start["y"]), float(start["theta"])),
            obstacles=[Obstacle.from_dict(o) for o in data.get("obstacles", [])],
        )


@dataclass
class State:
    tick: int
    pose: Pose
    distance: float
    collided: bool

    def to_message(self) -> dict:
        """Contract v0 state message."""
        return {
            "tick": self.tick,
            "pose": {"x": self.pose.x, "y": self.pose.y, "theta": self.pose.theta},
            "sensors": {"distance": self.distance},
            "collided": self.collided,
        }


def _normalize_angle(theta: float) -> float:
    theta = math.fmod(theta + math.pi, 2.0 * math.pi)
    if theta <= 0.0:
        theta += 2.0 * math.pi
    return theta - math.pi


class World:
    def __init__(self, config: WorldConfig | None = None) -> None:
        self.config = config or WorldConfig()
        self._pose = Pose(self.config.start.x, self.config.start.y, self.config.start.theta)
        self._left = 0.0
        self._right = 0.0
        self._tick = 0
        self._collided = False

    def drive(self, left: float, right: float) -> None:
        self._left = left
        self._right = right

    def stop(self) -> None:
        self._left = 0.0
        self._right = 0.0

    def reset(self) -> None:
        self._pose = Pose(self.config.start.x, self.config.start.y, self.config.start.theta)
        self._left = 0.0
        self._right = 0.0
        self._tick = 0
        self._collided = False

    def step(self, dt: float) -> None:
        v = (self._left + self._right) / 2.0
        w = (self._right - self._left) / self.config.wheel_base
        p = self._pose

        if abs(w) < _OMEGA_EPSILON:
            p.x += v * dt * math.cos(p.theta)
            p.y += v * dt * math.sin(p.theta)
        else:
            r = v / w
            p.x += r * (math.sin(p.theta + w * dt) - math.sin(p.theta))
            p.y -= r * (math.cos(p.theta + w * dt) - math.cos(p.theta))
            p.theta = _normalize_angle(p.theta + w * dt)

        min_xy = self.config.robot_radius
        max_x = self.config.arena_width - self.config.robot_radius
        max_y = self.config.arena_height - self.config.robot_radius
        clamped_x = min(max(p.x, min_xy), max_x)
        clamped_y = min(max(p.y, min_xy), max_y)
        self._collided = clamped_x != p.x or clamped_y != p.y
        p.x = clamped_x
        p.y = clamped_y

        self._tick += 1

    def _sensor_distance(self) -> float:
        return self.ray(0.0)

    def ray(self, offset: float) -> float:
        """Distance from the robot's front edge to the nearest wall or obstacle."""
        return self.ray_hit(offset).distance

    def ray_hit(self, offset: float) -> RayHit:
        """Distance and colour along heading+offset. Mirrors engine ray_hit."""
        dx = math.cos(self._pose.theta + offset)
        dy = math.sin(self._pose.theta + offset)
        t = math.inf
        if dx > _OMEGA_EPSILON:
            t = min(t, (self.config.arena_width - self._pose.x) / dx)
        if dx < -_OMEGA_EPSILON:
            t = min(t, -self._pose.x / dx)
        if dy > _OMEGA_EPSILON:
            t = min(t, (self.config.arena_height - self._pose.y) / dy)
        if dy < -_OMEGA_EPSILON:
            t = min(t, -self._pose.y / dy)

        color = (90, 90, 90)  # walls are grey
        for box in self.config.obstacles:
            near, far, miss = 0.0, t, False
            for origin, direction, lo, hi in (
                (self._pose.x, dx, box.x - box.width / 2, box.x + box.width / 2),
                (self._pose.y, dy, box.y - box.height / 2, box.y + box.height / 2),
            ):
                if abs(direction) < _OMEGA_EPSILON:
                    if origin < lo or origin > hi:
                        miss = True
                    continue
                t1, t2 = (lo - origin) / direction, (hi - origin) / direction
                if t1 > t2:
                    t1, t2 = t2, t1
                near, far = max(near, t1), min(far, t2)
                if near > far:
                    miss = True
                    break
            if not miss and near < t:
                t = near
                color = box.color

        return RayHit(distance=max(0.0, t - self.config.robot_radius), color=color)

    def state(self) -> State:
        return State(
            tick=self._tick,
            pose=Pose(self._pose.x, self._pose.y, self._pose.theta),
            distance=self._sensor_distance(),
            collided=self._collided,
        )


# ---- arm (contract v1) ----

ARM_JOINTS = 4  # base, shoulder, elbow, wrist
ARM_JOINT_NAMES = ("base", "shoulder", "elbow", "wrist")


@dataclass
class ArmConfig:
    base_height: float = 0.12
    link1: float = 0.22
    link2: float = 0.18
    link3: float = 0.10
    lower: tuple = (-math.pi, -0.17453292519943295, -2.0943951023931953, -1.5707963267948966)
    upper: tuple = (math.pi, 1.7453292519943295, 2.0943951023931953, 1.5707963267948966)
    speed: tuple = (
        1.5707963267948966,
        1.5707963267948966,
        1.5707963267948966,
        1.5707963267948966,
    )
    start: tuple = (0.0, 1.0471975511965976, -0.5235987755982988, -0.5235987755982988)


@dataclass
class ArmState:
    tick: int
    angles: list
    targets: list
    moving: bool
    tip: tuple  # (x, y, z)

    def to_message(self) -> dict:
        """Contract v1 arm state message."""
        return {
            "tick": self.tick,
            "joints": {"angles": list(self.angles), "targets": list(self.targets)},
            "moving": self.moving,
            "tip": {"x": self.tip[0], "y": self.tip[1], "z": self.tip[2]},
        }


class ArmWorld:
    """Reference model for the 4-DOF arm; mirrors engine/src/arm_world.cpp exactly."""

    def __init__(self, config: ArmConfig | None = None) -> None:
        self.config = config or ArmConfig()
        self._angles = list(self.config.start)
        self._targets = list(self.config.start)
        self._tick = 0

    def set_target(self, joint: int, angle: float) -> None:
        if not 0 <= joint < ARM_JOINTS:
            return
        self._targets[joint] = min(max(angle, self.config.lower[joint]), self.config.upper[joint])

    def stop(self) -> None:
        self._targets = list(self._angles)

    def reset(self) -> None:
        self._angles = list(self.config.start)
        self._targets = list(self.config.start)
        self._tick = 0

    def step(self, dt: float) -> None:
        for j in range(ARM_JOINTS):
            max_delta = self.config.speed[j] * dt
            delta = min(max(self._targets[j] - self._angles[j], -max_delta), max_delta)
            self._angles[j] += delta
        self._tick += 1

    def _forward_kinematics(self) -> tuple:
        c = self.config
        a1 = self._angles[1]
        a2 = a1 + self._angles[2]
        a3 = a2 + self._angles[3]
        r = c.link1 * math.cos(a1) + c.link2 * math.cos(a2) + c.link3 * math.cos(a3)
        z = c.base_height + c.link1 * math.sin(a1) + c.link2 * math.sin(a2) + c.link3 * math.sin(a3)
        return (r * math.cos(self._angles[0]), r * math.sin(self._angles[0]), z)

    def state(self) -> ArmState:
        moving = any(abs(t - a) > _OMEGA_EPSILON for t, a in zip(self._targets, self._angles))
        return ArmState(
            tick=self._tick,
            angles=list(self._angles),
            targets=list(self._targets),
            moving=moving,
            tip=self._forward_kinematics(),
        )


# ---- drone (contract v2) ----
#
# Point-mass kinematics, same spirit as the car (Phase 1-4: no physics
# engine) and the arm (Phase 5: no solver). Four degrees of freedom: forward
# speed and yaw rate in the horizontal plane (exactly the car's v/omega, just
# without a wheel_base to derive them from two wheels) plus a vertical speed.
# The drone shares the car's arena footprint (arena_width/height,
# robot_radius) and clamps to it the same way; altitude clamps to
# [0, max_altitude]. It flies above the ground-level obstacles, so unlike the
# car it has no obstacle-aware sensor — only the arena walls are a hazard,
# which is what its distance sensor and collision clamp are for.


@dataclass
class DronePose:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    theta: float = 0.0


@dataclass
class DroneConfig:
    arena_width: float = 2.0
    arena_height: float = 2.0
    robot_radius: float = 0.1
    max_altitude: float = 1.0
    start: DronePose = field(default_factory=lambda: DronePose(1.0, 1.0, 0.0, 0.0))


@dataclass
class DroneState:
    tick: int
    pose: DronePose
    distance: float
    collided: bool

    def to_message(self) -> dict:
        """Contract v2 drone state message."""
        return {
            "tick": self.tick,
            "pose": {"x": self.pose.x, "y": self.pose.y, "z": self.pose.z, "theta": self.pose.theta},
            "sensors": {"distance": self.distance},
            "collided": self.collided,
        }


class DroneWorld:
    """Reference model for the drone; mirrors engine/src/drone_world.cpp exactly."""

    def __init__(self, config: DroneConfig | None = None) -> None:
        self.config = config or DroneConfig()
        s = self.config.start
        self._pose = DronePose(s.x, s.y, s.z, s.theta)
        self._forward = 0.0
        self._vertical = 0.0
        self._yaw_rate = 0.0
        self._tick = 0
        self._collided = False

    def drive(self, forward: float, vertical: float, yaw_rate: float) -> None:
        self._forward = forward
        self._vertical = vertical
        self._yaw_rate = yaw_rate

    def stop(self) -> None:
        self._forward = self._vertical = self._yaw_rate = 0.0

    def reset(self) -> None:
        s = self.config.start
        self._pose = DronePose(s.x, s.y, s.z, s.theta)
        self._forward = self._vertical = self._yaw_rate = 0.0
        self._tick = 0
        self._collided = False

    def step(self, dt: float) -> None:
        p = self._pose
        p.x += self._forward * dt * math.cos(p.theta)
        p.y += self._forward * dt * math.sin(p.theta)
        p.z += self._vertical * dt
        p.theta = _normalize_angle(p.theta + self._yaw_rate * dt)

        min_xy = self.config.robot_radius
        max_x = self.config.arena_width - self.config.robot_radius
        max_y = self.config.arena_height - self.config.robot_radius
        clamped_x = min(max(p.x, min_xy), max_x)
        clamped_y = min(max(p.y, min_xy), max_y)
        clamped_z = min(max(p.z, 0.0), self.config.max_altitude)
        self._collided = clamped_x != p.x or clamped_y != p.y or clamped_z != p.z
        p.x, p.y, p.z = clamped_x, clamped_y, clamped_z

        self._tick += 1

    def _sensor_distance(self) -> float:
        return self.ray(0.0)

    def ray(self, offset: float) -> float:
        """Horizontal distance from the drone to the nearest arena wall along
        heading+offset. Walls only: the drone flies above the boxes."""
        dx = math.cos(self._pose.theta + offset)
        dy = math.sin(self._pose.theta + offset)
        t = math.inf
        if dx > _OMEGA_EPSILON:
            t = min(t, (self.config.arena_width - self._pose.x) / dx)
        if dx < -_OMEGA_EPSILON:
            t = min(t, -self._pose.x / dx)
        if dy > _OMEGA_EPSILON:
            t = min(t, (self.config.arena_height - self._pose.y) / dy)
        if dy < -_OMEGA_EPSILON:
            t = min(t, -self._pose.y / dy)
        return max(0.0, t - self.config.robot_radius)

    def state(self) -> DroneState:
        return DroneState(
            tick=self._tick,
            pose=DronePose(self._pose.x, self._pose.y, self._pose.z, self._pose.theta),
            distance=self._sensor_distance(),
            collided=self._collided,
        )
