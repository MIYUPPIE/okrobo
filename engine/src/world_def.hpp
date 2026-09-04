#pragma once

// Robot Builder Phase 5: contracts/world-def/v0. Structural parse + semantic
// validation only -- no simulation behavior in this header. Reference spec:
// runtime/python/okrobo/world_def.py. See
// docs/decisions/robot-builder-world.md.
//
// Reuses robot_def.hpp's own Vec3/Transform/Geometry/GeometryType/Material
// directly rather than redefining an equivalent shape -- a position/
// rotation and a primitive shape are the same concepts for a world object
// as for a robot body. Unlike a RobotDef, a WorldDef has no kinematic tree:
// every object is independently placed and static (no joints, no
// actuators, no sensors, no mass/inertia).
//
// No nlohmann type appears in this header; only world_def.cpp includes
// <nlohmann/json.hpp>, same posture as robot_def.hpp.

#include "robot_def.hpp"

#include <string>
#include <vector>

namespace okrobo {

struct WorldObject {
    std::string id;
    std::string name;
    Transform transform{};
    Geometry geometry{};

    Material material{};

    bool operator==(const WorldObject&) const = default;
};

struct WorldDef {
    std::string id;
    std::string name;
    std::string description;
    std::vector<WorldObject> objects;

    bool operator==(const WorldDef&) const = default;
};

/// Parses a world-def v0 JSON document. Throws std::runtime_error on
/// malformed shape (missing required fields, wrong types, an object with
/// no geometry) -- never on semantic issues, which are ValidateWorldDef's
/// job.
WorldDef ParseWorldDef(const std::string& json);

/// Canonical JSON serialization of a WorldDef, for round-tripping
/// (ParseWorldDef(WorldDefToJson(world)) == world).
std::string WorldDefToJson(const WorldDef& world);

/// Never throws. Always returns a (possibly empty) list of issues. The
/// rule set is short -- no tree, so no root/cycle/duplicate-child class of
/// rule exists here: object-duplicate-id and object-invalid-geometry only.
std::vector<ValidationIssue> ValidateWorldDef(const WorldDef& world);

}  // namespace okrobo
