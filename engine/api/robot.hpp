#pragma once

// Student-facing C++ robot API: header-only, real, and standalone.
//
//   #include "robot.hpp"
//   int main() {
//       okrobo::Robot robot;
//       robot.forward(0.3);
//       if (robot.distance() < 0.2) robot.turn_left();
//   }
//
// A direct C++ port of runtime/python/okrobo/robot.py: same constants, same
// blocking duration-based movement (full steps plus one exact partial
// step), same early stop on wall contact. It wraps engine/src/world.hpp's
// World, which the WASM parity gate already locks to the Python reference
// model -- this header adds no new simulation math, only the friendly,
// blocking-call shape Blocks and Python both generate. See
// engine/api/README.md to compile and run it, with no browser involved.
//
// Distances are meters, angles are degrees -- the same student-facing
// convention as Robot/Arm/Drone in every other language this project has.
//
// camera() wraps engine/src/camera.hpp's deterministic raycast renderer
// (the same one the browser and the sidecar use); find_color() for it lives
// in vision.hpp, mirroring how camera.py and vision.py are separate modules
// in Python too.

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "camera.hpp"
#include "world.hpp"

namespace okrobo {

/** One RGB camera frame, row-major from the top. Mirrors okrobo.camera.Frame. */
struct Frame {
    int width = 0;
    int height = 0;
    std::vector<unsigned char> pixels;  // width * height * 3 bytes

    /** (r, g, b) at column x, row y. */
    std::array<unsigned char, 3> pixel(int x, int y) const {
        if (x < 0 || x >= width || y < 0 || y >= height) {
            throw std::out_of_range("pixel out of range");
        }
        const auto index = (static_cast<std::size_t>(y) * width + x) * 3;
        return {pixels[index], pixels[index + 1], pixels[index + 2]};
    }
};

class Robot {
public:
    static constexpr double kSpeed = 0.2;       // m/s during forward/backward, matches Robot.SPEED
    static constexpr double kTurnSpeed = 0.1;   // wheel m/s during turns, matches Robot.TURN_SPEED
    static constexpr double kDt = 0.01;         // simulation timestep, s

    explicit Robot(const WorldConfig& config = WorldConfig{}) : world_(config) {}

    /** Drive straight ahead. Stops early at a wall. */
    void forward(double meters = 0.1) { drive_for(kSpeed, kSpeed, std::abs(meters) / kSpeed); }

    /** Drive straight back. Stops early at a wall. */
    void backward(double meters = 0.1) { drive_for(-kSpeed, -kSpeed, std::abs(meters) / kSpeed); }

    /** Rotate in place, counter-clockwise. */
    void turn_left(double degrees = 90.0) { turn(degrees * kPi / 180.0); }

    /** Rotate in place, clockwise. */
    void turn_right(double degrees = 90.0) { turn(-degrees * kPi / 180.0); }

    /** Do nothing while simulation time passes. */
    void wait(double seconds = 1.0) {
        if (seconds > 0.0) drive_for(0.0, 0.0, seconds);
    }

    /** Meters from the robot's front edge to the wall it is facing. */
    double distance() const { return world_.state().distance; }

    /** Distances (m) along `rays` directions spread over `fov_degrees`,
        centered on the heading, left to right. */
    std::vector<double> lidar(int rays = 9, double fov_degrees = 180.0) const {
        if (rays < 1) return {};
        if (rays == 1) return {world_.ray(0.0)};
        const double half = fov_degrees * kPi / 360.0;
        const double step = fov_degrees * kPi / 180.0 / (rays - 1);
        std::vector<double> result;
        result.reserve(static_cast<std::size_t>(rays));
        for (int i = 0; i < rays; ++i) result.push_back(world_.ray(half - i * step));
        return result;
    }

    /** Robot heading in degrees, (-180, 180], 0 = +x, counter-clockwise. */
    double heading() const { return world_.state().pose.theta * 180.0 / kPi; }

    /** (x, y) in meters. */
    std::pair<double, double> position() const {
        const auto pose = world_.state().pose;
        return {pose.x, pose.y};
    }

    void stop() { world_.stop(); }

    /** A picture from the robot's point of view. */
    Frame camera(int width = 64, int height = 48) const {
        if (width <= 0 || height <= 0) {
            throw std::invalid_argument("camera size must be positive");
        }
        if (width > kCameraMaxWidth || height > kCameraMaxHeight) {
            throw std::invalid_argument(
                "camera size max is " + std::to_string(kCameraMaxWidth) + "x" +
                std::to_string(kCameraMaxHeight));
        }
        Frame frame;
        frame.width = width;
        frame.height = height;
        frame.pixels.resize(static_cast<std::size_t>(width) * height * 3);
        render_camera(world_, width, height, frame.pixels.data());
        return frame;
    }

    /** The underlying World, for callers that need engine-level access
        (rendering, the camera, direct state) beyond this friendly API. */
    World& engine() { return world_; }
    const World& engine() const { return world_; }

private:
    static constexpr double kPi = 3.14159265358979323846;

    void turn(double radians) {
        if (radians == 0.0) return;
        const double omega = 2.0 * kTurnSpeed / world_.config().wheel_base;
        const double duration = std::abs(radians) / omega;
        const double wheel = radians > 0.0 ? kTurnSpeed : -kTurnSpeed;
        drive_for(-wheel, wheel, duration);
    }

    void drive_for(double left, double right, double duration) {
        // Full steps plus one exact partial step, so movements land precisely.
        world_.drive(left, right);
        const auto full_steps = static_cast<long>(duration / kDt);
        const double remainder = duration - static_cast<double>(full_steps) * kDt;
        bool collided = false;
        for (long i = 0; i < full_steps; ++i) {
            world_.step(kDt);
            if (world_.state().collided) {
                collided = true;
                break;
            }
        }
        if (!collided && remainder > 1e-12) world_.step(remainder);
        world_.stop();
    }

    World world_;
};

}  // namespace okrobo
