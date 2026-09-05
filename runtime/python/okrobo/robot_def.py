"""Reference model for the OKROBO robot definition v1 (Robot Builder Phase 1;
v1 adds cad_mesh geometry for the CAD Kernel initiative -- see
docs/decisions/cad-kernel-foundation.md).

This is the executable spec for contracts/robot-def/v1: the same role
_sim.py plays for kinematics. TypeScript (apps/studio/src/contracts/robotDef.ts)
and C++ (engine/src/robot_def.{hpp,cpp}) are hand-mirrored to match. Change
this file only together with the contract and the other two mirrors.

A robot-def document is purely structural data -- bodies, joints, actuators,
sensors -- with no simulation behavior. It is parsed and validated here,
never simulated. Units: meters, kilograms, radians, seconds. Rotation is
roll-pitch-yaw (intrinsic XYZ Euler radians), matching URDF's convention.

The kinematic tree is defined entirely by joints[] edges, not a body.parent
field: a body with no incoming joint edge is a root, and rigid attachment is
a `fixed` joint, not a second hierarchy mechanism -- mirrors URDF and
apps/studio/src/packs/urdf.ts's own idiom exactly.

validate_robot_def never raises: it always returns a (possibly empty) list
of Issue, so a future builder UI can show every problem on a robot at once.
parse_robot_def still raises ValueError on malformed shape -- that is a
file-corruption/programmer error, not a design-time issue for a student.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Union

# ---- geometry ----


@dataclass
class BoxGeometry:
    size: tuple  # (x, y, z), meters
    type: str = "box"


@dataclass
class SphereGeometry:
    radius: float
    type: str = "sphere"


@dataclass
class CylinderGeometry:
    radius: float
    length: float
    type: str = "cylinder"


@dataclass
class CapsuleGeometry:
    radius: float
    length: float
    type: str = "capsule"


@dataclass
class ConeGeometry:
    radius: float
    length: float
    type: str = "cone"


@dataclass
class PlaneGeometry:
    size: tuple  # (width, height)
    type: str = "plane"


@dataclass
class MeshGeometry:
    path: str  # pack-relative; never opened in v0
    scale: tuple = (1.0, 1.0, 1.0)
    type: str = "mesh"


@dataclass
class CadMeshGeometry:
    """A baked, frozen mesh authored by the CAD kernel pipeline (Robot
    Builder CAD Kernel Phase 1) -- flat vertex/face arrays, in this body's
    own frame. No live feature tree yet; see
    docs/decisions/cad-kernel-foundation.md."""

    vertices: tuple  # flat (x0, y0, z0, x1, y1, z1, ...), meters
    faces: tuple  # flat triangulated vertex-index triples
    type: str = "cad_mesh"


Geometry = Union[
    BoxGeometry, SphereGeometry, CylinderGeometry, CapsuleGeometry, ConeGeometry, PlaneGeometry, MeshGeometry, CadMeshGeometry
]

# ---- bodies ----


@dataclass
class Transform:
    position: tuple = (0.0, 0.0, 0.0)
    rotation_rpy: tuple = (0.0, 0.0, 0.0)


@dataclass
class Inertia:
    ixx: float
    iyy: float
    izz: float


@dataclass
class Material:
    color: tuple | None = None


@dataclass
class Body:
    id: str
    name: str
    transform: Transform = field(default_factory=Transform)
    visual: Geometry | None = None
    collision: Geometry | None = None
    mass: float = 0.0
    inertia: Inertia = field(default_factory=lambda: Inertia(0.0, 0.0, 0.0))
    material: Material | None = None


# ---- joints ----


@dataclass
class Limits:
    lower: float
    upper: float


@dataclass
class FixedJoint:
    id: str
    name: str
    parent: str
    child: str
    origin: Transform = field(default_factory=Transform)
    type: str = "fixed"


@dataclass
class HingeJoint:
    id: str
    name: str
    parent: str
    child: str
    axis: tuple
    origin: Transform = field(default_factory=Transform)
    limits: Limits | None = None
    damping: float | None = None
    friction: float | None = None
    type: str = "hinge"


@dataclass
class SliderJoint:
    id: str
    name: str
    parent: str
    child: str
    axis: tuple
    origin: Transform = field(default_factory=Transform)
    limits: Limits | None = None
    damping: float | None = None
    friction: float | None = None
    type: str = "slider"


@dataclass
class BallJoint:
    id: str
    name: str
    parent: str
    child: str
    origin: Transform = field(default_factory=Transform)
    damping: float | None = None
    type: str = "ball"


@dataclass
class FreeJoint:
    id: str
    name: str
    parent: str
    child: str
    origin: Transform = field(default_factory=Transform)
    type: str = "free"


Joint = Union[FixedJoint, HingeJoint, SliderJoint, BallJoint, FreeJoint]

# ---- actuators & sensors ----


@dataclass
class ActuatorLimits:
    effort: float | None = None
    velocity: float | None = None


@dataclass
class Actuator:
    id: str
    name: str
    type: str  # motor | servo | force | torque | velocity
    target_joint: str
    limits: ActuatorLimits | None = None


@dataclass
class Sensor:
    id: str
    name: str
    type: str  # camera | distance | lidar | imu | encoder | gps | touch | force_torque
    body: str
    joint: str | None = None  # required for type == "encoder"
    transform: Transform = field(default_factory=Transform)
    params: dict = field(default_factory=dict)


@dataclass
class RobotDef:
    id: str
    name: str
    description: str = ""
    root_placement: Transform = field(default_factory=Transform)
    bodies: list = field(default_factory=list)  # list[Body]
    joints: list = field(default_factory=list)  # list[Joint]
    actuators: list = field(default_factory=list)  # list[Actuator]
    sensors: list = field(default_factory=list)  # list[Sensor]


@dataclass
class Issue:
    rule: str
    severity: str = "error"
    element_kind: str | None = None  # body | joint | actuator | sensor | robot
    element_id: str | None = None
    message: str = ""


# ---- parsing ----
#
# parse_transform/parse_geometry/transform_to_dict/geometry_to_dict are
# public (Robot Builder Phase 5) so runtime/python/okrobo/world_def.py can
# reuse them directly rather than redefining an equivalent shape -- a
# position/rotation and a primitive shape are the same concepts for a world
# object as for a robot body. See docs/decisions/robot-builder-world.md.


def parse_transform(data: dict | None) -> Transform:
    if not data:
        return Transform()
    position = tuple(float(v) for v in data.get("position", (0.0, 0.0, 0.0)))
    rotation = tuple(float(v) for v in data.get("rotation_rpy", (0.0, 0.0, 0.0)))
    return Transform(position=position, rotation_rpy=rotation)


def parse_geometry(data: dict | None) -> Geometry | None:
    if data is None:
        return None
    kind = data.get("type")
    if kind == "box":
        return BoxGeometry(size=tuple(float(v) for v in data["size"]))
    if kind == "sphere":
        return SphereGeometry(radius=float(data["radius"]))
    if kind == "cylinder":
        return CylinderGeometry(radius=float(data["radius"]), length=float(data["length"]))
    if kind == "capsule":
        return CapsuleGeometry(radius=float(data["radius"]), length=float(data["length"]))
    if kind == "cone":
        return ConeGeometry(radius=float(data["radius"]), length=float(data["length"]))
    if kind == "plane":
        return PlaneGeometry(size=tuple(float(v) for v in data["size"]))
    if kind == "mesh":
        scale = tuple(float(v) for v in data.get("scale", (1.0, 1.0, 1.0)))
        return MeshGeometry(path=str(data["path"]), scale=scale)
    if kind == "cad_mesh":
        vertices = tuple(float(v) for v in data["vertices"])
        faces_data = data["faces"]
        if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in faces_data):
            raise ValueError("robot-def: cad_mesh geometry needs a non-negative integer faces array")
        faces = tuple(int(v) for v in faces_data)
        return CadMeshGeometry(vertices=vertices, faces=faces)
    raise ValueError(f"robot-def: unknown geometry type {kind!r}")


def _parse_body(data: dict) -> Body:
    material = None
    material_data = data.get("material")
    if material_data and "color" in material_data:
        material = Material(color=tuple(float(v) for v in material_data["color"]))
    inertia_data = data["inertia"]
    return Body(
        id=str(data["id"]),
        name=str(data["name"]),
        transform=parse_transform(data.get("transform")),
        visual=parse_geometry(data.get("visual")),
        collision=parse_geometry(data.get("collision")),
        mass=float(data["mass"]),
        inertia=Inertia(ixx=float(inertia_data["ixx"]), iyy=float(inertia_data["iyy"]), izz=float(inertia_data["izz"])),
        material=material,
    )


def _parse_limits(data: dict | None) -> Limits | None:
    if data is None:
        return None
    return Limits(lower=float(data["lower"]), upper=float(data["upper"]))


def _parse_joint(data: dict) -> Joint:
    kind = data.get("type")
    common = dict(
        id=str(data["id"]),
        name=str(data["name"]),
        parent=str(data["parent"]),
        child=str(data["child"]),
        origin=parse_transform(data.get("origin")),
    )
    if kind == "fixed":
        return FixedJoint(**common)
    if kind in ("hinge", "slider"):
        axis = tuple(float(v) for v in data["axis"])
        limits = _parse_limits(data.get("limits"))
        damping = float(data["damping"]) if "damping" in data else None
        friction = float(data["friction"]) if "friction" in data else None
        cls = HingeJoint if kind == "hinge" else SliderJoint
        return cls(**common, axis=axis, limits=limits, damping=damping, friction=friction)
    if kind == "ball":
        damping = float(data["damping"]) if "damping" in data else None
        return BallJoint(**common, damping=damping)
    if kind == "free":
        return FreeJoint(**common)
    raise ValueError(f"robot-def: unknown joint type {kind!r}")


def _parse_actuator(data: dict) -> Actuator:
    limits = None
    if "limits" in data:
        limits_data = data["limits"]
        limits = ActuatorLimits(
            effort=float(limits_data["effort"]) if "effort" in limits_data else None,
            velocity=float(limits_data["velocity"]) if "velocity" in limits_data else None,
        )
    return Actuator(
        id=str(data["id"]),
        name=str(data["name"]),
        type=str(data["type"]),
        target_joint=str(data["target_joint"]),
        limits=limits,
    )


def _parse_sensor(data: dict) -> Sensor:
    return Sensor(
        id=str(data["id"]),
        name=str(data["name"]),
        type=str(data["type"]),
        body=str(data["body"]),
        joint=str(data["joint"]) if "joint" in data else None,
        transform=parse_transform(data.get("transform")),
        params=dict(data.get("params", {})),
    )


def parse_robot_def(data: dict) -> RobotDef:
    """Parse a robot-def v0 document. Raises ValueError on malformed shape
    (missing required fields, wrong types) -- never on semantic issues,
    which are validate_robot_def's job."""
    for required in ("id", "name", "bodies"):
        if required not in data:
            raise ValueError(f"robot-def: missing required field '{required}'")
    return RobotDef(
        id=str(data["id"]),
        name=str(data["name"]),
        description=str(data.get("description", "")),
        root_placement=parse_transform(data.get("root_placement")),
        bodies=[_parse_body(b) for b in data["bodies"]],
        joints=[_parse_joint(j) for j in data.get("joints", [])],
        actuators=[_parse_actuator(a) for a in data.get("actuators", [])],
        sensors=[_parse_sensor(s) for s in data.get("sensors", [])],
    )


