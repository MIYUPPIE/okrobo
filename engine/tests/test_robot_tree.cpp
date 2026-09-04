// Gate tests for BuildKinematicTree. Plain asserts, no framework, run by
// ctest. Mirrors apps/studio/src/builder/robotTree.test.ts case for case,
// including its cross-checks against ValidateRobotDef on the same fixtures
// (contracts/robot-def/v0/{examples,invalid}/, path baked in at configure
// time -- see engine/CMakeLists.txt's OKROBO_ROBOT_DEF_CONTRACT_DIR).

#include "robot_def.hpp"
#include "robot_tree.hpp"

#include <algorithm>
#include <cassert>
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
        std::fprintf(stderr, "robot_tree test: cannot open %s\n", path.string().c_str());
        std::abort();
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

okrobo::RobotDef LoadExample(const std::string& name) {
    return okrobo::ParseRobotDef(ReadFile(kContractDir / "examples" / (name + ".json")));
}

okrobo::RobotDef LoadInvalid(const std::string& name) {
    return okrobo::ParseRobotDef(ReadFile(kContractDir / "invalid" / (name + ".json")));
}

void AssertSingleRule(const okrobo::RobotDef& robot, const std::string& rule) {
    const auto issues = okrobo::ValidateRobotDef(robot);
    if (issues.size() != 1 || issues[0].rule != rule) {
        std::fprintf(stderr, "expected exactly one '%s' issue, got %zu\n", rule.c_str(), issues.size());
        std::abort();
    }
}

void TestSingleBody() {
    const auto robot = LoadExample("single-body");
    const auto tree = okrobo::BuildKinematicTree(robot);
    assert(tree.root_ids.size() == 1 && tree.root_ids[0] == "chassis");
    assert(tree.parent_of.empty());
    assert(tree.unreachable_ids.empty());
}

void TestTwoLinkArm() {
    const auto robot = LoadExample("two-link-arm");
    const auto tree = okrobo::BuildKinematicTree(robot);
    assert(tree.root_ids.size() == 1 && tree.root_ids[0] == "base");
    assert(tree.parent_of.at("link1") == "base");
    assert(tree.parent_of.at("link2") == "link1");
    assert(tree.parent_joint_of.at("link1")->id == "joint1");
    assert(tree.children_of.at("base") == std::vector<std::string>{"link1"});
    assert(tree.children_of.at("link1") == std::vector<std::string>{"link2"});
    assert(tree.unreachable_ids.empty());
}

// Cross-check against ValidateRobotDef's independent implementation of the
// same graph rules on the same fixtures, so the two can't silently drift
// apart (see this file's module comment).

void TestCycleAgreesWithValidate() {
    const auto robot = LoadInvalid("robot-cycle");
    AssertSingleRule(robot, "robot-cycle");

    const auto tree = okrobo::BuildKinematicTree(robot);
    assert(tree.root_ids.size() == 1 && tree.root_ids[0] == "root");
    auto unreachable = tree.unreachable_ids;
    std::sort(unreachable.begin(), unreachable.end());
    assert((unreachable == std::vector<std::string>{"p", "q", "r"}));
}

void TestDuplicateChildAgreesWithValidate() {
    const auto robot = LoadInvalid("joint-duplicate-child");
    AssertSingleRule(robot, "joint-duplicate-child");

    const auto tree = okrobo::BuildKinematicTree(robot);
    // Both joint1 and joint2 attach base->link1; the first (declaration
    // order) wins the tree edge, exactly like ValidateRobotDef's parent_of.
    assert(tree.parent_of.at("link1") == "base");
    assert(tree.parent_joint_of.at("link1")->id == "joint1");
    assert(tree.root_ids.size() == 1 && tree.root_ids[0] == "base");
    assert(tree.unreachable_ids.empty());
}

void TestUnknownParentAgreesWithValidate() {
    const auto robot = LoadInvalid("joint-unknown-parent-body");
    AssertSingleRule(robot, "joint-unknown-parent-body");

    const auto tree = okrobo::BuildKinematicTree(robot);
    // link1 is still "attached" (not a root) even though its recorded
    // parent ("ghost") doesn't resolve to a real body -- same posture as
    // ValidateRobotDef's root-counting.
    assert(tree.root_ids.size() == 1 && tree.root_ids[0] == "base");
    assert(tree.parent_of.at("link1") == "ghost");
    assert(tree.unreachable_ids.size() == 1 && tree.unreachable_ids[0] == "link1");
}

}  // namespace

int main() {
    TestSingleBody();
    TestTwoLinkArm();
    TestCycleAgreesWithValidate();
    TestDuplicateChildAgreesWithValidate();
    TestUnknownParentAgreesWithValidate();
    std::puts("robot_tree: all tests passed");
    return 0;
}
