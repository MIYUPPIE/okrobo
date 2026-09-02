# OKROBO firmware

A differential-drive robot that speaks [contracts/robot-serial/v0](../contracts/robot-serial/v0/contract.md),
so the same student program that drives the simulator drives the real robot.

```text
okrobo_car/
├── protocol.hpp     parsing + formatting (host-tested, no Arduino APIs)
└── okrobo_car.ino   pins, motors, sensor, odometry
```

## Testing without a board

`protocol.hpp` deliberately contains no Arduino calls, so the exact code that
runs on the robot is gate-tested on a workstation:

```bash
cmake -S firmware -B firmware/build && cmake --build firmware/build
ctest --test-dir firmware/build
```

`scripts/test-all.sh` runs this, plus a cross-language parity check that feeds
everything the Python side sends through this parser
(`runtime/python/tests/test_serial_parity.py`).

## Flashing

Wire the pins at the top of `okrobo_car.ino` to your motor driver and
ultrasonic sensor. Install [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/)
and its ESP32 core once (`arduino-cli core install esp32:esp32`), then either:

- **From the studio (recommended):** open the Hardware section in the
  sidebar and click the ⚡ button next to a port (or "Flash new firmware" if
  already connected). The sidecar runs `arduino-cli compile` then `upload`
  against this same `okrobo_car.ino` and streams progress into the Python
  output panel — no terminal needed. arduino-cli is checked lazily: if it
  isn't on PATH, the panel says so with the install link above instead of
  hanging or crashing.
- **By hand**, same result:

  ```bash
  # Arduino IDE: open okrobo_car/okrobo_car.ino and upload, or
  arduino-cli compile --fqbn esp32:esp32:esp32 firmware/okrobo_car
  arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/okrobo_car
  ```

Then in the studio: start the Python sidecar, open the Hardware section in the
sidebar, and pick the port. The robot answers `H` with its identity, and Run
drives the real thing.

## Safety

The board stops the wheels if it hears nothing from the host for one second, so
an unplugged cable or a closed studio cannot leave a robot driving into a wall.
