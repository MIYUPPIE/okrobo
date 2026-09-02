#include "drone.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace okrobo {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kEpsilon = 1e-9;

// Normalize to (-pi, pi].
double normalize_angle(double theta) {
    theta = std::fmod(theta + kPi, 2.0 * kPi);
    if (theta <= 0.0) theta += 2.0 * kPi;
    return theta - kPi;
}

}  // namespace

Drone::Drone(const DroneConfig& config) : config_(config), pose_(config.start) {}

void Drone::drive(double forward, double vertical, double yaw_rate) {
    forward_ = forward;
    vertical_ = vertical;
    yaw_rate_ = yaw_rate;
}

void Drone::stop() {
    forward_ = 0.0;
    vertical_ = 0.0;
    yaw_rate_ = 0.0;
}

void Drone::reset() {
    pose_ = config_.start;
    forward_ = 0.0;
    vertical_ = 0.0;
    yaw_rate_ = 0.0;
    tick_ = 0;
    collided_ = false;
}

void Drone::step(double dt) {
    pose_.x += forward_ * dt * std::cos(pose_.theta);
    pose_.y += forward_ * dt * std::sin(pose_.theta);
    pose_.z += vertical_ * dt;
    pose_.theta = normalize_angle(pose_.theta + yaw_rate_ * dt);

    const double min_x = config_.robot_radius;
    const double max_x = config_.arena_width - config_.robot_radius;
    const double min_y = config_.robot_radius;
    const double max_y = config_.arena_height - config_.robot_radius;
    const double clamped_x = std::clamp(pose_.x, min_x, max_x);
    const double clamped_y = std::clamp(pose_.y, min_y, max_y);
    const double clamped_z = std::clamp(pose_.z, 0.0, config_.max_altitude);
    collided_ = (clamped_x != pose_.x) || (clamped_y != pose_.y) || (clamped_z != pose_.z);
    pose_.x = clamped_x;
    pose_.y = clamped_y;
    pose_.z = clamped_z;

    ++tick_;
}

double Drone::sensor_distance() const {
    return ray(0.0);
}

double Drone::ray(double offset) const {
    const double dx = std::cos(pose_.theta + offset);
    const double dy = std::sin(pose_.theta + offset);

    double t = std::numeric_limits<double>::infinity();
    if (dx > kEpsilon) t = std::min(t, (config_.arena_width - pose_.x) / dx);
    if (dx < -kEpsilon) t = std::min(t, -pose_.x / dx);
    if (dy > kEpsilon) t = std::min(t, (config_.arena_height - pose_.y) / dy);
    if (dy < -kEpsilon) t = std::min(t, -pose_.y / dy);

    return std::max(0.0, t - config_.robot_radius);
}

DroneState Drone::state() const {
    DroneState s;
    s.tick = tick_;
    s.pose = pose_;
    s.distance = sensor_distance();
    s.collided = collided_;
    return s;
}

}  // namespace okrobo
