// C ABI exported to the studio via Emscripten. Pointers cross the boundary
// as integers; state crosses as scalars so no JSON or memory marshalling is
// needed. The TS side (apps/studio/src/engine/) assembles contract v0 messages.

#include "arm.hpp"
#include "camera.hpp"
#include "world.hpp"

#include <emscripten/emscripten.h>

// Scratch buffer for camera frames: the JS side reads it straight out of the
// heap, so no allocation crosses the boundary per frame.
static unsigned char g_camera_frame[okrobo::kCameraMaxWidth * okrobo::kCameraMaxHeight * 3];

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
okrobo::Arm* arm_create() { return new okrobo::Arm(); }

EMSCRIPTEN_KEEPALIVE
void arm_destroy(okrobo::Arm* arm) { delete arm; }

EMSCRIPTEN_KEEPALIVE
void arm_set_target(okrobo::Arm* arm, int joint, double angle) {
    arm->set_target(joint, angle);
}

EMSCRIPTEN_KEEPALIVE
void arm_stop(okrobo::Arm* arm) { arm->stop(); }

EMSCRIPTEN_KEEPALIVE
void arm_reset(okrobo::Arm* arm) { arm->reset(); }

EMSCRIPTEN_KEEPALIVE
void arm_step(okrobo::Arm* arm, double dt) { arm->step(dt); }

EMSCRIPTEN_KEEPALIVE
double arm_tick(const okrobo::Arm* arm) {
    return static_cast<double>(arm->state().tick);
}

EMSCRIPTEN_KEEPALIVE
double arm_angle(const okrobo::Arm* arm, int joint) {
    const auto s = arm->state();
    return (joint >= 0 && joint < okrobo::kArmJoints) ? s.angles[joint] : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double arm_target(const okrobo::Arm* arm, int joint) {
    const auto s = arm->state();
    return (joint >= 0 && joint < okrobo::kArmJoints) ? s.targets[joint] : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int arm_moving(const okrobo::Arm* arm) { return arm->state().moving ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_x(const okrobo::Arm* arm) { return arm->state().tip.x; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_y(const okrobo::Arm* arm) { return arm->state().tip.y; }

EMSCRIPTEN_KEEPALIVE
double arm_tip_z(const okrobo::Arm* arm) { return arm->state().tip.z; }

}  // extern "C"
