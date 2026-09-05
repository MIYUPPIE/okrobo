#pragma once

// Robot Builder Phase 1: contracts/robot-def/v1 (v1 adds cad_mesh geometry
// for the CAD Kernel initiative -- see
// docs/decisions/cad-kernel-foundation.md). Structural parse + semantic
// validation only -- no simulation behavior. Reference spec:
// runtime/python/okrobo/robot_def.py. No nlohmann type appears in this
// header; only robot_def.cpp includes <nlohmann/json.hpp> (see
// docs/decisions/robot-definition-schema.md for why it's vendored and how
// it's scoped).
//
// Units: meters, kilograms, radians, seconds. Rotation is roll-pitch-yaw
// (intrinsic XYZ Euler, radians). The kinematic tree is defined entirely by
// Joint::parent/child edges, not a Body::parent field -- mirrors URDF and
// this repo's own apps/studio/src/packs/urdf.ts idiom: a body with no
// incoming joint edge is a root, and rigid attachment is a `fixed` joint,
// not a second hierarchy mechanism.
//
// Flat aggregate structs (one struct per geometry/joint kind, unused fields
// left at their zero value) rather than std::variant, matching this
// codebase's existing style (Obstacle, WorldConfig in world.hpp).
// Defaulted operator== (C++20) gives free deep structural equality, used by
// the round-trip test.

#include <cstdint>
#include <string>
#include <vector>

namespace okrobo {

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    bool operator==(const Vec3&) const = default;
};

struct Transform {
    Vec3 position{};
    Vec3 rotation_rpy{};

    bool operator==(const Transform&) const = default;
};

enum class GeometryType { kBox, kSphere, kCylinder, kCapsule, kCone, kPlane, kMesh, kCadMesh };

struct Geometry {
    GeometryType type = GeometryType::kBox;
    Vec3 size{};                // box (x,y,z); plane (x,y; z unused)
    double radius = 0.0;        // sphere, cylinder, capsule, cone
    double length = 0.0;        // cylinder, capsule, cone
    std::string path;           // mesh; never opened in v0
    Vec3 scale{1.0, 1.0, 1.0};  // mesh
    // cad_mesh (Robot Builder CAD Kernel Phase 1): a baked, frozen mesh
    // authored by the CAD kernel pipeline -- flat vertex/face arrays, in
    // this body's own frame. No live feature tree yet; see
    // docs/decisions/cad-kernel-foundation.md.
    std::vector<double> vertices;  // flat (x0,y0,z0, x1,y1,z1, ...), meters
    std::vector<int32_t> faces;    // flat triangulated vertex-index triples

    bool operator==(const Geometry&) const = default;
};

struct Inertia {
    double ixx = 0.0;
    double iyy = 0.0;
    double izz = 0.0;

    bool operator==(const Inertia&) const = default;
};

struct Material {
    bool has_color = false;
    std::vector<double> color;  // 3 (rgb) or 4 (rgba) entries, 0..1, when has_color

    bool operator==(const Material&) const = default;
};

struct Body {
    std::string id;
    std::string name;
    Transform transform{};
    bool has_visual = false;
    Geometry visual{};
    bool has_collision = false;
    Geometry collision{};
    double mass = 0.0;
    Inertia inertia{};
    Material material{};

    bool operator==(const Body&) const = default;
};

enum class JointType { kFixed, kHinge, kSlider, kBall, kFree };

struct Limits {
    double lower = 0.0;
    double upper = 0.0;

    bool operator==(const Limits&) const = default;
};

struct Joint {
    std::string id;
    std::string name;
    JointType type = JointType::kFixed;
    std::string parent;
    std::string child;
    Transform origin{};
    Vec3 axis{};                // hinge, slider
    bool has_limits = false;    // hinge, slider
    Limits limits{};
    bool has_damping = false;   // hinge, slider, ball
    double damping = 0.0;
    bool has_friction = false;  // hinge, slider
    double friction = 0.0;

    bool operator==(const Joint&) const = default;
};

struct ActuatorLimits {
    bool has_effort = false;
    double effort = 0.0;
    bool has_velocity = false;
    double velocity = 0.0;

    bool operator==(const ActuatorLimits&) const = default;
};

struct Actuator {
    std::string id;
    std::string name;
    std::string type;  // motor | servo | force | torque | velocity
    std::string target_joint;
    bool has_limits = false;
    ActuatorLimits limits{};

    bool operator==(const Actuator&) const = default;
};

struct Sensor {
    std::string id;
    std::string name;
    std::string type;  // camera | distance | lidar | imu | encoder | gps | touch | force_torque
    std::string body;
    bool has_joint = false;
    std::string joint;
    Transform transform{};
    // Canonicalized JSON text of the type-specific `params` object ("" when
    // absent). Kept opaque (not parsed into fields) so this header never
    // needs a JSON type -- the schema itself only guarantees the envelope
    // (see contracts/robot-def/v0/schema.json's `sensor.params`).
    std::string params_json;

    bool operator==(const Sensor&) const = default;
};

struct RobotDef {
    std::string id;
    std::string name;
    std::string description;
    Transform root_placement{};
    std::vector<Body> bodies;
    std::vector<Joint> joints;
    std::vector<Actuator> actuators;
    std::vector<Sensor> sensors;

    bool operator==(const RobotDef&) const = default;
};

struct ValidationIssue {
    std::string rule;
    std::string severity = "error";
    std::string element_kind;
    std::string element_id;
    std::string message;
};

/// Parses a robot-def v0 JSON document. Throws std::runtime_error on
/// malformed shape (missing required fields, wrong types) -- never on
/// semantic issues, which are ValidateRobotDef's job.
RobotDef ParseRobotDef(const std::string& json);

/// Canonical JSON serialization of a RobotDef, for round-tripping
/// (ParseRobotDef(RobotDefToJson(robot)) == robot).
std::string RobotDefToJson(const RobotDef& robot);

/// Never throws. Always returns a (possibly empty) list of issues.
std::vector<ValidationIssue> ValidateRobotDef(const RobotDef& robot);

}  // namespace okrobo