# ---- serialization (round-trip) ----


def transform_to_dict(t: Transform) -> dict:
    return {"position": list(t.position), "rotation_rpy": list(t.rotation_rpy)}


def geometry_to_dict(g: Geometry) -> dict:
    if isinstance(g, BoxGeometry):
        return {"type": "box", "size": list(g.size)}
    if isinstance(g, SphereGeometry):
        return {"type": "sphere", "radius": g.radius}
    if isinstance(g, (CylinderGeometry, CapsuleGeometry, ConeGeometry)):
        return {"type": g.type, "radius": g.radius, "length": g.length}
    if isinstance(g, PlaneGeometry):
        return {"type": "plane", "size": list(g.size)}
    if isinstance(g, MeshGeometry):
        return {"type": "mesh", "path": g.path, "scale": list(g.scale)}
    if isinstance(g, CadMeshGeometry):
        return {"type": "cad_mesh", "vertices": list(g.vertices), "faces": list(g.faces)}
    raise ValueError(f"robot-def: unknown geometry {g!r}")


def _body_to_dict(b: Body) -> dict:
    out = {
        "id": b.id,
        "name": b.name,
        "transform": transform_to_dict(b.transform),
        "mass": b.mass,
        "inertia": {"ixx": b.inertia.ixx, "iyy": b.inertia.iyy, "izz": b.inertia.izz},
    }
    if b.visual is not None:
        out["visual"] = geometry_to_dict(b.visual)
    if b.collision is not None:
        out["collision"] = geometry_to_dict(b.collision)
    if b.material is not None and b.material.color is not None:
        out["material"] = {"color": list(b.material.color)}
    return out


