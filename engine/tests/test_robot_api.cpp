// Gate tests for the student-facing C++ Robot API (engine/api/robot.hpp).
// Mirrors runtime/python/tests/test_robot.py's scenarios and expected
// values exactly: independent proof, in two languages, that they agree.

#include "robot.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

constexpr double kTol = 1e-9;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

void test_forward_moves_exact_distance() {
    okrobo::Robot robot;
    robot.forward(0.1);
    const auto [x, y] = robot.position();
    assert(near(x, 1.1));
    assert(near(y, 1.0));
}

void test_backward() {
    okrobo::Robot robot;
    robot.backward(0.3);
    const auto [x, y] = robot.position();
    assert(near(x, 0.7));
    (void)y;
}

void test_turn_left_is_exact() {
    okrobo::Robot robot;
    robot.turn_left(90);
    assert(near(robot.heading(), 90.0, 1e-6));
    const auto [x, y] = robot.position();
    assert(near(x, 1.0));
    assert(near(y, 1.0));
}

void test_turn_right_arbitrary_angle() {
    okrobo::Robot robot;
    robot.turn_right(30);
    assert(near(robot.heading(), -30.0, 1e-6));
}

void test_distance_shrinks_when_approaching_wall() {
    okrobo::Robot robot;
    const double before = robot.distance();
    robot.forward(0.5);
    assert(robot.distance() < before);
    assert(near(robot.distance(), before - 0.5));
}

void test_forward_stops_at_wall() {
    okrobo::Robot robot;
    robot.forward(5.0);  // arena is only 2 m wide
    const auto [x, y] = robot.position();
    assert(x <= 1.9 + 1e-9);
    assert(robot.distance() < 0.01);
    (void)y;
}

void test_lidar_fan() {
    okrobo::Robot robot;
    const auto distances = robot.lidar(5, 180.0);
    assert(distances.size() == 5);
    // Center ray equals the plain distance sensor.
    assert(near(distances[2], robot.distance(), 1e-12));
    // At the arena center all cardinal rays hit walls 0.9 m away.
    assert(near(distances[0], 0.9));  // +90deg (left)
    assert(near(distances[4], 0.9));  // -90deg (right)
    // Diagonals are longer than cardinals from the center.
    assert(distances[1] > distances[2]);
}

void test_wait_passes_time_without_moving() {
    okrobo::Robot robot;
    const auto before = robot.engine().state();
    robot.wait(0.5);
    const auto after = robot.engine().state();
    assert(after.tick > before.tick);
    assert(near(after.pose.x, before.pose.x, 1e-12));
    assert(near(after.pose.y, before.pose.y, 1e-12));
}

void test_vision_doc_snippet_pattern() {
    // The wall avoider from docs/vision.md terminates and ends up turned.
    okrobo::Robot robot;
    while (robot.distance() > 0.2) robot.forward(0.05);
    robot.turn_left();
    assert(robot.distance() > 0.2);
    assert(near(robot.heading(), 90.0, 1e-6));
}

}  // namespace

int main() {
    test_forward_moves_exact_distance();
    test_backward();
    test_turn_left_is_exact();
    test_turn_right_arbitrary_angle();
    test_distance_shrinks_when_approaching_wall();
    test_forward_stops_at_wall();
    test_lidar_fan();
    test_wait_passes_time_without_moving();
    test_vision_doc_snippet_pattern();
    std::puts("engine robot API: all tests passed");
    return 0;
}
