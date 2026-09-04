// Gate tests for GenerateMjcf/BuiltRobot. Plain asserts, no framework, run
// by ctest. Fixtures read via OKROBO_ROBOT_DEF_CONTRACT_DIR (see
// engine/CMakeLists.txt), same convention as test_robot_def.cpp/test_robot_tree.cpp.

#include "built_robot.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

namespace fs = std::filesystem;

const fs::path kContractDir = OKROBO_ROBOT_DEF_CONTRACT_DIR;

std::string ReadFile(const fs::path& path) {
    std::ifstream file(path);
    if (!file) {
        std::fprintf(stderr, "built_robot test: cannot open %s\n", path.string().c_str());
        std::abort();
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

okrobo::RobotDef LoadExample(const std::string& name) {
    return okrobo::ParseRobotDef(ReadFile(kContractDir / "examples" / (name + ".json")));
}

void Run(okrobo::BuiltRobot& robot, double seconds, double dt = 0.01) {
    const int steps = static_cast<int>(std::round(seconds / dt));
    for (int i = 0; i < steps; ++i) robot.step(dt);
}

// GenerateMjcf produces a document MuJoCo can actually compile, for both
// shipped examples.
void TestExamplesCompile() {
    { okrobo::BuiltRobot robot(LoadExample("single-body")); }
    { okrobo::BuiltRobot robot(LoadExample("two-link-arm")); }
}

okrobo::Inertia MakeInertia(double v) { return {v, v, v}; }

// A single free-floating box, dropped from height, settles on the floor at
// its own half-height with no lateral drift.
void TestDropAndSettle() {
    okrobo::RobotDef robot;
    robot.id = "drop-test";
    robot.name = "Drop Test";
    robot.root_placement.position = {0.0, 0.0, 0.5};

    okrobo::Body box;
    box.id = "box";
    box.name = "Box";
    box.mass = 1.0;
    box.inertia = MakeInertia(0.01);
    box.has_collision = true;
    box.collision.type = okrobo::GeometryType::kBox;
    box.collision.size = {0.2, 0.15, 0.08};
    robot.bodies.push_back(box);

    okrobo::BuiltRobot built(robot);
    Run(built, 2.0);

    const auto pose = built.body_pose(0);
    std::fprintf(stderr, "drop-and-settle: x=%.6f y=%.6f z=%.6f\n", pose.x, pose.y, pose.z);
    assert(std::abs(pose.x) < 1e-6);
    assert(std::abs(pose.y) < 1e-6);
    assert(std::abs(pose.z - 0.04) < 5e-3);  // half the box's z extent (0.08/2)
}

// A servo actuator drives its target joint's child body to move measurably
// from wherever it settled without actuation -- proof the actuator path
// (MJCF <position>, ctrl write, real dynamics) actually works end to end.
void TestActuatorMovesJoint() {
    okrobo::RobotDef robot;
    robot.id = "actuator-test";
    robot.name = "Actuator Test";
    robot.root_placement.position = {0.0, 0.0, 0.05};

    okrobo::Body base;
    base.id = "base";
    base.name = "Base";
    base.mass = 0.5;
    base.inertia = MakeInertia(0.01);
    base.has_collision = true;
    base.collision.type = okrobo::GeometryType::kBox;
    base.collision.size = {0.1, 0.1, 0.05};
    robot.bodies.push_back(base);

    okrobo::Body link1;
    link1.id = "link1";
    link1.name = "Link 1";
    link1.mass = 0.1;
    link1.inertia = MakeInertia(0.001);
    link1.has_collision = true;
    link1.collision.type = okrobo::GeometryType::kBox;
    link1.collision.size = {0.2, 0.04, 0.04};
    link1.transform.position = {0.1, 0.0, 0.0};  // mass offset along local x, away from the joint
    robot.bodies.push_back(link1);

    okrobo::Joint hinge;
    hinge.id = "joint1";
    hinge.name = "Joint 1";
    hinge.type = okrobo::JointType::kHinge;
    hinge.parent = "base";
    hinge.child = "link1";
    hinge.axis = {0.0, 1.0, 0.0};
    hinge.has_limits = true;
    hinge.limits = {-3.14, 3.14};
    hinge.has_damping = true;
    hinge.damping = 0.5;  // damped, so the un-actuated rest pose is well-defined, not an undamped pendulum
    robot.joints.push_back(hinge);

    okrobo::Actuator servo;
    servo.id = "shoulder";
    servo.name = "Shoulder";
    servo.type = "servo";
    servo.target_joint = "joint1";
    robot.actuators.push_back(servo);

    okrobo::BuiltRobot built(robot);
    assert(built.actuator_count() == 1);

    // Let it settle onto the floor and the un-actuated joint damp to rest
    // under gravity before recording a baseline.
    Run(built, 1.5);
    const auto before = built.body_pose(1);  // link1 is robot.bodies[1]

    const bool ok = built.set_actuator_ctrl(0, 1.5);
    assert(ok);
    Run(built, 2.0);
    const auto after = built.body_pose(1);

    const double moved =
        std::sqrt((after.x - before.x) * (after.x - before.x) + (after.y - before.y) * (after.y - before.y) +
                   (after.z - before.z) * (after.z - before.z));
    std::fprintf(stderr, "actuator-moves-joint: before=(%.4f,%.4f,%.4f) after=(%.4f,%.4f,%.4f) moved=%.4f\n",
                 before.x, before.y, before.z, after.x, after.y, after.z, moved);
    assert(moved > 0.03);

    // An out-of-range actuator index is a documented no-op, not a crash.
    assert(!built.set_actuator_ctrl(5, 1.0));
}

// ---- Robot Builder Phase 4: sensors ----
// See docs/decisions/robot-builder-sensors.md.

okrobo::RobotDef MakeHingeArm() {
    okrobo::RobotDef robot;
    robot.id = "sensor-test";
    robot.name = "Sensor Test";
    robot.root_placement.position = {0.0, 0.0, 0.05};

    okrobo::Body base;
    base.id = "base";
    base.name = "Base";
    base.mass = 0.5;
    base.inertia = MakeInertia(0.01);
    base.has_collision = true;
    base.collision.type = okrobo::GeometryType::kBox;
    base.collision.size = {0.1, 0.1, 0.05};
    robot.bodies.push_back(base);

    okrobo::Body link1;
    link1.id = "link1";
    link1.name = "Link 1";
    link1.mass = 0.1;
    link1.inertia = MakeInertia(0.001);
    link1.has_collision = true;
    link1.collision.type = okrobo::GeometryType::kBox;
    link1.collision.size = {0.2, 0.04, 0.04};
    link1.transform.position = {0.1, 0.0, 0.0};
    robot.bodies.push_back(link1);

    okrobo::Joint hinge;
    hinge.id = "joint1";
    hinge.name = "Joint 1";
    hinge.type = okrobo::JointType::kHinge;
    hinge.parent = "base";
    hinge.child = "link1";
    hinge.axis = {0.0, 1.0, 0.0};
    hinge.has_limits = true;
    hinge.limits = {-3.14, 3.14};
    hinge.has_damping = true;
    hinge.damping = 0.5;
    robot.joints.push_back(hinge);

    okrobo::Actuator servo;
    servo.id = "shoulder";
    servo.name = "Shoulder";
    servo.type = "servo";
    servo.target_joint = "joint1";
    robot.actuators.push_back(servo);

    return robot;
}

// An encoder reads back the settled angle a servo actuator drove its joint to.
void TestEncoderReadsJointAngle() {
    okrobo::RobotDef robot = MakeHingeArm();
    okrobo::Sensor encoder;
    encoder.id = "axle_encoder";
    encoder.name = "Axle Encoder";
    encoder.type = "encoder";
    encoder.body = "link1";
    encoder.has_joint = true;
    encoder.joint = "joint1";
    robot.sensors.push_back(encoder);

    okrobo::BuiltRobot built(robot);
    assert(built.sensor_count() == 1);
    assert(built.sensor_output_count(0) == 1);

    built.set_actuator_ctrl(0, 1.0);
    Run(built, 3.0);

    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    std::fprintf(stderr, "encoder: reading=%.4f (target 1.0)\n", data[0]);
    assert(std::abs(data[0] - 1.0) < 0.05);
}

// An encoder targeting a non-scalar joint is silently skipped: the robot
// still constructs, the sensor still exists and reports its nominal width,
// but reads back zero rather than crashing the whole document.
void TestEncoderSkipsNonScalarJoint() {
    okrobo::RobotDef robot;
    robot.id = "encoder-skip-test";
    robot.name = "Encoder Skip Test";
    robot.root_placement.position = {0.0, 0.0, 0.5};

    okrobo::Body base;
    base.id = "base";
    base.name = "Base";
    base.mass = 0.5;
    base.inertia = MakeInertia(0.01);
    base.has_collision = true;
    base.collision.type = okrobo::GeometryType::kBox;
    base.collision.size = {0.1, 0.1, 0.05};
    robot.bodies.push_back(base);

    okrobo::Body link1;
    link1.id = "link1";
    link1.name = "Link 1";
    link1.mass = 0.1;
    link1.inertia = MakeInertia(0.001);
    robot.bodies.push_back(link1);

    okrobo::Joint ball;
    ball.id = "joint1";
    ball.name = "Joint 1";
    ball.type = okrobo::JointType::kBall;
    ball.parent = "base";
    ball.child = "link1";
    robot.joints.push_back(ball);

    okrobo::Sensor encoder;
    encoder.id = "bad_encoder";
    encoder.name = "Bad Encoder";
    encoder.type = "encoder";
    encoder.body = "link1";
    encoder.has_joint = true;
    encoder.joint = "joint1";
    robot.sensors.push_back(encoder);

    okrobo::BuiltRobot built(robot);  // must not throw
    assert(built.sensor_output_count(0) == 1);
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    assert(data[0] == 0.0);
}

// A gps sensor with an identity mount transform reads the same world
// position as its mounting body's own body_pose.
void TestGpsMatchesBodyPose() {
    okrobo::RobotDef robot;
    robot.id = "gps-test";
    robot.name = "GPS Test";
    robot.root_placement.position = {0.3, -0.2, 0.5};

    okrobo::Body box;
    box.id = "box";
    box.name = "Box";
    box.mass = 1.0;
    box.inertia = MakeInertia(0.01);
    box.has_collision = true;
    box.collision.type = okrobo::GeometryType::kBox;
    box.collision.size = {0.2, 0.15, 0.08};
    robot.bodies.push_back(box);

    okrobo::Sensor gps;
    gps.id = "position";
    gps.name = "Position";
    gps.type = "gps";
    gps.body = "box";
    robot.sensors.push_back(gps);

    okrobo::BuiltRobot built(robot);
    Run(built, 2.0);

    const auto pose = built.body_pose(0);
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    std::fprintf(stderr, "gps: body=(%.4f,%.4f,%.4f) sensor=(%.4f,%.4f,%.4f)\n", pose.x, pose.y, pose.z, data[0],
                 data[1], data[2]);
    assert(std::abs(data[0] - pose.x) < 1e-6);
    assert(std::abs(data[1] - pose.y) < 1e-6);
    assert(std::abs(data[2] - pose.z) < 1e-6);
}

// A downward-facing rangefinder, read immediately at construction (before
// any falling has occurred), measures the body's exact starting height
// above the floor plane at z=0.
void TestDistanceReadsFloorHeight() {
    okrobo::RobotDef robot;
    robot.id = "distance-test";
    robot.name = "Distance Test";
    robot.root_placement.position = {0.0, 0.0, 0.5};

    okrobo::Body box;
    box.id = "box";
    box.name = "Box";
    box.mass = 1.0;
    box.inertia = MakeInertia(0.01);
    box.has_collision = true;
    box.collision.type = okrobo::GeometryType::kBox;
    box.collision.size = {0.1, 0.1, 0.08};
    robot.bodies.push_back(box);

    okrobo::Sensor rangefinder;
    rangefinder.id = "down_range";
    rangefinder.name = "Down Range";
    rangefinder.type = "distance";
    rangefinder.body = "box";
    // Rotate 180 degrees around Y: local +Z (the rangefinder's own forward
    // axis) flips from world +Z to world -Z, i.e. pointing at the floor.
    rangefinder.transform.rotation_rpy = {0.0, 3.14159265358979323846, 0.0};
    robot.sensors.push_back(rangefinder);

    okrobo::BuiltRobot built(robot);  // mj_forward has run once; nothing has fallen yet
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    std::fprintf(stderr, "distance: reading=%.4f (expected close to 0.5)\n", data[0]);
    assert(std::abs(data[0] - 0.5) < 0.02);
}

// A touch sensor on a body's underside reads (near) zero before it has
// settled onto the floor, and a real nonzero contact force once it has.
// Uses a sphere, not a box: a box resting on a plane contacts near its four
// corners (a box-plane collision generates a contact point per corner, not
// one at the center), which would sit well outside a small touch zone
// positioned at the center of the bottom face. A sphere-on-plane contact is
// exactly one point, directly below the sphere's own center -- the correct
// shape to test the sensor mechanism itself without a geometry-distribution
// confound.
void TestTouchDetectsFloorContact() {
    okrobo::RobotDef robot;
    robot.id = "touch-test";
    robot.name = "Touch Test";
    robot.root_placement.position = {0.0, 0.0, 0.5};

    constexpr double kRadius = 0.08;
    okrobo::Body ball;
    ball.id = "ball";
    ball.name = "Ball";
    ball.mass = 1.0;
    ball.inertia = MakeInertia(0.01);
    ball.has_collision = true;
    ball.collision.type = okrobo::GeometryType::kSphere;
    ball.collision.radius = kRadius;
    robot.bodies.push_back(ball);

    okrobo::Sensor touch;
    touch.id = "belly";
    touch.name = "Belly";
    touch.type = "touch";
    touch.body = "ball";
    touch.transform.position = {0.0, 0.0, -kRadius};  // directly below center, where the one contact point lands
    robot.sensors.push_back(touch);

    okrobo::BuiltRobot built(robot);
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));

    built.sync_sensor_data(data.data());
    const double before = data[0];

    Run(built, 2.0);
    built.sync_sensor_data(data.data());
    const double after = data[0];

    std::fprintf(stderr, "touch: before=%.4f after=%.4f\n", before, after);
    assert(before == 0.0);
    assert(after > 0.0);
}