def _joint_to_dict(j: Joint) -> dict:
    out = {"id": j.id, "name": j.name, "type": j.type, "parent": j.parent, "child": j.child, "origin": transform_to_dict(j.origin)}
    if isinstance(j, (HingeJoint, SliderJoint)):
        out["axis"] = list(j.axis)
        if j.limits is not None:
            out["limits"] = {"lower": j.limits.lower, "upper": j.limits.upper}
        if j.damping is not None:
            out["damping"] = j.damping
        if j.friction is not None:
            out["friction"] = j.friction
    elif isinstance(j, BallJoint) and j.damping is not None:
        out["damping"] = j.damping
    return out


def _actuator_to_dict(a: Actuator) -> dict:
    out = {"id": a.id, "name": a.name, "type": a.type, "target_joint": a.target_joint}
    if a.limits is not None:
        limits = {}
        if a.limits.effort is not None:
            limits["effort"] = a.limits.effort
        if a.limits.velocity is not None:
            limits["velocity"] = a.limits.velocity
        if limits:
            out["limits"] = limits
    return out


def _sensor_to_dict(s: Sensor) -> dict:
    out = {"id": s.id, "name": s.name, "type": s.type, "body": s.body, "transform": transform_to_dict(s.transform)}
    if s.joint is not None:
        out["joint"] = s.joint
    if s.params:
        out["params"] = dict(s.params)
    return out


