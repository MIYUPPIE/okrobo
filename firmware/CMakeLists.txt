cmake_minimum_required(VERSION 3.20)
project(okrobo_firmware CXX)

# Host build of the firmware's protocol code so it can be gate-tested without
# a board. The .ino includes the same header and adds only Arduino glue.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

enable_testing()

# Keep assert() live even in Release: NDEBUG would compile the assertions away
# and the suite would pass without testing anything.
add_executable(test_protocol tests/test_protocol.cpp)
target_include_directories(test_protocol PRIVATE okrobo_car)
target_compile_options(test_protocol PRIVATE -UNDEBUG -Wall -Wextra -Werror)
add_test(NAME firmware_protocol COMMAND test_protocol)

# Parses stdin with the board's real parser so the Python side can be checked
# against it (runtime/python/tests/test_serial_parity.py).
add_executable(protocol_cli tests/protocol_cli.cpp)
target_include_directories(protocol_cli PRIVATE okrobo_car)
target_compile_options(protocol_cli PRIVATE -Wall -Wextra -Werror)
