// Gate tests for the engine core. Plain asserts, no framework, run by ctest.

#include "world.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTol = 1e-9;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void run(okrobo::World& world, double seconds, double dt = 0.01) {
    const int steps = static_cast<int>(std::round(seconds / dt));
    for (int i = 0; i < steps; ++i) world.step(dt);
}

void test_initial_state() {
    okrobo::World world;
    const auto s = world.state();
    assert(s.tick == 0);
    assert(near(s.pose.x, 1.0) && near(s.pose.y, 1.0) && near(s.pose.theta, 0.0));
    // Center of a 2x2 arena facing +x: 1.0 to the wall minus 0.1 radius.
    assert(near(s.distance, 0.9));
    assert(!s.collided);
}

void test_straight_drive() {
    okrobo::World world;
    world.drive(0.2, 0.2);
    run(world, 1.0);  // 0.2 m/s for 1 s
    const auto s = world.state();
    assert(s.tick == 100);
    assert(near(s.pose.x, 1.2));
    assert(near(s.pose.y, 1.0));
    assert(near(s.pose.theta, 0.0));
    assert(near(s.distance, 0.7));
}

void test_turn_in_place() {
    okrobo::World world;
    world.drive(-0.06, 0.06);  // w = 0.12/0.12 = 1 rad/s
    run(world, kPi / 2.0, kPi / 200.0);
    const auto s = world.state();
    assert(near(s.pose.x, 1.0));
    assert(near(s.pose.y, 1.0));
    assert(near(s.pose.theta, kPi / 2.0, 1e-6));
    // Facing +y now, same distance to the wall.
    assert(near(s.distance, 0.9, 1e-6));
}

void test_wall_stop() {
    okrobo::World world;
    world.drive(0.5, 0.5);
    run(world, 10.0);  // would travel 5 m in a 2 m arena
    const auto s = world.state();
    assert(near(s.pose.x, 1.9));  // arena_width - robot_radius
    assert(s.collided);
    assert(near(s.distance, 0.0));
}

void test_reset() {
    okrobo::World world;
    world.drive(0.5, 0.5);
    run(world, 10.0);
    world.reset();
    const auto s = world.state();
    assert(s.tick == 0);
    assert(near(s.pose.x, 1.0) && near(s.pose.y, 1.0));
    assert(!s.collided);
}

void test_arc_returns_to_start() {
    // A full circle at constant wheel speeds ends where it began.
    okrobo::World world;
    world.drive(0.05, 0.15);  // v = 0.1, w = 0.1/0.12
    const double w = 0.1 / 0.12;
    const double period = 2.0 * kPi / w;
    run(world, period, period / 1000.0);
    const auto s = world.state();
    assert(near(s.pose.x, 1.0, 1e-6));
    assert(near(s.pose.y, 1.0, 1e-6));
    assert(near(s.pose.theta, 0.0, 1e-6));
}

}  // namespace

int main() {
    test_initial_state();
    test_straight_drive();
    test_turn_in_place();
    test_wall_stop();
    test_reset();
    test_arc_returns_to_start();
    std::puts("engine: all tests passed");
    return 0;
}
