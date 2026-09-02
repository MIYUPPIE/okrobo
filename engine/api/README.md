# OKROBO C++ student API

Real, standalone, header-only C++ ports of the three student robot classes
(`runtime/python/okrobo/robot.py`, `arm.py`, `drone.py`), for students who
want to write real C++ against the simulator — no browser, no build system
beyond a C++ compiler.

The studio's C++ tab shows this: whatever program the Blocks tab builds,
rendered as real C++ against the matching header below, not a cosmetic
mock-up. It compiles and runs the same simulation the browser uses (each
header wraps the engine's own low-level `*World` class — `World`,
`ArmWorld`, `DroneWorld` in `engine/src/` — which the WASM parity gate
already locks to the Python reference model, so no simulation math is
duplicated here, only the same friendly, blocking-call shape Blocks and
Python both generate). None of this runs inside the studio itself: there is
no C++ compiler in a browser, so unlike the Python tab, this is a preview to
take and compile yourself, not something Run executes in place.

## Compile and run

From the repo root, with any C++17 compiler — one `.cpp` from `engine/src`
alongside your program, matching whichever class you use:

```sh
g++ -std=c++17 -I engine/src -I engine/api your_program.cpp engine/src/world.cpp       -o your_program   # Robot
g++ -std=c++17 -I engine/src -I engine/api your_program.cpp engine/src/arm_world.cpp   -o your_program   # Arm
g++ -std=c++17 -I engine/src -I engine/api your_program.cpp engine/src/drone_world.cpp -o your_program   # Drone
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
other language surface in this project. Each class starts at its student
API's own defaults (`Robot`/`Drone` share the same 2×2 m arena the studio's
Car and Drone do; `Arm`'s starting pose matches `arm.py`'s); pass a
`WorldConfig`/`DroneConfig`/`ArmConfig` to the constructor to match a
different world or arm geometry, the same shapes `contracts/world/v0` and
the arm's config describe.

## What's covered

- **`robot.hpp` → `okrobo::Robot`**: `forward`, `backward`, `turn_left`,
  `turn_right`, `wait`, `distance`, `lidar`, `heading`, `position`, `stop`,
  `camera` — the car's full movement/sensor/camera API.
- **`arm.hpp` → `okrobo::Arm`**: `move` (by joint name or index), `move_all`,
  `angles`, `tip`, `wait`, `stop`.
- **`drone.hpp` → `okrobo::Drone`**: `takeoff`, `land`, `forward`,
  `backward`, `up`, `down`, `turn_left`, `turn_right`, `wait`, `altitude`,
  `distance`, `heading`, `position`, `stop`.
- **`vision.hpp` → `okrobo::find_color`**: a direct port of
  `okrobo.vision.find_color` — no dependencies, works with no packs
  installed, same as the Python version. Takes the `Frame` `Robot::camera()`
  returns; other classes don't have a camera yet.

```cpp
#include "robot.hpp"
#include "vision.hpp"

int main() {
    okrobo::Robot robot;
    auto target = okrobo::find_color(robot.camera(), "red");
    if (target) { /* target->bearing, target->coverage, target->area */ }
}
```

Each class's `.engine()` accessor exposes the underlying low-level World for
anyone who wants to reach engine internals (rendering, direct state) beyond
this friendly API. Arm and Drone don't have a camera in any language yet —
this isn't a C++-specific gap.

## Tested

`engine/tests/test_robot_api.cpp`, `test_arm_api.cpp`, `test_drone_api.cpp`,
and `test_vision_api.cpp` (run by `ctest`, wired into `scripts/test-all.sh`)
each mirror their Python test file's scenarios and expected values exactly —
the same inputs are asserted against the same hand-computed numbers in both
languages, independently, which is the cross-language proof that these
headers' behavior actually matches the student-facing classes everywhere
else.
