#include "built_robot.hpp"

#include "robot_tree.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

#include <mujoco/mujoco.h>

namespace okrobo {

namespace {

constexpr double kModelTimestep = 0.002;              // matches physics_object.cpp
constexpr double kFloorHalfExtent = 25.0;              // meters; generous workbench-scale floor
constexpr double kMeshPlaceholderHalfExtent = 0.03;    // 0.06 full extent, matches robotThree.ts's PLACEHOLDER_SIZE
constexpr double kDefaultPositionGain = 5.0;           // see docs/decisions/robot-builder-physics.md

struct GeomAttrs {
    std::string type;
    std::string size;
};

// Collision geometry size conversion: MJCF box/plane/cylinder/capsule sizes
// are half-extents; robot-def's are full extents, so halved here. Sphere is
// unchanged (radius both sides). cone has no native MJCF geom type --
// approximated as a cylinder of the same radius/length. mesh files are
// never opened in v0 -- a small placeholder box, matching robotThree.ts's
// own mesh-placeholder treatment. (docs/decisions/robot-builder-physics.md)
GeomAttrs MjcfGeomAttrs(const Geometry& geometry) {
    std::ostringstream size;
    switch (geometry.type) {
        case GeometryType::kBox:
            size << geometry.size.x / 2 << " " << geometry.size.y / 2 << " " << geometry.size.z / 2;
            return {"box", size.str()};
        case GeometryType::kSphere:
            size << geometry.radius;
            return {"sphere", size.str()};
        case GeometryType::kCylinder:
            size << geometry.radius << " " << geometry.length / 2;
            return {"cylinder", size.str()};
        case GeometryType::kCapsule:
            size << geometry.radius << " " << geometry.length / 2;
            return {"capsule", size.str()};
        case GeometryType::kCone:
            size << geometry.radius << " " << geometry.length / 2;
            return {"cylinder", size.str()};
        case GeometryType::kPlane:
            size << geometry.size.x / 2 << " " << geometry.size.y / 2 << " 0.1";
            return {"plane", size.str()};
        case GeometryType::kMesh:
            size << kMeshPlaceholderHalfExtent << " " << kMeshPlaceholderHalfExtent << " " << kMeshPlaceholderHalfExtent;
            return {"box", size.str()};
    }
    throw std::runtime_error("built_robot: unknown geometry type");
}

std::string MjcfPosEuler(const Transform& transform) {
    std::ostringstream out;
    out << "pos=\"" << transform.position.x << " " << transform.position.y << " " << transform.position.z
        << "\" euler=\"" << transform.rotation_rpy.x << " " << transform.rotation_rpy.y << " "
        << transform.rotation_rpy.z << "\"";
    return out.str();
}

void AppendInertial(std::ostringstream& xml, const Body& body) {
    xml << "<inertial " << MjcfPosEuler(body.transform) << " mass=\"" << body.mass << "\" diaginertia=\""
        << body.inertia.ixx << " " << body.inertia.iyy << " " << body.inertia.izz << "\"/>";
}

// Collision geometry preferred over visual; omitted entirely (mass-only
// body) if neither is set.
void AppendGeom(std::ostringstream& xml, const Body& body) {
    const Geometry* geometry = nullptr;
    if (body.has_collision) {
        geometry = &body.collision;
    } else if (body.has_visual) {
        geometry = &body.visual;
    }
    if (!geometry) return;
    const GeomAttrs attrs = MjcfGeomAttrs(*geometry);
    xml << "<geom type=\"" << attrs.type << "\" size=\"" << attrs.size << "\" " << MjcfPosEuler(body.transform)
        << "/>";
}

std::string MjcfJointType(JointType type) {
    switch (type) {
        case JointType::kHinge:
            return "hinge";
        case JointType::kSlider:
            return "slide";
        case JointType::kBall:
            return "ball";
        case JointType::kFree:
            return "free";
        case JointType::kFixed:
            break;  // caller never emits a <joint> element for fixed
    }
    throw std::runtime_error("built_robot: unexpected joint type for MJCF <joint>");
}

// Every non-fixed, non-root joint becomes a named <joint> element (named so
// an <actuator> can reference it by joint="..."). fixed emits nothing: a
// body with no <joint> child is rigidly welded to its parent by default.
void AppendJoint(std::ostringstream& xml, const Joint& joint) {
    if (joint.type == JointType::kFixed) return;
    xml << "<joint name=\"" << joint.id << "\" type=\"" << MjcfJointType(joint.type) << "\"";
    if (joint.type == JointType::kHinge || joint.type == JointType::kSlider) {
        xml << " axis=\"" << joint.axis.x << " " << joint.axis.y << " " << joint.axis.z << "\"";
        if (joint.has_limits) {
            xml << " limited=\"true\" range=\"" << joint.limits.lower << " " << joint.limits.upper << "\"";
        }
        if (joint.has_damping) xml << " damping=\"" << joint.damping << "\"";
        if (joint.has_friction) xml << " frictionloss=\"" << joint.friction << "\"";
    } else if (joint.type == JointType::kBall && joint.has_damping) {
        xml << " damping=\"" << joint.damping << "\"";
    }
    xml << "/>";
}

}  // namespace

std::string GenerateMjcf(const RobotDef& robot) {
    const KinematicTree tree = BuildKinematicTree(robot);
    std::unordered_map<std::string, const Body*> body_by_id;
    for (const auto& body : robot.bodies) {
        if (!body_by_id.count(body.id)) body_by_id[body.id] = &body;
    }
    std::unordered_map<std::string, const Joint*> joint_by_id;
    for (const auto& joint : robot.joints) {
        if (!joint_by_id.count(joint.id)) joint_by_id[joint.id] = &joint;
    }

    std::ostringstream xml;
    xml << "<mujoco model=\"" << robot.id << "\">"
        << "<compiler angle=\"radian\" eulerseq=\"XYZ\"/>"
        << "<option timestep=\"" << kModelTimestep << "\" gravity=\"0 0 -9.81\"/>"
        << "<worldbody>"
        << "<geom name=\"floor\" type=\"plane\" size=\"" << kFloorHalfExtent << " " << kFloorHalfExtent << " 0.1\"/>";

    // Recursive lambda (std::function for self-reference; C++20 has no
    // deducing-this) walking the kinematic tree. Every declared root --
    // including a defensive fallback for unreachable_ids, which
    // BuilderPanel's errorCount===0 gate should keep empty in practice,
    // since any unreachable body implies a robot-cycle or
    // joint-unknown-parent-body validation error -- gets a <freejoint/> and
    // robot.root_placement as its origin (matching robotThree.ts's own
    // "multiple roots share the same wrapper origin" behavior).
    std::function<void(const std::string&, bool)> append_body = [&](const std::string& body_id, bool is_root) {
        const Body& body = *body_by_id.at(body_id);
        const Transform& origin = is_root ? robot.root_placement : tree.parent_joint_of.at(body_id)->origin;

        xml << "<body name=\"" << body.id << "\" " << MjcfPosEuler(origin) << ">";
        if (is_root) {
            xml << "<freejoint/>";
        } else {
            AppendJoint(xml, *tree.parent_joint_of.at(body_id));
        }
        AppendInertial(xml, body);
        AppendGeom(xml, body);

        const auto it = tree.children_of.find(body_id);
        if (it != tree.children_of.end()) {
            for (const auto& child_id : it->second) append_body(child_id, false);
        }
        xml << "</body>";
    };

    for (const auto& root_id : tree.root_ids) append_body(root_id, true);
    for (const auto& orphan_id : tree.unreachable_ids) append_body(orphan_id, true);

    xml << "</worldbody>";

    // Actuators: motor|force|torque -> <motor>, servo -> <position> (target
    // range from the joint's own limits, not the actuator's), velocity ->
    // <velocity> (MuJoCo's default kv, no schema field to source one from).
    // Silently skipped when the target joint doesn't resolve to a scalar
    // hinge/slide DOF (docs/decisions/robot-builder-physics.md).
    std::ostringstream actuators;
    bool any_actuator = false;
    for (const auto& actuator : robot.actuators) {
        const auto joint_it = joint_by_id.find(actuator.target_joint);
        if (joint_it == joint_by_id.end()) continue;
        const Joint& joint = *joint_it->second;
        if (joint.type != JointType::kHinge && joint.type != JointType::kSlider) continue;
        any_actuator = true;

        if (actuator.type == "servo") {
            actuators << "<position name=\"" << actuator.id << "\" joint=\"" << joint.id << "\" kp=\""
                       << kDefaultPositionGain << "\"";
            if (joint.has_limits) {
                actuators << " ctrllimited=\"true\" ctrlrange=\"" << joint.limits.lower << " " << joint.limits.upper
                           << "\"";
            }
            actuators << "/>";
        } else if (actuator.type == "velocity") {
            actuators << "<velocity name=\"" << actuator.id << "\" joint=\"" << joint.id << "\"";
            if (actuator.has_limits && actuator.limits.has_velocity) {
                actuators << " ctrllimited=\"true\" ctrlrange=\"-" << actuator.limits.velocity << " "
                           << actuator.limits.velocity << "\"";
            }
            actuators << "/>";
        } else {  // motor | force | torque
            actuators << "<motor name=\"" << actuator.id << "\" joint=\"" << joint.id << "\"";
            if (actuator.has_limits && actuator.limits.has_effort) {
                actuators << " ctrllimited=\"true\" ctrlrange=\"-" << actuator.limits.effort << " "
                           << actuator.limits.effort << "\"";
            }
            actuators << "/>";
        }
    }
    if (any_actuator) xml << "<actuator>" << actuators.str() << "</actuator>";

    xml << "</mujoco>";
    return xml.str();
}

struct BuiltRobot::Impl {
    mjSpec* spec = nullptr;
    mjModel* model = nullptr;
    mjData* data = nullptr;
    std::vector<int> body_mjids;      // robot.bodies[i] -> mjModel body id, or -1
    std::vector<int> actuator_mjids;  // robot.actuators[i] -> mjModel actuator id, or -1

