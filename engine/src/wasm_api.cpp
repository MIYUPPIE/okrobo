// C ABI exported to the studio via Emscripten. Pointers cross the boundary
// as integers; state crosses as scalars so no JSON or memory marshalling is
// needed. The TS side (apps/studio/src/engine/) assembles contract v0 messages.

#include "arm_world.hpp"
#include "built_robot.hpp"
#include "camera.hpp"
#include "drone_world.hpp"
#include "world.hpp"

#include <algorithm>
#include <string>

#include <emscripten/emscripten.h>

// Scratch buffer for camera frames: the JS side reads it straight out of the
// heap, so no allocation crosses the boundary per frame.
static unsigned char g_camera_frame[okrobo::kCameraMaxWidth * okrobo::kCameraMaxHeight * 3];

// Robot Builder Phase 3: scratch buffer for a built robot's body poses,
// same "static array + sync call + pointer accessor" pattern as the camera
// buffer above. 7 doubles per body: x,y,z, then MuJoCo's native (w,x,y,z)
// quaternion order -- reordered to three.js's (x,y,z,w) on the TS side
// (apps/studio/src/engine/EngineBuiltRobot.ts), not here.
constexpr int kBuiltMaxBodies = 64;
static double g_body_pose_buffer[kBuiltMaxBodies * 7];

// Robot Builder Phase 4: scratch buffer for a built robot's sensor
// readings, same pattern as g_body_pose_buffer. Sized generously: six
// generic sensors at up to 6 doubles each plus a couple of lidars at up to
// kMaxLidarRays(64) doubles comfortably fits.
constexpr int kBuiltMaxSensorDoubles = 512;
static double g_sensor_data_buffer[kBuiltMaxSensorDoubles];

