// Gate tests for the arm kinematics. Plain asserts, run by ctest.

#include "arm_world.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTol = 1e-9;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void run(okrobo::ArmWorld& arm, double seconds, double dt = 0.01) {
    const int steps = static_cast<int>(std::round(seconds / dt));
    for (int i = 0; i < steps; ++i) arm.step(dt);
}

void test_initial_state() {
    okrobo::ArmWorld arm;
    const auto s = arm.state();
    assert(s.tick == 0);
    assert(!s.moving);
    assert(near(s.angles[0], 0.0));
    assert(near(s.angles[1], kPi / 3));
    // FK hand-check: a1=60deg, a2=30deg, a3=0deg
    const double r = 0.22 * std::cos(kPi / 3) + 0.18 * std::cos(kPi / 6) + 0.10;
    const double z = 0.12 + 0.22 * std::sin(kPi / 3) + 0.18 * std::sin(kPi / 6) + 0.0;
    assert(near(s.tip.x, r));
    assert(near(s.tip.y, 0.0));
    assert(near(s.tip.z, z));
}

void test_moves_to_target_exactly() {
    okrobo::ArmWorld arm;
    arm.set_target(0, kPi / 2);  // 90deg at 90deg/s -> 1 s
    run(arm, 0.5);
    auto s = arm.state();
    assert(s.moving);
    assert(near(s.angles[0], kPi / 4));
    run(arm, 0.6);  // overshoot time; motion clamps at the target
    s = arm.state();
    assert(!s.moving);
    assert(near(s.angles[0], kPi / 2));
    // Base yaw moves the tip around z, radius unchanged.
    assert(near(s.tip.x, 0.0));
    assert(s.tip.y > 0.3);
}

void test_targets_clamped_to_limits() {
    okrobo::ArmWorld arm;
    arm.set_target(1, 10.0);  // way past the shoulder limit
    run(arm, 5.0);
    const auto s = arm.state();
    assert(near(s.angles[1], 1.7453292519943295));
    assert(!s.moving);
}

void test_stop_freezes_motion() {
    okrobo::ArmWorld arm;
    arm.set_target(2, 1.5);
    run(arm, 0.2);
    arm.stop();
    const double held = arm.state().angles[2];
    run(arm, 1.0);
    assert(near(arm.state().angles[2], held));
    assert(!arm.state().moving);
}

void test_reset() {
    okrobo::ArmWorld arm;
    arm.set_target(0, 1.0);
    arm.set_target(3, 0.5);
    run(arm, 3.0);
    arm.reset();
    const auto s = arm.state();
    assert(s.tick == 0);
    assert(near(s.angles[0], 0.0));
    assert(near(s.angles[3], -kPi / 6));
    assert(!s.moving);
}

void test_all_joints_move_simultaneously() {
    okrobo::ArmWorld arm;
    arm.set_target(0, 0.4);
    arm.set_target(1, 1.2);
    run(arm, 0.1);
    const auto s = arm.state();
    assert(near(s.angles[0], 0.1 * (kPi / 2)));  // moved speed*t toward the target
    assert(s.angles[1] > kPi / 3);
}

}  // namespace

int main() {
    test_initial_state();
    test_moves_to_target_exactly();
    test_targets_clamped_to_limits();
    test_stop_freezes_motion();
    test_reset();
    test_all_joints_move_simultaneously();
    std::puts("engine arm: all tests passed");
    return 0;
}
