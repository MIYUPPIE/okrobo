#pragma once

// Robot Builder Phase 3: given an arbitrary RobotDef, generate an MJCF
// model and simulate it with the same vendored MuJoCo already used for the
// Arm's graspable object (physics_object.hpp). No sensors (Phase 4). See
// docs/decisions/robot-builder-physics.md for the interpretive decisions
// behind the MJCF mapping (every root gets a <freejoint/>, a synthesized
// floor plane, cone->cylinder and mesh->placeholder-box fallbacks, why
// `plane` geometry and a non-root `free` joint can never compile, actuators
// targeting ball/free joints are skipped, the default position-actuator
// gain, and the open question on joint.axis's frame).
//
// No MuJoCo type appears in this header -- only built_robot.cpp includes
// <mujoco/mujoco.h>, same posture as physics_object.hpp.

#include "robot_def.hpp"

#include <string>
#include <vector>

namespace okrobo {

/// Generates an MJCF document for `robot`. Exposed standalone (not just
/// inside BuiltRobot) so it has its own test coverage independent of
/// whether MuJoCo can actually compile the result.
std::string GenerateMjcf(const RobotDef& robot);

struct BuiltBodyPose {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    // MuJoCo's native quaternion order (w,x,y,z) -- deliberately not
    // reordered here; the one call site that needs three.js's (x,y,z,w)
    // order (apps/studio/src/engine/EngineBuiltRobot.ts) does that reorder
    // explicitly, not silently.
    double qw = 1.0;
    double qx = 0.0;
    double qy = 0.0;
    double qz = 0.0;
};

/// A simulated instance of an arbitrary robot-def document. Bodies, joints,
/// and actuators only -- no sensors (Phase 4).
class BuiltRobot {
public:
    /// Throws std::runtime_error if `robot` can't be turned into a
    /// compilable MJCF model (e.g. a `plane`-geometry body, or a non-root
    /// `free` joint -- see docs/decisions/robot-builder-physics.md).
    explicit BuiltRobot(const RobotDef& robot);
    ~BuiltRobot();
    BuiltRobot(const BuiltRobot&) = delete;
    BuiltRobot& operator=(const BuiltRobot&) = delete;

    /// Advances the simulation by dt, in fixed 0.002s substeps.
    void step(double dt);

    int body_count() const;
    /// robot.bodies[index]'s current world pose. Out-of-range returns a
    /// default-constructed pose rather than throwing (a hot per-frame path
    /// from WASM, not a place to raise exceptions across the ABI).
    BuiltBodyPose body_pose(int index) const;

    int actuator_count() const;
    /// robot.actuators[index]'s control value, clamped to the actuator's
    /// MJCF ctrlrange when one was generated. Returns false (a no-op) if
    /// that actuator has no MJCF equivalent (it targets a ball/free joint)
    /// or the index is out of range.
    bool set_actuator_ctrl(int index, double value);

private:
    struct Impl;
    Impl* impl_ = nullptr;
};

}  // namespace okrobo
