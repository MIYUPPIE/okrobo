#include "built_robot.hpp"

#include "robot_tree.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>

#include <mujoco/mujoco.h>
#include <nlohmann/json.hpp>

namespace okrobo {

namespace {

constexpr double kModelTimestep = 0.002;              // matches physics_object.cpp
constexpr double kFloorHalfExtent = 25.0;              // meters; generous workbench-scale floor
constexpr double kMeshPlaceholderHalfExtent = 0.03;    // 0.06 full extent, matches robotThree.ts's PLACEHOLDER_SIZE
constexpr double kDefaultPositionGain = 5.0;           // see docs/decisions/robot-builder-physics.md

// Robot Builder Phase 4 (sensors). See docs/decisions/robot-builder-sensors.md.
constexpr int kDefaultLidarRays = 9;          // matches Robot.lidar()'s own default everywhere else in this codebase
constexpr double kDefaultLidarFovDegrees = 180.0;
constexpr int kMaxLidarRays = 64;             // buffer-safety clamp
// meters. Empirically, this is a search-radius hint for mj_multiRay's
// internal culling, not a hard clamp on the returned distance -- a ray
// whose actual hit point is slightly beyond this value can still come back
// with that real (larger) distance rather than -1. Callers should treat
// "close to or somewhat past this value" as "far/no meaningful target",
// not assume every reading is strictly <= this number.
constexpr double kLidarCutoff = 5.0;
constexpr double kPi = 3.14159265358979323846;

struct LidarParams {
    int rays = kDefaultLidarRays;
    double fov_degrees = kDefaultLidarFovDegrees;
};

// Malformed/absent params_json falls back to defaults rather than failing
// the whole robot over one sensor's bad JSON.
LidarParams ParseLidarParams(const std::string& params_json) {
    LidarParams params;
    if (params_json.empty()) return params;
    try {
        const auto json = nlohmann::json::parse(params_json);
        if (json.contains("rays") && json.at("rays").is_number()) {
            params.rays = std::clamp(json.at("rays").get<int>(), 1, kMaxLidarRays);
        }
        if (json.contains("fov_degrees") && json.at("fov_degrees").is_number()) {
            params.fov_degrees = json.at("fov_degrees").get<double>();
        }
    } catch (const nlohmann::json::exception&) {
        // Keep defaults.
    }
    return params;
}

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

// One <site> per sensor mounted on this body, at the sensor's own
// transform -- except `encoder` (attaches via joint="..." directly, no
// site needed) and `camera` (out of scope, see
// docs/decisions/robot-builder-sensors.md).
void AppendSites(std::ostringstream& xml, const std::vector<const Sensor*>& sensors) {
    for (const Sensor* sensor : sensors) {
        if (sensor->type == "encoder" || sensor->type == "camera") continue;
        xml << "<site name=\"" << sensor->id << "_site\" " << MjcfPosEuler(sensor->transform) << "/>";
    }
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
    std::unordered_map<std::string, std::vector<const Sensor*>> sensors_by_body;
    for (const auto& sensor : robot.sensors) sensors_by_body[sensor.body].push_back(&sensor);

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
        const auto sensors_it = sensors_by_body.find(body_id);
        if (sensors_it != sensors_by_body.end()) AppendSites(xml, sensors_it->second);

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

    // Sensors: one/two elements per in-scope type, referencing either
    // joint="..." (encoder) or site="{id}_site" (everything else -- sites
    // emitted above, by AppendSites). encoder is silently skipped when its
    // target joint doesn't resolve to a scalar (hinge/slide) joint, same
    // defensive posture as actuators targeting ball/free joints above.
    // lidar gets a <site> but no <sensor> element here -- computed
    // manually via mj_multiRay at read time (BuiltRobot::Impl). camera
    // gets neither. (docs/decisions/robot-builder-sensors.md)
    std::ostringstream sensors_xml;
    bool any_sensor = false;
    for (const auto& sensor : robot.sensors) {
        if (sensor.type == "encoder") {
            if (!sensor.has_joint) continue;
            const auto joint_it = joint_by_id.find(sensor.joint);
            if (joint_it == joint_by_id.end()) continue;
            const Joint& joint = *joint_it->second;
            if (joint.type != JointType::kHinge && joint.type != JointType::kSlider) continue;
            sensors_xml << "<jointpos name=\"" << sensor.id << "\" joint=\"" << joint.id << "\"/>";
            any_sensor = true;
        } else if (sensor.type == "gps") {
            sensors_xml << "<framepos name=\"" << sensor.id << "\" objtype=\"site\" objname=\"" << sensor.id
                        << "_site\"/>";
            any_sensor = true;
        } else if (sensor.type == "distance") {
            sensors_xml << "<rangefinder name=\"" << sensor.id << "\" site=\"" << sensor.id << "_site\"/>";
            any_sensor = true;
        } else if (sensor.type == "touch") {
            sensors_xml << "<touch name=\"" << sensor.id << "\" site=\"" << sensor.id << "_site\"/>";
            any_sensor = true;
        } else if (sensor.type == "force_torque") {
            sensors_xml << "<force name=\"" << sensor.id << "_force\" site=\"" << sensor.id << "_site\"/>"
                        << "<torque name=\"" << sensor.id << "_torque\" site=\"" << sensor.id << "_site\"/>";
            any_sensor = true;
        } else if (sensor.type == "imu") {
            sensors_xml << "<accelerometer name=\"" << sensor.id << "_accel\" site=\"" << sensor.id << "_site\"/>"
                        << "<gyro name=\"" << sensor.id << "_gyro\" site=\"" << sensor.id << "_site\"/>";
            any_sensor = true;
        }
        // lidar / camera: handled as noted above.
    }
    if (any_sensor) xml << "<sensor>" << sensors_xml.str() << "</sensor>";

    xml << "</mujoco>";
    return xml.str();
}

struct BuiltRobot::Impl {
    mjSpec* spec = nullptr;
    mjModel* model = nullptr;
    mjData* data = nullptr;
    std::vector<int> body_mjids;      // robot.bodies[i] -> mjModel body id, or -1
    std::vector<int> actuator_mjids;  // robot.actuators[i] -> mjModel actuator id, or -1

