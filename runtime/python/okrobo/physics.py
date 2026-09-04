"""A single graspable rigid body, simulated by real MuJoCo once released.

Python mirror of engine/src/physics_object.cpp -- same MJCF shape, same
constants, same semantics: held is plain kinematics (position pinned by the
caller, e.g. the arm's tip, no simulation cost), release() hands it to
MuJoCo as a free body so it actually falls and settles under real gravity
and contact. A parity gate (engine/tests/parity/) locks the two
implementations together numerically, the same discipline this project uses
for every other simulated quantity.

Requires the `mujoco` package (requirements.txt pins it to the exact
version tools/mujoco vendors for C++/WASM, so both sides run the same
solver, not just "a" solver).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import _deps  # noqa: F401  (adds .deps to sys.path before the mujoco import)

import mujoco

MODEL_TIMESTEP = 0.002  # proven stable in the WASM feasibility spike
SETTLE_VELOCITY = 1e-3  # m/s


@dataclass
class PhysicsObjectConfig:
    half_extent: float = 0.03  # a 6 cm cube
    density: float = 1000.0  # kg/m^3
    start_x: float = 0.30
    start_y: float = 0.0
    start_z: float = 0.03  # resting height on the floor (z=0)


def _build_mjcf(config: PhysicsObjectConfig) -> str:
    return f"""
<mujoco model="okrobo_object">
  <option timestep="{MODEL_TIMESTEP}" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <body name="object" pos="{config.start_x} {config.start_y} {config.start_z}">
      <freejoint/>
      <geom name="objectgeom" type="box"
            size="{config.half_extent} {config.half_extent} {config.half_extent}"
            density="{config.density}"/>
    </body>
  </worldbody>
</mujoco>
"""


class PhysicsObject:
    """Held: pinned position, no MuJoCo cost. Released: a real free body."""

    def __init__(self, config: PhysicsObjectConfig | None = None) -> None:
        self.config = config or PhysicsObjectConfig()
        self._model = mujoco.MjModel.from_xml_string(_build_mjcf(self.config))
        self._data = mujoco.MjData(self._model)
        self.reset()

    def reset(self) -> None:
        self._held = True
        self._pinned = (self.config.start_x, self.config.start_y, self.config.start_z)

    def set_kinematic(self, pos: tuple) -> None:
        self._held = True
        self._pinned = tuple(pos)

    def release(self, pos: tuple) -> None:
        self._held = False
        d = self._data
        d.qpos[0:3] = pos
        d.qpos[3:7] = (1.0, 0.0, 0.0, 0.0)  # identity quaternion: axis-aligned
        d.qvel[:] = 0.0
        mujoco.mj_forward(self._model, d)

    def step(self, dt: float) -> None:
        if self._held or dt <= 0.0:
            return
        steps = max(1, round(dt / MODEL_TIMESTEP))
        for _ in range(steps):
            mujoco.mj_step(self._model, self._data)

    def position(self) -> tuple:
        if self._held:
            return self._pinned
        return tuple(self._data.qpos[0:3])

    def settled(self) -> bool:
        if self._held:
            return True
        vx, vy, vz = self._data.qvel[0:3]
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        return speed < SETTLE_VELOCITY and self._data.ncon > 0

    @property
    def held(self) -> bool:
        return self._held