def robot_def_to_dict(robot: RobotDef) -> dict:
    return {
        "id": robot.id,
        "name": robot.name,
        "description": robot.description,
        "root_placement": transform_to_dict(robot.root_placement),
        "bodies": [_body_to_dict(b) for b in robot.bodies],
        "joints": [_joint_to_dict(j) for j in robot.joints],
        "actuators": [_actuator_to_dict(a) for a in robot.actuators],
        "sensors": [_sensor_to_dict(s) for s in robot.sensors],
    }


# ---- validation ----

_EPSILON = 1e-12


def _geometry_is_valid(geometry: Geometry) -> bool:
    if isinstance(geometry, (BoxGeometry, PlaneGeometry)):
        return all(v > 0 for v in geometry.size)
    if isinstance(geometry, SphereGeometry):
        return geometry.radius > 0
    if isinstance(geometry, (CylinderGeometry, CapsuleGeometry, ConeGeometry)):
        return geometry.radius > 0 and geometry.length > 0
    if isinstance(geometry, MeshGeometry):
        return bool(geometry.path)
    if isinstance(geometry, CadMeshGeometry):
        return (
            len(geometry.vertices) > 0
            and len(geometry.vertices) % 3 == 0
            and len(geometry.faces) > 0
            and len(geometry.faces) % 3 == 0
            and all(index < len(geometry.vertices) // 3 for index in geometry.faces)
        )
    return True


def _find_cycle(body_ids: list, parent_of: dict) -> str | None:
    """Follows parent_of chains (deduped: at most one parent per child) from
    every body. A walk that revisits a node still in its own current path is
    a cycle; `resolved` memoizes bodies already proven acyclic."""
    resolved: set = set()
    for start in body_ids:
        if start in resolved:
            continue
        path: list = []
        current = start
        while current is not None and current not in resolved:
            if current in path:
                return current
            path.append(current)
            current = parent_of.get(current)
        resolved.update(path)
    return None


def validate_robot_def(robot: RobotDef) -> list:  # list[Issue]
    """Never raises. Always returns a (possibly empty) list of Issue."""
    issues: list = []

    # ---- bodies ----
    body_by_id: dict = {}
    for body in robot.bodies:
        if body.id in body_by_id:
            issues.append(Issue("body-duplicate-id", element_kind="body", element_id=body.id, message=f"Duplicate body id '{body.id}'"))
        else:
            body_by_id[body.id] = body

        for geometry in (body.visual, body.collision):
            if geometry is not None and not _geometry_is_valid(geometry):
                issues.append(
                    Issue("body-invalid-geometry", element_kind="body", element_id=body.id, message=f"Body '{body.id}': geometry size must be positive")
                )
        if not math.isfinite(body.mass) or body.mass <= 0:
            issues.append(Issue("body-invalid-mass", element_kind="body", element_id=body.id, message=f"Body '{body.id}' has no valid mass"))
        for axis_name, value in (("ixx", body.inertia.ixx), ("iyy", body.inertia.iyy), ("izz", body.inertia.izz)):
            if not math.isfinite(value) or value <= 0:
                issues.append(
                    Issue("body-invalid-inertia", element_kind="body", element_id=body.id, message=f"Body '{body.id}': inertia.{axis_name} must be > 0")
                )

    # ---- joints: dedup by id (first occurrence wins) before any graph logic,
    # so a duplicate-id fixture can never cascade into unrelated graph rules.
    joint_by_id: dict = {}
    for joint in robot.joints:
        if joint.id in joint_by_id:
            issues.append(Issue("joint-duplicate-id", element_kind="joint", element_id=joint.id, message=f"Duplicate joint id '{joint.id}'"))
        else:
            joint_by_id[joint.id] = joint

    for joint in joint_by_id.values():
        if joint.parent not in body_by_id:
            issues.append(
                Issue(
                    "joint-unknown-parent-body",
                    element_kind="joint",
                    element_id=joint.id,
                    message=f"Joint '{joint.id}': parent body '{joint.parent}' does not exist",
                )
            )
        if joint.child not in body_by_id:
            issues.append(
                Issue(
                    "joint-unknown-child-body",
                    element_kind="joint",
                    element_id=joint.id,
                    message=f"Joint '{joint.id}': child body '{joint.child}' does not exist",
                )
            )
        if joint.parent == joint.child:
            issues.append(
                Issue("joint-self-loop", element_kind="joint", element_id=joint.id, message=f"Joint '{joint.id}' connects '{joint.parent}' to itself")
            )
        if isinstance(joint, (HingeJoint, SliderJoint)):
            if all(abs(v) < _EPSILON for v in joint.axis):
                issues.append(Issue("joint-missing-axis", element_kind="joint", element_id=joint.id, message=f"Joint '{joint.id}': axis must be non-zero"))
            if joint.limits is not None and joint.limits.lower >= joint.limits.upper:
                issues.append(
                    Issue(
                        "joint-invalid-limits",
                        element_kind="joint",
                        element_id=joint.id,
                        message=f"Joint '{joint.id}': limits.lower must be less than limits.upper",
                    )
                )
            if joint.damping is not None and joint.damping < 0:
                issues.append(
                    Issue("joint-invalid-damping-friction", element_kind="joint", element_id=joint.id, message=f"Joint '{joint.id}': damping must be >= 0")
                )
            if joint.friction is not None and joint.friction < 0:
                issues.append(
                    Issue(
                        "joint-invalid-damping-friction", element_kind="joint", element_id=joint.id, message=f"Joint '{joint.id}': friction must be >= 0"
                    )
                )
        elif isinstance(joint, BallJoint) and joint.damping is not None and joint.damping < 0:
            issues.append(
                Issue("joint-invalid-damping-friction", element_kind="joint", element_id=joint.id, message=f"Joint '{joint.id}': damping must be >= 0")
            )

    # ---- graph: a valid tree edge is (parent, child) from a joint whose
    # child resolves to a real body and which is not a self-loop. When more
    # than one joint targets the same child, only the first (declaration
    # order) becomes a tree edge -- the rest are reported (joint-duplicate-child)
    # but excluded, so that situation can never masquerade as an unrelated
    # cycle. A child is marked "has a parent" even when the parent id itself
    # doesn't resolve (joint-unknown-parent-body already reports that) so an
    # invalid parent reference doesn't also manufacture a phantom extra root.
    child_joints: dict = {}
    for joint in joint_by_id.values():
        if joint.parent == joint.child:
            continue
        if joint.child not in body_by_id:
            continue
        child_joints.setdefault(joint.child, []).append(joint)

    parent_of: dict = {}
    for child_id, joints_here in child_joints.items():
        if len(joints_here) > 1:
            names = ", ".join(f"'{j.id}'" for j in joints_here)
            issues.append(
                Issue(
                    "joint-duplicate-child",
                    element_kind="body",
                    element_id=child_id,
                    message=f"Body '{child_id}' is attached by more than one joint ({names})",
                )
            )
        parent_of[child_id] = joints_here[0].parent

    roots = [body_id for body_id in body_by_id if body_id not in parent_of]

    if not roots:
        if body_by_id:
            issues.append(Issue("robot-no-root-body", element_kind="robot", element_id=robot.id, message="Robot cannot simulate: no root body found"))
    else:
        for extra_root in roots[1:]:
            issues.append(
                Issue(
                    "robot-multiple-root-bodies",
                    element_kind="body",
                    element_id=extra_root,
                    message=f"Robot cannot simulate: '{extra_root}' has no parent joint attaching it to the rest of the robot",
                )
            )
        cycle_body = _find_cycle(list(body_by_id.keys()), parent_of)
        if cycle_body is not None:
            issues.append(
                Issue(
                    "robot-cycle", element_kind="body", element_id=cycle_body, message=f"Robot cannot simulate: cycle detected in joints at body '{cycle_body}'"
                )
            )

    # ---- actuators ----
    actuator_ids: set = set()
    for actuator in robot.actuators:
        if actuator.id in actuator_ids:
            issues.append(Issue("actuator-duplicate-id", element_kind="actuator", element_id=actuator.id, message=f"Duplicate actuator id '{actuator.id}'"))
        else:
            actuator_ids.add(actuator.id)

        target = joint_by_id.get(actuator.target_joint)
        if target is None:
            issues.append(
                Issue(
                    "actuator-unknown-target-joint",
                    element_kind="actuator",
                    element_id=actuator.id,
                    message=f"Actuator '{actuator.id}': target joint '{actuator.target_joint}' does not exist",
                )
            )
        elif isinstance(target, FixedJoint):
            issues.append(
                Issue(
                    "actuator-fixed-joint-target",
                    element_kind="actuator",
                    element_id=actuator.id,
                    message=f"Actuator '{actuator.id}': cannot actuate fixed joint '{target.id}'",
                )
            )

        if actuator.limits is not None:
            if actuator.limits.effort is not None and (not math.isfinite(actuator.limits.effort) or actuator.limits.effort <= 0):
                issues.append(
                    Issue(
                        "actuator-invalid-limits", element_kind="actuator", element_id=actuator.id, message=f"Actuator '{actuator.id}': limits.effort must be > 0"
                    )
                )
            if actuator.limits.velocity is not None and (not math.isfinite(actuator.limits.velocity) or actuator.limits.velocity <= 0):
                issues.append(
                    Issue(
                        "actuator-invalid-limits",
                        element_kind="actuator",
                        element_id=actuator.id,
                        message=f"Actuator '{actuator.id}': limits.velocity must be > 0",
                    )
                )

    # ---- sensors ----
    sensor_ids: set = set()
    for sensor in robot.sensors:
        if sensor.id in sensor_ids:
            issues.append(Issue("sensor-duplicate-id", element_kind="sensor", element_id=sensor.id, message=f"Duplicate sensor id '{sensor.id}'"))
        else:
            sensor_ids.add(sensor.id)

        if sensor.body not in body_by_id:
            issues.append(
                Issue("sensor-unknown-body", element_kind="sensor", element_id=sensor.id, message=f"Sensor '{sensor.id}': body '{sensor.body}' does not exist")
            )

        if sensor.type == "encoder" and sensor.joint is None:
            issues.append(
                Issue(
                    "sensor-encoder-missing-joint",
                    element_kind="sensor",
                    element_id=sensor.id,
                    message=f"Sensor '{sensor.id}': encoder sensors must set 'joint'",
                )
            )
        if sensor.joint is not None and sensor.joint not in joint_by_id:
            issues.append(
                Issue("sensor-unknown-joint", element_kind="sensor", element_id=sensor.id, message=f"Sensor '{sensor.id}': joint '{sensor.joint}' does not exist")
            )

    return issues
