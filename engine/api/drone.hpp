#pragma once

// Student-facing C++ drone API: header-only, real, and standalone.
//
//   #include "drone.hpp"
//   int main() {
//       okrobo::Drone drone;
//       drone.takeoff();
//       drone.forward(0.3);
//       drone.land();
//   }
//
// A direct C++ port of runtime/python/okrobo/drone.py: same constants, same
// blocking duration-based movement (full steps plus one exact partial
// step), same early stop on wall/floor/ceiling contact. It wraps
// engine/src/drone_world.hpp's DroneWorld, which the WASM parity gate already
// locks to the Python reference model -- this header adds no new
// kinematics, only the friendly, blocking-call shape Blocks and Python
// both generate. See engine/api/README.md to compile and run it, with no
// browser involved.
//
// Distances are meters, angles are degrees, same convention as Robot and Arm.

#include <cmath>
#include <tuple>

#include "drone_world.hpp"

namespace okrobo {

class Drone {
public:
    static constexpr double kSpeed = 0.2;          // m/s during forward/backward
    static constexpr double kVerticalSpeed = 0.1;  // m/s during up/down/takeoff/land
    static constexpr double kTurnSpeed = 1.0;      // rad/s during turns
    static constexpr double kHoverHeight = 0.4;    // meters, takeoff()'s default
    static constexpr double kDt = 0.01;            // simulation timestep, s

    explicit Drone(const DroneConfig& config = DroneConfig{}) : drone_(config) {}

    /** Rise straight up to `height` meters. */
    void takeoff(double height = kHoverHeight) { up(height - altitude()); }

    /** Descend straight down to the ground. */
    void land() { down(altitude()); }

    /** Fly straight ahead. Stops early at a wall. */
    void forward(double meters = 0.1) { drive_for(kSpeed, 0.0, 0.0, std::abs(meters) / kSpeed); }

    /** Fly straight back. Stops early at a wall. */
    void backward(double meters = 0.1) { drive_for(-kSpeed, 0.0, 0.0, std::abs(meters) / kSpeed); }

    /** Rise. Stops early at the altitude ceiling. */
    void up(double meters = 0.1) {
        if (meters <= 0.0) return;
        drive_for(0.0, kVerticalSpeed, 0.0, meters / kVerticalSpeed);
    }

    /** Descend. Stops early at the ground. */
    void down(double meters = 0.1) {
        if (meters <= 0.0) return;
        drive_for(0.0, -kVerticalSpeed, 0.0, meters / kVerticalSpeed);
    }

    /** Rotate in place, counter-clockwise. */
    void turn_left(double degrees = 90.0) { turn(degrees * kPi / 180.0); }

    /** Rotate in place, clockwise. */
    void turn_right(double degrees = 90.0) { turn(-degrees * kPi / 180.0); }

    /** Do nothing while simulation time passes. */
    void wait(double seconds = 1.0) {
        if (seconds > 0.0) drive_for(0.0, 0.0, 0.0, seconds);
    }

    /** Meters above the ground. */
    double altitude() const { return drone_.state().pose.z; }

    /** Meters from the drone to the wall it is facing (walls only; it flies above obstacles). */
    double distance() const { return drone_.state().distance; }

    /** Drone heading in degrees, (-180, 180], 0 = +x, counter-clockwise. */
    double heading() const { return drone_.state().pose.theta * 180.0 / kPi; }

    /** (x, y, z) in meters. */
    std::tuple<double, double, double> position() const {
        const auto pose = drone_.state().pose;
        return {pose.x, pose.y, pose.z};
    }

    void stop() { drone_.stop(); }

    /** The underlying DroneWorld, for callers that need engine-level access. */
    DroneWorld& engine() { return drone_; }
    const DroneWorld& engine() const { return drone_; }

private:
    static constexpr double kPi = 3.14159265358979323846;

    void turn(double radians) {
        if (radians == 0.0) return;
        const double duration = std::abs(radians) / kTurnSpeed;
        const double yaw_rate = radians > 0.0 ? kTurnSpeed : -kTurnSpeed;
        drive_for(0.0, 0.0, yaw_rate, duration);
    }

    void drive_for(double forward, double vertical, double yaw_rate, double duration) {
        if (duration <= 0.0) return;
        // Full steps plus one exact partial step, so movements land precisely.
        drone_.drive(forward, vertical, yaw_rate);
        const auto full_steps = static_cast<long>(duration / kDt);
        const double remainder = duration - static_cast<double>(full_steps) * kDt;
        bool collided = false;
        for (long i = 0; i < full_steps; ++i) {
            drone_.step(kDt);
            if (drone_.state().collided) {
                collided = true;
                break;
            }
        }
        if (!collided && remainder > 1e-12) drone_.step(remainder);
        drone_.stop();
    }

    DroneWorld drone_;
};

}  // namespace okrobo
