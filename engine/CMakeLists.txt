cmake_minimum_required(VERSION 3.20)
project(okrobo_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(okrobo_engine src/world.cpp src/arm.cpp)
target_include_directories(okrobo_engine PUBLIC src)
target_compile_options(okrobo_engine PRIVATE -Wall -Wextra -Werror)

enable_testing()
add_executable(test_world tests/test_world.cpp)
target_link_libraries(test_world PRIVATE okrobo_engine)
add_test(NAME world COMMAND test_world)

add_executable(test_arm tests/test_arm.cpp)
target_link_libraries(test_arm PRIVATE okrobo_engine)
add_test(NAME arm COMMAND test_arm)

# Phase 1 adds an Emscripten target here exporting the contract v0 surface
# (create_world / send_command / step / get_state) to apps/studio.
