// Gate tests for the robot-def v0 engine core. Plain asserts, no framework,
// run by ctest. Mirrors runtime/python/tests/test_robot_def.py and
// apps/studio/src/contracts/robotDef.test.ts: all three read the same
// fixtures under contracts/robot-def/v0/ (path baked in at configure time,
// see engine/CMakeLists.txt's OKROBO_ROBOT_DEF_CONTRACT_DIR).

#include "robot_def.hpp"

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
        std::fprintf(stderr, "robot_def test: cannot open %s\n", path.string().c_str());
        std::abort();
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

void TestExampleRoundTrips(const std::string& name) {
    const std::string text = ReadFile(kContractDir / "examples" / (name + ".json"));
    const okrobo::RobotDef robot = okrobo::ParseRobotDef(text);
    assert(okrobo::ValidateRobotDef(robot).empty());

    const std::string serialized = okrobo::RobotDefToJson(robot);
    const okrobo::RobotDef reparsed = okrobo::ParseRobotDef(serialized);
    assert(reparsed == robot);
}

void TestInvalidFixturesTriggerExactlyTheirRule() {
    const fs::path invalid_dir = kContractDir / "invalid";
    int fixture_count = 0;
    for (const auto& entry : fs::directory_iterator(invalid_dir)) {
        if (entry.path().extension() != ".json") continue;
        ++fixture_count;
        const std::string rule = entry.path().stem().string();
        const okrobo::RobotDef robot = okrobo::ParseRobotDef(ReadFile(entry.path()));
        const std::vector<okrobo::ValidationIssue> issues = okrobo::ValidateRobotDef(robot);
        if (issues.size() != 1 || issues[0].rule != rule) {
            std::fprintf(stderr, "%s.json: expected exactly one '%s' issue, got %zu issue(s):", rule.c_str(), rule.c_str(), issues.size());
            for (const auto& issue : issues) std::fprintf(stderr, " [%s]", issue.rule.c_str());
            std::fprintf(stderr, "\n");
            std::abort();
        }
    }
    if (fixture_count == 0) {
        std::fprintf(stderr, "robot_def test: no fixtures found under %s\n", invalid_dir.string().c_str());
        std::abort();
    }
}

}  // namespace

int main() {
    TestExampleRoundTrips("single-body");
    TestExampleRoundTrips("two-link-arm");
    TestInvalidFixturesTriggerExactlyTheirRule();
    std::puts("robot_def: all tests passed");
    return 0;
}
