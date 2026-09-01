#include "world.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace okrobo {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kOmegaEpsilon = 1e-9;

// Normalize to (-pi, pi].
double normalize_angle(double theta) {
    theta = std::fmod(theta + kPi, 2.0 * kPi);
    if (theta <= 0.0) theta += 2.0 * kPi;
    return theta - kPi;
}

}  // namespace

World::World(const WorldConfig& config) : config_(config), pose_(config.start) {}

void World::drive(double left, double right) {
    left_ = left;
    right_ = right;
}

void World::stop() {
    left_ = 0.0;
    right_ = 0.0;
}

void World::reset() {
    pose_ = config_.start;
    left_ = 0.0;
    right_ = 0.0;
    tick_ = 0;
    collided_ = false;
}

void World::step(double dt) {
    const double v = (left_ + right_) / 2.0;
    const double w = (right_ - left_) / config_.wheel_base;

    if (std::abs(w) < kOmegaEpsilon) {
        pose_.x += v * dt * std::cos(pose_.theta);
        pose_.y += v * dt * std::sin(pose_.theta);
    } else {
        const double r = v / w;
        pose_.x += r * (std::sin(pose_.theta + w * dt) - std::sin(pose_.theta));
        pose_.y -= r * (std::cos(pose_.theta + w * dt) - std::cos(pose_.theta));
        pose_.theta = normalize_angle(pose_.theta + w * dt);
    }

    const double min_x = config_.robot_radius;
    const double max_x = config_.arena_width - config_.robot_radius;
    const double min_y = config_.robot_radius;
    const double max_y = config_.arena_height - config_.robot_radius;
    const double clamped_x = std::clamp(pose_.x, min_x, max_x);
    const double clamped_y = std::clamp(pose_.y, min_y, max_y);
    collided_ = (clamped_x != pose_.x) || (clamped_y != pose_.y);
    pose_.x = clamped_x;
    pose_.y = clamped_y;

    ++tick_;
}

double World::sensor_distance() const {
    // Slab method: distance from robot center to the arena wall along heading,
    // minus the robot radius, floored at 0.
    const double dx = std::cos(pose_.theta);
    const double dy = std::sin(pose_.theta);
    double t = std::numeric_limits<double>::infinity();

    if (dx > kOmegaEpsilon) t = std::min(t, (config_.arena_width - pose_.x) / dx);
    if (dx < -kOmegaEpsilon) t = std::min(t, -pose_.x / dx);
    if (dy > kOmegaEpsilon) t = std::min(t, (config_.arena_height - pose_.y) / dy);
    if (dy < -kOmegaEpsilon) t = std::min(t, -pose_.y / dy);

    return std::max(0.0, t - config_.robot_radius);
}

State World::state() const {
    State s;
    s.tick = tick_;
    s.pose = pose_;
    s.distance = sensor_distance();
    s.collided = collided_;
    return s;
}

}  // namespace okrobo
