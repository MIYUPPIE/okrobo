#include "arm.hpp"

#include <algorithm>
#include <cmath>

namespace okrobo {

namespace {
constexpr double kEpsilon = 1e-9;
}

Arm::Arm(const ArmConfig& config) : config_(config), angles_(config.start), targets_(config.start) {}

void Arm::set_target(int joint, double angle) {
    if (joint < 0 || joint >= kArmJoints) return;
    targets_[joint] = std::clamp(angle, config_.lower[joint], config_.upper[joint]);
}

void Arm::stop() {
    targets_ = angles_;
}

void Arm::reset() {
    angles_ = config_.start;
    targets_ = config_.start;
    tick_ = 0;
}

void Arm::step(double dt) {
    for (int j = 0; j < kArmJoints; ++j) {
        const double max_delta = config_.speed[j] * dt;
        const double delta = std::clamp(targets_[j] - angles_[j], -max_delta, max_delta);
        angles_[j] += delta;
    }
    ++tick_;
}

Tip Arm::forward_kinematics() const {
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

ArmState Arm::state() const {
    ArmState s;
    s.tick = tick_;
    s.angles = angles_;
    s.targets = targets_;
    s.moving = false;
    for (int j = 0; j < kArmJoints; ++j) {
        if (std::abs(targets_[j] - angles_[j]) > kEpsilon) s.moving = true;
    }
    s.tip = forward_kinematics();
    return s;
}

}  // namespace okrobo
