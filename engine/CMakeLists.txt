cmake_minimum_required(VERSION 3.20)
project(okrobo_engine CXX)

# 20, not 17: only MuJoCo's own implementation needs it (its public C API
# header is plain-C-compatible and unaffected) — see physics_object.cpp,
# the one file in this engine that actually includes <mujoco/mujoco.h>.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The arm's graspable object (Arm.grip()/release()) is simulated by MuJoCo
# once released — see docs/decisions/physics-engine.md and physics_object.hpp
# for why. Vendored via FetchContent, the same mechanism MuJoCo's own
# CMakeLists.txt already uses for its own dependencies (ccd, qhull, etc.),
# pinned to the release tag verified in the WASM feasibility spike.
# First configure needs network access to fetch it; cached under
# engine/build/_deps afterward (gitignored, like the rest of engine/build/).
include(FetchContent)
FetchContent_Declare(
  mujoco
  GIT_REPOSITORY https://github.com/google-deepmind/mujoco
  GIT_TAG 3.9.0
  GIT_SHALLOW TRUE
)
set(MUJOCO_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(MUJOCO_BUILD_SIMULATE OFF CACHE BOOL "" FORCE)
set(MUJOCO_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(mujoco)

# robot_def.cpp's JSON parsing only -- see docs/decisions/robot-definition-schema.md
# for why a vendored parser (vs. hand-rolled) and why it's scoped to its own
# target rather than okrobo_engine. Single header, no impact on the WASM
# build: scripts/build-engine-wasm.sh hand-lists its own .cpp sources and
# robot_def.cpp is never among them.
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

add_library(okrobo_engine src/world.cpp src/arm_world.cpp src/drone_world.cpp src/physics_object.cpp)
# api/ is the header-only student SDK (engine/api/robot.hpp): real,
# standalone C++ built on the same World the parity gate locks to Python.
target_include_directories(okrobo_engine PUBLIC src api)
target_compile_options(okrobo_engine PRIVATE -Wall -Wextra -Werror)
target_link_libraries(okrobo_engine PRIVATE mujoco::mujoco)

# Robot Builder Phase 1 (contracts/robot-def/v0): parse + validate only, no
# simulation behavior. A separate target/library, deliberately never linked
# into okrobo_engine, so nlohmann/json can never reach the WASM build even
# by accident.
add_library(okrobo_robot_def src/robot_def.cpp)
target_include_directories(okrobo_robot_def PUBLIC src)
target_link_libraries(okrobo_robot_def PRIVATE nlohmann_json::nlohmann_json)
target_compile_options(okrobo_robot_def PRIVATE -Wall -Wextra -Werror)

# Robot Builder Phase 3: kinematic-tree helper for MJCF generation. Its own
# target, not added to okrobo_robot_def -- that target is documented frozen
# (contracts/robot-def/v0/contract.md) once all three language mirrors ship.
add_library(okrobo_robot_tree src/robot_tree.cpp)
target_include_directories(okrobo_robot_tree PUBLIC src)
target_link_libraries(okrobo_robot_tree PUBLIC okrobo_robot_def)
target_compile_options(okrobo_robot_tree PRIVATE -Wall -Wextra -Werror)

# Robot Builder Phase 3: MJCF generation + MuJoCo simulation for an
# arbitrary robot-def document. See docs/decisions/robot-builder-physics.md.
# nlohmann_json (Phase 4): ParseLidarParams parses a lidar sensor's
# params_json -- see docs/decisions/robot-builder-sensors.md.
add_library(okrobo_built_robot src/built_robot.cpp)
target_include_directories(okrobo_built_robot PUBLIC src)
target_link_libraries(okrobo_built_robot PUBLIC okrobo_robot_tree)
target_link_libraries(okrobo_built_robot PRIVATE mujoco::mujoco)
target_link_libraries(okrobo_built_robot PRIVATE nlohmann_json::nlohmann_json)
target_compile_options(okrobo_built_robot PRIVATE -Wall -Wextra -Werror)

enable_testing()

# The tests assert. A Release build defines NDEBUG, which compiles assert()
# away and would make every suite pass without checking anything, so keep
# assertions live in test targets whatever the build type.
function(okrobo_add_test target source)
  add_executable(${target} ${source})
  target_link_libraries(${target} PRIVATE okrobo_engine)
  target_compile_options(${target} PRIVATE -UNDEBUG -Wall -Wextra -Werror)
endfunction()

okrobo_add_test(test_world tests/test_world.cpp)
add_test(NAME world COMMAND test_world)

okrobo_add_test(test_arm tests/test_arm.cpp)
add_test(NAME arm COMMAND test_arm)

# Phase 1 adds an Emscripten target here exporting the contract v0 surface
# (create_world / send_command / step / get_state) to apps/studio.

okrobo_add_test(test_camera tests/test_camera.cpp)
add_test(NAME camera COMMAND test_camera)

okrobo_add_test(test_drone tests/test_drone.cpp)
add_test(NAME drone COMMAND test_drone)

okrobo_add_test(test_robot_api tests/test_robot_api.cpp)
add_test(NAME robot_api COMMAND test_robot_api)

okrobo_add_test(test_arm_api tests/test_arm_api.cpp)
add_test(NAME arm_api COMMAND test_arm_api)

okrobo_add_test(test_drone_api tests/test_drone_api.cpp)
add_test(NAME drone_api COMMAND test_drone_api)

okrobo_add_test(test_vision_api tests/test_vision_api.cpp)
add_test(NAME vision_api COMMAND test_vision_api)

okrobo_add_test(test_arm_physics tests/test_arm_physics.cpp)
add_test(NAME arm_physics COMMAND test_arm_physics)

# Not okrobo_add_test: robot_def has nothing to do with okrobo_engine and
# must not link it (see the target's own comment above).
add_executable(test_robot_def tests/test_robot_def.cpp)
target_link_libraries(test_robot_def PRIVATE okrobo_robot_def)
target_compile_options(test_robot_def PRIVATE -UNDEBUG -Wall -Wextra -Werror)
# Baked in at configure time so the test finds the fixtures regardless of
# ctest's working directory, rather than guessing from __FILE__ or CWD.
target_compile_definitions(test_robot_def PRIVATE
  OKROBO_ROBOT_DEF_CONTRACT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../contracts/robot-def/v0")
add_test(NAME robot_def COMMAND test_robot_def)

add_executable(test_robot_tree tests/test_robot_tree.cpp)
target_link_libraries(test_robot_tree PRIVATE okrobo_robot_tree)
target_compile_options(test_robot_tree PRIVATE -UNDEBUG -Wall -Wextra -Werror)
target_compile_definitions(test_robot_tree PRIVATE
  OKROBO_ROBOT_DEF_CONTRACT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../contracts/robot-def/v0")
add_test(NAME robot_tree COMMAND test_robot_tree)

add_executable(test_built_robot tests/test_built_robot.cpp)
target_link_libraries(test_built_robot PRIVATE okrobo_built_robot)
target_compile_options(test_built_robot PRIVATE -UNDEBUG -Wall -Wextra -Werror)
target_compile_definitions(test_built_robot PRIVATE
  OKROBO_ROBOT_DEF_CONTRACT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../contracts/robot-def/v0")
add_test(NAME built_robot COMMAND test_built_robot)
