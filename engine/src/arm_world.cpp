#include "arm_world.hpp"

#include <algorithm>
#include <cmath>

namespace okrobo {

namespace {
constexpr double kEpsilon = 1e-9;
}

ArmWorld::ArmWorld(const ArmConfig& config, const PhysicsObjectConfig& object_config)
    : config_(config), angles_(config.start), targets_(config.start), object_(object_config) {}

void ArmWorld::set_target(int joint, double angle) {
    if (joint < 0 || joint >= kArmJoints) return;
    targets_[joint] = std::clamp(angle, config_.lower[joint], config_.upper[joint]);
}

void ArmWorld::stop() {
    targets_ = angles_;
}

void ArmWorld::reset() {
    angles_ = config_.start;
    targets_ = config_.start;
    tick_ = 0;
    holding_ = false;
    object_.reset();
}

void ArmWorld::step(double dt) {
    for (int j = 0; j < kArmJoints; ++j) {
        const double max_delta = config_.speed[j] * dt;
        const double delta = std::clamp(targets_[j] - angles_[j], -max_delta, max_delta);
        angles_[j] += delta;
    }
    if (holding_) {
        const Tip tip = forward_kinematics();
        object_.set_kinematic({tip.x, tip.y, tip.z});
    } else {
        object_.step(dt);
    }
    ++tick_;
}

bool ArmWorld::grip() {
    if (holding_) return true;
    const Tip tip = forward_kinematics();
    const Vec3 object_pos = object_.position();
    const double dx = tip.x - object_pos.x;
    const double dy = tip.y - object_pos.y;
    const double dz = tip.z - object_pos.z;
    if (dx * dx + dy * dy + dz * dz > kGraspTolerance * kGraspTolerance) return false;
    holding_ = true;
    object_.set_kinematic({tip.x, tip.y, tip.z});
    return true;
}

void ArmWorld::release() {
    if (!holding_) return;
    holding_ = false;
    const Vec3 drop_pos = object_.position();
    object_.release(drop_pos);
}

Tip ArmWorld::forward_kinematics() const {
    const double a1 = angles_[1];
    const double a2 = a1 + angles_[2];
    const double a3 = a2 + angles_[3];
    const double r = config_.link1 * std::cos(a1) + config_.link2 * std::cos(a2) +
                     config_.link3 * std::cos(a3);
    const double z = config_.base_height + config_.link1 * std::sin(a1) +
                     config_.link2 * std::sin(a2) + config_.link3 * std::sin(a3);
    Tip tip;
    tip.x = r * std::cos(angles_[0]);
    tip.y = r * std::sin(angles_[0]);
    tip.z = z;
    return tip;
}

ArmState ArmWorld::state() const {
    ArmState s;
    s.tick = tick_;
    s.angles = angles_;
    s.targets = targets_;
    s.moving = false;
    for (int j = 0; j < kArmJoints; ++j) {
        if (std::abs(targets_[j] - angles_[j]) > kEpsilon) s.moving = true;
    }
    s.tip = forward_kinematics();
    s.holding = holding_;
    s.object = object_.position();
    return s;
}

}  // namespace okrobo
