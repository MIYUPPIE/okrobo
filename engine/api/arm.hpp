#pragma once

// Student-facing C++ arm API: header-only, real, and standalone.
//
//   #include "arm.hpp"
//   int main() {
//       okrobo::Arm arm;
//       arm.move("shoulder", 80);
//       auto [x, y, z] = arm.tip();
//   }
//
// A direct C++ port of runtime/python/okrobo/arm.py: same blocking-until-
// arrival semantics, same safety bound on a single motion. It wraps
// engine/src/arm_world.hpp's ArmWorld, which the WASM parity gate already locks
// to the Python reference model -- this header adds no new kinematics, only
// the friendly, blocking-call shape Blocks and Python both generate. See
// engine/api/README.md to compile and run it, with no browser involved.
//
// Angles are degrees at this API (radians internally), like Robot/Drone.
// Joints, in order: base (yaw), shoulder, elbow, wrist.

#include <array>
#include <cctype>
#include <stdexcept>
#include <string>
#include <tuple>

#include "arm_world.hpp"

namespace okrobo {

namespace detail {

inline std::string to_lower(const std::string& s) {
    std::string out = s;
    for (char& c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return out;
}

inline int arm_joint_index(const std::string& joint) {
    static constexpr std::array<const char*, kArmJoints> kNames = {"base", "shoulder", "elbow", "wrist"};
    const std::string lower = to_lower(joint);
    for (int i = 0; i < kArmJoints; ++i) {
        if (lower == kNames[i]) return i;
    }
    throw std::invalid_argument("unknown joint: " + joint);
}

}  // namespace detail

class Arm {
public:
    static constexpr double kDt = 0.01;         // simulation timestep, s
    static constexpr double kMaxSeconds = 30.0;  // safety bound for a single blocking motion

    explicit Arm(const ArmConfig& config = ArmConfig{}) : arm_(config) {}

    /** Move one joint (by index, 0=base..3=wrist) to an absolute angle and wait until it arrives. */
    void move(int joint, double degrees) {
        arm_.set_target(joint, degrees * kPi / 180.0);
        settle();
    }

    /** Move one joint (by name: "base"/"shoulder"/"elbow"/"wrist") to an absolute angle. */
    void move(const std::string& joint, double degrees) { move(detail::arm_joint_index(joint), degrees); }

    /** Move every joint to absolute angles [base, shoulder, elbow, wrist] and wait until they arrive. */
    void move_all(const std::array<double, kArmJoints>& degrees) {
        for (int j = 0; j < kArmJoints; ++j) arm_.set_target(j, degrees[j] * kPi / 180.0);
        settle();
    }

    /** Current joint angles in degrees [base, shoulder, elbow, wrist]. */
    std::array<double, kArmJoints> angles() const {
        const auto state = arm_.state();
        std::array<double, kArmJoints> result{};
        for (int j = 0; j < kArmJoints; ++j) result[j] = state.angles[j] * 180.0 / kPi;
        return result;
    }

    /** (x, y, z) of the arm's tip in meters. */
    std::tuple<double, double, double> tip() const {
        const auto t = arm_.state().tip;
        return {t.x, t.y, t.z};
    }

    /** Do nothing while simulation time passes. */
    void wait(double seconds = 1.0) {
        const auto steps = static_cast<long>(seconds / kDt + 0.5);
        for (long i = 0; i < steps; ++i) arm_.step(kDt);
    }

    void stop() { arm_.stop(); }

    /** The underlying ArmWorld, for callers that need engine-level access. */
    ArmWorld& engine() { return arm_; }
    const ArmWorld& engine() const { return arm_; }

private:
    static constexpr double kPi = 3.14159265358979323846;

    void settle() {
        const auto max_steps = static_cast<long>(kMaxSeconds / kDt);
        for (long i = 0; i < max_steps; ++i) {
            if (!arm_.state().moving) return;
            arm_.step(kDt);
        }
    }

    ArmWorld arm_;
};

}  // namespace okrobo