    // Robot Builder Phase 4 (sensors). One entry per robot.sensors[i],
    // resolved once here rather than assuming any particular mjModel
    // compiled ordering -- same posture as body_mjids/actuator_mjids.
    struct SensorEntry {
        int output_count = 0;  // nominal width; see built_robot.hpp's sensor_output_count doc
        bool is_lidar = false;
        // Resolved mjOBJ_SENSOR ids (0, 1, or 2 depending on type). Empty
        // means "unresolved" (camera, or an id lookup that failed) --
        // sync_sensor_data zero-fills in that case rather than risking a
        // negative-index read into sensor_dim/sensor_adr.
        std::vector<int> mj_sensor_ids;
        // lidar only (computed manually via mj_multiRay, no MJCF sensor
        // element exists for it):
        int site_mjid = -1;
        int body_mjid = -1;
        int rays = 0;
        double fov_radians = 0.0;
    };
    std::vector<SensorEntry> sensor_entries;
    int total_sensor_doubles = 0;

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

    impl_->sensor_entries.reserve(robot.sensors.size());
    for (const auto& sensor : robot.sensors) {
        Impl::SensorEntry entry;
        if (sensor.type == "camera") {
            // Out of scope (docs/decisions/robot-builder-sensors.md):
            // zero width, nothing to resolve.
        } else if (sensor.type == "lidar") {
            entry.is_lidar = true;
            const LidarParams params = ParseLidarParams(sensor.params_json);
            entry.rays = params.rays;
            entry.fov_radians = params.fov_degrees * kPi / 180.0;
            entry.output_count = entry.rays;
            entry.site_mjid = mj_name2id(impl_->model, mjOBJ_SITE, (sensor.id + "_site").c_str());
            entry.body_mjid = mj_name2id(impl_->model, mjOBJ_BODY, sensor.body.c_str());
        } else if (sensor.type == "encoder") {
            entry.output_count = 1;
            const int id = mj_name2id(impl_->model, mjOBJ_SENSOR, sensor.id.c_str());
            if (id >= 0) entry.mj_sensor_ids.push_back(id);
        } else if (sensor.type == "gps") {
            entry.output_count = 3;
            const int id = mj_name2id(impl_->model, mjOBJ_SENSOR, sensor.id.c_str());
            if (id >= 0) entry.mj_sensor_ids.push_back(id);
        } else if (sensor.type == "distance" || sensor.type == "touch") {
            entry.output_count = 1;
            const int id = mj_name2id(impl_->model, mjOBJ_SENSOR, sensor.id.c_str());
            if (id >= 0) entry.mj_sensor_ids.push_back(id);
        } else if (sensor.type == "imu") {
            entry.output_count = 6;
            const int accel_id = mj_name2id(impl_->model, mjOBJ_SENSOR, (sensor.id + "_accel").c_str());
            const int gyro_id = mj_name2id(impl_->model, mjOBJ_SENSOR, (sensor.id + "_gyro").c_str());
            if (accel_id >= 0 && gyro_id >= 0) {
                entry.mj_sensor_ids.push_back(accel_id);
                entry.mj_sensor_ids.push_back(gyro_id);
            }
        } else if (sensor.type == "force_torque") {
            entry.output_count = 6;
            const int force_id = mj_name2id(impl_->model, mjOBJ_SENSOR, (sensor.id + "_force").c_str());
            const int torque_id = mj_name2id(impl_->model, mjOBJ_SENSOR, (sensor.id + "_torque").c_str());
            if (force_id >= 0 && torque_id >= 0) {
                entry.mj_sensor_ids.push_back(force_id);
                entry.mj_sensor_ids.push_back(torque_id);
            }
        }
        impl_->total_sensor_doubles += entry.output_count;
        impl_->sensor_entries.push_back(entry);
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

int BuiltRobot::sensor_count() const { return static_cast<int>(impl_->sensor_entries.size()); }

int BuiltRobot::sensor_output_count(int index) const {
    if (index < 0 || index >= static_cast<int>(impl_->sensor_entries.size())) return 0;
    return impl_->sensor_entries[static_cast<size_t>(index)].output_count;
}

int BuiltRobot::sensor_data_count() const { return impl_->total_sensor_doubles; }

void BuiltRobot::sync_sensor_data(double* out) const {
    const mjModel* m = impl_->model;
    mjData* d = impl_->data;
    int offset = 0;
    for (const auto& entry : impl_->sensor_entries) {
        if (entry.is_lidar) {
            if (entry.site_mjid < 0 || entry.body_mjid < 0) {
                std::fill(out + offset, out + offset + entry.rays, 0.0);
            } else {
                const double* p = d->site_xpos + 3 * entry.site_mjid;
                const double* mat = d->site_xmat + 9 * entry.site_mjid;
                // Local +Z (forward), matching <rangefinder>'s own +Z
                // convention, is column 2 of the row-major 3x3 site
                // orientation matrix; local +Y (the fan's sweep axis) is
                // column 1. See docs/decisions/robot-builder-sensors.md
                // for why this particular axis choice, not a uniquely
                // "correct" one.
                const double fwd[3] = {mat[2], mat[5], mat[8]};
                const double axis[3] = {mat[1], mat[4], mat[7]};
                std::vector<double> dirs(static_cast<size_t>(entry.rays) * 3);
                for (int i = 0; i < entry.rays; ++i) {
                    const double theta = entry.rays == 1
                                              ? 0.0
                                              : -entry.fov_radians / 2.0 + entry.fov_radians * i / (entry.rays - 1);
                    // Rodrigues' rotation of fwd around axis by theta; the
                    // axis*(axis.fwd) term drops out since fwd and axis
                    // are orthonormal frame axes (axis.fwd == 0).
                    const double c = std::cos(theta);
                    const double s = std::sin(theta);
                    const double cross[3] = {
                        axis[1] * fwd[2] - axis[2] * fwd[1],
                        axis[2] * fwd[0] - axis[0] * fwd[2],
                        axis[0] * fwd[1] - axis[1] * fwd[0],
                    };
                    dirs[static_cast<size_t>(3 * i + 0)] = fwd[0] * c + cross[0] * s;
                    dirs[static_cast<size_t>(3 * i + 1)] = fwd[1] * c + cross[1] * s;
                    dirs[static_cast<size_t>(3 * i + 2)] = fwd[2] * c + cross[2] * s;
                }
                std::vector<int> geomid(static_cast<size_t>(entry.rays));
                mj_multiRay(m, d, p, dirs.data(), nullptr, /*flg_static=*/1, entry.body_mjid, geomid.data(),
                            out + offset, nullptr, entry.rays, kLidarCutoff);
            }
        } else if (entry.mj_sensor_ids.empty()) {
            std::fill(out + offset, out + offset + entry.output_count, 0.0);  // camera, or unresolved
        } else {
            int written = 0;
            for (int id : entry.mj_sensor_ids) {
                const int dim = m->sensor_dim[id];
                std::copy(d->sensordata + m->sensor_adr[id], d->sensordata + m->sensor_adr[id] + dim,
                          out + offset + written);
                written += dim;
            }
        }
        offset += entry.output_count;
    }
}

}  // namespace okrobo
