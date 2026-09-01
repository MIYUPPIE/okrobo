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
class WorldConfig:
    arena_width: float = 2.0
    arena_height: float = 2.0
    robot_radius: float = 0.1
    wheel_base: float = 0.12
    start: Pose = field(default_factory=lambda: Pose(1.0, 1.0, 0.0))


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
        dx = math.cos(self._pose.theta)
        dy = math.sin(self._pose.theta)
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

    def state(self) -> State:
        return State(
            tick=self._tick,
            pose=Pose(self._pose.x, self._pose.y, self._pose.theta),
            distance=self._sensor_distance(),
            collided=self._collided,
        )
