// Gate tests for the student-facing C++ Arm API (engine/api/arm.hpp).
// Mirrors the Arm-API scenarios in runtime/python/tests/test_arm.py
// exactly: independent proof, in two languages, that they agree.

#include "arm.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <stdexcept>

namespace {

constexpr double kTol = 1e-6;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void test_move_blocking_and_degrees() {
    okrobo::Arm arm;
    arm.move("base", 90);
    assert(near(arm.angles()[0], 90.0));
    const auto [x, y, z] = arm.tip();
    assert(near(x, 0.0));
    assert(y > 0.3);
    (void)z;
}

void test_move_all_and_names() {
    okrobo::Arm arm;
    arm.move_all({0, 90, 0, 0});  // arm straight up
    const auto [x, y, z] = arm.tip();
    assert(near(z, 0.12 + 0.22 + 0.18 + 0.10));
    (void)x;
    (void)y;

    bool threw = false;
    try {
        arm.move("knee", 10);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    assert(threw);
}

void test_stop_interrupts() {
    okrobo::Arm arm;
    constexpr double kPi = 3.14159265358979323846;
    arm.engine().set_target(0, kPi);
    for (int i = 0; i < 30; ++i) arm.engine().step(0.01);  // 0.3s
    arm.stop();
    const double held = arm.angles()[0];
    arm.wait(1.0);
    assert(near(arm.angles()[0], held, 1e-9));
}

}  // namespace

int main() {
    test_move_blocking_and_degrees();
    test_move_all_and_names();
    test_stop_interrupts();
    std::puts("engine arm API: all tests passed");
    return 0;
}
