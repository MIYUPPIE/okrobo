#pragma once

// Robot Builder Phase 3/4: given an arbitrary RobotDef, generate an MJCF
// model and simulate it with the same vendored MuJoCo already used for the
// Arm's graspable object (physics_object.hpp). Bodies, joints, actuators
// (Phase 3), and seven of the eight sensor types (Phase 4) -- `camera` is
// not implemented, see docs/decisions/robot-builder-sensors.md. See
// docs/decisions/robot-builder-physics.md for the Phase 3 interpretive
// decisions behind the MJCF mapping (every root gets a <freejoint/>, a
// synthesized floor plane, cone->cylinder and mesh->placeholder-box
// fallbacks, why `plane` geometry and a non-root `free` joint can never
// compile, actuators targeting ball/free joints are skipped, the default
// position-actuator gain, and the open question on joint.axis's frame) and
// docs/decisions/robot-builder-sensors.md for the Phase 4 ones (the
// per-sensor <site> mechanism, the encoder-on-non-scalar-joint skip, the
// lidar params/fan-axis convention, force/torque's "parent joint reaction"
// semantics, why camera is deferred).
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
/// actuators, and seven of the eight sensor types (all but `camera`, see
/// docs/decisions/robot-builder-sensors.md).
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

    int sensor_count() const;
    /// robot.sensors[index]'s output width: fixed per type
    /// (encoder=1, gps=3, distance=1, touch=1, force_torque=6, imu=6,
    /// camera=0) except lidar, whose width is its own resolved ray count.
    /// This is the *nominal* width -- stable even when the sensor turns
    /// out to be unresolvable (e.g. an encoder on a non-scalar joint),
    /// so callers can rely on a fixed per-type shape; sync_sensor_data
    /// writes zeros for that width in that case rather than shrinking it.
    int sensor_output_count(int index) const;
    /// Sum of sensor_output_count(i) over all sensors -- the exact width
    /// sync_sensor_data needs.
    int sensor_data_count() const;
    /// Fills `out` with sensor_data_count() doubles: one contiguous block
    /// per robot.sensors[] entry, in declaration order. `out` must have at
    /// least sensor_data_count() capacity.
    void sync_sensor_data(double* out) const;

private:
    struct Impl;
    Impl* impl_ = nullptr;
};

}  // namespace okrobo
