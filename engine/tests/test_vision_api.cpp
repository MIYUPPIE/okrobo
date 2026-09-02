// Gate tests for the student-facing C++ camera + vision API
// (engine/api/robot.hpp's Frame/camera(), engine/api/vision.hpp's
// find_color). Mirrors runtime/python/tests/test_vision.py's scenarios and
// expected values exactly: independent proof, in two languages, that they
// agree.

#include "vision.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

namespace {

/** A robot with one coloured box ahead, mirroring test_vision.py's world_with_box(). */
okrobo::Robot robot_with_box(double x = 1.6, double y = 1.0, unsigned char r = 220,
                              unsigned char g = 40, unsigned char b = 40) {
    okrobo::Robot robot;
    okrobo::Obstacle box;
    box.x = x;
    box.y = y;
    box.width = 0.2;
    box.height = 0.2;
    box.r = r;
    box.g = g;
    box.b = b;
    robot.engine().add_obstacle(box);
    return robot;
}

void test_camera_frame_shape() {
    okrobo::Robot robot;
    const auto frame = robot.camera(32, 24);
    assert(frame.width == 32);
    assert(frame.height == 24);
    assert(frame.pixels.size() == 32u * 24u * 3u);
    auto sky = frame.pixel(0, 0);
    assert(sky[0] == 22 && sky[1] == 24 && sky[2] == 29);
    auto floor = frame.pixel(0, 23);
    assert(floor[0] == 26 && floor[1] == 34 && floor[2] == 48);
}

void test_camera_rejects_bad_sizes() {
    okrobo::Robot robot;
    bool threw = false;
    try {
        robot.camera(0, 10);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    assert(threw);

    threw = false;
    try {
        robot.camera(10, 1000);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    assert(threw);
}

void test_camera_sees_a_red_box_ahead() {
    auto robot = robot_with_box();
    const auto frame = robot.camera(64, 48);
    const auto p = frame.pixel(32, 24);
    assert(p[0] > p[1] * 2 && p[0] > p[2] * 2);
}

void test_find_color_locates_the_box() {
    auto robot = robot_with_box();
    const auto detection = okrobo::find_color(robot.camera(64, 48), "red");
    assert(detection.has_value());
    assert(detection->color == "red");
    assert(detection->area > 50);
    assert(std::abs(detection->bearing) < 3.0);  // dead ahead
}

void test_find_color_reports_left_and_right() {
    // A box offset to the robot's left (+y) should read as a negative bearing.
    auto left_robot = robot_with_box(1.45, 1.25);
    const auto left = okrobo::find_color(left_robot.camera(64, 48), "red");
    auto right_robot = robot_with_box(1.45, 0.75);
    const auto right = okrobo::find_color(right_robot.camera(64, 48), "red");
    assert(left.has_value() && right.has_value());
    assert(left->bearing < -5.0);
    assert(right->bearing > 5.0);
}

void test_find_color_returns_none_when_absent() {
    okrobo::Robot plain;
    assert(!okrobo::find_color(plain.camera(32, 24), "red").has_value());

    // A green box is not a red one.
    auto green_robot = robot_with_box(1.6, 1.0, 40, 200, 80);
    assert(!okrobo::find_color(green_robot.camera(32, 24), "red").has_value());
    assert(okrobo::find_color(green_robot.camera(32, 24), "green").has_value());
}

void test_find_color_rejects_unknown_names() {
    okrobo::Robot robot;
    bool threw = false;
    try {
        okrobo::find_color(robot.camera(8, 8), "purple");
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    assert(threw);
}

void test_closer_boxes_cover_more_of_the_frame() {
    auto near_robot = robot_with_box(1.4, 1.0);
    const auto near_detection = okrobo::find_color(near_robot.camera(64, 48), "red");
    auto far_robot = robot_with_box(1.9, 1.0);
    const auto far_detection = okrobo::find_color(far_robot.camera(64, 48), "red");
    assert(near_detection.has_value() && far_detection.has_value());
    assert(near_detection->coverage > far_detection->coverage);
}

void test_bearing_matches_the_camera_field_of_view() {
    auto robot = robot_with_box();
    const auto detection = okrobo::find_color(robot.camera(64, 48), "red");
    assert(detection.has_value());
    constexpr double kCameraFov = 1.0471975511965976;
    const double limit = kCameraFov / 2.0 * 180.0 / 3.14159265358979323846;
    assert(detection->bearing >= -limit && detection->bearing <= limit);
}

}  // namespace

int main() {
    test_camera_frame_shape();
    test_camera_rejects_bad_sizes();
    test_camera_sees_a_red_box_ahead();
    test_find_color_locates_the_box();
    test_find_color_reports_left_and_right();
    test_find_color_returns_none_when_absent();
    test_find_color_rejects_unknown_names();
    test_closer_boxes_cover_more_of_the_frame();
    test_bearing_matches_the_camera_field_of_view();
    std::puts("engine vision API: all tests passed");
    return 0;
}