// force_torque on the driven link of a loaded, actuated joint reads a real
// nonzero interaction force with its parent body.
void TestForceTorqueNonzeroOnLoadedJoint() {
    okrobo::RobotDef robot = MakeHingeArm();
    okrobo::Sensor ft;
    ft.id = "axle_ft";
    ft.name = "Axle F/T";
    ft.type = "force_torque";
    ft.body = "link1";
    robot.sensors.push_back(ft);

    okrobo::BuiltRobot built(robot);
    built.set_actuator_ctrl(0, 1.0);
    Run(built, 3.0);

    assert(built.sensor_output_count(0) == 6);
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    const double force_mag = std::sqrt(data[0] * data[0] + data[1] * data[1] + data[2] * data[2]);
    const double torque_mag = std::sqrt(data[3] * data[3] + data[4] * data[4] + data[5] * data[5]);
    std::fprintf(stderr, "force_torque: |force|=%.4f |torque|=%.4f\n", force_mag, torque_mag);
    assert(force_mag > 0.01);
}

// An accelerometer on a body at rest on the floor reads the reaction force
// countering gravity: approximately (0, 0, +9.81) m/s^2, not zero -- proper
// acceleration, the standard IMU convention, verified numerically rather
// than assumed (docs/decisions/robot-builder-sensors.md).
void TestImuAccelerometerReadsGravityAtRest() {
    okrobo::RobotDef robot;
    robot.id = "imu-test";
    robot.name = "IMU Test";
    robot.root_placement.position = {0.0, 0.0, 0.5};

    okrobo::Body box;
    box.id = "box";
    box.name = "Box";
    box.mass = 1.0;
    box.inertia = MakeInertia(0.01);
    box.has_collision = true;
    box.collision.type = okrobo::GeometryType::kBox;
    box.collision.size = {0.2, 0.15, 0.08};
    robot.bodies.push_back(box);

    okrobo::Sensor imu;
    imu.id = "imu";
    imu.name = "IMU";
    imu.type = "imu";
    imu.body = "box";
    robot.sensors.push_back(imu);

    okrobo::BuiltRobot built(robot);
    Run(built, 2.0);  // settle onto the floor first

    assert(built.sensor_output_count(0) == 6);
    std::vector<double> data(static_cast<size_t>(built.sensor_data_count()));
    built.sync_sensor_data(data.data());
    std::fprintf(stderr, "imu: accel=(%.4f,%.4f,%.4f) gyro=(%.4f,%.4f,%.4f)\n", data[0], data[1], data[2], data[3],
                 data[4], data[5]);
    const double accel_mag = std::sqrt(data[0] * data[0] + data[1] * data[1] + data[2] * data[2]);
    assert(std::abs(accel_mag - 9.81) < 0.5);
    assert(data[2] > 0.0);  // pointing up: the reaction force countering gravity
}

