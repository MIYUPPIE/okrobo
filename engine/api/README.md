# OKROBO C++ student API

A real, standalone, header-only C++ port of the student `Robot` API
(`runtime/python/okrobo/robot.py`), for students who want to write real C++
against the simulator — no browser, no build system beyond a C++ compiler.

The studio's C++ tab shows this: whatever program the Blocks tab builds,
rendered as real C++ against this exact header, not a cosmetic mock-up. It
compiles and runs the same simulation the browser uses (this header wraps
`engine/src/world.hpp`'s `World`, which the WASM parity gate already locks
to the Python reference model — no simulation math is duplicated here, only
the same friendly, blocking-call shape Blocks and Python both generate).
It does not run inside the studio itself: there is no C++ compiler in a
browser, so unlike the Python tab, this is a preview to take and compile
yourself, not something Run executes in place.

## Compile and run

From the repo root, with any C++17 compiler:

```sh
g++ -std=c++17 -I engine/src -I engine/api your_program.cpp engine/src/world.cpp -o your_program
./your_program
```

```cpp
// your_program.cpp
#include "robot.hpp"

int main() {
    okrobo::Robot robot;
    robot.forward(0.3);
    if (robot.distance() < 0.2) robot.turn_left();
}
```

Distances are meters, angles are degrees — the same convention as every
other language surface in this project. `Robot` starts at the same default
2×2 m arena the studio's Car does (`WorldConfig{}`); pass a `WorldConfig` to
the constructor to match a different world, the same shape
`contracts/world/v0` describes.

## What's covered

`forward`, `backward`, `turn_left`, `turn_right`, `wait`, `distance`,
`lidar`, `heading`, `position`, `stop` — the car's full API. Camera and
computer vision aren't ported to C++ yet; `Robot::engine()` exposes the
underlying `World` for anyone who wants to reach the engine's own camera
render function (`engine/src/camera.hpp`) directly. Arm and Drone don't have
a C++ SDK yet either — this covers the car, matching how the very first
Python API did (Phase 2), with the others following the same pattern later
if there's demand.

## Tested

`engine/tests/test_robot_api.cpp` (run by `ctest`, wired into
`scripts/test-all.sh`) mirrors `runtime/python/tests/test_robot.py`'s
scenarios and expected values exactly — the same inputs are asserted
against the same hand-computed numbers in both languages, independently,
which is the cross-language proof that this header's behavior actually
matches the student-facing `Robot` class everywhere else.
