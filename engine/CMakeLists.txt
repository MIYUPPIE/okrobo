cmake_minimum_required(VERSION 3.20)
project(okrobo_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(okrobo_engine src/world.cpp src/arm.cpp src/drone.cpp)
target_include_directories(okrobo_engine PUBLIC src)
target_compile_options(okrobo_engine PRIVATE -Wall -Wextra -Werror)

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
