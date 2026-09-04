// Gate tests for the world-def v0 reference model and validator. Plain
// asserts, no framework, run by ctest. Mirrors
// runtime/python/tests/test_world_def.py and
// apps/studio/src/contracts/worldDef.test.ts: all three read the same
// fixtures under contracts/world-def/v0/ (path baked in at configure time,
// see engine/CMakeLists.txt's OKROBO_WORLD_DEF_CONTRACT_DIR).

#include "world_def.hpp"

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

const fs::path kContractDir = OKROBO_WORLD_DEF_CONTRACT_DIR;

std::string ReadFile(const fs::path& path) {
    std::ifstream file(path);
    if (!file) {
        std::fprintf(stderr, "world_def test: cannot open %s\n", path.string().c_str());
        std::abort();
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

okrobo::WorldDef LoadExample(const std::string& name) {
    return okrobo::ParseWorldDef(ReadFile(kContractDir / "examples" / (name + ".json")));
}

okrobo::WorldDef LoadInvalid(const std::string& name) {
    return okrobo::ParseWorldDef(ReadFile(kContractDir / "invalid" / (name + ".json")));
}

void TestExamplesRoundTrip() {
    for (const std::string name : {"empty", "obstacle-course", "ramp"}) {
        const okrobo::WorldDef world = LoadExample(name);
        assert(okrobo::ValidateWorldDef(world).empty());

        const std::string serialized = okrobo::WorldDefToJson(world);
        const okrobo::WorldDef reparsed = okrobo::ParseWorldDef(serialized);
        assert(reparsed == world);
    }
}

void AssertSingleRuleAndMessage(const okrobo::WorldDef& world, const std::string& rule, const std::string& message) {
    const auto issues = okrobo::ValidateWorldDef(world);
    if (issues.size() != 1 || issues[0].rule != rule) {
        std::fprintf(stderr, "expected exactly one '%s' issue, got %zu\n", rule.c_str(), issues.size());
        std::abort();
    }
    assert(issues[0].message == message);
}

void TestInvalidFixtures() {
    AssertSingleRuleAndMessage(LoadInvalid("object-duplicate-id"), "object-duplicate-id", "Duplicate object id 'box1'");
    AssertSingleRuleAndMessage(LoadInvalid("object-invalid-geometry"), "object-invalid-geometry",
                                "Object 'box1': geometry size must be positive");
}

}  // namespace

int main() {
    TestExamplesRoundTrip();
    TestInvalidFixtures();
    std::puts("world_def: all tests passed");
    return 0;
}
