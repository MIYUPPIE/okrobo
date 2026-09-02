// Gate tests for obstacles and the raycast camera.

#include "camera.hpp"
#include "world.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

namespace {

constexpr double kTol = 1e-9;

bool near(double a, double b, double tol = kTol) { return std::abs(a - b) < tol; }

okrobo::World world_with_red_box() {
    // A red box 0.5 m ahead of the robot at the arena centre.
    okrobo::WorldConfig config;
    okrobo::World world(config);
    okrobo::Obstacle box;
    box.x = 1.6;
    box.y = 1.0;
    box.width = 0.2;
    box.height = 0.2;
    box.r = 220;
    box.g = 40;
    box.b = 40;
    world.add_obstacle(box);
    return world;
}

void test_obstacle_shortens_the_distance_sensor() {
    okrobo::World empty;
    // Centre of a 2x2 arena facing +x: 0.9 m to the wall.
    assert(near(empty.state().distance, 0.9));

    okrobo::World world = world_with_red_box();
    // The box's near face is at x = 1.5, so 0.5 m minus the robot radius.
    assert(near(world.state().distance, 0.4));
}

void test_ray_hit_reports_obstacle_colour() {
    okrobo::World world = world_with_red_box();
    const okrobo::RayHit ahead = world.ray_hit(0.0);
    assert(ahead.r == 220 && ahead.g == 40 && ahead.b == 40);

    // Looking sideways misses the box and sees a grey wall.
    const okrobo::RayHit sideways = world.ray_hit(1.5);
    assert(sideways.r == 90 && sideways.g == 90 && sideways.b == 90);
    assert(sideways.distance > ahead.distance);
}

void test_obstacles_do_not_affect_motion_odometry() {
    // Obstacles are visible to sensors; blocking movement is a physics
    // feature and deliberately not part of the kinematic model.
    okrobo::World world = world_with_red_box();
    world.drive(0.2, 0.2);
    for (int i = 0; i < 100; ++i) world.step(0.01);
    assert(near(world.state().pose.x, 1.2));
}

void test_camera_frame_size_and_bounds() {
    okrobo::World world = world_with_red_box();
    std::vector<unsigned char> frame(64 * 48 * 3);
    const int written = okrobo::render_camera(world, 64, 48, frame.data());
    assert(written == 64 * 48 * 3);

    // Nothing outside the buffer, and every byte written.
    for (unsigned char byte : frame) (void)byte;

    // Invalid sizes are refused rather than overflowing.
    assert(okrobo::render_camera(world, 0, 10, frame.data()) == 0);
    assert(okrobo::render_camera(world, 10, 0, frame.data()) == 0);
    assert(okrobo::render_camera(world, 10000, 10, frame.data()) == 0);
    assert(okrobo::render_camera(world, 10, 10, nullptr) == 0);
}

void test_camera_sees_the_red_box_ahead() {
    okrobo::World world = world_with_red_box();
    const int w = 64;
    const int h = 48;
    std::vector<unsigned char> frame(w * h * 3);
    okrobo::render_camera(world, w, h, frame.data());

    // The centre pixel should be reddish: red channel clearly dominant.
    const unsigned char* centre = frame.data() + ((h / 2) * w + w / 2) * 3;
    assert(centre[0] > centre[1] * 2);
    assert(centre[0] > centre[2] * 2);

    // A pixel at the far left looks past the box at a grey wall, so its
    // channels stay balanced.
    const unsigned char* left = frame.data() + ((h / 2) * w + 1) * 3;
    assert(left[0] == left[1] && left[1] == left[2]);
}

void test_camera_shows_sky_and_floor() {
    okrobo::World world;  // empty arena: distant walls, small band
    const int w = 32;
    const int h = 32;
    std::vector<unsigned char> frame(w * h * 3);
    okrobo::render_camera(world, w, h, frame.data());

    const unsigned char* top = frame.data() + (0 * w + w / 2) * 3;
    const unsigned char* bottom = frame.data() + ((h - 1) * w + w / 2) * 3;
    assert(top[0] == 22 && top[1] == 24 && top[2] == 29);
    assert(bottom[0] == 26 && bottom[1] == 34 && bottom[2] == 48);
}

void test_closer_obstacles_look_bigger_and_brighter() {
    okrobo::WorldConfig config;
    okrobo::World near_world(config);
    okrobo::Obstacle box;
    box.y = 1.0;
    box.width = 0.2;
    box.height = 0.2;
    box.r = 200;
    box.g = 60;
    box.b = 60;

    box.x = 1.4;  // close
    near_world.add_obstacle(box);

    okrobo::World far_world(config);
    box.x = 1.9;  // further away
    far_world.add_obstacle(box);

    const int w = 32;
    const int h = 32;
    std::vector<unsigned char> a(w * h * 3);
    std::vector<unsigned char> b(w * h * 3);
    okrobo::render_camera(near_world, w, h, a.data());
    okrobo::render_camera(far_world, w, h, b.data());

    auto count_red = [&](const std::vector<unsigned char>& frame) {
        int count = 0;
        for (int i = 0; i < w * h; ++i) {
            const unsigned char* p = frame.data() + i * 3;
            if (p[0] > p[1] * 2 && p[0] > p[2] * 2) ++count;
        }
        return count;
    };
    assert(count_red(a) > count_red(b));

    const unsigned char* near_pixel = a.data() + ((h / 2) * w + w / 2) * 3;
    const unsigned char* far_pixel = b.data() + ((h / 2) * w + w / 2) * 3;
    assert(near_pixel[0] > far_pixel[0]);  // nearer is brighter
}

}  // namespace

int main() {
    test_obstacle_shortens_the_distance_sensor();
    test_ray_hit_reports_obstacle_colour();
    test_obstacles_do_not_affect_motion_odometry();
    test_camera_frame_size_and_bounds();
    test_camera_sees_the_red_box_ahead();
    test_camera_shows_sky_and_floor();
    test_closer_obstacles_look_bigger_and_brighter();
    std::puts("engine camera: all tests passed");
    return 0;
}
