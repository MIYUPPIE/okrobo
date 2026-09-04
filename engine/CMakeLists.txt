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

add_library(okrobo_engine src/world.cpp src/arm_world.cpp src/drone_world.cpp src/physics_object.cpp)
# api/ is the header-only student SDK (engine/api/robot.hpp): real,
# standalone C++ built on the same World the parity gate locks to Python.
target_include_directories(okrobo_engine PUBLIC src api)
target_compile_options(okrobo_engine PRIVATE -Wall -Wextra -Werror)
target_link_libraries(okrobo_engine PRIVATE mujoco::mujoco)

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
