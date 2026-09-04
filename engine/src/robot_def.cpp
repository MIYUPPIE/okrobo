#include "robot_def.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace okrobo {

namespace {

using nlohmann::json;

constexpr double kEpsilon = 1e-12;

// ---- parsing helpers ----

Vec3 ParseVec3(const json& value, const std::string& context) {
    if (!value.is_array() || value.size() != 3) {
        throw std::runtime_error("robot-def: " + context + " must be three numbers");
    }
    return Vec3{value[0].get<double>(), value[1].get<double>(), value[2].get<double>()};
}

Transform ParseTransform(const json& data) {
    Transform t{};
    if (data.is_null()) return t;
    if (data.contains("position")) t.position = ParseVec3(data.at("position"), "transform.position");
    if (data.contains("rotation_rpy")) t.rotation_rpy = ParseVec3(data.at("rotation_rpy"), "transform.rotation_rpy");
    return t;
}

Geometry ParseGeometry(const json& data) {
    Geometry g{};
    const std::string type = data.at("type").get<std::string>();
    if (type == "box") {
        g.type = GeometryType::kBox;
        g.size = ParseVec3(data.at("size"), "geometry.size");
    } else if (type == "sphere") {
        g.type = GeometryType::kSphere;
        g.radius = data.at("radius").get<double>();
    } else if (type == "cylinder" || type == "capsule" || type == "cone") {
        g.type = type == "cylinder" ? GeometryType::kCylinder : (type == "capsule" ? GeometryType::kCapsule : GeometryType::kCone);
        g.radius = data.at("radius").get<double>();
        g.length = data.at("length").get<double>();
    } else if (type == "plane") {
        g.type = GeometryType::kPlane;
        const auto& size = data.at("size");
        if (!size.is_array() || size.size() != 2) throw std::runtime_error("robot-def: plane geometry needs a two-number size");
        g.size = Vec3{size[0].get<double>(), size[1].get<double>(), 0.0};
    } else if (type == "mesh") {
        g.type = GeometryType::kMesh;
        g.path = data.at("path").get<std::string>();
        g.scale = data.contains("scale") ? ParseVec3(data.at("scale"), "geometry.scale") : Vec3{1.0, 1.0, 1.0};
    } else {
        throw std::runtime_error("robot-def: unknown geometry type '" + type + "'");
    }
    return g;
}

Body ParseBody(const json& data) {
    Body b{};
    b.id = data.at("id").get<std::string>();
    b.name = data.at("name").get<std::string>();
    b.transform = data.contains("transform") ? ParseTransform(data.at("transform")) : Transform{};
    if (data.contains("visual")) {
        b.has_visual = true;
        b.visual = ParseGeometry(data.at("visual"));
    }
    if (data.contains("collision")) {
        b.has_collision = true;
        b.collision = ParseGeometry(data.at("collision"));
    }
    b.mass = data.at("mass").get<double>();
    const auto& inertia = data.at("inertia");
    b.inertia = Inertia{inertia.at("ixx").get<double>(), inertia.at("iyy").get<double>(), inertia.at("izz").get<double>()};
    if (data.contains("material") && data.at("material").contains("color")) {
        b.material.has_color = true;
        for (const auto& c : data.at("material").at("color")) b.material.color.push_back(c.get<double>());
    }
    return b;
}

Joint ParseJoint(const json& data) {
    Joint j{};
    j.id = data.at("id").get<std::string>();
    j.name = data.at("name").get<std::string>();
    j.parent = data.at("parent").get<std::string>();
    j.child = data.at("child").get<std::string>();
    j.origin = data.contains("origin") ? ParseTransform(data.at("origin")) : Transform{};

    const std::string type = data.at("type").get<std::string>();
    if (type == "fixed") {
        j.type = JointType::kFixed;
    } else if (type == "hinge" || type == "slider") {
        j.type = type == "hinge" ? JointType::kHinge : JointType::kSlider;
        j.axis = ParseVec3(data.at("axis"), "joint.axis");
        if (data.contains("limits")) {
            j.has_limits = true;
            j.limits = Limits{data.at("limits").at("lower").get<double>(), data.at("limits").at("upper").get<double>()};
        }
        if (data.contains("damping")) {
            j.has_damping = true;
            j.damping = data.at("damping").get<double>();
        }
        if (data.contains("friction")) {
            j.has_friction = true;
            j.friction = data.at("friction").get<double>();
        }
    } else if (type == "ball") {
        j.type = JointType::kBall;
        if (data.contains("damping")) {
            j.has_damping = true;
            j.damping = data.at("damping").get<double>();
        }
    } else if (type == "free") {
        j.type = JointType::kFree;
    } else {
        throw std::runtime_error("robot-def: unknown joint type '" + type + "'");
    }
    return j;
}

Actuator ParseActuator(const json& data) {
    Actuator a{};
    a.id = data.at("id").get<std::string>();
    a.name = data.at("name").get<std::string>();
    a.type = data.at("type").get<std::string>();
    a.target_joint = data.at("target_joint").get<std::string>();
    if (data.contains("limits")) {
        a.has_limits = true;
        const auto& limits = data.at("limits");
        if (limits.contains("effort")) {
            a.limits.has_effort = true;
            a.limits.effort = limits.at("effort").get<double>();
        }
        if (limits.contains("velocity")) {
            a.limits.has_velocity = true;
            a.limits.velocity = limits.at("velocity").get<double>();
        }
    }
    return a;
}

Sensor ParseSensor(const json& data) {
    Sensor s{};
    s.id = data.at("id").get<std::string>();
    s.name = data.at("name").get<std::string>();
    s.type = data.at("type").get<std::string>();
    s.body = data.at("body").get<std::string>();
    if (data.contains("joint")) {
        s.has_joint = true;
        s.joint = data.at("joint").get<std::string>();
    }
    s.transform = data.contains("transform") ? ParseTransform(data.at("transform")) : Transform{};
    if (data.contains("params")) s.params_json = data.at("params").dump();
    return s;
}

// ---- serialization helpers ----

json TransformToJson(const Transform& t) {
    return json{{"position", {t.position.x, t.position.y, t.position.z}}, {"rotation_rpy", {t.rotation_rpy.x, t.rotation_rpy.y, t.rotation_rpy.z}}};
}

json GeometryToJson(const Geometry& g) {
    switch (g.type) {
        case GeometryType::kBox:
            return json{{"type", "box"}, {"size", {g.size.x, g.size.y, g.size.z}}};
        case GeometryType::kSphere:
            return json{{"type", "sphere"}, {"radius", g.radius}};
        case GeometryType::kCylinder:
            return json{{"type", "cylinder"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kCapsule:
            return json{{"type", "capsule"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kCone:
            return json{{"type", "cone"}, {"radius", g.radius}, {"length", g.length}};
        case GeometryType::kPlane:
            return json{{"type", "plane"}, {"size", {g.size.x, g.size.y}}};
        case GeometryType::kMesh:
            return json{{"type", "mesh"}, {"path", g.path}, {"scale", {g.scale.x, g.scale.y, g.scale.z}}};
    }
    throw std::runtime_error("robot-def: unknown geometry type");
}

json BodyToJson(const Body& b) {
    json out{{"id", b.id},
             {"name", b.name},
             {"transform", TransformToJson(b.transform)},
             {"mass", b.mass},
             {"inertia", {{"ixx", b.inertia.ixx}, {"iyy", b.inertia.iyy}, {"izz", b.inertia.izz}}}};
    if (b.has_visual) out["visual"] = GeometryToJson(b.visual);
    if (b.has_collision) out["collision"] = GeometryToJson(b.collision);
    if (b.material.has_color) out["material"] = json{{"color", b.material.color}};
    return out;
}

std::string JointTypeName(JointType type) {
    switch (type) {
        case JointType::kFixed:
            return "fixed";
        case JointType::kHinge:
            return "hinge";
        case JointType::kSlider:
            return "slider";
        case JointType::kBall:
            return "ball";
        case JointType::kFree:
            return "free";
    }
    throw std::runtime_error("robot-def: unknown joint type");
}

json JointToJson(const Joint& j) {
    json out{{"id", j.id}, {"name", j.name}, {"type", JointTypeName(j.type)}, {"parent", j.parent}, {"child", j.child}, {"origin", TransformToJson(j.origin)}};
    if (j.type == JointType::kHinge || j.type == JointType::kSlider) {
        out["axis"] = {j.axis.x, j.axis.y, j.axis.z};
        if (j.has_limits) out["limits"] = json{{"lower", j.limits.lower}, {"upper", j.limits.upper}};
        if (j.has_damping) out["damping"] = j.damping;
        if (j.has_friction) out["friction"] = j.friction;
    } else if (j.type == JointType::kBall && j.has_damping) {
        out["damping"] = j.damping;
    }
    return out;
}

json ActuatorToJson(const Actuator& a) {
    json out{{"id", a.id}, {"name", a.name}, {"type", a.type}, {"target_joint", a.target_joint}};
    if (a.has_limits) {
        json limits = json::object();
        if (a.limits.has_effort) limits["effort"] = a.limits.effort;
        if (a.limits.has_velocity) limits["velocity"] = a.limits.velocity;
        if (!limits.empty()) out["limits"] = limits;
    }
    return out;
}

json SensorToJson(const Sensor& s) {
    json out{{"id", s.id}, {"name", s.name}, {"type", s.type}, {"body", s.body}, {"transform", TransformToJson(s.transform)}};
    if (s.has_joint) out["joint"] = s.joint;
    if (!s.params_json.empty()) out["params"] = json::parse(s.params_json);
    return out;
}

// ---- validation helpers ----

bool GeometryIsValid(const Geometry& g) {
    switch (g.type) {
        case GeometryType::kBox:
            return g.size.x > 0 && g.size.y > 0 && g.size.z > 0;
        case GeometryType::kPlane:
            return g.size.x > 0 && g.size.y > 0;
        case GeometryType::kSphere:
            return g.radius > 0;
        case GeometryType::kCylinder:
        case GeometryType::kCapsule:
        case GeometryType::kCone:
            return g.radius > 0 && g.length > 0;
        case GeometryType::kMesh:
            return !g.path.empty();
    }
    return true;
}

/// Follows parent_of chains (deduped: at most one parent per child) from
/// every body, in `body_ids` order. A walk that revisits a node still in its
/// own current path is a cycle; `resolved` memoizes bodies already proven
/// acyclic. Mirrors runtime/python/okrobo/robot_def.py's _find_cycle.
std::optional<std::string> FindCycle(const std::vector<std::string>& body_ids, const std::unordered_map<std::string, std::string>& parent_of) {
    std::unordered_set<std::string> resolved;
    for (const auto& start : body_ids) {
        if (resolved.count(start)) continue;
        std::vector<std::string> path;
        std::optional<std::string> current = start;
        while (current.has_value() && !resolved.count(*current)) {
            if (std::find(path.begin(), path.end(), *current) != path.end()) return *current;
            path.push_back(*current);
            auto it = parent_of.find(*current);
            current = (it != parent_of.end()) ? std::optional<std::string>(it->second) : std::nullopt;
        }
        for (const auto& id : path) resolved.insert(id);
    }
    return std::nullopt;
}

}  // namespace

RobotDef ParseRobotDef(const std::string& text) {
    json data;
    try {
        data = json::parse(text);
    } catch (const json::parse_error& e) {
        throw std::runtime_error(std::string("robot-def: invalid JSON: ") + e.what());
    }
    if (!data.contains("id") || !data.contains("name") || !data.contains("bodies")) {
        throw std::runtime_error("robot-def: missing required field 'id', 'name', or 'bodies'");
    }

    RobotDef robot{};
    robot.id = data.at("id").get<std::string>();
    robot.name = data.at("name").get<std::string>();
    robot.description = data.value("description", std::string{});
    robot.root_placement = data.contains("root_placement") ? ParseTransform(data.at("root_placement")) : Transform{};
    for (const auto& b : data.at("bodies")) robot.bodies.push_back(ParseBody(b));
    if (data.contains("joints")) {
        for (const auto& j : data.at("joints")) robot.joints.push_back(ParseJoint(j));
    }
    if (data.contains("actuators")) {
        for (const auto& a : data.at("actuators")) robot.actuators.push_back(ParseActuator(a));
    }
    if (data.contains("sensors")) {
        for (const auto& s : data.at("sensors")) robot.sensors.push_back(ParseSensor(s));
    }
    return robot;
}

std::string RobotDefToJson(const RobotDef& robot) {
    json out{{"id", robot.id}, {"name", robot.name}, {"description", robot.description}, {"root_placement", TransformToJson(robot.root_placement)}};
    json bodies = json::array();
    for (const auto& b : robot.bodies) bodies.push_back(BodyToJson(b));
    out["bodies"] = bodies;
    json joints = json::array();
    for (const auto& j : robot.joints) joints.push_back(JointToJson(j));
    out["joints"] = joints;
    json actuators = json::array();
    for (const auto& a : robot.actuators) actuators.push_back(ActuatorToJson(a));
    out["actuators"] = actuators;
    json sensors = json::array();
    for (const auto& s : robot.sensors) sensors.push_back(SensorToJson(s));
    out["sensors"] = sensors;
    return out.dump();
}

std::vector<ValidationIssue> ValidateRobotDef(const RobotDef& robot) {
    std::vector<ValidationIssue> issues;

    // ---- bodies ----
    std::unordered_map<std::string, const Body*> body_by_id;
    std::vector<std::string> body_order;  // first-occurrence order

    for (const auto& body : robot.bodies) {
        if (body_by_id.count(body.id)) {
            issues.push_back(ValidationIssue{"body-duplicate-id", "error", "body", body.id, "Duplicate body id '" + body.id + "'"});
        } else {
            body_by_id[body.id] = &body;
            body_order.push_back(body.id);
        }

        if (body.has_visual && !GeometryIsValid(body.visual)) {
            issues.push_back(ValidationIssue{"body-invalid-geometry", "error", "body", body.id, "Body '" + body.id + "': geometry size must be positive"});
        }
        if (body.has_collision && !GeometryIsValid(body.collision)) {
            issues.push_back(ValidationIssue{"body-invalid-geometry", "error", "body", body.id, "Body '" + body.id + "': geometry size must be positive"});
        }
        if (!std::isfinite(body.mass) || body.mass <= 0) {
            issues.push_back(ValidationIssue{"body-invalid-mass", "error", "body", body.id, "Body '" + body.id + "' has no valid mass"});
        }
        for (const auto& [axis_name, value] :
             std::vector<std::pair<std::string, double>>{{"ixx", body.inertia.ixx}, {"iyy", body.inertia.iyy}, {"izz", body.inertia.izz}}) {
            if (!std::isfinite(value) || value <= 0) {
                issues.push_back(ValidationIssue{"body-invalid-inertia", "error", "body", body.id, "Body '" + body.id + "': inertia." + axis_name + " must be > 0"});
            }
        }
    }

    // ---- joints: dedup by id (first occurrence wins) before any graph logic ----
    std::unordered_map<std::string, const Joint*> joint_by_id;
    std::vector<std::string> joint_order;
    for (const auto& joint : robot.joints) {
        if (joint_by_id.count(joint.id)) {
            issues.push_back(ValidationIssue{"joint-duplicate-id", "error", "joint", joint.id, "Duplicate joint id '" + joint.id + "'"});
        } else {
            joint_by_id[joint.id] = &joint;
            joint_order.push_back(joint.id);
        }
    }

    for (const auto& joint_id : joint_order) {
        const Joint& joint = *joint_by_id.at(joint_id);
        if (!body_by_id.count(joint.parent)) {
            issues.push_back(
                ValidationIssue{"joint-unknown-parent-body", "error", "joint", joint.id, "Joint '" + joint.id + "': parent body '" + joint.parent + "' does not exist"});
        }
        if (!body_by_id.count(joint.child)) {
            issues.push_back(
                ValidationIssue{"joint-unknown-child-body", "error", "joint", joint.id, "Joint '" + joint.id + "': child body '" + joint.child + "' does not exist"});
        }
        if (joint.parent == joint.child) {
            issues.push_back(ValidationIssue{"joint-self-loop", "error", "joint", joint.id, "Joint '" + joint.id + "' connects '" + joint.parent + "' to itself"});
        }
        if (joint.type == JointType::kHinge || joint.type == JointType::kSlider) {
            const bool axis_zero = std::abs(joint.axis.x) < kEpsilon && std::abs(joint.axis.y) < kEpsilon && std::abs(joint.axis.z) < kEpsilon;
            if (axis_zero) {
                issues.push_back(ValidationIssue{"joint-missing-axis", "error", "joint", joint.id, "Joint '" + joint.id + "': axis must be non-zero"});
            }
            if (joint.has_limits && joint.limits.lower >= joint.limits.upper) {
                issues.push_back(ValidationIssue{"joint-invalid-limits", "error", "joint", joint.id, "Joint '" + joint.id + "': limits.lower must be less than limits.upper"});
            }
            if (joint.has_damping && joint.damping < 0) {
                issues.push_back(ValidationIssue{"joint-invalid-damping-friction", "error", "joint", joint.id, "Joint '" + joint.id + "': damping must be >= 0"});
            }
            if (joint.has_friction && joint.friction < 0) {
                issues.push_back(ValidationIssue{"joint-invalid-damping-friction", "error", "joint", joint.id, "Joint '" + joint.id + "': friction must be >= 0"});
            }
        } else if (joint.type == JointType::kBall && joint.has_damping && joint.damping < 0) {
            issues.push_back(ValidationIssue{"joint-invalid-damping-friction", "error", "joint", joint.id, "Joint '" + joint.id + "': damping must be >= 0"});
        }
    }

    // ---- graph: a valid tree edge is (parent, child) from a joint whose
    // child resolves to a real body and which is not a self-loop. When more
    // than one joint targets the same child, only the first (declaration
    // order) becomes a tree edge -- the rest are reported (joint-duplicate-child)
    // but excluded, so that situation can never masquerade as an unrelated
    // cycle. A child is marked "has a parent" even when the parent id itself
    // doesn't resolve (joint-unknown-parent-body already reports that) so an
    // invalid parent reference doesn't also manufacture a phantom extra root.
    std::unordered_map<std::string, std::vector<const Joint*>> child_joints;
    std::vector<std::string> child_order;
    for (const auto& joint_id : joint_order) {
        const Joint& joint = *joint_by_id.at(joint_id);
        if (joint.parent == joint.child) continue;
        if (!body_by_id.count(joint.child)) continue;
        if (!child_joints.count(joint.child)) child_order.push_back(joint.child);
        child_joints[joint.child].push_back(&joint);
    }

    std::unordered_map<std::string, std::string> parent_of;
    for (const auto& child_id : child_order) {
        const auto& joints_here = child_joints.at(child_id);
        if (joints_here.size() > 1) {
            std::string names;
            for (size_t i = 0; i < joints_here.size(); ++i) {
                if (i > 0) names += ", ";
                names += "'" + joints_here[i]->id + "'";
            }
            issues.push_back(
                ValidationIssue{"joint-duplicate-child", "error", "body", child_id, "Body '" + child_id + "' is attached by more than one joint (" + names + ")"});
        }
        parent_of[child_id] = joints_here[0]->parent;
    }

    std::vector<std::string> roots;
    for (const auto& body_id : body_order) {
        if (!parent_of.count(body_id)) roots.push_back(body_id);
    }

    if (roots.empty()) {
        if (!body_by_id.empty()) {
            issues.push_back(ValidationIssue{"robot-no-root-body", "error", "robot", robot.id, "Robot cannot simulate: no root body found"});
        }
    } else {
        for (size_t i = 1; i < roots.size(); ++i) {
            const auto& extra_root = roots[i];
            issues.push_back(ValidationIssue{"robot-multiple-root-bodies", "error", "body", extra_root,
                                              "Robot cannot simulate: '" + extra_root + "' has no parent joint attaching it to the rest of the robot"});
        }
        const auto cycle_body = FindCycle(body_order, parent_of);
        if (cycle_body.has_value()) {
            issues.push_back(
                ValidationIssue{"robot-cycle", "error", "body", *cycle_body, "Robot cannot simulate: cycle detected in joints at body '" + *cycle_body + "'"});
        }
    }

    // ---- actuators ----
    std::unordered_set<std::string> actuator_ids;
    for (const auto& actuator : robot.actuators) {
        if (actuator_ids.count(actuator.id)) {
            issues.push_back(ValidationIssue{"actuator-duplicate-id", "error", "actuator", actuator.id, "Duplicate actuator id '" + actuator.id + "'"});
        } else {
            actuator_ids.insert(actuator.id);
        }

        const auto it = joint_by_id.find(actuator.target_joint);
        if (it == joint_by_id.end()) {
            issues.push_back(ValidationIssue{"actuator-unknown-target-joint", "error", "actuator", actuator.id,
                                              "Actuator '" + actuator.id + "': target joint '" + actuator.target_joint + "' does not exist"});
        } else if (it->second->type == JointType::kFixed) {
            issues.push_back(ValidationIssue{"actuator-fixed-joint-target", "error", "actuator", actuator.id,
                                              "Actuator '" + actuator.id + "': cannot actuate fixed joint '" + it->second->id + "'"});
        }

        if (actuator.has_limits) {
            if (actuator.limits.has_effort && (!std::isfinite(actuator.limits.effort) || actuator.limits.effort <= 0)) {
                issues.push_back(
                    ValidationIssue{"actuator-invalid-limits", "error", "actuator", actuator.id, "Actuator '" + actuator.id + "': limits.effort must be > 0"});
            }
            if (actuator.limits.has_velocity && (!std::isfinite(actuator.limits.velocity) || actuator.limits.velocity <= 0)) {
                issues.push_back(
                    ValidationIssue{"actuator-invalid-limits", "error", "actuator", actuator.id, "Actuator '" + actuator.id + "': limits.velocity must be > 0"});
            }
        }
    }

    // ---- sensors ----
    std::unordered_set<std::string> sensor_ids;
    for (const auto& sensor : robot.sensors) {
        if (sensor_ids.count(sensor.id)) {
            issues.push_back(ValidationIssue{"sensor-duplicate-id", "error", "sensor", sensor.id, "Duplicate sensor id '" + sensor.id + "'"});
        } else {
            sensor_ids.insert(sensor.id);
        }

        if (!body_by_id.count(sensor.body)) {
            issues.push_back(ValidationIssue{"sensor-unknown-body", "error", "sensor", sensor.id, "Sensor '" + sensor.id + "': body '" + sensor.body + "' does not exist"});
        }

        if (sensor.type == "encoder" && !sensor.has_joint) {
            issues.push_back(ValidationIssue{"sensor-encoder-missing-joint", "error", "sensor", sensor.id, "Sensor '" + sensor.id + "': encoder sensors must set 'joint'"});
        }
        if (sensor.has_joint && !joint_by_id.count(sensor.joint)) {
            issues.push_back(ValidationIssue{"sensor-unknown-joint", "error", "sensor", sensor.id, "Sensor '" + sensor.id + "': joint '" + sensor.joint + "' does not exist"});
        }
    }

    return issues;
}

}  // namespace okrobo
