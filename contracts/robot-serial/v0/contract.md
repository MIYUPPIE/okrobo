# Robot Serial v0

The link between the OKROBO Python sidecar and a physical robot (ESP32,
Arduino, Raspberry Pi Pico). Deliberately a compact ASCII line protocol: a
microcontroller must parse it in a few hundred bytes of RAM with no allocator,
and a student must be able to read it in a serial monitor while debugging.

**Transport:** USB serial, 115200 baud, 8N1. Every message is one line
terminated by `\n` (a leading `\r` is ignored). Lines are at most 64 bytes.

## Host to board

| line | meaning |
|---|---|
| `H` | hello; the board replies `I` |
| `D <left> <right>` | drive: wheel speeds in m/s, 3 decimal places |
| `S` | stop both wheels |
| `R` | reset odometry and pose to zero |
| `Q` | query: the board replies with one state line |

Unknown or malformed lines are answered with `E <reason>` and otherwise
ignored: a board must never lock up because the host sent nonsense.

## Board to host

| line | meaning |
|---|---|
| `I <name> <version>` | identity, e.g. `I okrobo-car 1` |
| `T <tick> <x> <y> <theta> <distance> <collided>` | state: tick count, pose in metres and radians, sensor distance in metres, `0` or `1` |
| `E <reason>` | error, human readable, no spaces required |

The state line carries exactly the fields of `contracts/robot-api/v0` state, so
the sidecar maps it onto the same messages the simulator produces and the
student's program cannot tell the difference.

## Rules

- The board is the source of truth for its own pose; the host never writes it.
- The host sends `Q` at its own cadence (default 20 Hz); the board may also
  push `T` lines unprompted, and the host accepts both.
- On connect the host sends `H` and waits for `I`; a board that does not
  identify within 2 seconds is not an OKROBO robot and the port is released.
- Numbers are plain decimal with `.`; no locale, no exponents.
- Safety: if the board receives no line for 1 second it stops the wheels. A
  disconnected cable must not leave a robot driving into a wall.
