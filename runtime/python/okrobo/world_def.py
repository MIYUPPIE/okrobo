"""Reference model for the OKROBO world definition v0 (Robot Builder Phase 5).

This is the executable spec for contracts/world-def/v0 -- the same role
robot_def.py plays for robots. A world-def document is purely structural
data -- a flat list of static placed objects -- with no simulation
behavior of its own. See docs/decisions/robot-builder-world.md.

Unlike a RobotDef, a WorldDef has no kinematic tree: every object is
independently placed and static (no joints, no actuators, no sensors, no
mass). Reuses robot_def.py's own Transform/Geometry/Material dataclasses
and parse/serialize helpers directly rather than redefining an equivalent
shape -- a position/rotation and a primitive shape are the same concepts
for a world object as for a robot body.

validate_world_def never raises: it always returns a (possibly empty) list
of Issue. parse_world_def still raises ValueError on malformed shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .robot_def import (
    BoxGeometry,
    CadMeshGeometry,
    CapsuleGeometry,
    ConeGeometry,
    CylinderGeometry,
    Geometry,
    Issue,
    Material,
    MeshGeometry,
    PlaneGeometry,
    SphereGeometry,
    Transform,
    geometry_to_dict,
    parse_geometry,
    parse_transform,
    transform_to_dict,
)


@dataclass
class WorldObject:
    id: str
    name: str
    transform: Transform = field(default_factory=Transform)
    geometry: Geometry | None = None
    material: Material | None = None


@dataclass
class WorldDef:
    id: str
    name: str
    description: str = ""
    objects: list = field(default_factory=list)  # list[WorldObject]


# ---- parsing ----


def _parse_material(data: dict | None) -> Material | None:
    if data is None:
        return None
    if "color" in data:
        return Material(color=tuple(float(v) for v in data["color"]))
    return Material()


def _parse_world_object(data: dict) -> WorldObject:
    geometry = parse_geometry(data.get("geometry"))
    if geometry is None:
        raise ValueError(f"world-def: object '{data.get('id')}' needs geometry")
    return WorldObject(
        id=str(data["id"]),
        name=str(data["name"]),
        transform=parse_transform(data.get("transform")),
        geometry=geometry,
        material=_parse_material(data.get("material")),
    )


def parse_world_def(data: dict) -> WorldDef:
    """Parse a world-def v0 document. Raises ValueError on malformed shape
    -- never on semantic issues, which are validate_world_def's job."""
    for required in ("id", "name", "objects"):
        if required not in data:
            raise ValueError(f"world-def: missing required field '{required}'")
    return WorldDef(
        id=str(data["id"]),
        name=str(data["name"]),
        description=str(data.get("description", "")),
        objects=[_parse_world_object(o) for o in data["objects"]],
    )


# ---- serialization (round-trip) ----


def _world_object_to_dict(o: WorldObject) -> dict:
    out = {
        "id": o.id,
        "name": o.name,
        "transform": transform_to_dict(o.transform),
        "geometry": geometry_to_dict(o.geometry),
    }
    if o.material is not None and o.material.color is not None:
        out["material"] = {"color": list(o.material.color)}
    return out


def world_def_to_dict(world: WorldDef) -> dict:
    return {
        "id": world.id,
        "name": world.name,
        "description": world.description,
        "objects": [_world_object_to_dict(o) for o in world.objects],
    }


# ---- validation ----


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


def validate_world_def(world: WorldDef) -> list:  # list[Issue]
    """Never raises. Always returns a (possibly empty) list of Issue."""
    issues: list = []
    seen_ids: set = set()

    for obj in world.objects:
        if obj.id in seen_ids:
            issues.append(
                Issue("object-duplicate-id", element_kind="object", element_id=obj.id, message=f"Duplicate object id '{obj.id}'")
            )
        else:
            seen_ids.add(obj.id)

        if obj.geometry is not None and not _geometry_is_valid(obj.geometry):
            issues.append(
                Issue(
                    "object-invalid-geometry",
                    element_kind="object",
                    element_id=obj.id,
                    message=f"Object '{obj.id}': geometry size must be positive",
                )
            )

    return issues
