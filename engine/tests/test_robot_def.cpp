// Gate tests for the robot-def v2 engine core. Plain asserts, no framework,
// run by ctest. Mirrors runtime/python/tests/test_robot_def.py and
// apps/studio/src/contracts/robotDef.test.ts: all three read the same
// fixtures under contracts/robot-def/v2/ (path baked in at configure time,
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

// ---- CAD Kernel Phase 7.1 (v2): the new Body.features construction
// history. See docs/decisions/cad-kernel-feature-tree-data-model.md.

okrobo::RobotDef MakeRobotWithFeatures(const std::vector<okrobo::Feature>& features) {
    okrobo::Geometry cad_mesh;
    cad_mesh.type = okrobo::GeometryType::kCadMesh;
    cad_mesh.vertices = kTetrahedronVertices;
    cad_mesh.faces = kTetrahedronFaces;

    okrobo::RobotDef robot;
    robot.id = "cad-test";
    robot.name = "CAD Test";

    okrobo::Body part;
    part.id = "part";
    part.name = "Part";
    part.has_visual = true;
    part.visual = cad_mesh;
    part.has_collision = true;
    part.collision = cad_mesh;
    part.features = features;
    part.mass = 0.1;
    part.inertia = {0.001, 0.001, 0.001};
    robot.bodies.push_back(part);
    return robot;
}

okrobo::Profile MakeRectangleProfile(double width, double height) {
    okrobo::Profile p;
    p.type = okrobo::ProfileType::kRectangle;
    p.width = width;
    p.height = height;
    return p;
}

okrobo::Profile MakeCircleProfile(double radius) {
    okrobo::Profile p;
    p.type = okrobo::ProfileType::kCircle;
    p.radius = radius;
    return p;
}

okrobo::Pick MakeCadPick() {
    okrobo::Pick p;
    p.source_step = 0;
    p.local_index = 0;
    p.point = okrobo::Vec3{0.05, 0.0, 0.0};
    return p;
}

okrobo::Feature MakeExtrudeFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kExtrude;
    f.profile = MakeRectangleProfile(0.1, 0.06);
    f.depth = 0.04;
    return f;
}

okrobo::Feature MakeRevolveFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kRevolve;
    f.profile = MakeCircleProfile(0.02);
    f.offset = 0.05;
    f.angle_deg = 360.0;
    return f;
}

okrobo::Feature MakeLoftFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kLoft;
    f.start_profile = MakeCircleProfile(0.03);
    f.end_profile = MakeRectangleProfile(0.05, 0.05);
    f.height = 0.08;
    return f;
}

okrobo::Feature MakeBoxFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kBox;
    f.size = okrobo::Vec3{0.1, 0.06, 0.04};
    return f;
}

okrobo::Feature MakeCylinderFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kCylinder;
    f.radius = 0.03;
    f.length = 0.08;
    return f;
}

okrobo::Feature MakeCutFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kCut;
    f.tool.operation = okrobo::BossOperationType::kExtrude;
    f.tool.profile = MakeCircleProfile(0.01);
    f.tool.depth = 0.2;
    f.position = okrobo::Vec3{0.0, 0.0, 0.0};
    return f;
}

okrobo::Feature MakeFilletChamferFeature() {
    okrobo::Pick pick = MakeCadPick();
    pick.has_operation = true;
    pick.operation = okrobo::PickOperation::kFillet;
    pick.value = 0.005;

    okrobo::Feature f;
    f.type = okrobo::FeatureType::kFilletChamfer;
    f.picks = {pick};
    return f;
}

okrobo::Feature MakeShellFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kShell;
    f.picks = {MakeCadPick()};
    f.thickness = 0.005;
    return f;
}

okrobo::Feature MakeDraftFeature() {
    okrobo::Feature f;
    f.type = okrobo::FeatureType::kDraft;
    f.picks = {MakeCadPick()};
    f.angle_deg = 5.0;
    return f;
}

void TestFeatureParsesValidatesCleanlyAndRoundTrips() {
    const std::vector<okrobo::Feature> cases = {
        MakeExtrudeFeature(),       MakeRevolveFeature(), MakeLoftFeature(),         MakeBoxFeature(),  MakeCylinderFeature(),
        MakeCutFeature(),           MakeFilletChamferFeature(), MakeShellFeature(),  MakeDraftFeature(),
    };
    for (const auto& feature : cases) {
        const okrobo::RobotDef robot = MakeRobotWithFeatures({feature});
        assert(okrobo::ValidateRobotDef(robot).empty());
        const okrobo::RobotDef reparsed = okrobo::ParseRobotDef(okrobo::RobotDefToJson(robot));
        assert(reparsed == robot);
    }
}

void TestFeaturesPreservesAMultiStepOrderedHistory() {
    const okrobo::RobotDef robot = MakeRobotWithFeatures({MakeBoxFeature(), MakeShellFeature(), MakeDraftFeature()});
    const okrobo::RobotDef reparsed = okrobo::ParseRobotDef(okrobo::RobotDefToJson(robot));
    assert(reparsed.bodies[0].features.size() == 3);
    assert(reparsed.bodies[0].features == robot.bodies[0].features);
}

void TestFeaturesThrowsOnUnknownOperation() {
    const std::string json =
        R"({"id":"cad-test","name":"CAD Test","bodies":[{"id":"part","name":"Part","mass":0.1,)"
        R"("inertia":{"ixx":0.001,"iyy":0.001,"izz":0.001},)"
        R"("visual":{"type":"cad_mesh","vertices":[0,0,0,0.1,0,0,0,0.1,0,0,0,0.1],"faces":[0,1,2,0,1,3,0,2,3,1,2,3]},)"
        R"("features":[{"operation":"bogus"}]}]})";
    bool threw = false;
    try {
        okrobo::ParseRobotDef(json);
    } catch (const std::runtime_error&) {
        threw = true;
    }
    assert(threw);
}

void TestFeaturesThrowsOnFilletChamferWithNoPicks() {
    const std::string json =
        R"({"id":"cad-test","name":"CAD Test","bodies":[{"id":"part","name":"Part","mass":0.1,)"
        R"("inertia":{"ixx":0.001,"iyy":0.001,"izz":0.001},)"
        R"("visual":{"type":"cad_mesh","vertices":[0,0,0,0.1,0,0,0,0.1,0,0,0,0.1],"faces":[0,1,2,0,1,3,0,2,3,1,2,3]},)"
        R"("features":[{"operation":"fillet_chamfer","picks":[]}]}]})";
    bool threw = false;
    try {
        okrobo::ParseRobotDef(json);
    } catch (const std::runtime_error&) {
        threw = true;
    }
    assert(threw);
}

void TestFeaturesOmitsEmptyFeaturesFromSerialization() {
    const okrobo::RobotDef robot = MakeRobotWithFeatures({});
    assert(robot.bodies[0].features.empty());
    const std::string serialized = okrobo::RobotDefToJson(robot);
    assert(serialized.find("\"features\"") == std::string::npos);
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
    TestFeatureParsesValidatesCleanlyAndRoundTrips();
    TestFeaturesPreservesAMultiStepOrderedHistory();
    TestFeaturesThrowsOnUnknownOperation();
    TestFeaturesThrowsOnFilletChamferWithNoPicks();
    TestFeaturesOmitsEmptyFeaturesFromSerialization();
    std::puts("robot_def: all tests passed");
    return 0;
}
