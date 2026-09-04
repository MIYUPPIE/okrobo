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

}  // namespace

int main() {
    TestExamplesCompile();
    TestDropAndSettle();
    TestActuatorMovesJoint();
    std::puts("built_robot: all tests passed");
    return 0;
}