    ~Impl() {
        if (data) mj_deleteData(data);
        if (model) mj_deleteModel(model);
        if (spec) mj_deleteSpec(spec);
    }
};

BuiltRobot::BuiltRobot(const RobotDef& robot) {
    const std::string xml = GenerateMjcf(robot);
    char error[1024] = {0};
    mjSpec* spec = mj_parseXMLString(xml.c_str(), nullptr, error, sizeof(error));
    if (!spec) {
        throw std::runtime_error(std::string("built robot model failed to parse: ") + error);
    }
    mjModel* model = mj_compile(spec, nullptr);
    if (!model) {
        const std::string message = std::string("built robot model failed to compile: ") + mjs_getError(spec);
        mj_deleteSpec(spec);
        throw std::runtime_error(message);
    }
    mjData* data = mj_makeData(model);
    mj_forward(model, data);

    // Only allocate impl_ once every MuJoCo call above has succeeded, so a
    // throw never leaves a partially-built Impl for ~BuiltRobot to clean up
    // (it never runs for a constructor that throws) or leaks spec/model.
    impl_ = new Impl;
    impl_->spec = spec;
    impl_->model = model;
    impl_->data = data;

    impl_->body_mjids.reserve(robot.bodies.size());
    for (const auto& body : robot.bodies) {
        impl_->body_mjids.push_back(mj_name2id(impl_->model, mjOBJ_BODY, body.id.c_str()));
    }
    impl_->actuator_mjids.reserve(robot.actuators.size());
    for (const auto& actuator : robot.actuators) {
        impl_->actuator_mjids.push_back(mj_name2id(impl_->model, mjOBJ_ACTUATOR, actuator.id.c_str()));
    }
}

BuiltRobot::~BuiltRobot() { delete impl_; }

void BuiltRobot::step(double dt) {
    if (dt <= 0.0) return;
    const int steps = std::max(1, static_cast<int>(std::lround(dt / kModelTimestep)));
    for (int i = 0; i < steps; ++i) {
        mj_step(impl_->model, impl_->data);
    }
}

int BuiltRobot::body_count() const { return static_cast<int>(impl_->body_mjids.size()); }

BuiltBodyPose BuiltRobot::body_pose(int index) const {
    if (index < 0 || index >= static_cast<int>(impl_->body_mjids.size())) return {};
    const int mjid = impl_->body_mjids[static_cast<size_t>(index)];
    if (mjid < 0) return {};
    const mjData* d = impl_->data;
    BuiltBodyPose pose;
    pose.x = d->xpos[3 * mjid + 0];
    pose.y = d->xpos[3 * mjid + 1];
    pose.z = d->xpos[3 * mjid + 2];
    pose.qw = d->xquat[4 * mjid + 0];
    pose.qx = d->xquat[4 * mjid + 1];
    pose.qy = d->xquat[4 * mjid + 2];
    pose.qz = d->xquat[4 * mjid + 3];
    return pose;
}

int BuiltRobot::actuator_count() const { return static_cast<int>(impl_->actuator_mjids.size()); }

bool BuiltRobot::set_actuator_ctrl(int index, double value) {
    if (index < 0 || index >= static_cast<int>(impl_->actuator_mjids.size())) return false;
    const int mjid = impl_->actuator_mjids[static_cast<size_t>(index)];
    if (mjid < 0) return false;
    const mjModel* m = impl_->model;
    double clamped = value;
    if (m->actuator_ctrllimited[mjid]) {
        clamped = std::clamp(value, m->actuator_ctrlrange[2 * mjid], m->actuator_ctrlrange[2 * mjid + 1]);
    }
    impl_->data->ctrl[mjid] = clamped;
    return true;
}

}  // namespace okrobo