extern "C" {

EMSCRIPTEN_KEEPALIVE
okrobo::World* world_create(double arena_width, double arena_height,
                            double robot_radius, double wheel_base,
                            double start_x, double start_y, double start_theta) {
    okrobo::WorldConfig config;
    config.arena_width = arena_width;
    config.arena_height = arena_height;
    config.robot_radius = robot_radius;
    config.wheel_base = wheel_base;
    config.start = okrobo::Pose{start_x, start_y, start_theta};
    return new okrobo::World(config);
}

EMSCRIPTEN_KEEPALIVE
void world_destroy(okrobo::World* world) { delete world; }

EMSCRIPTEN_KEEPALIVE
void world_drive(okrobo::World* world, double left, double right) {
    world->drive(left, right);
}

EMSCRIPTEN_KEEPALIVE
void world_stop(okrobo::World* world) { world->stop(); }

EMSCRIPTEN_KEEPALIVE
void world_reset(okrobo::World* world) { world->reset(); }

EMSCRIPTEN_KEEPALIVE
void world_step(okrobo::World* world, double dt) { world->step(dt); }

EMSCRIPTEN_KEEPALIVE
double world_tick(const okrobo::World* world) {
    return static_cast<double>(world->state().tick);
}

EMSCRIPTEN_KEEPALIVE
double world_x(const okrobo::World* world) { return world->state().pose.x; }

EMSCRIPTEN_KEEPALIVE
double world_y(const okrobo::World* world) { return world->state().pose.y; }

EMSCRIPTEN_KEEPALIVE
double world_theta(const okrobo::World* world) { return world->state().pose.theta; }

EMSCRIPTEN_KEEPALIVE
double world_distance(const okrobo::World* world) { return world->state().distance; }

EMSCRIPTEN_KEEPALIVE
int world_collided(const okrobo::World* world) {
    return world->state().collided ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
double world_ray(const okrobo::World* world, double offset) {
    return world->ray(offset);
}

EMSCRIPTEN_KEEPALIVE
void world_add_obstacle(okrobo::World* world, double x, double y, double width, double height,
                        int r, int g, int b) {
    okrobo::Obstacle obstacle;
    obstacle.x = x;
    obstacle.y = y;
    obstacle.width = width;
    obstacle.height = height;
    obstacle.r = static_cast<unsigned char>(r);
    obstacle.g = static_cast<unsigned char>(g);
    obstacle.b = static_cast<unsigned char>(b);
    world->add_obstacle(obstacle);
}

EMSCRIPTEN_KEEPALIVE
int world_obstacle_count(const okrobo::World* world) { return world->obstacle_count(); }

/// Render a camera frame into the shared buffer; returns bytes written.
EMSCRIPTEN_KEEPALIVE
int world_render_camera(const okrobo::World* world, int width, int height) {
    return okrobo::render_camera(*world, width, height, g_camera_frame);
}

/// Address of the frame buffer, so JS can read it from the heap.
EMSCRIPTEN_KEEPALIVE
unsigned char* world_camera_buffer() { return g_camera_frame; }

// ---- arm (contract v1) ----

EMSCRIPTEN_KEEPALIVE
okrobo::ArmWorld* arm_create() { return new okrobo::ArmWorld(); }

EMSCRIPTEN_KEEPALIVE
void arm_destroy(okrobo::ArmWorld* arm) { delete arm; }

EMSCRIPTEN_KEEPALIVE
void arm_set_target(okrobo::ArmWorld* arm, int joint, double angle) {
    arm->set_target(joint, angle);
}

EMSCRIPTEN_KEEPALIVE
void arm_stop(okrobo::ArmWorld* arm) { arm->stop(); }

EMSCRIPTEN_KEEPALIVE
void arm_reset(okrobo::ArmWorld* arm) { arm->reset(); }

EMSCRIPTEN_KEEPALIVE
void arm_step(okrobo::ArmWorld* arm, double dt) { arm->step(dt); }

EMSCRIPTEN_KEEPALIVE
double arm_tick(const okrobo::ArmWorld* arm) {
    return static_cast<double>(arm->state().tick);
}

EMSCRIPTEN_KEEPALIVE
double arm_angle(const okrobo::ArmWorld* arm, int joint) {
    const auto s = arm->state();
    return (joint >= 0 && joint < okrobo::kArmJoints) ? s.angles[joint] : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double arm_target(const okrobo::ArmWorld* arm, int joint) {
    const auto s = arm->state();
    return (joint >= 0 && joint < okrobo::kArmJoints) ? s.targets[joint] : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int arm_moving(const okrobo::ArmWorld* arm) { return arm->state().moving ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_x(const okrobo::ArmWorld* arm) { return arm->state().tip.x; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_y(const okrobo::ArmWorld* arm) { return arm->state().tip.y; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_z(const okrobo::ArmWorld* arm) { return arm->state().tip.z; }

/// Grip the graspable object if the tip is within kGraspTolerance of it.
/// Returns 1 on success, 0 otherwise.
EMSCRIPTEN_KEEPALIVE
int arm_grip(okrobo::ArmWorld* arm) { return arm->grip() ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
void arm_release(okrobo::ArmWorld* arm) { arm->release(); }

EMSCRIPTEN_KEEPALIVE
int arm_holding(const okrobo::ArmWorld* arm) { return arm->state().holding ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
double arm_object_x(const okrobo::ArmWorld* arm) { return arm->state().object.x; }

EMSCRIPTEN_KEEPALIVE
double arm_object_y(const okrobo::ArmWorld* arm) { return arm->state().object.y; }

EMSCRIPTEN_KEEPALIVE
double arm_object_z(const okrobo::ArmWorld* arm) { return arm->state().object.z; }

// ---- drone (contract v2) ----

EMSCRIPTEN_KEEPALIVE
okrobo::DroneWorld* drone_create(double arena_width, double arena_height, double robot_radius,
                            double max_altitude, double start_x, double start_y, double start_z,
                            double start_theta) {
    okrobo::DroneConfig config;
    config.arena_width = arena_width;
    config.arena_height = arena_height;
    config.robot_radius = robot_radius;
    config.max_altitude = max_altitude;
    config.start = okrobo::DronePose{start_x, start_y, start_z, start_theta};
    return new okrobo::DroneWorld(config);
}

EMSCRIPTEN_KEEPALIVE
void drone_destroy(okrobo::DroneWorld* drone) { delete drone; }

EMSCRIPTEN_KEEPALIVE
void drone_drive(okrobo::DroneWorld* drone, double forward, double vertical, double yaw_rate) {
    drone->drive(forward, vertical, yaw_rate);
}

EMSCRIPTEN_KEEPALIVE
void drone_stop(okrobo::DroneWorld* drone) { drone->stop(); }

EMSCRIPTEN_KEEPALIVE
void drone_reset(okrobo::DroneWorld* drone) { drone->reset(); }

EMSCRIPTEN_KEEPALIVE
void drone_step(okrobo::DroneWorld* drone, double dt) { drone->step(dt); }

EMSCRIPTEN_KEEPALIVE
double drone_tick(const okrobo::DroneWorld* drone) {
    return static_cast<double>(drone->state().tick);
}

EMSCRIPTEN_KEEPALIVE
double drone_x(const okrobo::DroneWorld* drone) { return drone->state().pose.x; }

EMSCRIPTEN_KEEPALIVE
double drone_y(const okrobo::DroneWorld* drone) { return drone->state().pose.y; }

EMSCRIPTEN_KEEPALIVE
double drone_z(const okrobo::DroneWorld* drone) { return drone->state().pose.z; }

EMSCRIPTEN_KEEPALIVE
double drone_theta(const okrobo::DroneWorld* drone) { return drone->state().pose.theta; }

EMSCRIPTEN_KEEPALIVE
double drone_distance(const okrobo::DroneWorld* drone) { return drone->state().distance; }

EMSCRIPTEN_KEEPALIVE
int drone_collided(const okrobo::DroneWorld* drone) {
    return drone->state().collided ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
double drone_ray(const okrobo::DroneWorld* drone, double offset) { return drone->ray(offset); }

// ---- built robot (Robot Builder Phase 3/5; contracts/robot-def/v0,
// contracts/world-def/v0) ----
// No sensors (Phase 4 -- no `camera`). See docs/decisions/robot-builder-physics.md
// and docs/decisions/robot-builder-world.md.

/// Parses `robot_json` (a robot-def v0 document) and, when `world_len > 0`,
/// `world_json` (a world-def v0 document) too, then builds a simulated
/// instance of the robot in that environment. `world_len == 0` means "no
/// world" (matches Phase 3/4's exact behavior -- just the robot and the
/// floor). Neither buffer needs to be null-terminated. Returns null on any
/// parse or MJCF-compile failure -- the JS side checks for a falsy handle
/// rather than catching a C++ exception across the ABI.
EMSCRIPTEN_KEEPALIVE
okrobo::BuiltRobot* built_create(const char* robot_json, int robot_len, const char* world_json, int world_len) {
    try {
        const std::string robot_text(robot_json, static_cast<size_t>(robot_len));
        const okrobo::RobotDef robot = okrobo::ParseRobotDef(robot_text);
        if (world_len <= 0) {
            return new okrobo::BuiltRobot(robot);
        }
        const std::string world_text(world_json, static_cast<size_t>(world_len));
        const okrobo::WorldDef world = okrobo::ParseWorldDef(world_text);
        return new okrobo::BuiltRobot(robot, &world);
    } catch (const std::exception&) {
        return nullptr;
    }
}

EMSCRIPTEN_KEEPALIVE
void built_destroy(okrobo::BuiltRobot* robot) { delete robot; }

EMSCRIPTEN_KEEPALIVE
void built_step(okrobo::BuiltRobot* robot, double dt) { robot->step(dt); }

EMSCRIPTEN_KEEPALIVE
int built_body_count(const okrobo::BuiltRobot* robot) { return robot->body_count(); }

EMSCRIPTEN_KEEPALIVE
int built_actuator_count(const okrobo::BuiltRobot* robot) { return robot->actuator_count(); }

/// Returns 1 if the actuator accepted the value, 0 if that index has no
/// MJCF equivalent (targets a ball/free joint) or is out of range.
EMSCRIPTEN_KEEPALIVE
int built_set_actuator_ctrl(okrobo::BuiltRobot* robot, int index, double value) {
    return robot->set_actuator_ctrl(index, value) ? 1 : 0;
}

/// Fills the shared buffer with every body's current world pose, in
/// robot.bodies declaration order. Returns the number of bodies written
/// (capped at kBuiltMaxBodies).
EMSCRIPTEN_KEEPALIVE
int built_sync_body_poses(okrobo::BuiltRobot* robot) {
    const int count = std::min(robot->body_count(), kBuiltMaxBodies);
    for (int i = 0; i < count; ++i) {
        const okrobo::BuiltBodyPose pose = robot->body_pose(i);
        double* out = g_body_pose_buffer + i * 7;
        out[0] = pose.x;
        out[1] = pose.y;
        out[2] = pose.z;
        out[3] = pose.qw;
        out[4] = pose.qx;
        out[5] = pose.qy;
        out[6] = pose.qz;
    }
    return count;
}

/// Address of the pose buffer, so JS can read it from the heap.
EMSCRIPTEN_KEEPALIVE
double* built_body_pose_buffer() { return g_body_pose_buffer; }

// ---- built robot sensors (Robot Builder Phase 4) ----
// No `camera` readout. See docs/decisions/robot-builder-sensors.md.

EMSCRIPTEN_KEEPALIVE
int built_sensor_count(const okrobo::BuiltRobot* robot) { return robot->sensor_count(); }

EMSCRIPTEN_KEEPALIVE
int built_sensor_output_count(const okrobo::BuiltRobot* robot, int index) {
    return robot->sensor_output_count(index);
}

/// Fills the shared sensor buffer; returns doubles actually written (0 if
/// the robot's total sensor width exceeds kBuiltMaxSensorDoubles -- a
/// documented no-sync rather than a heap overrun).
EMSCRIPTEN_KEEPALIVE
int built_sync_sensor_data(okrobo::BuiltRobot* robot) {
    const int total = robot->sensor_data_count();
    if (total <= 0 || total > kBuiltMaxSensorDoubles) return 0;
    robot->sync_sensor_data(g_sensor_data_buffer);
    return total;
}

/// Address of the sensor buffer, so JS can read it from the heap.
EMSCRIPTEN_KEEPALIVE
double* built_sensor_data_buffer() { return g_sensor_data_buffer; }

}  // extern "C"
