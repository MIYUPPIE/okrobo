// Gate tests for the robot-def v1 engine core. Plain asserts, no framework,
// run by ctest. Mirrors runtime/python/tests/test_robot_def.py and
// apps/studio/src/contracts/robotDef.test.ts: all three read the same
// fixtures under contracts/robot-def/v1/ (path baked in at configure time,
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

// ---- CAD Kernel Phase 1: the new cad_mesh geometry variant. See
// docs/decisions/cad-kernel-foundation.md.

// A tetrahedron: 4 vertices, 4 triangular faces.
const std::vector<double> kTetrahedronVertices = {0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1};
const std::vector<int32_t> kTetrahedronFaces = {0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3};

okrobo::RobotDef MakeRobotWithCadMesh(const okrobo::Geometry& visual, bool has_collision, const okrobo::Geometry& collision) {
    okrobo::RobotDef robot;
    robot.id = "cad-test";
    robot.name = "CAD Test";

    okrobo::Body part;
    part.id = "part";
    part.name = "Part";
    part.has_visual = true;
    part.visual = visual;
    part.has_collision = has_collision;
    part.collision = collision;
    part.mass = 0.1;
    part.inertia = {0.001, 0.001, 0.001};
    robot.bodies.push_back(part);
    return robot;
}

void TestCadMeshParsesValidatesCleanlyAndRoundTrips() {
    okrobo::Geometry geometry;
    geometry.type = okrobo::GeometryType::kCadMesh;
    geometry.vertices = kTetrahedronVertices;
    geometry.faces = kTetrahedronFaces;

    const okrobo::RobotDef robot = MakeRobotWithCadMesh(geometry, true, geometry);
    assert(okrobo::ValidateRobotDef(robot).empty());

    const okrobo::RobotDef reparsed = okrobo::ParseRobotDef(okrobo::RobotDefToJson(robot));
    assert(reparsed == robot);
}

void TestCadMeshRejectsNonMultipleOf3Vertices() {
    okrobo::Geometry bad;
    bad.type = okrobo::GeometryType::kCadMesh;
    bad.vertices = {0.0, 0.0};
    bad.faces = {0, 0, 0};

    const okrobo::RobotDef robot = MakeRobotWithCadMesh(bad, false, okrobo::Geometry{});
    const std::vector<okrobo::ValidationIssue> issues = okrobo::ValidateRobotDef(robot);
    assert(issues.size() == 1);
    assert(issues[0].rule == "body-invalid-geometry");
    assert(issues[0].element_id == "part");
}

void TestCadMeshRejectsFaceIndexOutOfRange() {
    okrobo::Geometry bad;
    bad.type = okrobo::GeometryType::kCadMesh;
    bad.vertices = kTetrahedronVertices;
    bad.faces = {0, 1, 99};

    const okrobo::RobotDef robot = MakeRobotWithCadMesh(bad, false, okrobo::Geometry{});
    const std::vector<okrobo::ValidationIssue> issues = okrobo::ValidateRobotDef(robot);
    assert(issues.size() == 1);
    assert(issues[0].rule == "body-invalid-geometry");
    assert(issues[0].element_id == "part");
}

void TestCadMeshParseThrowsOnNegativeFaceIndex() {
    const std::string json =
        R"({"id":"cad-test","name":"CAD Test","bodies":[{"id":"part","name":"Part","mass":0.1,)"
        R"("inertia":{"ixx":0.001,"iyy":0.001,"izz":0.001},)"
        R"("visual":{"type":"cad_mesh","vertices":[0,0,0,0.1,0,0,0,0.1,0],"faces":[-1,0,0]}}]})";
    bool threw = false;
    try {
        okrobo::ParseRobotDef(json);
    } catch (const std::runtime_error&) {
        threw = true;
    }
    assert(threw);
}

}  // namespace

int main() {
    TestExampleRoundTrips("single-body");
    TestExampleRoundTrips("two-link-arm");
    TestExampleRoundTrips("cad-l-bracket");
    TestInvalidFixturesTriggerExactlyTheirRule();
    TestCadMeshParsesValidatesCleanlyAndRoundTrips();
    TestCadMeshRejectsNonMultipleOf3Vertices();
    TestCadMeshRejectsFaceIndexOutOfRange();
    TestCadMeshParseThrowsOnNegativeFaceIndex();
    std::puts("robot_def: all tests passed");
    return 0;
}