// An open-range lidar reads its cutoff/miss value on every ray with nothing
// in front of it, and a real, smaller distance on at least one ray once an
// obstacle is placed in its path.
void TestLidarReadsOpenRangeThenBlocked() {
    auto build = [](bool with_obstacle) {
        okrobo::RobotDef robot;
        robot.id = "lidar-test";
        robot.name = "Lidar Test";
        robot.root_placement.position = {0.0, 0.0, 0.5};

        okrobo::Body box;
        box.id = "box";
        box.name = "Box";
        box.mass = 1.0;
        box.inertia = MakeInertia(0.01);
        box.has_collision = true;
        box.collision.type = okrobo::GeometryType::kBox;
        box.collision.size = {0.1, 0.1, 0.08};
        robot.bodies.push_back(box);

        okrobo::Sensor lidar;
        lidar.id = "scan";
        lidar.name = "Scan";
        lidar.type = "lidar";
        lidar.body = "box";
        // Local +Z ("forward", matching <rangefinder>'s own convention)
        // starts pointing along the body's own +Z (up, since the body has
        // no rotation). Rotate 90 degrees around Y so it points along
        // world +X instead, toward the wall placed below.
        lidar.transform.rotation_rpy = {0.0, 3.14159265358979323846 / 2.0, 0.0};
        // Narrow (not the usual 180 degree default): a wide fan's downward-
        // tilted rays legitimately hit the floor at a real distance even
        // with no obstacle in front, which is correct lidar behavior but
        // not what this test wants to isolate -- a near-horizontal scan
        // that only the wall (not the floor) should interrupt.
        lidar.params_json = R"({"rays": 5, "fov_degrees": 10})";
        robot.sensors.push_back(lidar);

        if (with_obstacle) {
            okrobo::Body wall;
            wall.id = "wall";
            wall.name = "Wall";
            wall.mass = 1.0;
            wall.inertia = MakeInertia(0.01);
            wall.has_collision = true;
            wall.collision.type = okrobo::GeometryType::kBox;
            wall.collision.size = {0.05, 1.0, 1.0};
            wall.transform.position = {0.6, 0.0, 0.0};  // ahead of the sensor's rotated local +Z (world +X)
            // A second, unconnected root body -- also gets its own
            // <freejoint/>, but sensor data is read immediately below with
            // no step() calls first, so it has no chance to fall.
            robot.bodies.push_back(wall);
        }
        return robot;
    };

    okrobo::BuiltRobot open(build(false));
    std::vector<double> open_data(static_cast<size_t>(open.sensor_data_count()));
    open.sync_sensor_data(open_data.data());
    std::fprintf(stderr, "lidar open: %.3f %.3f %.3f %.3f %.3f\n", open_data[0], open_data[1], open_data[2],
                 open_data[3], open_data[4]);
    for (double d : open_data) assert(d < 0.0 || d > 3.0);  // miss (-1) or near/at cutoff

    okrobo::BuiltRobot blocked(build(true));
    std::vector<double> blocked_data(static_cast<size_t>(blocked.sensor_data_count()));
    blocked.sync_sensor_data(blocked_data.data());
    std::fprintf(stderr, "lidar blocked: %.3f %.3f %.3f %.3f %.3f\n", blocked_data[0], blocked_data[1],
                 blocked_data[2], blocked_data[3], blocked_data[4]);
    bool any_close_hit = false;
    for (double d : blocked_data) {
        if (d >= 0.0 && d < 1.0) any_close_hit = true;
    }
    assert(any_close_hit);
}

}  // namespace

int main() {
    TestExamplesCompile();
    TestDropAndSettle();
    TestActuatorMovesJoint();
    TestEncoderReadsJointAngle();
    TestEncoderSkipsNonScalarJoint();
    TestGpsMatchesBodyPose();
    TestDistanceReadsFloorHeight();
    TestTouchDetectsFloorContact();
    TestForceTorqueNonzeroOnLoadedJoint();
    TestImuAccelerometerReadsGravityAtRest();
    TestLidarReadsOpenRangeThenBlocked();
    std::puts("built_robot: all tests passed");
    return 0;
}
