// C ABI exported to the studio via Emscripten. Pointers cross the boundary
// as integers; state crosses as scalars so no JSON or memory marshalling is
// needed. The TS side (apps/studio/src/engine/) assembles contract v0 messages.

#include "world.hpp"

#include <emscripten/emscripten.h>

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

}  // extern "C"
