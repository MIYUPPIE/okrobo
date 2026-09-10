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

    // Obstacle collision: standard circle-vs-AABB push-out, resolved
    // sequentially per obstacle (a later obstacle in the same tick sees the
    // already-corrected position) -- geometrically correct at corners,
    // unlike clamping x/y independently against an inflated box. Mirrored
    // line-for-line in runtime/python/okrobo/_sim.py's own World.step;
    // engine/tests/parity/parity.mjs locks the two together, so any change
    // here must land there too. Runs before the wall clamp below, which
    // stays the final authority on where the robot ends up.
    bool obstacle_collided = false;
    for (int i = 0; i < config_.obstacle_count; ++i) {
        const Obstacle& box = config_.obstacles[i];
        const double half_w = box.width / 2.0;
        const double half_h = box.height / 2.0;
        const double closest_x = std::clamp(pose_.x, box.x - half_w, box.x + half_w);
        const double closest_y = std::clamp(pose_.y, box.y - half_h, box.y + half_h);
        double dx = pose_.x - closest_x;
        double dy = pose_.y - closest_y;
        const double r2 = config_.robot_radius * config_.robot_radius;
        if (dx * dx + dy * dy < r2) {
            double dist = std::sqrt(dx * dx + dy * dy);
            if (dist < kOmegaEpsilon) {
                // Degenerate: the robot's own centre sits exactly on/inside
                // the box's own boundary point (only reachable if it spawned
                // inside an obstacle or overshot severely in one tick) --
                // push away from the box's own centre instead.
                dx = pose_.x - box.x;
                dy = pose_.y - box.y;
                dist = std::sqrt(dx * dx + dy * dy);
                if (dist < kOmegaEpsilon) {
                    dx = 1.0;
                    dy = 0.0;
                    dist = 1.0;
                }
            }
            pose_.x = closest_x + (dx / dist) * config_.robot_radius;
            pose_.y = closest_y + (dy / dist) * config_.robot_radius;
            obstacle_collided = true;
        }
    }

    const double min_x = config_.robot_radius;
    const double max_x = config_.arena_width - config_.robot_radius;
    const double min_y = config_.robot_radius;
    const double max_y = config_.arena_height - config_.robot_radius;
    const double clamped_x = std::clamp(pose_.x, min_x, max_x);
    const double clamped_y = std::clamp(pose_.y, min_y, max_y);
    collided_ = obstacle_collided || (clamped_x != pose_.x) || (clamped_y != pose_.y);
    pose_.x = clamped_x;
    pose_.y = clamped_y;

    ++tick_;
}

void World::add_obstacle(const Obstacle& obstacle) {
    if (config_.obstacle_count >= kMaxObstacles) return;
    config_.obstacles[config_.obstacle_count++] = obstacle;
}

double World::sensor_distance() const {
    return ray(0.0);
}

double World::ray(double offset) const {
    return ray_hit(offset).distance;
}

RayHit World::ray_hit(double offset) const {
    // Slab method against the arena, then against every obstacle box; the
    // nearest hit wins and carries its colour.
    const double dx = std::cos(pose_.theta + offset);
    const double dy = std::sin(pose_.theta + offset);

    double t = std::numeric_limits<double>::infinity();
    if (dx > kOmegaEpsilon) t = std::min(t, (config_.arena_width - pose_.x) / dx);
    if (dx < -kOmegaEpsilon) t = std::min(t, -pose_.x / dx);
    if (dy > kOmegaEpsilon) t = std::min(t, (config_.arena_height - pose_.y) / dy);
    if (dy < -kOmegaEpsilon) t = std::min(t, -pose_.y / dy);

    RayHit hit;
    // Walls are grey; obstacles override with their own colour when nearer.
    hit.r = hit.g = hit.b = 90;

    for (int i = 0; i < config_.obstacle_count; ++i) {
        const Obstacle& box = config_.obstacles[i];
        const double min_x = box.x - box.width / 2.0;
        const double max_x = box.x + box.width / 2.0;
        const double min_y = box.y - box.height / 2.0;
        const double max_y = box.y + box.height / 2.0;

        // Ray/AABB slab intersection.
        double near = 0.0;
        double far = t;
        bool miss = false;

        for (int axis = 0; axis < 2 && !miss; ++axis) {
            const double origin = axis == 0 ? pose_.x : pose_.y;
            const double direction = axis == 0 ? dx : dy;
            const double lo = axis == 0 ? min_x : min_y;
            const double hi = axis == 0 ? max_x : max_y;

            if (std::abs(direction) < kOmegaEpsilon) {
                if (origin < lo || origin > hi) miss = true;
                continue;
            }
            double t1 = (lo - origin) / direction;
            double t2 = (hi - origin) / direction;
            if (t1 > t2) std::swap(t1, t2);
            near = std::max(near, t1);
            far = std::min(far, t2);
            if (near > far) miss = true;
        }

        if (!miss && near < t) {
            t = near;
            hit.r = box.r;
            hit.g = box.g;
            hit.b = box.b;
        }
    }

    hit.distance = std::max(0.0, t - config_.robot_radius);
    return hit;
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
