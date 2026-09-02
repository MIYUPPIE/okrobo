#pragma once

// OKROBO engine: 4-DOF educational robot arm (base yaw + shoulder/elbow/wrist
// pitch). Joint-space kinematics: rate-limited motion toward clamped targets,
// forward kinematics for the tip. Implements contracts/robot-api/v1 (arm).
// Reference spec: runtime/python/okrobo/_sim.py (ArmWorld).
// Units: meters, radians, seconds. Pitch measured from horizontal, up positive.

#include <array>
#include <cstdint>

namespace okrobo {

constexpr int kArmJoints = 4;  // base, shoulder, elbow, wrist

struct ArmConfig {
    double base_height = 0.12;
    double link1 = 0.22;
    double link2 = 0.18;
    double link3 = 0.10;
    std::array<double, kArmJoints> lower{-3.14159265358979323846, -0.17453292519943295,
                                         -2.0943951023931953, -1.5707963267948966};
    std::array<double, kArmJoints> upper{3.14159265358979323846, 1.7453292519943295,
                                         2.0943951023931953, 1.5707963267948966};
    std::array<double, kArmJoints> speed{1.5707963267948966, 1.5707963267948966,
                                         1.5707963267948966, 1.5707963267948966};
    std::array<double, kArmJoints> start{0.0, 1.0471975511965976, -0.5235987755982988,
                                         -0.5235987755982988};
};

struct Tip {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

struct ArmState {
    std::uint64_t tick = 0;
    std::array<double, kArmJoints> angles{};
    std::array<double, kArmJoints> targets{};
    bool moving = false;
    Tip tip;
};

class ArmWorld {
public:
    explicit ArmWorld(const ArmConfig& config = ArmConfig{});

    /** Set one joint's target angle (clamped to its limits). */
    void set_target(int joint, double angle);
    /** Freeze: targets snap to the current angles. */
    void stop();
    void reset();
    void step(double dt);

    ArmState state() const;

private:
    Tip forward_kinematics() const;

    ArmConfig config_;
    std::array<double, kArmJoints> angles_;
    std::array<double, kArmJoints> targets_;
    std::uint64_t tick_ = 0;
};

}  // namespace okrobo
