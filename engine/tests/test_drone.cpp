// Gate tests for drone kinematics. Plain asserts, run by ctest.
// Mirrors runtime/python/tests/test_drone.py.

#include "drone.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTol = 1e-9;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void run(okrobo::Drone& drone, double seconds, double dt = 0.01) {
    const int steps = static_cast<int>(std::round(seconds / dt));
    for (int i = 0; i < steps; ++i) drone.step(dt);
}

void test_initial_state() {
    okrobo::Drone drone;
    const auto s = drone.state();
    assert(s.tick == 0);
    assert(!s.collided);
    assert(near(s.pose.x, 1.0));
    assert(near(s.pose.y, 1.0));
    assert(near(s.pose.z, 0.0));
    assert(near(s.pose.theta, 0.0));
}

void test_vertical_drive_changes_only_altitude() {
    okrobo::Drone drone;
    drone.drive(0.0, 0.2, 0.0);
    run(drone, 1.0);
    const auto s = drone.state();
    assert(near(s.pose.z, 0.2));
    assert(near(s.pose.x, 1.0));
    assert(near(s.pose.y, 1.0));
}

void test_forward_drive_moves_along_heading() {
    okrobo::Drone drone;
    drone.drive(0.2, 0.0, 0.0);
    run(drone, 1.0);
    const auto s = drone.state();
    assert(near(s.pose.x, 1.2));
    assert(near(s.pose.y, 1.0));
}

void test_yaw_rate_turns_in_place() {
    okrobo::Drone drone;
    drone.drive(0.0, 0.0, kPi / 2);
    run(drone, 1.0);
    assert(near(drone.state().pose.theta, kPi / 2, 1e-6));
    assert(near(drone.state().pose.x, 1.0));
}

void test_clamps_to_arena_walls_and_reports_collision() {
    okrobo::Drone drone;
    drone.drive(5.0, 0.0, 0.0);
    run(drone, 2.0);
    const auto s = drone.state();
    assert(near(s.pose.x, 2.0 - 0.1, 1e-6));
    assert(s.collided);
}

void test_clamps_altitude_floor_and_ceiling() {
    okrobo::Drone drone;
    drone.drive(0.0, -5.0, 0.0);
    run(drone, 1.0);
    assert(near(drone.state().pose.z, 0.0));
    assert(drone.state().collided);

    drone.reset();
    drone.drive(0.0, 5.0, 0.0);
    run(drone, 1.0);
    assert(near(drone.state().pose.z, 1.0, 1e-6));
    assert(drone.state().collided);
}

void test_stop_zeroes_all_rates() {
    okrobo::Drone drone;
    drone.drive(0.2, 0.1, 0.5);
    drone.stop();
    run(drone, 0.5);
    const auto s = drone.state();
    assert(near(s.pose.x, 1.0));
    assert(near(s.pose.y, 1.0));
    assert(near(s.pose.z, 0.0));
    assert(near(s.pose.theta, 0.0));
}

void test_reset_restores_start() {
    okrobo::Drone drone;
    drone.drive(0.2, 0.1, 0.3);
    run(drone, 1.0);
    drone.reset();
    const auto s = drone.state();
    assert(near(s.pose.x, 1.0));
    assert(near(s.pose.y, 1.0));
    assert(near(s.pose.z, 0.0));
    assert(s.tick == 0);
    assert(!s.collided);
}

void test_distance_sensor_is_wall_only() {
    okrobo::Drone drone;
    assert(near(drone.ray(0.0), 0.9));
}

}  // namespace

int main() {
    test_initial_state();
    test_vertical_drive_changes_only_altitude();
    test_forward_drive_moves_along_heading();
    test_yaw_rate_turns_in_place();
    test_clamps_to_arena_walls_and_reports_collision();
    test_clamps_altitude_floor_and_ceiling();
    test_stop_zeroes_all_rates();
    test_reset_restores_start();
    test_distance_sensor_is_wall_only();
    std::puts("engine drone: all tests passed");
    return 0;
}
