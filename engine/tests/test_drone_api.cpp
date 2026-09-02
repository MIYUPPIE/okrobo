// Gate tests for the student-facing C++ Drone API (engine/api/drone.hpp).
// Mirrors the Drone-API scenarios in runtime/python/tests/test_drone.py
// exactly: independent proof, in two languages, that they agree.

#include "drone.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kTol = 1e-6;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void test_takeoff_and_altitude() {
    okrobo::Drone drone;
    assert(drone.altitude() == 0.0);
    drone.takeoff();
    assert(near(drone.altitude(), okrobo::Drone::kHoverHeight));
}

void test_land_returns_to_ground() {
    okrobo::Drone drone;
    drone.takeoff(0.5);
    drone.land();
    assert(near(drone.altitude(), 0.0));
}

void test_forward_and_turn_blocking_and_units() {
    okrobo::Drone drone;
    drone.forward(0.2);
    auto [x, y, z] = drone.position();
    assert(near(x, 1.2));
    assert(near(y, 1.0));
    (void)z;

    drone.turn_right(90);
    assert(near(drone.heading(), -90.0, 1e-4));
}

void test_forward_stops_early_at_wall() {
    okrobo::Drone drone;
    drone.forward(5.0);  // arena is 2m wide, far more than it can travel
    auto [x, y, z] = drone.position();
    assert(near(x, 2.0 - 0.1));
    assert(near(drone.distance(), 0.0));
    (void)y;
    (void)z;
}

void test_up_down_stop_early_at_limits() {
    okrobo::Drone drone;
    drone.up(5.0);
    assert(near(drone.altitude(), 1.0));  // ceiling
    drone.down(5.0);
    assert(near(drone.altitude(), 0.0));  // ground
}

void test_wait_passes_time_without_moving() {
    okrobo::Drone drone;
    drone.takeoff();
    const auto before = drone.position();
    drone.wait(0.5);
    const auto after = drone.position();
    assert(before == after);
}

void test_non_positive_up_down_are_no_ops() {
    for (double meters : {0.0, -1.0}) {
        okrobo::Drone drone;
        drone.up(meters);
        assert(drone.altitude() == 0.0);
    }
}

}  // namespace

int main() {
    test_takeoff_and_altitude();
    test_land_returns_to_ground();
    test_forward_and_turn_blocking_and_units();
    test_forward_stops_early_at_wall();
    test_up_down_stop_early_at_limits();
    test_wait_passes_time_without_moving();
    test_non_positive_up_down_are_no_ops();
    std::puts("engine drone API: all tests passed");
    return 0;
}
